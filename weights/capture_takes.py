"""Find repeated held poses in a scanned capture and show the consistency weights they give.

    python weights/capture_takes.py SCAN.npz [--side right] [--data-dir backend/data --wearer arpan] [--raw]

SCAN.npz comes from weights/scan_capture.py. Every still stretch (all angles
under [record] still_deg_s for still_min_ms, the recorder's own rule) is one
held pose. Poses within [record] take_match_deg of each other are takes of one
pose (core.recorder.take_groups), and each group with two or more takes gets
the consistency weights the recorder would give (core.recorder.consistency_weights).
With --data-dir the wearer's calibration is applied first, as the live core does.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core import hand as H  # noqa: E402
from core.calibration import load_hand  # noqa: E402
from core.config import load_config  # noqa: E402
from core.recorder import (  # noqa: E402
    Trace,
    consistency_weights,
    finger_flexion,
    still_regions,
    take_groups,
)


def poses(t_s: np.ndarray, angles: np.ndarray, rec) -> list[tuple[float, float, np.ndarray]]:
    n = len(t_s)
    tr = Trace(
        t_us=(t_s * 1e6).astype(np.int64),
        angles=angles.astype(float),
        joints=np.zeros((n, 26, 3)),
        wrist_p=np.zeros((n, 3)),
        wrist_q=np.tile([0.0, 0.0, 0.0, 1.0], (n, 1)),
        step=np.zeros(n, dtype=int),
    )
    out = []
    for a, b in still_regions(tr, rec.still_deg_s, rec.still_min_ms):
        out.append((float(t_s[a]), float(t_s[b]), angles[a : b + 1].mean(axis=0)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("scan", type=Path)
    ap.add_argument("--side", default="right")
    ap.add_argument("--data-dir", type=Path, default=None)
    ap.add_argument("--wearer", default="")
    ap.add_argument("--min-takes", type=int, default=2)
    a = ap.parse_args()
    cfg = load_config()
    rec = cfg.record
    z = np.load(a.scan)
    t, ang = z[f"{a.side}_t"], z[f"{a.side}_angles"].astype(float)
    if a.data_dir is not None:
        cal = load_hand(a.data_dir, a.side, a.wearer, cfg.calibration, cfg.hand)
        if cal is not None:
            ang = np.stack([cal.apply(x) for x in ang])
            print(f"calibrated with {cal.origin.get('range_calibration_id')}, unusable {cal.summary()['unusable']}")
    ps = poses(t, ang, rec)
    print(f"{a.side}: {len(t)} samples over {t[-1] - t[0]:.0f} s, {len(ps)} held poses")
    groups = take_groups([p[2] for p in ps], float(rec.take_match_deg))
    groups = [g for g in groups if len(g) >= a.min_takes]
    groups.sort(key=len, reverse=True)
    print("| Pose | Takes | First at (s) | Mean flexion t/i/m/r/l (deg) | Spread across takes t/i/m/r/l (deg) | Weights t/i/m/r/l |")
    print("| --- | --- | --- | --- | --- | --- |")
    fmt = lambda d, p=0: "/".join(f"{d[f]:.{p}f}" for f in H.FINGERS)  # noqa: E731
    for k, g in enumerate(groups):
        takes = [ps[i][2] for i in g]
        w, sd = consistency_weights(
            takes, rec.consistent_deg, rec.inconsistent_deg, rec.inconsistent_floor
        )
        mean = finger_flexion(np.mean(takes, axis=0))
        print(f"| {k + 1} | {len(g)} | {ps[g[0]][0]:.0f} | {fmt(mean)} | {fmt(sd, 1)} | {fmt(w, 2)} |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
