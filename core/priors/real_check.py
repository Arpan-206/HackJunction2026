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


def calibrated_angles(cfg, hands: list[H.HandState], side: str, wearer: str) -> tuple[np.ndarray, dict]:
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
            ang, info = calibrated_angles(cfg, hs, side, wearer)
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
                "inside_per_joint": {n: round(float(inside[:, j].mean()), 2) for j, n in enumerate(H.ANGLE_NAMES)},
                "all_inside_share": round(float(inside.all(axis=1).mean()), 3),
                "median_joints_outside": float(np.median(n_out)),
                "top_worst": sorted(worst.items(), key=lambda kv: -kv[1])[:5],
                "median_angles": {n: round(float(v), 1) for n, v in zip(H.ANGLE_NAMES, np.median(ang, axis=0))},
                **info,
            }
    return res


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
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "real_check.json").write_text(json.dumps(res, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(res, indent=1)[:6000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
