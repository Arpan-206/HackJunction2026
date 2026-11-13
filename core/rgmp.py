"""RGMP reader for Rokoko's solved hands. Definition-driven: byte offsets come
from the definition JSON, never from code. The joint mapping is configuration
([rgmp] in config.toml) because the real stream names are unverified.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import struct
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import numpy as np

from . import geom
from . import hand as H

log = logging.getLogger("geppetto.rgmp")

OUTER = struct.Struct("<II")          # prefix, payload length
DATA_HDR = struct.Struct("<IIQ")      # device_id, group_id, timestamp_us
PREFIX_DEFINITION, PREFIX_DATA, PREFIX_DISCONNECT = 1, 2, 3

_BASE_TYPES = {
    "INT32": ("i", 4), "UINT32": ("I", 4), "INT64": ("q", 8), "UINT64": ("Q", 8),
    "FLOAT": ("f", 4), "FLOAT32": ("f", 4), "DOUBLE": ("d", 8), "FLOAT64": ("d", 8),
    "INT16": ("h", 2), "UINT16": ("H", 2), "INT8": ("b", 1), "UINT8": ("B", 1), "BOOL": ("?", 1),
}
_ALIASES = {"VEC3F": "FLOAT[3]", "VEC3": "FLOAT[3]", "QUATF": "FLOAT[4]", "QUAT": "FLOAT[4]",
            "VEC4F": "FLOAT[4]", "TRANSFORM": "FLOAT[7]", "POSE": "FLOAT[7]", "MAT3F": "FLOAT[3,3]"}
_TYPE_RE = re.compile(r"^([A-Z0-9]+)(?:\[(\d+)(?:,(\d+))?\])?$")


def parse_data_type(s: str) -> tuple[str, int, int]:
    """'FLOAT[7]' -> (struct code, count, byte size)."""
    u = str(s).strip().upper().replace(" ", "")
    u = _ALIASES.get(u, u)
    m = _TYPE_RE.match(u)
    if not m:
        raise ValueError(f"unknown RGMP data type {s!r}")
    base, n, mm = m.group(1), m.group(2), m.group(3)
    if base not in _BASE_TYPES:
        raise ValueError(f"unknown RGMP base type {base!r} in {s!r}")
    code, size = _BASE_TYPES[base]
    count = (int(n) if n else 1) * (int(mm) if mm else 1)
    return code, count, count * size


@dataclass
class StreamDef:
    index: int
    name: str
    data_type: str
    measure_type: str
    target_frame: str
    reference_frame: str
    code: str
    count: int
    size: int
    offset: int
    raw: dict

    def unpack(self, payload: bytes) -> np.ndarray:
        vals = struct.unpack_from(f"<{self.count}{self.code}", payload, self.offset)
        return np.asarray(vals)


@dataclass
class GroupDef:
    index: int
    name: str
    rate_hz: float
    streams: list[StreamDef]
    size: int


@dataclass
class DeviceDefinition:
    device_id: int
    device_type: str
    timestamp_epoch: str
    device_info: dict
    static_data: list
    groups: list[GroupDef]
    raw: dict

    def group(self, name: str) -> GroupDef | None:
        for g in self.groups:
            if g.name == name:
                return g
        return None


def parse_definition(doc: dict) -> DeviceDefinition:
    groups = []
    for gi, g in enumerate(doc.get("groups", [])):
        streams, off = [], 0
        for si, s in enumerate(g.get("streams", [])):
            dt = s.get("data_type") or s.get("type") or "FLOAT"
            code, count, size = parse_data_type(dt)
            name = s.get("name") or s.get("custom_label") or s.get("target_frame") or f"stream_{si}"
            streams.append(StreamDef(si, str(name), str(dt), str(s.get("measure_type", "")).upper(),
                                     str(s.get("target_frame", "")), str(s.get("reference_frame", "")),
                                     code, count, size, off, s))
            off += size
        groups.append(GroupDef(gi, str(g.get("name", f"group_{gi}")), float(g.get("expected_rate_hz", 0) or 0), streams, off))
    return DeviceDefinition(int(doc.get("device_id", 0)), str(doc.get("device_type", "")),
                            str(doc.get("timestamp_epoch", "unix_epoch")), dict(doc.get("device_info") or {}),
                            list(doc.get("static_data") or []), groups, doc)


@dataclass
class DataFrame:
    device_id: int
    group: GroupDef
    timestamp_us: int
    payload: bytes
    arrival_us: int

    def value(self, stream: StreamDef) -> np.ndarray:
        return stream.unpack(self.payload)


class RgmpParser:
    """Feed bytes, get messages: ('definition', DeviceDefinition) | ('data', DataFrame) | ('disconnect', device_id)."""

    def __init__(self) -> None:
        self.buf = bytearray()
        self.definitions: dict[int, DeviceDefinition] = {}
        self.bad_frames = 0

    def feed(self, data: bytes, arrival_us: int | None = None) -> list[tuple[str, Any]]:
        self.buf += data
        out: list[tuple[str, Any]] = []
        arrival = arrival_us if arrival_us is not None else int(time.time() * 1e6)
        while len(self.buf) >= OUTER.size:
            prefix, length = OUTER.unpack_from(self.buf, 0)
            if length > 50_000_000 or prefix not in (PREFIX_DEFINITION, PREFIX_DATA, PREFIX_DISCONNECT):
                # out of sync: drop one byte and try again
                self.bad_frames += 1
                del self.buf[0]
                continue
            if len(self.buf) < OUTER.size + length:
                break
            payload = bytes(self.buf[OUTER.size:OUTER.size + length])
            del self.buf[:OUTER.size + length]
            msg = self._handle(prefix, payload, arrival)
            if msg is not None:
                out.append(msg)
        return out

    def _handle(self, prefix: int, payload: bytes, arrival_us: int) -> tuple[str, Any] | None:
        if prefix == PREFIX_DEFINITION:
            try:
                d = parse_definition(json.loads(payload.decode("utf-8")))
            except Exception as e:
                log.error("bad RGMP definition: %s", e)
                self.bad_frames += 1
                return None
            self.definitions[d.device_id] = d
            return ("definition", d)
        if prefix == PREFIX_DATA:
            if len(payload) < DATA_HDR.size:
                self.bad_frames += 1
                return None
            dev, gid, ts = DATA_HDR.unpack_from(payload, 0)
            d = self.definitions.get(dev)
            if d is None or gid >= len(d.groups):
                self.bad_frames += 1
                return None
            g = d.groups[gid]
            body = payload[DATA_HDR.size:]
            if len(body) < g.size:
                self.bad_frames += 1
                return None
            return ("data", DataFrame(dev, g, int(ts), body, arrival_us))
        # disconnect: JSON {"device_id": n} or a bare uint32
        try:
            dev = int(json.loads(payload.decode("utf-8")).get("device_id", 0))
        except Exception:
            dev = struct.unpack_from("<I", payload, 0)[0] if len(payload) >= 4 else 0
        return ("disconnect", dev)


# ---------------------------------------------------------------------------
# Joint mapping: which streams of joints_openxr hold which joint
# ---------------------------------------------------------------------------

_STRIP_PREFIXES = ("xr_hand_joint_", "xrhandjoint_", "openxr_", "xr_", "hand_joint_", "joint_")
_STRIP_SUFFIXES = ("_ext", "_position", "_pos", "_orientation", "_rotation", "_rot", "_transform", "_pose")


def normalize_joint_name(name: str, aliases: dict[str, str]) -> str:
    n = str(name).strip().lower().replace("-", "_").replace(" ", "_")
    if n in aliases:
        return aliases[n]
    for p in _STRIP_PREFIXES:
        if n.startswith(p):
            n = n[len(p):]
    for s in _STRIP_SUFFIXES:
        if n.endswith(s):
            n = n[: -len(s)]
    return aliases.get(n, n)


@dataclass
class JointMapping:
    group: GroupDef
    positions: dict[int, StreamDef] = field(default_factory=dict)      # joint idx -> stream (FLOAT[3])
    rotations: dict[int, StreamDef] = field(default_factory=dict)      # joint idx -> stream (FLOAT[4])
    poses: dict[int, StreamDef] = field(default_factory=dict)          # joint idx -> stream (FLOAT[7]: pos, quat)
    flags: StreamDef | None = None
    unmapped: list[str] = field(default_factory=list)
    by_order: bool = False

    def complete(self) -> bool:
        have = set(self.poses) | (set(self.positions) & set(self.rotations))
        return len(have) == 26

    def joints_covered(self) -> int:
        return len(set(self.poses) | set(self.positions))

    def extract(self, frame: DataFrame) -> tuple[np.ndarray, np.ndarray, bool]:
        joints = np.zeros((26, 3))
        rots = np.tile(geom.IDENTITY_Q, (26, 1))
        for j, s in self.poses.items():
            v = frame.value(s)
            joints[j] = v[:3]
            rots[j] = v[3:7]
        for j, s in self.positions.items():
            joints[j] = frame.value(s)[:3]
        for j, s in self.rotations.items():
            rots[j] = frame.value(s)[:4]
        reliable = True
        if self.flags is not None:
            bits = int(frame.value(self.flags)[0])
            bm = self.flags.raw.get("bit_mapping") or {}
            for k, v in (bm.items() if isinstance(bm, dict) else []):
                if "heading" in str(v).lower():
                    reliable = bool(bits & (1 << int(k)))
                elif "heading" in str(k).lower():
                    reliable = bool(bits & (1 << int(v)))
        return joints, rots, reliable


def build_joint_mapping(definition: DeviceDefinition, rgmp_cfg) -> JointMapping | None:
    g = definition.group(rgmp_cfg.group)
    if g is None:
        # tolerate a differently named group that still looks like 26 joints
        for cand in definition.groups:
            if "openxr" in cand.name.lower() or len(cand.streams) >= 26:
                g = cand
                log.warning("group %r not found, using %r", rgmp_cfg.group, cand.name)
                break
    if g is None:
        return None
    aliases = {str(k).lower(): str(v) for k, v in dict(rgmp_cfg.joint_aliases).items()}
    pos_types = {t.upper() for t in rgmp_cfg.position_measure_types}
    rot_types = {t.upper() for t in rgmp_cfg.orientation_measure_types}
    pose_types = {t.upper() for t in rgmp_cfg.pose_measure_types}
    name_field = str(rgmp_cfg.joint_name_field)
    m = JointMapping(group=g)
    for s in g.streams:
        if s.measure_type == "STATUS_FLAGS" or "flag" in s.name.lower():
            m.flags = s
            continue
        raw_name = s.raw.get(name_field) or s.target_frame or s.name
        jname = normalize_joint_name(raw_name, aliases)
        j = H.JOINT_INDEX.get(jname)
        if j is None:
            m.unmapped.append(f"{raw_name} ({s.measure_type} {s.data_type})")
            continue
        if s.count == 7 or s.measure_type in pose_types:
            m.poses[j] = s
        elif s.count == 3 or s.measure_type in pos_types:
            m.positions[j] = s
        elif s.count == 4 or s.measure_type in rot_types:
            m.rotations[j] = s
        else:
            m.unmapped.append(f"{raw_name} ({s.measure_type} {s.data_type})")
    if m.joints_covered() < 26:
        # Fallback: 26 pose streams in OpenXR enum order with names we do not know.
        poses = [s for s in g.streams if s.count == 7]
        if len(poses) == 26:
            m.poses = {j: s for j, s in enumerate(poses)}
            m.positions, m.rotations, m.by_order = {}, {}, True
            log.warning("joint names not recognised; mapped 26 FLOAT[7] streams by enum order. "
                        "Unmapped names were: %s", m.unmapped[:5])
        else:
            log.error("only %d/26 joints mapped from group %r. Unmapped: %s", m.joints_covered(), g.name, m.unmapped)
    return m


def detect_hand(definition: DeviceDefinition, rgmp_cfg) -> str | None:
    left_values = {str(v).lower() for v in rgmp_cfg.left_values}
    right_values = {"right", "r", "false"}
    for path in rgmp_cfg.hand_fields:
        parts = str(path).split(".")
        node: Any = definition.raw
        if parts[0] == "static_data":
            for entry in definition.static_data:
                label = " ".join(str(entry.get(k, "")) for k in ("custom_label", "target_frame", "measure_type")).lower()
                if "hand" in label or "side" in label or "left" in label:
                    v = str(entry.get("value", "")).lower()
                    if v in left_values:
                        return "left"
                    if v in right_values:
                        return "right"
            continue
        ok = True
        for p in parts:
            if isinstance(node, dict) and p in node:
                node = node[p]
            else:
                ok = False
                break
        if ok and not isinstance(node, (dict, list)):
            v = str(node).lower()
            if v in left_values:
                return "left"
            if v in right_values:
                return "right"
    # last resort: words anywhere in device_info
    blob = json.dumps(definition.device_info).lower()
    if '"left"' in blob or "left" in blob and "right" not in blob:
        return "left"
    if '"right"' in blob or "right" in blob and "left" not in blob:
        return "right"
    return None


# ---------------------------------------------------------------------------
# Glove source: TCP client, newest frame per device, clock mapping, silence
# ---------------------------------------------------------------------------

@dataclass
class GloveSample:
    device_id: int
    hand: str
    t_us: int                 # core clock
    joints: np.ndarray        # (26, 3) wrist-relative, xr_base
    rots: np.ndarray          # (26, 4)
    heading_reliable: bool
    arrival_us: int


class ClockMapper:
    """Map device timestamps to the core clock with the smallest arrival - timestamp seen over window_s."""

    def __init__(self, window_s: float = 5.0) -> None:
        self.window_us = int(window_s * 1e6)
        self.samples: deque[tuple[int, int]] = deque()

    def map(self, timestamp_us: int, arrival_us: int) -> int:
        delta = arrival_us - timestamp_us
        self.samples.append((arrival_us, delta))
        while self.samples and self.samples[0][0] < arrival_us - self.window_us:
            self.samples.popleft()
        return timestamp_us + min(d for _, d in self.samples)


class GloveSource:
    """Reads solved hands from the solver (or a replay) and serves HandStates to the Core."""

    def __init__(self, cfg, clock, logs_dir: Path | None = None, replay=None, capture_path: Path | None = None,
                 host: str | None = None, port: int | None = None) -> None:
        self.cfg = cfg
        self.clock = clock
        self.logs_dir = Path(logs_dir) if logs_dir else None
        self.replay = replay
        self.host = host or cfg.glove.solver_host
        self.port = port or int(cfg.glove.solver_port)
        self.capture_path = capture_path
        self._capture = None
        self.parser = RgmpParser()
        self.mappings: dict[int, JointMapping] = {}
        self.sides: dict[int, str] = {}
        self.clockmap: dict[int, ClockMapper] = {}
        self.latest: dict[str, GloveSample] = {}
        self.lost: set[str] = set()
        self.pinch = {s: H.PinchTracker(cfg.hand.pinch_on_m, cfg.hand.pinch_off_m) for s in ("left", "right")}
        self.yaw_offset = {"left": 0.0, "right": 0.0}
        self._calib_until_us: int | None = None
        self._calib_yaws: dict[str, list[float]] = {"left": [], "right": []}
        self.connected = False
        self.frames = 0
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.on_device: Callable[[int, str], None] | None = None
        self._last_hand: dict[str, H.HandState] = {}

    # -- lifecycle -----------------------------------------------------------
    async def start(self) -> None:
        if self.replay is not None:
            await self.replay.start()
            self.host, self.port = self.replay.host, self.replay.port
        if self.capture_path:
            self._capture = open(self.capture_path, "ab")
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
        if self.replay is not None:
            await self.replay.stop()
        if self._capture:
            self._capture.close()

    async def _run(self) -> None:
        while not self._stop.is_set():
            try:
                reader, writer = await asyncio.open_connection(self.host, self.port)
                self.connected = True
                log.info("RGMP connected to %s:%d", self.host, self.port)
                try:
                    while not self._stop.is_set():
                        data = await reader.read(65536)
                        if not data:
                            break
                        self.feed(data)
                finally:
                    writer.close()
                    self.connected = False
                    log.warning("RGMP connection closed")
            except (ConnectionRefusedError, OSError) as e:
                self.connected = False
                log.warning("RGMP connect to %s:%d failed: %s; retry in %.1fs", self.host, self.port, e, self.cfg.glove.reconnect_s)
            if self.replay is not None and getattr(self.replay, "finished", False) and not self.replay.loop:
                log.info("replay finished")
                return
            await asyncio.sleep(float(self.cfg.glove.reconnect_s))

    # -- parsing -------------------------------------------------------------
    def feed(self, data: bytes) -> None:
        if self._capture:
            self._capture.write(data)
        now = int(self.clock.now_us())
        for kind, payload in self.parser.feed(data, now):
            if kind == "definition":
                self._on_definition(payload)
            elif kind == "data":
                self._on_data(payload)
            else:
                self._on_disconnect(payload)

    def _on_definition(self, d: DeviceDefinition) -> None:
        if self.logs_dir is not None:
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            (self.logs_dir / f"rgmp_definition_{d.device_id}.json").write_text(json.dumps(d.raw, indent=2))
        if "hand" not in d.device_type.lower() and d.group(self.cfg.rgmp.group) is None:
            log.info("ignoring device %d of type %r (no %s group)", d.device_id, d.device_type, self.cfg.rgmp.group)
            return
        m = build_joint_mapping(d, self.cfg.rgmp)
        if m is None:
            log.error("device %d (%s): no joint group found; groups=%s", d.device_id, d.device_type, [g.name for g in d.groups])
            return
        side = detect_hand(d, self.cfg.rgmp)
        if side is None:
            if self.cfg.rgmp.hand_from_device_id_parity:
                side = "left" if d.device_id % 2 == 0 else "right"
                log.warning("device %d: no hand field found, using device_id parity -> %s", d.device_id, side)
            else:
                log.error("device %d: no hand field found; set [rgmp].hand_fields", d.device_id)
                return
        self.mappings[d.device_id] = m
        self.sides[d.device_id] = side
        self.clockmap[d.device_id] = ClockMapper(float(self.cfg.glove.clock_window_s))
        self.lost.discard(side)
        log.info("device %d is the %s hand: %d/26 joints mapped%s, epoch %s", d.device_id, side, m.joints_covered(),
                 " (by order)" if m.by_order else "", d.timestamp_epoch)
        if self.on_device:
            self.on_device(d.device_id, "connected")

    def _on_data(self, f: DataFrame) -> None:
        m = self.mappings.get(f.device_id)
        if m is None or f.group is not m.group:
            return
        joints, rots, reliable = m.extract(f)
        t_core = self.clockmap[f.device_id].map(f.timestamp_us, f.arrival_us)
        side = self.sides[f.device_id]
        self.latest[side] = GloveSample(f.device_id, side, t_core, joints, rots, reliable, f.arrival_us)
        self.lost.discard(side)
        self.frames += 1

    def _on_disconnect(self, device_id: int) -> None:
        side = self.sides.get(device_id)
        if side:
            self.lost.add(side)
            log.warning("device %d (%s) disconnected", device_id, side)
            if self.on_device:
                self.on_device(device_id, "lost")

    # -- calibration ---------------------------------------------------------
    def calibrate(self, duration_s: float = 1.0) -> None:
        """Average the wrist yaw over the next second; that heading becomes yaw 0."""
        self._calib_until_us = int(self.clock.now_us() + duration_s * 1e6)
        self._calib_yaws = {"left": [], "right": []}

    @staticmethod
    def _yaw_of(q: np.ndarray) -> float:
        fwd = geom.rotate(q, np.array([0.0, 0.0, -1.0]))
        return float(np.arctan2(-fwd[0], -fwd[2]))

    # -- output --------------------------------------------------------------
    def poll(self, t_us: int) -> dict[str, tuple[H.HandState | None, list]]:
        out: dict[str, tuple[H.HandState | None, list]] = {}
        silence_us = int(self.cfg.glove.silence_ms) * 1000
        for side in ("left", "right"):
            s = self.latest.get(side)
            if s is None:
                out[side] = (None, [])
                continue
            tracked = (t_us - s.arrival_us) < silence_us and side not in self.lost
            joints_xr = s.joints - s.joints[1]           # wrist at the origin
            wrist_q = geom.quat_normalize(s.rots[1])
            if self._calib_until_us is not None:
                if t_us <= self._calib_until_us:
                    self._calib_yaws[side].append(self._yaw_of(wrist_q))
                else:
                    for sd, ys in self._calib_yaws.items():
                        if ys:
                            self.yaw_offset[sd] = -float(np.arctan2(np.mean(np.sin(ys)), np.mean(np.cos(ys))))
                    self._calib_until_us = None
                    log.info("yaw calibrated: %s", self.yaw_offset)
            yq = geom.yaw_quat(self.yaw_offset[side])
            wrist_q_w = geom.quat_mul(yq, wrist_q)
            joints_xr_w = geom.rotate(yq, joints_xr)
            local = geom.rotate_inv(wrist_q_w, joints_xr_w)
            rots_local = np.array([geom.quat_mul(geom.quat_conj(wrist_q_w), geom.quat_mul(yq, r)) for r in s.rots])
            rp = np.asarray(self.cfg.rest_pose[side].p, dtype=float)
            h = H.HandState(side=side, device_id=s.device_id, source="glove", t_us=s.t_us, joints_local=local,
                            wrist_p=rp, wrist_q=wrist_q_w, rots_local=rots_local, tracked=tracked, anchor="rest",
                            heading_reliable=s.heading_reliable)
            events = H.finish_hand(h, self.cfg.hand, self.pinch[side])
            if not tracked and side in self._last_hand:
                # hold the last pose, flagged untracked
                prev = self._last_hand[side]
                prev.tracked = False
                prev.t_us = s.t_us
                out[side] = (prev, [])
                continue
            self._last_hand[side] = h
            out[side] = (h, events)
        return out
