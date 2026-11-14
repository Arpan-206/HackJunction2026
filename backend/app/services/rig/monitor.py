"""Live watchers behind the status screen: app frame rates, the driver's RCSP devices and events, and an RGMP tap.

The RCSP side uses the core's RcspClient and only lists devices, reads device info and subscribes to events; the one
command that changes anything is ReinitAlgo, sent from the calibration area. The tap reads the driver's RGMP stream
with the core's parser for STATUS_FLAGS and frame rates only: it never produces hands, so the core stays the only
glove data path.
"""

import asyncio
import contextlib
import logging
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app import constants as c
from app.schemas.common import Side
from app.schemas.frames import GloveFrame
from app.services.rig import core_link
from app.services.rig.diagnosis import (
    decode_flags,
    device_connection,
    find_battery,
    saturation_words,
    sensor_name,
    side_from_info,
)

log = logging.getLogger(__name__)


class RateMeter:
    """Arrival times in a sliding window: frames per second and the age of the newest frame."""

    def __init__(
        self,
        window_s: float = c.GLOVE_RATE_WINDOW_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Empty meter."""
        self.window_s = window_s
        self.clock = clock
        self.times: deque[float] = deque()

    def tick(self, now: float | None = None) -> None:
        """Record one frame."""
        t = self.clock() if now is None else now
        self.times.append(t)
        while self.times and self.times[0] < t - self.window_s:
            self.times.popleft()

    def fps(self, now: float | None = None) -> float | None:
        """Frames per second over the window, or None before two frames or after the stream went quiet."""
        t = self.clock() if now is None else now
        recent = [x for x in self.times if x >= t - self.window_s]
        if len(recent) < 2:
            return None
        span = recent[-1] - recent[0]
        return round((len(recent) - 1) / span, 1) if span > 0 else None

    def age_s(self, now: float | None = None) -> float | None:
        """Seconds since the newest frame, or None before any."""
        if not self.times:
            return None
        return (self.clock() if now is None else now) - self.times[-1]


class FrameStats:
    """Per-hand rate of the frames the backend actually streams (a GloveManager sink)."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        """One meter per hand."""
        self.meters: dict[str, RateMeter] = {s: RateMeter(clock=clock) for s in c.SIDES}

    def push(self, frame: GloveFrame) -> None:
        """Count each hand in the frame."""
        for hand in frame.hands:
            self.meters[hand.side].tick()


@dataclass
class RcspDevice:
    """One device from ListDevices plus what GetDeviceInfo said about it."""

    device_id: int
    device_type: str
    connection: str | None
    side: Side | None
    battery_pct: float | None
    raw: dict[str, Any] = field(default_factory=dict)


def rcsp_device(
    listed: dict[str, Any], info: dict[str, Any], known: "RcspDevice | None" = None
) -> RcspDevice:
    """Merge one ListDevices entry and its GetDeviceInfo response (both as the driver sends them)."""
    battery = find_battery(listed)
    return RcspDevice(
        device_id=int(listed.get("DeviceId", -1)),
        device_type=str(listed.get("DeviceType", "")),
        connection=device_connection(listed),
        side=side_from_info(info) or (known.side if known else None),
        battery_pct=battery if battery is not None else find_battery(info),
        raw={"device": listed, "info": info},
    )


class DriverMonitor:
    """Holds one RCSP connection to the driver: the device list, saturation events and recent driver log lines."""

    def __init__(
        self, host: str = c.ROKOKO_DRIVER_HOST, port: int = c.ROKOKO_RCSP_PORT
    ) -> None:
        """Nothing connects until start()."""
        self.host, self.port = host, port
        self.devices: dict[int, RcspDevice] = {}
        self.saturation_events: dict[int, dict[str, float]] = {}
        self.log_lines: deque[str] = deque(maxlen=c.ROKOKO_LOG_KEEP)
        self._client: Any = None
        self._refresh: asyncio.Task[None] | None = None

    @property
    def connected(self) -> bool:
        """True while the RCSP socket is up."""
        return bool(self._client is not None and self._client.connected.is_set())

    async def start(self) -> None:
        """Connect in the background (the core's client reconnects by itself)."""
        mod = core_link.rcsp()
        if mod is None:
            return
        self._client = mod.RcspClient(
            self.host,
            self.port,
            on_event=self.on_event,
            reconnect_s=c.ROKOKO_RCSP_RECONNECT_S,
        )
        self._client.on_connect = self._on_connect
        await self._client.start()
        self._refresh = asyncio.create_task(self._refresh_loop())

    async def stop(self) -> None:
        """Close the connection."""
        if self._refresh:
            self._refresh.cancel()
        if self._client is not None:
            await self._client.stop()

    async def _on_connect(self) -> None:
        """Subscribe to device events and driver logs, then read the device list."""
        try:
            await self._client.command(
                "Subscribe",
                {
                    "Publishers": [
                        {
                            "Publisher": "DeviceEvents",
                            "Topics": list(c.ROKOKO_EVENT_TOPICS),
                        },
                        {"Publisher": "Logs", "Topics": list(c.ROKOKO_LOG_TOPICS)},
                    ]
                },
                timeout=c.ROKOKO_RCSP_TIMEOUT_S,
            )
        except Exception as exc:
            log.info("RCSP Subscribe failed: %s", exc)
        await self.refresh()

    async def _refresh_loop(self) -> None:
        """Re-read the device list every few seconds while connected."""
        while True:
            await asyncio.sleep(c.ROKOKO_DEVICE_REFRESH_S)
            if self.connected:
                await self.refresh()

    async def refresh(self) -> None:
        """ListDevices, then GetDeviceInfo for each device (read-only)."""
        try:
            listed = await self._client.command(
                "ListDevices", timeout=c.ROKOKO_RCSP_TIMEOUT_S
            )
        except Exception as exc:
            log.debug("ListDevices failed: %s", exc)
            return
        found: dict[int, RcspDevice] = {}
        for d in listed.get("Devices", []):
            did = int(d.get("DeviceId", -1))
            if did < 0 or d.get("IsBootloader"):
                continue
            info: dict[str, Any] = {}
            with contextlib.suppress(Exception):
                info = await self._client.command(
                    "GetDeviceInfo", {"DeviceId": did}, timeout=c.ROKOKO_RCSP_TIMEOUT_S
                )
            found[did] = rcsp_device(d, info, self.devices.get(did))
        self.devices = found

    def on_event(self, body: dict[str, Any]) -> None:
        """Keep saturation events per device and driver log lines; refresh the list on connect or disconnect."""
        topic = str(body.get("Topic", ""))
        data = body.get("EventData") or {}
        if topic in c.GLOVE_SATURATION_EVENTS:
            did = int(data.get("DeviceId", -1)) if isinstance(data, dict) else -1
            self.saturation_events.setdefault(did, {})[
                c.GLOVE_SATURATION_EVENTS[topic]
            ] = time.monotonic()
        elif topic in c.ROKOKO_LOG_TOPICS:
            text = data.get("Message") if isinstance(data, dict) else None
            self.log_lines.append(f"{topic}: {text if text is not None else data}")
        elif topic in ("Connected", "Disconnected") and self.connected:
            asyncio.get_running_loop().create_task(self.refresh())

    def recent_saturation(self, device_id: int) -> list[str]:
        """Sensor words saturated by an RCSP event in the last few seconds."""
        now = time.monotonic()
        return [
            w
            for w, t in self.saturation_events.get(device_id, {}).items()
            if now - t < c.GLOVE_SATURATION_EVENT_HOLD_S
        ]

    def gloves(self) -> list[RcspDevice]:
        """The listed devices that are gloves."""
        return [d for d in self.devices.values() if "glove" in d.device_type.lower()]

    async def reinit(self) -> int:
        """RCSP ReinitAlgo on every glove: Rokoko's documented re-initialisation of the sensor fusion."""
        if not self.connected:
            return 0
        done = 0
        for d in self.gloves():
            try:
                await self._client.command(
                    "ReinitAlgo",
                    {"DeviceId": d.device_id},
                    timeout=c.ROKOKO_RCSP_TIMEOUT_S,
                )
                done += 1
            except Exception as exc:
                log.warning("ReinitAlgo(%d) failed: %s", d.device_id, exc)
        return done


@dataclass
class TapDevice:
    """One glove as seen on the driver's RGMP stream.

    Real captures (Smartgloves II, driver 1.9.7) send two groups at 83.33 Hz each, `default` and `emf_only`, so only
    the first group is counted for the rate. Saturation bits flicker for single frames when a hand moves fast, so a
    flag counts as current for GLOVE_SATURATION_EVENT_HOLD_S after it was last seen.
    """

    device_id: int
    side: Side | None
    clock: Callable[[], float] = time.monotonic
    meter: RateMeter = field(default_factory=RateMeter)
    heading: bool | None = None
    battery_pct: float | None = None
    saturated_at: dict[str, dict[str, float]] = field(default_factory=dict)
    heading_samples: deque[bool] = field(default_factory=lambda: deque(maxlen=512))
    defined_at: float | None = None
    frames: int = 0

    def streaming(self, now: float | None = None) -> bool | None:
        """True once data frames arrive; False when only the definition came for ROKOKO_SUBSCRIBE_GRACE_S.

        The driver sends definitions to any RGMP client but data only while some RCSP client holds SubscribeToData
        for the glove (docs/HARDWARE_INTEGRATION.md), so False means nobody subscribed, not a glove fault.
        """
        if self.frames:
            return True
        if self.defined_at is None:
            return None
        t = self.clock() if now is None else now
        return False if t - self.defined_at >= c.ROKOKO_SUBSCRIBE_GRACE_S else None

    def saturation(self, now: float | None = None) -> dict[str, list[str]]:
        """Sensor name to the saturated parts seen within the hold window."""
        t = self.clock() if now is None else now
        out: dict[str, list[str]] = {}
        for sensor, words in self.saturated_at.items():
            recent = [
                w for w, at in words.items() if t - at < c.GLOVE_SATURATION_EVENT_HOLD_S
            ]
            if recent:
                out[sensor] = recent
        return out


class DriverTap:
    """Reads the driver's RGMP (12276) for STATUS_FLAGS and per-glove rates, with the core's RgmpParser.

    It connects whenever the driver port answers: RGMP serves many readers, and definitions arrive even before any program
    subscribes, which is how the status tells "nobody subscribed" from a missing glove.
    """

    def __init__(
        self,
        port_open: Callable[[str, int], bool],
        host: str = c.ROKOKO_DRIVER_HOST,
        port: int = c.ROKOKO_DRIVER_RGMP_PORT,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Nothing connects until start()."""
        self.host, self.port = host, port
        self.port_open = port_open
        self.clock = clock
        self.devices: dict[int, TapDevice] = {}
        self.connected = False
        self._parser: Any = None
        self._task: asyncio.Task[None] | None = None
        self._mod: Any = None

    async def start(self) -> None:
        """Run the read loop in the background."""
        self._mod = core_link.rgmp()
        if self._mod is not None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        """Stop reading."""
        if self._task:
            self._task.cancel()

    async def _run(self) -> None:
        """Connect while the driver is up, read, reconnect."""
        while True:
            if await asyncio.to_thread(self.port_open, self.host, self.port):
                try:
                    reader, writer = await asyncio.open_connection(self.host, self.port)
                except OSError:
                    reader = writer = None
                if reader is not None and writer is not None:
                    self._parser = self._mod.RgmpParser()
                    self.connected = True
                    try:
                        while data := await reader.read(65536):
                            self.feed(data)
                    except (OSError, asyncio.IncompleteReadError):
                        pass
                    finally:
                        self.connected = False
                        self.devices.clear()
                        writer.close()
            await asyncio.sleep(c.ROKOKO_TAP_RECONNECT_S)

    def feed(self, data: bytes) -> None:
        """Parse bytes and update the per-device state."""
        if self._parser is None:
            self._mod = self._mod or core_link.rgmp()
            if self._mod is None:
                return
            self._parser = self._mod.RgmpParser()
        for kind, payload in self._parser.feed(data):
            if kind == "definition":
                self._on_definition(payload)
            elif kind == "data":
                self._on_data(payload)
            elif kind == "disconnect":
                self.devices.pop(int(payload), None)

    def _on_definition(self, d: Any) -> None:
        """A glove's definition: remember its side (device_info.hand) and any battery in its static data."""
        if "glove" not in d.device_type.lower():
            return
        dev = TapDevice(
            device_id=d.device_id,
            side=side_from_info(d.device_info),
            clock=self.clock,
            meter=RateMeter(clock=self.clock),
            defined_at=self.clock(),
        )
        for entry in d.static_data:
            if (
                "battery"
                in f"{entry.get('custom_label', '')} {entry.get('target_frame', '')}".lower()
            ):
                value = entry.get("value")
                dev.battery_pct = find_battery(
                    {
                        "battery": value[0]
                        if isinstance(value, list) and value
                        else value
                    }
                )
        self.devices[d.device_id] = dev

    def _on_data(self, f: Any) -> None:
        """Count the frame (first group only) and decode its STATUS_FLAGS streams by bit name."""
        dev = self.devices.get(f.device_id)
        if dev is None:
            return
        dev.frames += 1
        if f.group.index == 0:
            dev.meter.tick()
        now = self.clock()
        for stream in f.group.streams:
            if stream.measure_type == "STATUS_FLAGS":
                # Coil Pro streams describe the arm against a Coil Pro; without one their bits mean nothing here.
                if "coil" in stream.reference_frame.lower():
                    continue
                flags = decode_flags(
                    stream.raw.get("bit_mapping"), int(f.value(stream)[0])
                )
                if c.GLOVE_HEADING_FLAG in flags:
                    dev.heading = flags[c.GLOVE_HEADING_FLAG]
                    dev.heading_samples.append(dev.heading)
                sensor = sensor_name(stream.target_frame)
                if sensor is not None:
                    for word in saturation_words(flags):
                        dev.saturated_at.setdefault(sensor, {})[word] = now
            elif (
                "battery"
                in f"{stream.raw.get('custom_label', '')} {stream.target_frame}".lower()
            ):
                dev.battery_pct = find_battery({"battery": float(f.value(stream)[0])})

    def by_side(self, side: Side) -> TapDevice | None:
        """The tap's view of a hand's glove, if any."""
        return next((d for d in self.devices.values() if d.side == side), None)
