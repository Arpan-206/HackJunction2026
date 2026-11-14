"""Recording files for the GeppettoDepth stream (.gdrec, or .gdrec.gz): see ios/PROTOCOL.md.

A recording keeps every packet exactly as it came over the wire, plus its arrival time,
so a replay feeds the same reader the same bytes. ios/mac/recording.py re-exports this.
"""
from __future__ import annotations

import gzip
import json
import struct
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

from .depth import DepthFrame
from .geppetto_depth import PREFIX, parse_packet

FILE_MAGIC = b"GDREC1\n\0"
ARRIVAL = struct.Struct("<Q")


def _open(path: Path, mode: str) -> BinaryIO:
    path = Path(path)
    if path.suffix == ".gz":
        return gzip.open(path, mode + "b")
    return open(path, mode + "b")


class RecordingWriter:
    """Append packets to a recording. note says what made it (for example "fake sender")."""

    def __init__(self, path: Path, note: dict | None = None) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._f = _open(self.path, "w")
        meta = json.dumps(note or {}).encode()
        self._f.write(FILE_MAGIC + struct.pack("<I", len(meta)) + meta)
        self.packets = 0

    def write(self, arrival_us: int, packet: bytes) -> None:
        self._f.write(ARRIVAL.pack(int(arrival_us)) + packet)
        self.packets += 1

    def close(self) -> None:
        self._f.close()

    def __enter__(self) -> "RecordingWriter":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def read_note(path: Path) -> dict:
    with _open(path, "r") as f:
        return _read_head(f)


def _read_head(f: BinaryIO) -> dict:
    if f.read(len(FILE_MAGIC)) != FILE_MAGIC:
        raise ValueError("not a GeppettoDepth recording (bad magic)")
    (n,) = struct.unpack("<I", f.read(4))
    return json.loads(f.read(n) or b"{}")


def read_recording(path: Path) -> Iterator[tuple[int, bytes]]:
    """Yield (arrival_us, packet) in file order. Stops cleanly at a truncated tail."""
    with _open(path, "r") as f:
        _read_head(f)
        while True:
            a = f.read(ARRIVAL.size)
            if len(a) < ARRIVAL.size:
                return
            prefix = f.read(PREFIX.size)
            if len(prefix) < PREFIX.size:
                return
            _, n = PREFIX.unpack(prefix)
            payload = f.read(n)
            if len(payload) < n:
                return
            yield ARRIVAL.unpack(a)[0], prefix + payload


def frames(path: Path, latency_us: int = 0) -> Iterator[DepthFrame]:
    """Every decodable packet in the recording as a DepthFrame, t_us from the recorded arrival."""
    for arrival_us, pkt in read_recording(path):
        f = parse_packet(pkt, arrival_us, latency_us)
        if f is not None:
            yield f
