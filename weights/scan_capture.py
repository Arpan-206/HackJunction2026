"""Stream a long raw RGMP capture into a small angle file, without loading the capture into memory.

    python weights/scan_capture.py CAPTURE.rgmp OUT.npz [--every 8] [--from-s 0] [--to-s 0]

Reads the capture record by record (definition messages always, data frames
every `--every`-th per device), runs each through the core's own GloveSource
on a fake clock (as tools/score_capture.py does) and writes, per side, the
capture time in seconds since the first data frame, the 18 raw angles and the
wrist quaternion. The 736 MB solver capture of Sat 14 Nov becomes about 2 MB.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.clock import FakeClock  # noqa: E402
from core.config import load_config  # noqa: E402
from core.rgmp import DATA_HDR, OUTER, PREFIX_DATA, GloveSource  # noqa: E402

BASE_US = 1_700_000_000_000_000


def records(path: Path):
    """(prefix, raw bytes incl. outer header) for each message, streamed."""
    with open(path, "rb") as f:
        while True:
            head = f.read(OUTER.size)
            if len(head) < OUTER.size:
                return
            prefix, length = OUTER.unpack(head)
            body = f.read(length)
            if len(body) < length:
                return
            yield prefix, head + body


def scan(path: Path, every: int, from_s: float, to_s: float) -> dict[str, dict[str, np.ndarray]]:
    cfg = load_config()
    clock = FakeClock()
    src = GloveSource(cfg, clock, host="x", port=1)
    first_ts: int | None = None
    count: dict[int, int] = {}
    out: dict[str, dict[str, list]] = {s: {"t": [], "angles": [], "wrist_q": []} for s in ("left", "right")}
    for prefix, raw in records(path):
        if prefix != PREFIX_DATA:
            src.feed(raw)
            continue
        dev, _group, ts = DATA_HDR.unpack_from(raw, OUTER.size)
        first_ts = ts if first_ts is None else first_ts
        t_s = (ts - first_ts) / 1e6
        if t_s < from_s:
            continue
        if to_s and t_s > to_s:
            break
        n = count.get(dev, 0)
        count[dev] = n + 1
        if n % every:
            continue
        clock.set_us(BASE_US + (ts - first_ts))
        src.feed(raw)
        polled = src.poll(clock.now_us())
        side = src.sides.get(dev)
        if not side or polled[side][0] is None or not polled[side][0].tracked:
            continue
        h = polled[side][0]
        o = out[side]
        if o["t"] and t_s <= o["t"][-1]:
            continue
        o["t"].append(t_s)
        o["angles"].append(np.asarray(h.angles, dtype=np.float32))
        o["wrist_q"].append(np.asarray(h.wrist_q, dtype=np.float32))
    return {
        s: {k: np.asarray(v) for k, v in d.items()} for s, d in out.items()
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("capture", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--every", type=int, default=8)
    ap.add_argument("--from-s", type=float, default=0.0)
    ap.add_argument("--to-s", type=float, default=0.0)
    a = ap.parse_args()
    res = scan(a.capture, max(1, a.every), a.from_s, a.to_s)
    flat = {f"{s}_{k}": v for s, d in res.items() for k, v in d.items()}
    np.savez_compressed(a.out, **flat)
    for s, d in res.items():
        t = d["t"]
        span = f"{t[0]:.1f} to {t[-1]:.1f} s" if len(t) else "none"
        print(f"{s}: {len(t)} samples, {span}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
