"""Pure functions behind the glove status screen: decode what the driver reports and map it to fix steps.

Nothing here touches a socket or a process, so every rule is unit-tested with plain data. Field names follow what the
real driver sent (captures of 14 Nov 2026, driver 1.9.7, firmware 3.4.0): ListDevices gives `Connections: ["Serial"]`,
GetDeviceInfo gives `Smartgloves.IsLeft`, and neither carries a battery level.
"""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from app import constants as c
from app.schemas.common import GloveSource, Side
from app.schemas.rig import Connection, GloveDeviceStatus, GloveIssue, SensorStatus

_NON_ALNUM = re.compile(r"[^a-z0-9]")
_BATTERY_KEYS = {_NON_ALNUM.sub("", k) for k in c.GLOVE_BATTERY_KEYS}


def connection_name(raw: object) -> Connection | None:
    """RCSP connection ('Serial', 'UDP', 'Emulated', 'Unknown') to usb, wifi, emulated or unknown."""
    if raw is None:
        return None
    return c.ROKOKO_CONNECTION_NAMES.get(str(raw).strip().lower(), "unknown")  # type: ignore[return-value]


def device_connection(listed: Mapping[str, Any]) -> str | None:
    """The raw connection of a ListDevices entry: `Connections[0]` (the driver's choice) or the documented `ConnectionType`."""
    many = listed.get("Connections")
    if isinstance(many, list) and many:
        return str(many[0])
    one = listed.get("ConnectionType")
    return str(one) if one is not None else None


def find_battery(obj: Any, depth: int = 0) -> float | None:
    """A battery percentage anywhere in a device-list or device-info response, or None when the driver gives none."""
    if depth > 4:
        return None
    if isinstance(obj, Mapping):
        for key, value in obj.items():
            if _NON_ALNUM.sub("", str(key).lower()) in _BATTERY_KEYS:
                pct = _as_percent(value)
                if pct is not None:
                    return pct
        children: Iterable[Any] = obj.values()
    elif isinstance(obj, list):
        children = obj
    else:
        return None
    for value in children:
        found = find_battery(value, depth + 1)
        if found is not None:
            return found
    return None


def _as_percent(value: object) -> float | None:
    """A number read as a percentage; a value in 0..1 is taken as a fraction."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    v = float(value)
    if 0.0 <= v <= 1.0:
        v *= 100.0
    return round(v, 1) if 0.0 <= v <= 100.0 else None


def side_from_info(info: Mapping[str, Any] | None) -> Side | None:
    """Which hand a glove is, from RCSP GetDeviceInfo (Smartgloves.IsLeft) or an RGMP device_info (hand, is_right_glove)."""
    if not info:
        return None
    gloves = info.get("Smartgloves")
    is_left = (
        gloves.get("IsLeft") if isinstance(gloves, Mapping) else info.get("IsLeft")
    )
    if isinstance(is_left, bool):
        return "left" if is_left else "right"
    hand = info.get("hand")
    if isinstance(hand, str) and hand.lower() in ("left", "right"):
        return hand.lower()  # type: ignore[return-value]
    right = info.get("is_right_glove")
    if isinstance(right, bool):
        return "right" if right else "left"
    return None


def decode_flags(bit_mapping: Mapping[str, str] | None, value: int) -> dict[str, bool]:
    """Expand a STATUS_FLAGS word into {flag name: set}, keyed by the names in the stream's bit_mapping."""
    out: dict[str, bool] = {}
    for bit, name in (bit_mapping or {}).items():
        try:
            index = int(bit)
        except (TypeError, ValueError):
            continue
        if index >= 0:
            out[str(name)] = bool((int(value) >> index) & 1)
    return out


def saturation_words(flags: Mapping[str, bool]) -> list[str]:
    """The saturated parts in plain words ('gyroscope', 'EMF sensor') for the set saturation flags."""
    return [word for name, word in c.GLOVE_SATURATION_FLAGS.items() if flags.get(name)]


def sensor_name(target_frame: str) -> str | None:
    """'index_finger_sensor' -> 'index', 'hub_imu' -> 'hub', 'arm_sensor' -> 'arm'; None for anything else."""
    frame = target_frame.strip().lower()
    for name in c.GLOVE_SENSOR_NAMES:
        if frame == name or frame.startswith(f"{name}_"):
            return name
    return None


def sensor_statuses(
    saturated: Mapping[str, Iterable[str]], event_words: Iterable[str] = ()
) -> list[SensorStatus]:
    """One SensorStatus per glove sensor, in hand order, with what is saturated on it.

    Saturation known only from an RCSP event (no sensor named) is put on the hub.
    """
    words: dict[str, list[str]] = {n: [] for n in c.GLOVE_SENSOR_NAMES}
    for sensor, parts in saturated.items():
        if sensor in words:
            words[sensor].extend(p for p in parts if p not in words[sensor])
    words["hub"].extend(w for w in event_words if w and w not in words["hub"])
    return [SensorStatus(name=n, saturated=words[n]) for n in c.GLOVE_SENSOR_NAMES]


def text_matches(lines: Iterable[str], patterns: Iterable[str]) -> bool:
    """True when any line contains any pattern, ignoring case."""
    pats = [p.lower() for p in patterns]
    return any(p in line.lower() for line in lines for p in pats)


def parse_tasklist_csv(text: str) -> set[str]:
    """Process image names from `tasklist /FO CSV /NH`, lowercased."""
    names: set[str] = set()
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('"'):
            names.add(line[1:].split('"', 1)[0].lower())
    return names


@dataclass
class RigSnapshot:
    """Everything the fix-step rules look at, gathered once per status request."""

    source: GloveSource
    studio_running: bool
    driver_port_open: bool
    driver_process: bool
    solver_port_open: bool
    rcsp_connected: bool
    can_start: bool
    gloves: list[GloveDeviceStatus]
    driver_lines: list[str] = field(default_factory=list)


def _other(side: Side) -> Side:
    """The other hand."""
    return "left" if side == "right" else "right"


# Plain words for the two sensors whose stream names mean little to a wearer.


def diagnose(s: RigSnapshot) -> list[GloveIssue]:
    """The fix steps for a snapshot, most important first. The first blocking issue is the one to fix now."""
    issues: list[GloveIssue] = []
    driver_up = s.driver_port_open or s.driver_process or s.rcsp_connected
    start = "Press Start the gloves, or run" if s.can_start else "Run"
    if s.studio_running:
        issues.append(
            GloveIssue(
                code="studio_running",
                blocking=True,
                title="Rokoko Studio is open",
                fix="Close Rokoko Studio. It holds the gloves' USB connection, so the glove driver cannot open them. Then press Check again.",
            )
        )
    if text_matches(s.driver_lines, c.ROKOKO_BUSY_PATTERNS):
        issues.append(
            GloveIssue(
                code="device_busy",
                blocking=True,
                title="The driver cannot open the gloves (Access is denied)",
                fix="Another program holds the USB devices, usually Rokoko Studio. Close Studio, unplug and replug both gloves, then start the gloves again.",
            )
        )
    if not driver_up:
        issues.append(
            GloveIssue(
                code="driver_not_running",
                blocking=True,
                title="The glove driver is not running",
                fix=f"{start} `rokoko-sdk --auto-stream-usb` in a terminal.",
            )
        )
        return issues
    if not s.solver_port_open:
        issues.append(
            GloveIssue(
                code="solver_not_running",
                blocking=True,
                title="The hand solver is not running",
                fix=f"{start} `{c.ROKOKO_SOLVER_MANUAL}` in a terminal. Nothing serves port 12277 until it runs.",
            )
        )
    connected = [g for g in s.gloves if g.connected]
    if not connected and (
        s.rcsp_connected or text_matches(s.driver_lines, c.ROKOKO_NO_USB_PATTERNS)
    ):
        issues.append(
            GloveIssue(
                code="no_usb_devices",
                blocking=True,
                title="No gloves found",
                fix="Reconnect both USB cables. If a glove still does not show, try another cable or another USB port.",
            )
        )
    elif len(connected) == 1:
        missing = _other(connected[0].side)
        issues.append(
            GloveIssue(
                code="glove_missing",
                side=missing,
                blocking=False,
                title=f"The {missing} glove is missing",
                fix=f"Connect the {missing} glove: plug in its USB cable, or switch it on and wait a few seconds.",
            )
        )
    idle = [g for g in connected if g.streaming is False]
    if idle:
        issues.append(
            GloveIssue(
                code="not_streaming",
                side=idle[0].side if len(idle) == 1 else None,
                blocking=True,
                title="The gloves are connected, but no program has asked the driver for their data",
                fix=(
                    "This is not a glove fault: the driver streams a glove only while a program subscribes to it. "
                    "Start the core, which subscribes: `python -m core --solver 127.0.0.1:12277 --rcsp 127.0.0.1:45451`."
                ),
            )
        )
    for g in connected:
        if g.streaming is False:
            continue
        if (
            g.fps is None
            or g.last_frame_age_ms is None
            or g.last_frame_age_ms > c.GLOVE_STALE_FRAME_S * 1000
        ):
            issues.append(
                GloveIssue(
                    code="no_frames",
                    side=g.side,
                    blocking=True,
                    title=f"No {g.side} hand frames reach the app",
                    fix=(
                        "Start the core and the bridge: `python -m core --solver 127.0.0.1:12277 --rcsp 127.0.0.1:45451`, "
                        "then `python -m tools.ingest_bridge`. The bridge switches the app to the gloves."
                        if s.source != "simulator"
                        else "The app is showing the simulator. Start the core and `python -m tools.ingest_bridge`; the bridge switches the app to the gloves."
                    ),
                )
            )
            continue
        rate = g.driver_fps if g.driver_fps is not None else g.fps
        floor = (
            c.GLOVE_MIN_DRIVER_FPS
            if g.driver_fps is not None
            else c.GLOVE_MIN_STREAM_FPS
        )
        if rate < floor:
            how = (
                "check its battery and its USB cable"
                if g.connection == "usb"
                else "charge its battery or plug in its USB cable"
            )
            issues.append(
                GloveIssue(
                    code="low_frame_rate",
                    side=g.side,
                    blocking=False,
                    title=f"The {g.side} glove sends {round(rate)} frames a second",
                    fix=f"For the {g.side} glove, {how}. On Wi-Fi, move closer to the router and away from other networks.",
                )
            )
    return issues


def is_ready(gloves: list[GloveDeviceStatus], issues: list[GloveIssue]) -> bool:
    """Ready when at least one glove is connected and nothing blocking is left."""
    return any(g.connected for g in gloves) and not any(i.blocking for i in issues)
