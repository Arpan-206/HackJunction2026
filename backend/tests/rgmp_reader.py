"""Minimal RGMP reader for the glove tests. Independent of core/rgmp.py on purpose.

Wire format (Rokoko Device SDK, examples/python/rgmp_stream.py):
- outer header `<II` message type, payload length. Type 1 is a definition (JSON), 2 is data.
- data payload: `<IIQ` device_id, group_id, timestamp_us, then the group's streams back to back
  in definition order. Offsets restart at 0 for every group.
Stream data types come from the definition (`FLOAT[7]`, `UINT32`...), nothing is hard-coded.
"""

from __future__ import annotations

import gzip
import json
import math
import struct
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

TYPE_DEFINITION, TYPE_DATA = 1, 2
_FMT = {
    "FLOAT": ("f", 4),
    "UINT32": ("I", 4),
    "INT32": ("i", 4),
    "DOUBLE": ("d", 8),
    "UINT64": ("Q", 8),
}


@dataclass
class Stream:
    measure_type: str
    target_frame: str | None
    fmt: str
    size: int
    bit_mapping: dict[int, str] | None
    reference_frame: str | None = None


@dataclass
class Frame:
    device_id: int
    group: int
    timestamp_us: int
    values: list  # per stream: tuple of numbers, in definition order


@dataclass
class Capture:
    definitions: dict[int, dict] = field(default_factory=dict)
    frames: list[Frame] = field(default_factory=list)
    disconnects: list[int] = field(default_factory=list)

    def layout(self, device_id: int) -> list[list[Stream]]:
        return stream_layout(self.definitions[device_id])

    def device_frames(self, device_id: int, group: int | None = None) -> list[Frame]:
        return [
            f
            for f in self.frames
            if f.device_id == device_id and (group is None or f.group == group)
        ]

    def series(
        self, device_id: int, group: int, measure: str, target: str
    ) -> list[tuple]:
        """(timestamp_us, values) for one stream of one group."""
        layout = self.layout(device_id)[group]
        idx = next(
            i
            for i, s in enumerate(layout)
            if s.measure_type == measure and s.target_frame == target
        )
        return [
            (f.timestamp_us, f.values[idx])
            for f in self.device_frames(device_id, group)
        ]


def parse_data_type(data_type: str) -> tuple[str, int]:
    base = data_type.split("[")[0]
    count = int(data_type.split("[")[1][:-1]) if "[" in data_type else 1
    code, size = _FMT[base]
    return code * count, size * count


def stream_layout(definition: dict) -> list[list[Stream]]:
    out = []
    for group in definition["groups"]:
        streams = []
        for s in group["streams"]:
            fmt, size = parse_data_type(s["data_type"])
            bm = s.get("bit_mapping")
            streams.append(
                Stream(
                    s["measure_type"],
                    s.get("target_frame"),
                    fmt,
                    size,
                    {int(k): v for k, v in bm.items()} if bm else None,
                    s.get("reference_frame"),
                )
            )
        out.append(streams)
    return out


def iter_messages(blob: bytes) -> Iterator[tuple[int, bytes]]:
    i = 0
    while i + 8 <= len(blob):
        typ, length = struct.unpack_from("<II", blob, i)
        payload = blob[i + 8 : i + 8 + length]
        if len(payload) < length:
            break  # truncated tail
        i += 8 + length
        yield typ, payload


def decode_frame(layout: list[list[Stream]], payload: bytes) -> Frame | None:
    device_id, group, ts = struct.unpack_from("<IIQ", payload, 0)
    if group >= len(layout):
        return None
    offset, values = 16, []
    for s in layout[group]:
        values.append(struct.unpack_from("<" + s.fmt, payload, offset))
        offset += s.size
    if offset != len(payload):
        raise ValueError(
            f"group {group} layout is {offset - 16} bytes, payload has {len(payload) - 16}"
        )
    return Frame(device_id, group, ts, values)


def parse_capture(raw: bytes) -> Capture:
    blob = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
    cap = Capture()
    layouts: dict[int, list[list[Stream]]] = {}
    for typ, payload in iter_messages(blob):
        if typ == TYPE_DEFINITION:
            d = json.loads(payload)
            cap.definitions[d["device_id"]] = d
            layouts[d["device_id"]] = stream_layout(d)
        elif typ == TYPE_DATA:
            device_id = struct.unpack_from("<I", payload, 0)[0]
            if device_id in layouts:
                f = decode_frame(layouts[device_id], payload)
                if f is not None:
                    cap.frames.append(f)
        elif len(payload) == 4:  # disconnect carries a bare device id
            cap.disconnects.append(struct.unpack("<I", payload)[0])
    return cap


def read_capture(path: Path) -> Capture:
    """Read a raw RGMP byte stream (optionally gzip-compressed) into definitions and frames."""
    return parse_capture(path.read_bytes())


def quat_norm(q) -> float:
    return math.sqrt(sum(c * c for c in q))


def angle_between_deg(q, q0) -> float:
    dot = min(1.0, abs(sum(a * b for a, b in zip(q, q0))))
    return 2 * math.degrees(math.acos(dot))


def rotation_range_deg(quats: list[tuple]) -> float:
    """Largest angle between the first quaternion and any later one, in degrees."""
    return max(angle_between_deg(q, quats[0]) for q in quats)


def flag_names(value: int, bit_mapping: dict[int, str]) -> set[str]:
    """Names of the flags set in a STATUS_FLAGS word, decoded through the definition's bit_mapping."""
    return {name for bit, name in bit_mapping.items() if value >> bit & 1}


def group_rate_hz(frames: list[Frame]) -> dict[int, float]:
    per = defaultdict(list)
    for f in frames:
        per[f.group].append(f.timestamp_us)
    return {
        g: (len(ts) - 1) / ((ts[-1] - ts[0]) / 1e6)
        for g, ts in per.items()
        if len(ts) > 1 and ts[-1] > ts[0]
    }
