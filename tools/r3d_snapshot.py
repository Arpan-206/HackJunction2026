"""Connect to the Record3DStream app named in config.toml, save one frame of each stream, report numbers.

    python -m tools.r3d_snapshot [--seconds 5] [--out logs/r3d/<time>] [--config config.toml]

Writes rgb.jpg, depth.npy, depth.png, confidence.png, intrinsics.json and frame.json,
then prints resolution, frame rate, inter-frame jitter, bytes per frame and the depth
and confidence statistics. Latency is reported as what can be measured without a
shared clock: the gap between the app's frame timestamp step and the arrival step.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.camera.record3dstream import Record3DStreamCamera, save_frame  # noqa: E402
from core.clock import Clock  # noqa: E402
from core.config import load_config  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=5.0)
    ap.add_argument("--out", default=None)
    ap.add_argument("--config", default=None)
    ap.add_argument("--usb", action="store_true", help="override config: go over the USB cable through iproxy")
    a = ap.parse_args()
    cfg = load_config(a.config)
    cam = Record3DStreamCamera(cfg, Clock())
    if a.usb:
        cam.usb = True
    print(f"connecting to {'usb (iproxy localhost)' if cam.usb else cam.host}:{cam.port} (from config.toml [camera.record3dstream])")
    cam.start()
    t0 = time.monotonic()
    seen: list[tuple[int, float, int]] = []   # (frame_id, stream_t, arrival_us)
    last_id = None
    while time.monotonic() - t0 < a.seconds:
        f = cam.read()
        if f is not None and f.frame_id != last_id:
            last_id = f.frame_id
            seen.append((f.frame_id, f.stream_t, f.arrival_us))
        time.sleep(0.005)
    f = cam.read()
    cam.stop()
    if f is None:
        print("no frame received:", cam.error)
        return 1
    out = Path(a.out) if a.out else Path("logs/r3d") / time.strftime("%Y%m%d-%H%M%S")
    info = save_frame(f, out)
    n = len(seen)
    dur_arrival = (seen[-1][2] - seen[0][2]) / 1e6 if n > 1 else 0
    dur_stream = seen[-1][1] - seen[0][1] if n > 1 else 0
    gaps = [(b[2] - a_[2]) / 1000 for a_, b in zip(seen, seen[1:])]
    print(f"saved to {out}")
    print(f"rgb {info['rgb'][0]}x{info['rgb'][1]}  depth {info.get('depth', {}).get('shape')}  confidence {info.get('confidence', {}).get('shape')}")
    print(f"frames {n} in {dur_arrival:.2f} s = {n / dur_arrival if dur_arrival else 0:.1f} fps (app timestamps span {dur_stream:.2f} s)")
    if gaps:
        gaps_sorted = sorted(gaps)
        print(f"inter-frame gap ms: median {gaps_sorted[len(gaps)//2]:.0f}, p90 {gaps_sorted[int(len(gaps)*0.9)]:.0f}, max {gaps_sorted[-1]:.0f}; {cam.bytes / max(1, cam.frames) / 1e3:.0f} kB per frame")
    ids = [s[0] for s in seen]
    print(f"frame ids {ids[0]}..{ids[-1]}: {ids[-1] - ids[0] + 1 - n} dropped between the ones received")
    print("depth:", json.dumps(info.get("depth")))
    print("confidence:", json.dumps(info.get("confidence")))
    print("K rgb:", [[round(x, 1) for x in r] for r in info["K"]])
    return 0


if __name__ == "__main__":
    sys.exit(main())
