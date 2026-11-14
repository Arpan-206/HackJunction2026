"""Trim raw RGMP captures into the small gzip fixtures under tests/fixtures/rgmp/.

Usage (from backend/):
    uv run python scripts/make_rgmp_fixture.py SRC_DIR

SRC_DIR holds driver.rgmp, worn.rgmp, worn-solver.rgmp (raw TCP dumps from ports 12276 and 12277, as written by a
plain socket recorder). The output keeps the definitions verbatim and a few short contiguous slices of data frames,
so the tests can check the real wire format without a 10 MB file. Slices are cut by device timestamp.
"""

from __future__ import annotations

import gzip
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tests.rgmp_reader import TYPE_DATA, TYPE_DEFINITION, iter_messages

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "rgmp"

# (label, start_s, length_s) relative to the first data frame, per source capture.
WORN_SLICES = [  # phases from the scripted pose protocol; see worn-protocol.json
    ("flat", 2.0, 0.3),
    ("fist", 10.0, 0.3),
    ("open", 16.0, 0.3),
    ("thumb", 19.0, 0.3),
    ("index", 21.0, 0.3),
    ("middle", 23.0, 0.3),
    ("ring", 25.0, 0.3),
    ("little", 27.0, 0.3),
]
SHAKEN_SLICES = [("shake", 6.0, 0.8)]
SOLVER_SLICES = [(label, s, 0.1) for label, s, _ in WORN_SLICES]


def trim(
    src: Path,
    dst: Path,
    slices: list[tuple[str, float, float]],
    groups: set[int] | None = None,
) -> None:
    blob = src.read_bytes()
    msgs = list(iter_messages(blob))
    # each device has its own clock, so time zero is that device's own first frame
    first: dict[int, int] = {}
    for t, p in msgs:
        if t == TYPE_DATA:
            dev, _grp, ts = struct.unpack_from("<IIQ", p, 0)
            first.setdefault(dev, ts)
    out = bytearray()
    for typ, payload in msgs:
        keep = typ == TYPE_DEFINITION
        if typ == TYPE_DATA:
            dev, grp, ts = struct.unpack_from("<IIQ", payload, 0)
            t = (ts - first[dev]) / 1e6
            keep = any(s <= t < s + n for _, s, n in slices) and (
                groups is None or grp in groups
            )
        if keep:
            out += struct.pack("<II", typ, len(payload)) + payload
    dst.write_bytes(gzip.compress(bytes(out), 9, mtime=0))
    print(dst.name, dst.stat().st_size, "bytes")


def main() -> None:
    src = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    trim(src / "driver.rgmp", OUT / "shaken_driver.rgmp.gz", SHAKEN_SLICES)
    trim(src / "worn.rgmp", OUT / "worn_driver.rgmp.gz", WORN_SLICES, groups={0})
    # joints_local (0) and joints_openxr (2); the world group adds nothing the tests use
    trim(
        src / "worn-solver.rgmp",
        OUT / "worn_solver.rgmp.gz",
        SOLVER_SLICES,
        groups={0, 2},
    )


if __name__ == "__main__":
    main()
