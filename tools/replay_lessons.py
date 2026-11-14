"""Held-pose lessons from the Saturday capture, scored against other takes, before and after a thumb calibration.

    python -m tools.replay_lessons CAPTURE --cache inv.npz [--lessons-dir lessons] [--cal-dir DIR]
        [--cal-out docs/replay-demo/cal-thumb] [--json docs/replay-demo/results.json]

1. Still stretches come from tools/capture_inventory.py (the --cache it wrote).
2. Per hand, the longest stretches of distinct poses become lessons (tools/cut_lesson.py, one hold step each);
   for each, the closest stretch of the same hand at least MIN_APART_S away is the learner (a different take of
   the same pose) and the farthest is a wrong-pose control.
3. Every take is scored three ways: raw angles, the wearer's saved calibration ("before"), and the same
   calibration plus a thumb-folded phase cut from the capture ("after", right hand only).

The thumb phase is written as a copy of the wearer's records under --cal-out (the backend's own file format,
`calibrations/<id>.json` with a `thumb` triple, and `glove_calibrations/<id>.json` linking it); today's files
are only read. The calibration window is kept out of every lesson and learner take.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core import hand as H
from core.calibration import angles_to_triples, load_hand
from core.config import load_config
from tools import capture_inventory as inv
from tools.cut_lesson import apply_calibration, cut_lesson, score_take, window_hands

MIN_LEN_S = 3.0
MIN_APART_S = 60.0
SAME_POSE_DEG = 8.0
DISTINCT_DEG = 12.0
WRONG_MIN_DEG = 25.0
PER_SIDE = 5
LESSON_MAX_S = 8.0
TAKE_MAX_S = 6.0
EDGE_S = 0.25

# The thumb hold found in the survey: right thumb bent (MCP about 63, IP about 37 degrees) with the fingers open,
# capture seconds 2968.6 to 2979.0. Used for the calibration only.
THUMB_WINDOW = (2969.0, 9.5)
WEARER = "arpan"
RIGHT_RANGE_ID, LEFT_RANGE_ID, WEARER_REC_ID = "c8713cacaff6", "50462cbe80bd", "a907152ed526"


def stretches(w: dict, side: str, exclude: tuple[float, float]) -> list[dict]:
    d = w[side]
    out = []
    for i0, i1 in inv.still_stretches(d["t_s"], d["angles"], d["tracked"]):
        t0, t1 = float(d["t_s"][i0]), float(d["t_s"][i1])
        if t1 - t0 < MIN_LEN_S or (t0 < exclude[1] and t1 > exclude[0]):
            continue
        med = np.median(d["angles"][i0:i1 + 1], axis=0)
        out.append({"side": side, "t0": t0, "t1": t1, "len": t1 - t0, "flex": med[inv.FLEX], "angles": med})
    return out


def pose_dist(a: dict, b: dict) -> float:
    return float(np.mean(np.abs(a["flex"] - b["flex"])))


def pick(st: list[dict]) -> list[tuple[dict, dict, dict]]:
    """[(expert, learner, wrong)] for up to PER_SIDE distinct poses, longest first."""
    picked: list[tuple[dict, dict, dict]] = []
    for e in sorted(st, key=lambda s: -s["len"]):
        if any(pose_dist(e, p[0]) < DISTINCT_DEG for p in picked):
            continue
        others = [s for s in st if abs(s["t0"] - e["t0"]) > MIN_APART_S]
        if not others:
            continue
        learner = min(others, key=lambda s: pose_dist(e, s))
        wrong = max(others, key=lambda s: pose_dist(e, s))
        if pose_dist(e, learner) > SAME_POSE_DEG or pose_dist(e, wrong) < WRONG_MIN_DEG:
            continue
        picked.append((e, learner, wrong))
        if len(picked) >= PER_SIDE:
            break
    return picked


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def write_thumb_calibration(cfg, capture: Path, src_dir: Path, out_dir: Path) -> dict:
    """Copy the wearer's records into out_dir with a `thumb` phase on the right range record; return a summary."""
    hands = window_hands(capture, "right", *THUMB_WINDOW, cfg=cfg)
    raw = np.median([h.angles for h in hands], axis=0)
    from core.compat import thumb_cmc_deg

    cmc = float(np.radians(np.median([thumb_cmc_deg(h.joints_local) for h in hands])))
    thumb = angles_to_triples(raw, cmc)
    rng = json.loads((src_dir / "calibrations" / f"{RIGHT_RANGE_ID}.json").read_text())
    left = json.loads((src_dir / "calibrations" / f"{LEFT_RANGE_ID}.json").read_text())
    rec = json.loads((src_dir / "glove_calibrations" / f"{WEARER_REC_ID}.json").read_text())
    new_right_id = f"{RIGHT_RANGE_ID}-thumb"
    rng_new = {**rng, "id": new_right_id, "thumb": thumb,
               "note": f"replay-demo lane: thumb phase cut offline from the capture, capture seconds {THUMB_WINDOW[0]} "
                       f"to {THUMB_WINDOW[0] + THUMB_WINDOW[1]}; flat and fist copied from {RIGHT_RANGE_ID}"}
    rec_new = {**rec, "id": f"{WEARER_REC_ID}-thumb",
               "range_calibration_ids": {"left": LEFT_RANGE_ID, "right": new_right_id}}
    (out_dir / "calibrations").mkdir(parents=True, exist_ok=True)
    (out_dir / "glove_calibrations").mkdir(parents=True, exist_ok=True)
    (out_dir / "calibrations" / f"{new_right_id}.json").write_text(json.dumps(rng_new, indent=1))
    (out_dir / "calibrations" / f"{LEFT_RANGE_ID}.json").write_text(json.dumps(left, indent=1))
    (out_dir / "glove_calibrations" / f"{rec_new['id']}.json").write_text(json.dumps(rec_new, indent=1))
    flat = {k: round(float(np.degrees(rng["flat"]["thumb"][j])), 1) for k, j in (("mcp", 1), ("ip", 2))}
    fist = {k: round(float(np.degrees(rng["fist"]["thumb"][j])), 1) for k, j in (("mcp", 1), ("ip", 2))}
    folded = {"mcp": round(float(raw[0]), 1), "ip": round(float(raw[1]), 1), "cmc": round(float(np.degrees(cmc)), 1)}
    fingers = {f: round(float(np.mean(raw[H.FLEXION_SLOTS[f]])), 1) for f in ("index", "middle", "ring", "little")}
    return {"frames": len(hands), "window": THUMB_WINDOW, "flat_thumb_deg": flat, "fist_thumb_deg": fist,
            "folded_thumb_deg": folded, "fingers_deg_during_fold": fingers, "thumb_triple": thumb,
            "files": sorted(str(p.relative_to(out_dir)) for p in out_dir.rglob("*.json"))}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("capture", type=Path)
    ap.add_argument("--cache", type=Path, required=True, help="tools/capture_inventory.py --cache output")
    ap.add_argument("--lessons-dir", type=Path, default=None)
    ap.add_argument("--cal-dir", type=Path, default=None, help="the backend data dir with today's records (read only)")
    ap.add_argument("--cal-out", type=Path, default=Path("docs/replay-demo/cal-thumb"))
    ap.add_argument("--json", type=Path, default=Path("docs/replay-demo/results.json"))
    a = ap.parse_args()
    cfg = load_config(None)
    root = Path(str(cfg._root))
    lessons_dir = a.lessons_dir or root / cfg.server.lessons_dir
    cal_dir = a.cal_dir or root / cfg.calibration.data_dir
    w = inv.load_cache(a.cache)

    thumb = write_thumb_calibration(cfg, a.capture, cal_dir, a.cal_out)
    cals = {
        "raw": {"left": None, "right": None},
        "before": {s: load_hand(cal_dir, s, WEARER, cfg.calibration, cfg.hand) for s in ("left", "right")},
        "after": {s: load_hand(a.cal_out, s, WEARER, cfg.calibration, cfg.hand) for s in ("left", "right")},
    }
    excl = (THUMB_WINDOW[0] - 1, THUMB_WINDOW[0] + THUMB_WINDOW[1] + 1)
    rows = []
    for side in ("right", "left"):
        for e, l, wr in pick(stretches(w, side, excl)):
            pose = inv.describe_pose(inv.curl_of(e["angles"], cfg))
            name = f"{side}-{slug(pose)}-{int(e['t0'])}"
            e_win = (e["t0"] + EDGE_S, min(e["len"] - 2 * EDGE_S, LESSON_MAX_S))
            l_win = (l["t0"] + EDGE_S, min(l["len"] - 2 * EDGE_S, TAKE_MAX_S))
            w_win = (wr["t0"] + EDGE_S, min(wr["len"] - 2 * EDGE_S, TAKE_MAX_S))
            ex_raw = window_hands(a.capture, side, *e_win, cfg=cfg)
            le_raw = window_hands(a.capture, side, *l_win, cfg=cfg)
            wr_raw = window_hands(a.capture, side, *w_win, cfg=cfg)
            row = {"lesson": f"replay-{name}", "side": side, "pose": pose,
                   "expert": [round(x, 1) for x in e_win], "learner": [round(x, 1) for x in l_win],
                   "wrong": [round(x, 1) for x in w_win],
                   "pose_dist_deg": round(pose_dist(e, l), 1), "wrong_dist_deg": round(pose_dist(e, wr), 1),
                   "flex_deg": {f: round(float(np.mean(e["angles"][H.FLEXION_SLOTS[f]])), 0) for f in H.FINGERS},
                   "scores": {}}
            for mode, by_side in cals.items():
                cal = by_side[side]
                ex = ex_raw  # apply_calibration recomputes angles from angles_raw on every pass
                apply_calibration(ex, cal, cfg)
                # the "before" lesson is the one written to disk: what the live core would have recorded
                lesson = cut_lesson(cfg, ex, side, f"Held pose: {pose} ({side})", row["lesson"],
                                    lessons_dir if mode == "before" else None, cal)
                apply_calibration(le_raw, cal, cfg)
                right = score_take(cfg, lesson, le_raw, side, cal)
                apply_calibration(wr_raw, cal, cfg)
                bad = score_take(cfg, lesson, wr_raw, side, cal)
                row["scores"][mode] = {"right": right, "wrong": bad}
            rows.append(row)
            sc = row["scores"]
            print(f"{row['lesson']:52s} same {sc['before']['right']['score_mean']:5.1f} "
                  f"(raw {sc['raw']['right']['score_mean']:5.1f}, thumb {sc['after']['right']['score_mean']:5.1f}) "
                  f"pass {sc['before']['right']['passed']}  wrong {sc['before']['wrong']['score_mean']:5.1f} "
                  f"pass {sc['before']['wrong']['passed']}", flush=True)
    out = {"capture": str(a.capture), "thumb_calibration": thumb,
           "calibration_summary": {m: {s: (None if c is None else c.summary()) for s, c in v.items()} for m, v in cals.items()},
           "lessons": rows}
    a.json.parent.mkdir(parents=True, exist_ok=True)
    a.json.write_text(json.dumps(out, indent=1, default=str))
    print(f"wrote {a.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
