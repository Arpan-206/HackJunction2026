"""Build the piano ranges from FurElise: pull, convert, summarise.

    python -m core.priors.build_piano [--per-subject 4] [--max-pieces 0]

Streams each chosen piece's left-hand joint array and key presses out of
the remote zip (core/priors/furelise_pull.py), converts them at once to
the 18 angles, and keeps only the angles in memory. Writes:

- core/priors/models/piano_ranges.json: per-joint percentiles (all,
  pressing, not pressing), suggested tolerances per finger, per-piece fit
  correlations and the source of every piece;
- core/priors/data/piano_furelise.provenance.json: one source tag per
  training frame.

Pieces are split by pianist: the test pianists' frames never set a range,
and the report gives how often their frames fall inside the training band.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request

import numpy as np

from .. import hand as H
from . import piano
from .furelise_pull import open_dataset, pull_piece
from .provenance import write_manifest

METADATA_URL = "https://huggingface.co/datasets/rcwang/for_elise/raw/main/metadata.json"
TEST_SUBJECTS = (3, 9)  # held-out pianists, chosen before any result was seen


def choose(meta: list[dict], per_subject: int) -> list[dict]:
    by: dict[int, list[dict]] = {}
    for m in sorted(meta, key=lambda m: m["piece_id"]):
        by.setdefault(int(m["subject_id"]), []).append(m)
    out = []
    for s in sorted(by):
        out += by[s][:per_subject]
    return out


def inside_rate(angles: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> dict:
    inside = (angles >= lo) & (angles <= hi)
    return {
        "frames": int(len(angles)),
        "per_joint": {n: round(float(inside[:, j].mean()), 3) for j, n in enumerate(H.ANGLE_NAMES)},
        "all_joints_inside": round(float(inside.all(axis=1).mean()), 3),
        "mean_joints_outside": round(float((~inside).sum(axis=1).mean()), 2),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-subject", type=int, default=4)
    ap.add_argument("--max-pieces", type=int, default=0)
    a = ap.parse_args(argv)
    with urllib.request.urlopen(METADATA_URL, timeout=60) as r:
        meta = json.load(r)
    pieces = choose(meta, a.per_subject)
    if a.max_pieces:
        pieces = pieces[: a.max_pieces]
    zf = open_dataset()
    feats: list[piano.PieceFeatures] = []
    t0 = time.time()
    total_bytes = 0
    for m in pieces:
        pid = f"{int(m['piece_id']):03d}"
        pj = pull_piece(zf, pid)
        total_bytes += pj.bytes_read + pj.pressed.nbytes // 30
        feats.append(piano.piece_features(pid, int(m["subject_id"]), pj.joints_left, pj.pressed, pj.bytes_read))
        print(f"{pid} subject {m['subject_id']} frames {len(feats[-1].pressing)} fit_r {feats[-1].fit_r:.2f} t {time.time() - t0:.0f}s", flush=True)

    train = [f for f in feats if f.subject_id not in TEST_SUBJECTS]
    test = [f for f in feats if f.subject_id in TEST_SUBJECTS]
    Xtr = np.vstack([f.angles_cal for f in train])
    Ptr = np.concatenate([f.pressing for f in train])
    out = {
        "source": "FurElise (CC BY-NC 4.0), left hand, marker motion capture of 15 elite pianists",
        "scale": "calibrated degrees: flexion rescaled by AAOS normal range (MCP 90, PIP 100, DIP 70; thumb MCP 50, IP 80) so a fist reads 90 (thumb 60); spreads anatomical",
        "fps_after_downsample": round(59.94 / piano.DOWNSAMPLE, 2),
        "train_frames": int(len(Xtr)),
        "train_pressing_share": round(float(Ptr.mean()), 3),
        "all": piano.ranges_from(Xtr),
        "pressing": piano.ranges_from(Xtr[Ptr]) if Ptr.sum() > 100 else None,
        "not_pressing": piano.ranges_from(Xtr[~Ptr]) if (~Ptr).sum() > 100 else None,
        "suggested_tolerances": piano.suggested_tolerances(Xtr[:: max(1, len(Xtr) // 20000)]),
        "current_tolerances": {"perfect_deg": 15, "wrong_deg": 60},
        "pieces": [
            {"piece_id": f.piece_id, "subject_id": f.subject_id, "frames": int(len(f.pressing)), "press_fit_r": round(f.fit_r, 3), "split": "test" if f.subject_id in TEST_SUBJECTS else "train"}
            for f in feats
        ],
        "test_subjects": list(TEST_SUBJECTS),
        "bytes_streamed": int(total_bytes),
    }
    if test:
        Xte = np.vstack([f.angles_cal for f in test])
        lo = np.array([out["all"][n]["p5"] for n in H.ANGLE_NAMES])
        hi = np.array([out["all"][n]["p95"] for n in H.ANGLE_NAMES])
        out["held_out_pianists_inside_p5_p95"] = inside_rate(Xte, lo, hi)
    piano.RANGES_FILE.parent.mkdir(parents=True, exist_ok=True)
    piano.RANGES_FILE.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    sources = []
    for f in train:
        sources += [f"open_dataset:furelise:piece_{f.piece_id}:left"] * len(f.pressing)
    write_manifest(
        "piano_furelise",
        sources,
        {
            "component": "piano_posture",
            "dataset": "furelise",
            "licence": "CC BY-NC 4.0",
            "pieces_train": [f.piece_id for f in train],
            "pieces_test": [f.piece_id for f in test],
            "held_out_real_data_used": False,
        },
    )
    print(json.dumps({k: out[k] for k in ("train_frames", "train_pressing_share", "suggested_tolerances", "bytes_streamed")}, indent=1))
    if test:
        print(json.dumps(out["held_out_pianists_inside_p5_p95"], indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
