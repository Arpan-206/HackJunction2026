"""Run the hand root tracker (core/camera/hand_root.py) over a GeppettoDepth recording.

    python -m tools.hand_root_check captures/bench-stand-1.gdrec.gz --out logs/hand_root/bench-stand-1

Writes into --out: track.csv (one row per fix), summary.json (detection rate, range in
x, y, z, jitter when still), track.png (the wrist over time) and frames/ (every
--every-th frame with the landmarks and the bench position drawn). Prints the summary.
Jitter when still: the standard deviation of the smoothed position over every 1 s window
in which the raw wrist moves less than 1 cm per frame on average, reported as the median
over such windows.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

from core.camera.gdrec import frames
from core import hand as H
from core.camera.hand_root import HandRootTracker, RootConfig, rotate_image
from core.root_fuse import FuseConfig, RootFuser
from core.config import REPO_ROOT, load_config


def still_jitter(t: np.ndarray, p: np.ndarray, raw: np.ndarray, win_s: float = 1.0) -> dict:
    out = []
    if len(t) < 10:
        return {"windows": 0}
    i = 0
    while i < len(t):
        j = int(np.searchsorted(t, t[i] + win_s))
        if j - i >= 15:
            steps = np.linalg.norm(np.diff(raw[i:j], axis=0), axis=1)
            if steps.mean() < 0.01 and np.ptp(raw[i:j], axis=0).max() < 0.04:
                out.append(p[i:j].std(axis=0))
        i = max(j, i + 1)
    if not out:
        return {"windows": 0}
    a = np.array(out) * 1000
    return {"windows": len(out), "median_std_mm": [round(float(x), 2) for x in np.median(a, axis=0)],
            "median_std_norm_mm": round(float(np.median(np.linalg.norm(a, axis=1))), 2)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("recording")
    ap.add_argument("--out", default="logs/hand_root/check")
    ap.add_argument("--every", type=int, default=60, help="save every n-th frame as an image (0: none)")
    ap.add_argument("--max-frames", type=int, default=0)
    ap.add_argument("--no-swap", action="store_true", help="keep MediaPipe's handedness label as it is")
    ap.add_argument("--rotate", default=None, help='"auto" or quarter turns clockwise 0..3')
    ap.add_argument("--clahe", action="store_true", help="grey plus local contrast before detection")
    ap.add_argument("--gloves", default="both", choices=["both", "left", "right"],
                    help="glove hands the simulated session has (sets one-hand or two-hand matching)")
    ap.add_argument("--mode", default=None, help='"auto", "blobs" or "mediapipe"')
    args = ap.parse_args(argv)
    import cv2

    cfg = load_config()
    rc = RootConfig.from_config(cfg)
    if args.no_swap:
        rc.swap_handedness = False
    if args.rotate is not None:
        rc.rotate = args.rotate
    rc.clahe = rc.clahe or args.clahe
    if args.mode:
        rc.mode = args.mode
    fuser = RootFuser(FuseConfig.from_config(cfg))
    sides = ("left", "right") if args.gloves == "both" else (args.gloves,)
    key_side: dict = {}
    id_swaps = 0
    fused: dict = {s: [] for s in sides}
    both_found = 0
    rest = {s: cfg.rest_pose[s].p for s in ("left", "right")}
    model = Path(cfg.camera.model_path)
    if not model.is_absolute():
        model = REPO_ROOT / model
    tr = HandRootTracker(rc, rest_p=rest, model_path=model)
    out = Path(args.out)
    (out / "frames").mkdir(parents=True, exist_ok=True)
    rows, n, t0, ms = [], 0, None, []
    with_hand = 0
    for f in frames(Path(args.recording)):
        if t0 is None:
            t0 = f.t_us
        fixes = tr.process(f)
        ms.append(tr.process_ms)
        n += 1
        hands = {s: None for s in ("left", "right")}
        for s in sides:
            h = H.synth_hand(side=s, curl={k: 0.3 for k in H.FINGERS}, t_us=f.t_us, device_id=1 if s == "left" else 2)
            h.wrist_p = np.asarray(rest[s], dtype=float)
            hands[s] = h
        fuser.apply(hands, fixes, f.t_us)
        got = fuser.last_assigned
        if got:
            with_hand += 1
        if all(s in got for s in sides):
            both_found += 1
        for s, x in got.items():
            if x.key and key_side.get(x.key, s) != s:
                id_swaps += 1
            if x.key:
                key_side[x.key] = s
        for s in sides:
            fused[s].append(((f.t_us - t0) / 1e6, hands[s].wrist_p.copy(), hands[s].anchor))
        for s, x in got.items():
            rows.append({"t_s": round((f.t_us - t0) / 1e6, 3), "frame_id": f.frame_id, "side": s,
                         "src": x.source, "key": x.key, "led": int(x.led),
                         "dark": None if x.darkness is None else round(x.darkness, 3),
                         "score": round(x.score, 3), "conf": round(x.confidence, 3),
                         "x": round(float(x.p[0]), 4), "y": round(float(x.p[1]), 4), "z": round(float(x.p[2]), 4),
                         "bx": round(float(x.p_bench[0]), 4), "by": round(float(x.p_bench[1]), 4),
                         "bz": round(float(x.p_bench[2]), 4), "u": round(x.px[0], 1), "v": round(x.px[1], 1)})
        if args.every and n % args.every == 1:
            img = f.bgr.copy()
            for x in fixes:
                cv2.circle(img, (int(x.px[0]), int(x.px[1])), 9, (0, 255, 0), 2)
            for s, x in got.items():
                cv2.putText(img, f"{s} h={x.p_bench[1]*100:.0f}cm{' LED' if x.led else ''}",
                            (int(x.px[0]) + 12, int(x.px[1])), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            img = rotate_image(img, tr.rot)
            cv2.putText(img, f"t={(f.t_us - t0) / 1e6:5.1f}s fixes={len(fixes)}", (10, 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.imwrite(str(out / "frames" / f"{n:05d}.jpg"), img)
        if args.max_frames and n >= args.max_frames:
            break
    with open(out / "track.csv", "w", newline="") as fh:
        if rows:
            w = csv.DictWriter(fh, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
    summ: dict = {"recording": args.recording, "frames": n, "frames_with_fix": with_hand,
                  "fix_rate": round(with_hand / max(1, n), 3), "tracker": tr.status(), "gloves": args.gloves,
                  "all_gloves_found_rate": round(both_found / max(1, n), 3), "identity_swaps": id_swaps,
                  "fuser": fuser.status(),
                  "fps_capture": round((n - 1) / max(1e-6, (f.t_us - t0) / 1e6), 1) if n > 1 else None,
                  "fps_tracker_max": None,
                  "process_ms_median": round(float(np.median(ms)), 1) if ms else None,
                  "process_ms_p95": round(float(np.percentile(ms, 95)), 1) if ms else None}
    summ["fps_tracker_max"] = round(1000.0 / max(1e-6, summ["process_ms_median"] or 1e9), 1)
    for side in sides:
        tt = np.array([a for a, _, _ in fused[side]])
        pp = np.array([b for _, b, _ in fused[side]])
        live = np.array([c == "camera" for _, _, c in fused[side]])
        summ[f"fused_{side}"] = {"live_rate": round(float(live.mean()), 3),
                                "jitter_still": still_jitter(tt[live], pp[live], pp[live]) if live.sum() > 10 else None}
    for side in ("left", "right"):
        r = [x for x in rows if x["side"] == side]
        if not r:
            continue
        t = np.array([x["t_s"] for x in r])
        p = np.array([[x["x"], x["y"], x["z"]] for x in r])
        raw = np.array([[x["bx"], x["by"], x["bz"]] for x in r])
        summ[side] = {"fixes": len(r), "t_first_s": float(t[0]), "t_last_s": float(t[-1]),
                      "range_m": {k: [round(float(p[:, i].min()), 3), round(float(p[:, i].max()), 3)]
                                  for i, k in enumerate("xyz")},
                      "height_above_table_m": [round(float(raw[:, 1].min()), 3), round(float(raw[:, 1].max()), 3)],
                      "jitter_still": still_jitter(t, p, raw)}
    (out / "summary.json").write_text(json.dumps(summ, indent=2))
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(3, 1, figsize=(10, 7), sharex=True)
        for side, colour in (("left", "#2f6db5"), ("right", "#b5452f")):
            r = [x for x in rows if x["side"] == side]
            if not r:
                continue
            t = [x["t_s"] for x in r]
            for i, k in enumerate("xyz"):
                ax[i].plot(t, [x[k] for x in r], ".", ms=2, color=colour, label=side)
        for i, k in enumerate("xyz"):
            ax[i].set_ylabel(f"{k} (m, core world)")
            ax[i].grid(alpha=0.3)
        ax[0].legend(loc="upper right")
        ax[2].set_xlabel("time (s)")
        fig.suptitle(f"Wrist track: {Path(args.recording).name}, fix rate {summ['fix_rate']:.0%}")
        fig.tight_layout()
        fig.savefig(out / "track.png", dpi=110)
    except ImportError:
        print("matplotlib missing: no track.png", file=sys.stderr)
    print(json.dumps(summ, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
