"""RCSP client: devices, glove button events and the ring LED. TCP 45451, JSON with an 8-byte header."""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import time
from collections.abc import Callable
from typing import Any

log = logging.getLogger("geppetto.rcsp")

HEADER = struct.Struct(
    "<BBBBI"
)  # marker 0xDC, version 1, header size 8, type, body length (LE)
MARKER, VERSION, HEADER_SIZE = 0xDC, 1, 8
MAX_BODY = 8_000_000
T_COMMAND, T_OK, T_ERROR, T_EVENT = 1, 2, 3, 4

LED_COLOURS = {
    "idle": (0, 60, 255),  # blue: tracked and idle
    "recording": (255, 0, 0),  # red
    "marked": (255, 255, 255),  # white flash
    "passed": (0, 255, 0),  # green for 1 s
    "busy": (255, 140, 0),  # amber: calibrating or waiting
    "heading": (255, 0, 255),  # magenta: heading not reliable
    "off": (0, 0, 0),
}


def pack(msg_type: int, body: dict) -> bytes:
    data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    return HEADER.pack(MARKER, VERSION, HEADER_SIZE, msg_type, len(data)) + data


class RcspParser:
    def __init__(self) -> None:
        self.buf = bytearray()

    def feed(self, data: bytes) -> list[tuple[int, dict]]:
        self.buf += data
        out = []
        while len(self.buf) >= HEADER_SIZE:
            marker, version, hsize, mtype, length = HEADER.unpack_from(self.buf, 0)
            if (
                marker != MARKER
                or version != VERSION
                or hsize not in (0, HEADER_SIZE)
                or mtype not in (T_COMMAND, T_OK, T_ERROR, T_EVENT)
                or length > MAX_BODY
            ):
                del self.buf[0]  # not a header: resync one byte further
                continue
            hsize = hsize or HEADER_SIZE
            if len(self.buf) < hsize + length:
                break
            body = bytes(self.buf[hsize : hsize + length])
            del self.buf[: hsize + length]
            try:
                parsed = json.loads(body.decode("utf-8")) if body else {}
            except (json.JSONDecodeError, UnicodeDecodeError):
                log.warning("RCSP body is not JSON: %r", body[:80])
                continue
            if not isinstance(parsed, dict):
                log.warning("RCSP body is not an object: %r", body[:80])
                continue
            out.append((mtype, parsed))
        return out


class RcspError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code, self.message = code, message


class RcspClient:
    def __init__(
        self,
        host: str,
        port: int,
        on_event: Callable[[dict], None] | None = None,
        reconnect_s: float = 2.0,
    ) -> None:
        self.host, self.port = host, int(port)
        self.on_event = on_event
        self.reconnect_s = reconnect_s
        self.parser = RcspParser()
        self._pending: dict[str, asyncio.Future] = {}
        self._track = 0
        self._writer: asyncio.StreamWriter | None = None
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.connected = asyncio.Event()
        self.on_connect: Callable[[], Any] | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stop.set()
        if self._writer:
            self._writer.close()
        if self._task:
            self._task.cancel()

    async def _run(self) -> None:
        while not self._stop.is_set():
            try:
                reader, writer = await asyncio.open_connection(self.host, self.port)
                self._writer = writer
                self.connected.set()
                log.info("RCSP connected to %s:%d", self.host, self.port)
                if self.on_connect:
                    asyncio.create_task(self._safe(self.on_connect))
                while not self._stop.is_set():
                    data = await reader.read(65536)
                    if not data:
                        break
                    for mtype, body in self.parser.feed(data):
                        try:
                            self._dispatch(mtype, body)
                        except Exception:
                            log.exception("RCSP message handling failed")
            except (ConnectionRefusedError, OSError) as e:
                self._failures = getattr(self, "_failures", 0) + 1
                (log.warning if self._failures <= 2 else log.debug)(
                    "RCSP connect to %s:%d failed: %s; retrying every %.1fs%s",
                    self.host,
                    self.port,
                    e,
                    self.reconnect_s,
                    " (further retries logged at debug level)"
                    if self._failures == 2
                    else "",
                )
            finally:
                self.connected.clear()
                if self._writer is not None:
                    self._writer.close()
                self._writer = None
                for fut in self._pending.values():
                    if not fut.done():
                        fut.set_exception(RcspError("disconnected", "connection lost"))
                self._pending.clear()
            await asyncio.sleep(self.reconnect_s)

    async def _safe(self, fn):
        try:
            r = fn()
            if asyncio.iscoroutine(r):
                await r
        except Exception:
            log.exception("RCSP on_connect failed")

    def _dispatch(self, mtype: int, body: dict) -> None:
        if mtype == T_EVENT:
            if self.on_event:
                try:
                    self.on_event(body)
                except Exception:
                    log.exception("RCSP event handler failed")
            return
        tid = str(body.get("TrackId", ""))
        fut = self._pending.pop(tid, None)
        if fut is None or fut.done():
            return
        if mtype == T_OK:
            fut.set_result(body.get("Response") or {})
        else:
            err = body.get("Error") or {}
            fut.set_exception(
                RcspError(
                    str(err.get("Code", "error")),
                    str(err.get("Message", body.get("Status", ""))),
                )
            )

    async def command(
        self, name: str, arguments: dict | None = None, timeout: float = 5.0
    ) -> dict:
        if self._writer is None:
            raise RcspError("disconnected", "not connected")
        self._track += 1
        tid = str(self._track)
        body = {"Command": name, "TrackId": tid, "Version": 1}
        if arguments:
            body["Arguments"] = arguments
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[tid] = fut
        self._writer.write(pack(T_COMMAND, body))
        await self._writer.drain()
        try:
            return await asyncio.wait_for(fut, timeout)
        except TimeoutError:
            self._pending.pop(tid, None)
            raise RcspError("timeout", f"{name} got no reply in {timeout}s")

    # -- the commands we use ---------------------------------------------------
    async def list_devices(self) -> list[dict]:
        return list((await self.command("ListDevices")).get("Devices", []))

    async def get_device_info(self, device_id: int) -> dict:
        return await self.command("GetDeviceInfo", {"DeviceId": device_id})

    async def subscribe_to_data(self, device_id: int) -> dict:
        return await self.command("SubscribeToData", {"DeviceId": device_id})

    async def device_subscribe(self, device_id: int, topics=("ButtonPushed",)) -> dict:
        return await self.command(
            "DeviceSubscribe",
            {
                "DeviceId": device_id,
                "Publishers": [{"Publisher": "DeviceEvents", "Topics": list(topics)}],
            },
        )

    async def subscribe(self, topics=("Connected", "Disconnected")) -> dict:
        return await self.command(
            "Subscribe",
            {"Publishers": [{"Publisher": "DeviceEvents", "Topics": list(topics)}]},
        )

    async def set_color_led(
        self, device_id: int, rgb: tuple[int, int, int], led: str = "RingLed"
    ) -> dict:
        r, g, b = (int(max(0, min(255, c))) for c in rgb)
        return await self.command(
            "SetColorLed",
            {"DeviceId": device_id, "LedId": led, "Red": r, "Green": g, "Blue": b},
        )

    async def reinit_algo(self, device_id: int) -> dict:
        return await self.command("ReinitAlgo", {"DeviceId": device_id})


class GloveControl:
    """Wires RCSP to the session: finds gloves, routes button presses, drives the ring LEDs."""

    def __init__(self, client: RcspClient, session, auto_stream: bool = True) -> None:
        self.client = client
        self.session = session
        self.auto_stream = auto_stream
        self.side_of: dict[int, str] = {}
        self.led_state: dict[str, str] = {}
        self._flash_until: dict[str, float] = {}
        client.on_event = self.on_event
        client.on_connect = self.on_connect

    async def on_connect(self) -> None:
        try:
            devices = await self.client.list_devices()
        except RcspError as e:
            log.error("ListDevices failed: %s", e)
            return
        for d in devices:
            did = int(d.get("DeviceId", -1))
            if did < 0:
                continue
            try:
                info = await self.client.get_device_info(did)
            except RcspError as e:
                log.warning("GetDeviceInfo(%d) failed: %s", did, e)
                continue
            is_left = (info.get("Smartgloves") or {}).get("IsLeft", info.get("IsLeft"))
            if is_left is None:
                continue
            side = "left" if bool(is_left) else "right"
            self.side_of[did] = side
            log.info(
                "RCSP device %d is the %s glove (%s)", did, side, d.get("DeviceType")
            )
            for coro in (
                self.client.device_subscribe(did),
                *([self.client.subscribe_to_data(did)] if self.auto_stream else []),
            ):
                try:
                    await coro
                except RcspError as e:
                    log.warning("subscribe for %d failed: %s", did, e)
        try:
            await self.client.subscribe()
        except RcspError as e:
            log.warning("Subscribe failed: %s", e)
        await self.update_leds(force=True)

    def on_event(self, body: dict) -> None:
        topic = body.get("Topic")
        data = body.get("EventData") or {}
        if topic == "ButtonPushed":
            did = int(data.get("DeviceId", -1))
            side = self.side_of.get(did)
            if side is None:
                side = "left" if did % 2 == 0 else "right"
            self.session.handle_button(
                side, str(data.get("ButtonPushType", "SinglePress"))
            )
        elif topic in ("Connected", "Disconnected"):
            did = int(data.get("DeviceId", -1))
            self.session.emit_event(
                "device",
                self.side_of.get(did),
                {
                    "device_id": did,
                    "state": "connected" if topic == "Connected" else "lost",
                },
            )

    def desired_state(self, side: str) -> str:
        s = self.session
        if s.recorder.active and s.recorder.master_hand == side:
            return "recording"
        h = s.hands.get(side)
        if h is not None and not h.heading_reliable:
            return "heading"
        if getattr(s, "_calibrating", False):
            return "busy"
        return "idle"

    def flash(self, side: str, state: str, seconds: float) -> None:
        self.led_state.pop(side, None)
        self._flash_until[side] = time.monotonic() + seconds
        self._flash_state = state
        asyncio.create_task(self._set(side, state))

    async def _set(self, side: str, state: str) -> None:
        for did, sd in self.side_of.items():
            if sd == side:
                try:
                    await self.client.set_color_led(did, LED_COLOURS[state])
                except RcspError as e:
                    log.debug("SetColorLed failed: %s", e)

    async def update_leds(self, force: bool = False) -> None:
        now = time.monotonic()
        for side in ("left", "right"):
            if self._flash_until.get(side, 0) > now:
                continue
            want = self.desired_state(side)
            if force or self.led_state.get(side) != want:
                self.led_state[side] = want
                await self._set(side, want)

    def on_messages(self, msgs: list[dict]) -> None:
        for m in msgs:
            if m.get("type") != "event":
                continue
            if m["name"] == "step_passed" and m.get("hand"):
                self.flash(m["hand"], "passed", 1.0)
            elif m["name"] == "step_marked" and m.get("hand"):
                self.flash(m["hand"], "marked", 0.3)
