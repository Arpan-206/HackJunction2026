"""Gloved-hand blob finder on a recording: both-hands rate, left/right swaps, jitter, speed.

    python -m tools.hand_blob_check captures/bench-gloves-1.gdrec.gz [--out logs/depth/NAME] [--images 8]

Uses core.camera.depth_track.hand_blobs (the function lane hand-root consumes). Prints and
writes summary.json, frames.csv and upright overlays (right hand green, left orange) to
logs/depth/<time>-<name>-hands/.

- found: frames with 0, 1 and 2 hand blobs.
- swaps: blobs are followed frame to frame by nearest centre (within track_gate_m); a swap is
  a followed blob whose side_hint (bench x, the person's left or right) changes.
- jitter: per followed blob, the distance of each centre from the mean of its 5-frame
  window (mm, median and p95): noise, not motion. step: frame-to-frame centre motion.
- plane: the app's plane against our own RANSAC fit (degrees, mm), and the camera height.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.camera.depth_track import (
    HandBlobConfig,
    HandBlobSides,
    TrackerConfig,
    app_table,
    backproject,
    camera_pose,
    fit_table,
    hand_blobs,
    rotate_upright,
    upright_turns,
)
from core.camera.gdrec import read_note, read_recording
from core.camera.geppetto_depth import parse_packet
from core.config import REPO_ROOT, load_config


def check(
    path: Path,
    out: Path,
    n_images: int = 8,
    hcfg: HandBlobConfig | None = None,
    tcfg: TrackerConfig | None = None,
    track_gate_m: float = 0.08,
) -> dict:
    import cv2

    out.mkdir(parents=True, exist_ok=True)
    packets = list(read_recording(path))
    picks = (
        set(
            np.linspace(0, len(packets) - 1, min(n_images, len(packets)))
            .astype(int)
            .tolist()
        )
        if packets
        else set()
    )
    rows, counts, ms = [], [0, 0, 0], []
    tracks: list[dict] = []  # {"c": centre, "side": str, "hist": [centres], "last": k}
    swaps, jit, steps = 0, [], []
    plane_deg, plane_mm, h_app, h_fit, arrivals = [], [], [], [], []
    rng = np.random.default_rng(0)
    turns_seen = set()
    sides = HandBlobSides()
    for k, (arr, pkt) in enumerate(packets):
        f = parse_packet(pkt, arr)
        if f is None:
            continue
        arrivals.append(arr)
        p, valid, in_world = backproject(f)
        cam, _ = camera_pose(f, in_world)
        conf = (
            f.confidence.reshape(-1)
            if f.confidence is not None
            else np.full(len(valid), 2, np.uint8)
        )
        app = app_table(f, cam, in_world)
        fit = fit_table(
            p[valid & (conf >= 2)],
            cam,
            np.array([0.0, 1.0, 0.0]) if in_world else None,
            tcfg or TrackerConfig(),
            rng,
        )
        if app is not None:
            h_app.append(app.camera_height_m)
        if fit is not None:
            h_fit.append(fit.camera_height_m)
        if app is not None and fit is not None:
            plane_deg.append(
                math.degrees(math.acos(min(1.0, abs(float(app.normal @ fit.normal)))))
            )
            plane_mm.append(float(fit.height(app.point[None])[0]) * 1000)
        t0 = time.perf_counter()
        blobs = sides.update(hand_blobs(f, None, 2, hcfg, tcfg))
        ms.append((time.perf_counter() - t0) * 1000)
        counts[min(2, len(blobs))] += 1
        turns_seen.add(upright_turns(f))
        # follow blobs by nearest centre
        used = set()
        for b in blobs:
            best, bd = None, track_gate_m
            for i, tr in enumerate(tracks):
                if i in used or k - tr["last"] > 3:
                    continue
                d = float(np.linalg.norm(b.centre_world - tr["c"]))
                if d < bd:
                    best, bd = i, d
            if best is None:
                tracks.append(
                    {
                        "c": b.centre_world,
                        "side": b.side_hint,
                        "hist": [b.centre_world],
                        "last": k,
                    }
                )
                used.add(len(tracks) - 1)
                continue
            tr = tracks[best]
            used.add(best)
            if tr["last"] == k - 1:
                steps.append(bd * 1000)
            if b.side_hint != tr["side"]:
                swaps += 1
            tr.update(c=b.centre_world, side=b.side_hint, last=k)
            tr["hist"].append(b.centre_world)
            if len(tr["hist"]) >= 5:
                w = np.array(tr["hist"][-5:])
                jit.append(float(np.linalg.norm(w[2] - w.mean(axis=0))) * 1000)
        rows.append(
            {
                "index": k,
                "frame_id": f.frame_id,
                "n": len(blobs),
                "ms": round(ms[-1], 2),
                **{
                    f"{s}_{x}": ""
                    for s in ("right", "left")
                    for x in ("x", "y", "z", "h", "area_m2", "dark")
                },
            }
        )
        for b in blobs:
            if b.side_hint:
                r = rows[-1]
                r[f"{b.side_hint}_x"], r[f"{b.side_hint}_y"], r[f"{b.side_hint}_z"] = [
                    round(float(v), 4) for v in b.centre_world
                ]
                (
                    r[f"{b.side_hint}_h"],
                    r[f"{b.side_hint}_area_m2"],
                    r[f"{b.side_hint}_dark"],
                ) = round(b.height_m, 3), b.area_m2, round(b.darkness, 2)
        if k in picks:
            img = f.bgr.copy()
            for b in blobs:
                m = cv2.resize(
                    b.mask.astype(np.uint8),
                    (img.shape[1], img.shape[0]),
                    interpolation=cv2.INTER_NEAREST,
                ).astype(bool)
                col = np.array(
                    (60, 220, 60) if b.side_hint == "right" else (0, 140, 255)
                )
                img[m] = (0.4 * img[m] + 0.6 * col).astype(np.uint8)
            img = rotate_upright(img, upright_turns(f))
            cv2.putText(
                img,
                f"#{f.frame_id} hands {len(blobs)}",
                (8, 22),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
            )
            cv2.imwrite(str(out / f"frame_{k:05d}_hands.jpg"), img)
    with open(out / "frames.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["index"])
        w.writeheader()
        w.writerows(rows)
    n = sum(counts)
    a = np.array(arrivals, dtype=np.int64)
    gaps = np.diff(a) / 1000.0 if len(a) > 1 else np.array([])

    def q(x, ps):
        return [round(float(v), 2) for v in np.percentile(x, ps)] if len(x) else None

    s = {
        "file": str(path),
        "note": read_note(path),
        "out": str(out),
        "frames": n,
        "upright_turns": sorted(turns_seen),
        "found": {
            "none": round(counts[0] / n, 3),
            "one": round(counts[1] / n, 3),
            "both": round(counts[2] / n, 3),
        }
        if n
        else None,
        "swaps": swaps,
        "tracks": len(tracks),
        "jitter_mm": {
            "p50": (q(jit, [50]) or [None])[0],
            "p95": (q(jit, [95]) or [None])[0],
        },
        "step_mm": {
            "p50": (q(steps, [50]) or [None])[0],
            "p95": (q(steps, [95]) or [None])[0],
        },
        "plane": {
            "app_fraction": round(len(h_app) / n, 3) if n else None,
            "camera_height_app_m": (q(h_app, [50]) or [None])[0],
            "camera_height_fit_m": (q(h_fit, [50]) or [None])[0],
            "fit_std_mm": round(float(np.std(h_fit)) * 1000, 1) if h_fit else None,
            "app_vs_fit_deg_p50": (q(plane_deg, [50]) or [None])[0],
            "app_vs_fit_mm_p50": (q(plane_mm, [50]) or [None])[0],
        },
        "ms": {
            "mean": round(float(np.mean(ms)), 1) if ms else None,
            "p95": (q(ms, [95]) or [None])[0],
        },
        "recording_fps": round(1000.0 / float(np.median(gaps)), 1)
        if len(gaps)
        else None,
    }
    (out / "summary.json").write_text(json.dumps(s, indent=2))
    return s


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("recording", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--images", type=int, default=8)
    a = ap.parse_args()
    cfg = load_config(None)
    sec = cfg.camera.get("depth") if "depth" in cfg.camera else None
    name = a.recording.name.split(".")[0]
    out = a.out or (
        REPO_ROOT / "logs" / "depth" / f"{time.strftime('%Y%m%d-%H%M%S')}-{name}-hands"
    )
    print(
        json.dumps(
            check(
                a.recording,
                out,
                a.images,
                HandBlobConfig.from_section(sec),
                TrackerConfig.from_section(sec),
            ),
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
