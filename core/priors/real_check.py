"""Check the priors on the held-out real capture and the real held-pose lessons.

    python -m core.priors.real_check [--capture PATH] [--wearer arpan]

Nothing here trains anything: the capture is read only, and only the
models already built from FurElise and the generator are applied.

1. Piano ranges on the two typing runs of the Saturday capture (13:51:43
   to 13:52:17 and 14:18:11 to 14:19:03 local; capture clock zero is
   13:19:52, so about 1911 to 1945 s and 3499 to 3552 s). Typing is not
   piano, so this is a sanity check of the range logic: how often a real,
   calibrated typing hand falls inside the pianists' band, joint by joint.
2. Letter recogniser on the real held-pose lessons (lessons/replay-*):
   what each held shape reads as. None of them is a fingerspelled letter,
   so the expected reading is by shape only (a flat hand near B, a fist
   near A/S/E/M/N/T), and it is reported, not asserted.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .. import hand as H
from ..calibration import load_hand
from ..clock import FakeClock
from ..config import load_config
from ..rgmp import PREFIX_DATA, GloveSource
from . import asl, piano

ROOT = Path(__file__).resolve().parents[2]
CAPTURE = Path("/Users/arpanpandey/Code/Junction/repo/logs/live/20261114-131952/solver_12277.rgmp")
CAL_DATA = Path("/Users/arpanpandey/Code/Junction/repo/backend/data")
TYPING_WINDOWS = {"typing_run_1": (1912.0, 32.0), "typing_run_2": (3500.0, 51.0)}
# Capture clock zero, UTC (13:19:52 Helsinki). Calibration records are stamped in UTC.
CAPTURE_T0_UTC = "2026-11-14T11:19:52"
OUT = Path(__file__).resolve().parent / "out"


def hands_in_window(cfg, path: Path, start_s: float, seconds: float) -> dict[str, list[H.HandState]]:
    from tools.replay import cut_window
    from ..rgmp import DATA_HDR, OUTER

    defs, window = cut_window(path, start_s, seconds)
    clock = FakeClock()
    src = GloveSource(cfg, clock, host="x", port=1)
    for raw in defs:
        src.feed(raw)
    out: dict[str, list[H.HandState]] = {"left": [], "right": []}
    base: dict[int, int] = {}
    for prefix, ts, raw in window:
        if prefix == PREFIX_DATA and ts is not None:
            dev = DATA_HDR.unpack_from(raw, OUTER.size)[0]
            base.setdefault(dev, ts)
            clock.set_us(1_700_000_000_000_000 + ts - base[dev])
            src.feed(raw)
            polled = src.poll(clock.now_us())
            side = src.sides.get(dev)
            if side and polled[side][0] is not None and polled[side][0].tracked:
                out[side].append(polled[side][0])
        else:
            src.feed(raw)
    return out


def cal_before(cfg, side: str, before_utc: str):
    """The newest complete flat and fist record for this side taken before a time (what was in use)."""
    import json as _json

    from ..calibration import _phase_present, make_hand_calibration

    best = None
    for p in sorted((CAL_DATA / "calibrations").glob("*.json")):
        d = _json.loads(p.read_text(encoding="utf-8"))
        if d.get("side") != side or not (_phase_present(d.get("flat")) and _phase_present(d.get("fist"))):
            continue
        if d["created_at"][:19] >= before_utc:
            continue
        if best is None or d["created_at"] > best["created_at"]:
            best = d
    if best is None:
        return None
    return make_hand_calibration(
        side, best["flat"], best["fist"], cfg.calibration, cfg.hand,
        {"range_calibration_id": best["id"], "created_at": best["created_at"], "picked": "newest before the window"},
    )


def calibrated_angles(cfg, hands: list[H.HandState], side: str, wearer: str, before_utc: str | None = None) -> tuple[np.ndarray, dict]:
    cal = cal_before(cfg, side, before_utc) if before_utc else None
    if cal is None:
        cal = load_hand(CAL_DATA, side, wearer, cfg.calibration, cfg.hand)
    raw = np.stack([h.angles for h in hands]) if hands else np.zeros((0, H.N_ANGLES))
    if cal is None:
        return raw, {"calibration": None}
    return np.stack([cal.apply(a) for a in raw]) if len(raw) else raw, {
        "calibration": cal.origin,
        "unusable": [H.ANGLE_NAMES[i] for i in range(H.N_ANGLES) if cal.slot_weights()[i] == 0],
    }


def typing_check(cfg, capture: Path, wearer: str) -> dict:
    ranges = piano.PianoRanges.load()
    res = {}
    for name, (start, secs) in TYPING_WINDOWS.items():
        hands = hands_in_window(cfg, capture, start, secs)
        for side, hs in hands.items():
            if len(hs) < 20:
                continue
            from datetime import datetime, timedelta

            t = datetime.fromisoformat(CAPTURE_T0_UTC) + timedelta(seconds=start)
            ang, info = calibrated_angles(cfg, hs, side, wearer, t.isoformat()[:19])
            ang = ang[::3]
            inside = (ang >= ranges.lo) & (ang <= ranges.hi)
            n_out = [len(ranges.check(a)) for a in ang]
            worst: dict[str, int] = {}
            for a in ang:
                for item in ranges.check(a)[:1]:
                    key = f"{item['joint']} {item['direction']}"
                    worst[key] = worst.get(key, 0) + 1
            res[f"{name}_{side}"] = {
                "frames": int(len(ang)),
                "coach_fact_rate": fact_rate(ang),
                "inside_per_joint": {n: round(float(inside[:, j].mean()), 2) for j, n in enumerate(H.ANGLE_NAMES)},
                "all_inside_share": round(float(inside.all(axis=1).mean()), 3),
                "median_joints_outside": float(np.median(n_out)),
                "top_worst": sorted(worst.items(), key=lambda kv: -kv[1])[:5],
                "median_angles": {n: round(float(v), 1) for n, v in zip(H.ANGLE_NAMES, np.median(ang, axis=0))},
                **info,
            }
    return res


def fact_rate(angles: np.ndarray) -> float:
    """Share of frames where the coach-facing piano filter (facts.py) would raise at least one fact."""
    from .facts import piano_fact

    return round(float(np.mean([bool(piano_fact(a, None, None)["outside"]) for a in angles])), 3)


def pianist_fact_rate() -> dict:
    """The held-out pianists' frames through the same filter: the false-alarm rate on experts."""
    from .furelise_pull import open_dataset, pull_piece

    d = json.loads(piano.RANGES_FILE.read_text(encoding="utf-8"))
    zf = open_dataset()
    angs = []
    for p in d["pieces"]:
        if p["split"] != "test":
            continue
        pj = pull_piece(zf, p["piece_id"])
        f = piano.piece_features(p["piece_id"], p["subject_id"], pj.joints_left, pj.pressed, pj.bytes_read)
        angs.append(f.angles_cal)
    X = np.vstack(angs)[::5]
    return {"frames": int(len(X)), "fact_rate": fact_rate(X)}


def letters_on_lessons() -> dict:
    model = asl.LetterModel.load()
    out = {}
    for d in sorted((ROOT / "lessons").glob("replay-*")):
        tr = np.load(d / "trace.npz")
        a = np.median(tr["angles"], axis=0)
        out[d.name] = model.top2(a)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--capture", type=Path, default=CAPTURE)
    ap.add_argument("--wearer", default="arpan")
    a = ap.parse_args(argv)
    cfg = load_config()
    res = {"letters_on_real_held_poses": letters_on_lessons()}
    if a.capture.exists() and piano.RANGES_FILE.exists():
        res["piano_ranges_on_real_typing"] = typing_check(cfg, a.capture, a.wearer)
        res["piano_fact_rate_held_out_pianists"] = pianist_fact_rate()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "real_check.json").write_text(json.dumps(res, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(res, indent=1)[:6000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
