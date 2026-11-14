"""Wrist yaw from a raw RGMP solver capture: survey a long capture, or cut a window to .npz.

    python -m tools.glove_yaw_window logs/live/20261114-131952/solver_12277.rgmp --survey
    python -m tools.glove_yaw_window CAPTURE --start 1200 --seconds 20 --side right \\
        --out tests/fixtures/depth/glove_yaw_right.npz [--rgmp-out logs/depth/window.rgmp]

The capture is read in chunks (the hour on this Mac is 1.2 GB), parsed with core.rgmp and
turned into hands with GloveSource.poll on a fake clock, as tools/score_capture.py does.
--start counts seconds from the first data frame of the chosen side. The .npz holds
t_us (from the window start), wrist_q (x y z w, as GloveSource gives it, no yaw
calibration), yaw_deg (core convention) and heading_reliable. --rgmp-out writes the
definitions plus the window's raw data frames, replayable with python -m core --replay.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Iterator
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.clock import FakeClock
from core.config import load_config
from core.rgmp import DATA_HDR, OUTER, PREFIX_DATA, PREFIX_DEFINITION, GloveSource


def messages(path: Path, chunk: int = 8 << 20) -> Iterator[tuple[int, int | None, int | None, bytes]]:
    """(prefix, device_id, timestamp_us, raw message) for every complete message, streamed."""
    buf = bytearray()
    with open(path, "rb") as f:
        while True:
            data = f.read(chunk)
            if not data:
                break
            buf += data
            i, n = 0, len(buf)
            while i + OUTER.size <= n:
                prefix, length = OUTER.unpack_from(buf, i)
                end = i + OUTER.size + length
                if end > n:
                    break
                dev = ts = None
                if prefix == PREFIX_DATA and length >= DATA_HDR.size:
                    dev, _, ts = DATA_HDR.unpack_from(buf, i + OUTER.size)
                yield prefix, dev, ts, bytes(buf[i:end])
                i = end
            del buf[:i]


def yaw_deg(q: np.ndarray) -> float:
    from core import geom
    fwd = geom.rotate(q, np.array([0.0, 0.0, -1.0]))
    return math.degrees(math.atan2(-fwd[0], -fwd[2]))


def walk(path: Path, side: str, start_s: float = 0.0, seconds: float = float("inf"), every: int = 1,
         rgmp_out: Path | None = None) -> dict:
    cfg = load_config(None)
    clock = FakeClock()
    src = GloveSource(cfg, clock, host="x", port=1)
    base: dict[int, int] = {}
    count: dict[int, int] = {}
    t, q, rel = [], [], []
    out = open(rgmp_out, "wb") if rgmp_out else None
    t_side0 = None
    try:
        for prefix, dev, ts, raw in messages(path):
            if prefix != PREFIX_DATA:
                src.feed(raw)
                if out is not None and prefix == PREFIX_DEFINITION:
                    out.write(raw)
                continue
            base.setdefault(dev, ts)
            elapsed = ts - base[dev]
            if src.sides.get(dev) != side:
                continue
            if t_side0 is None:
                t_side0 = elapsed
            e_s = (elapsed - t_side0) / 1e6
            if e_s < start_s:
                continue
            if e_s > start_s + seconds:
                break
            count[dev] = count.get(dev, 0) + 1
            if count[dev] % every:
                continue
            clock.set_us(1_700_000_000_000_000 + elapsed)
            src.feed(raw)
            if out is not None:
                out.write(raw)
            h = src.poll(clock.now_us())[side][0]
            if h is not None and h.tracked:
                t.append(int((e_s - start_s) * 1e6))
                q.append(np.asarray(h.wrist_q, dtype=float))
                rel.append(bool(h.heading_reliable))
    finally:
        if out is not None:
            out.close()
    qa = np.array(q) if q else np.zeros((0, 4))
    return {"t_us": np.array(t, dtype=np.int64), "wrist_q": qa,
            "yaw_deg": np.array([yaw_deg(x) for x in qa]), "heading_reliable": np.array(rel, dtype=bool)}


def survey(path: Path, side: str, bucket_s: float = 30.0, every: int = 20) -> list[dict]:
    w = walk(path, side, every=every)
    rows = []
    if not len(w["t_us"]):
        return rows
    ts = w["t_us"] / 1e6
    y = np.unwrap(np.radians(w["yaw_deg"]))
    for b0 in np.arange(0, ts[-1], bucket_s):
        m = (ts >= b0) & (ts < b0 + bucket_s)
        if m.sum() < 10:
            continue
        yy = np.degrees(y[m])
        rows.append({"start_s": round(float(b0), 1), "samples": int(m.sum()),
                     "yaw_mean": round(float(np.degrees(math.atan2(np.sin(np.radians(yy)).mean(), np.cos(np.radians(yy)).mean()))), 1),
                     "yaw_range": round(float(yy.max() - yy.min()), 1), "yaw_std": round(float(yy.std()), 1),
                     "reliable": round(float(w["heading_reliable"][m].mean()), 2)})
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("capture", type=Path)
    ap.add_argument("--side", default="right")
    ap.add_argument("--survey", action="store_true", help="yaw spread per 30 s bucket over the whole capture")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--rgmp-out", type=Path)
    a = ap.parse_args()
    if a.survey:
        for r in survey(a.capture, a.side):
            print(json.dumps(r))
        return 0
    w = walk(a.capture, a.side, a.start, a.seconds, rgmp_out=a.rgmp_out)
    n = len(w["t_us"])
    print(json.dumps({"samples": n, "seconds": round(float(w["t_us"][-1]) / 1e6, 2) if n else 0,
                      "yaw_min": round(float(w["yaw_deg"].min()), 1) if n else None,
                      "yaw_max": round(float(w["yaw_deg"].max()), 1) if n else None}))
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(a.out, **w, source=str(a.capture.name), side=a.side, start_s=a.start)
        print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
