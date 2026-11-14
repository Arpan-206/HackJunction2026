"""Cut a held-pose lesson from a window of a raw RGMP capture, and score another take against it.

    python -m tools.cut_lesson CAPTURE --side right --start S --seconds D --name NAME
        [--learner-start S2 --learner-seconds D2 [--learner-side SIDE]]
        [--wearer arpan --calibration-dir DIR | --no-calibration] [--lessons-dir lessons] [--json out.json]

The lesson is written in the core's own format (lesson.json, trace.npz and the
step sketch) under <lessons-dir>/replay-<NAME>/ by the core's Recorder, exactly
as a `record_start` / `record_stop` on live gloves would: the hands are built
by GloveSource.poll at 30 Hz on a fake clock, calibrated with the wearer's
saved flat and fist (core/calibration.py, the backend's files), recorded, and
cut by the recorder into one hold step (the window is one still stretch).

The learner take is scored with the session's own StepScorer, with the step
weights times the learner calibration's finger mask and its slot mask, as
learn mode does (core/session.py `_weights_for`). The report gives whether
the hold passed, when, and the live score (0 to 100) over the take.

Times are capture seconds (tools/capture_inventory.py); the capture is read
in place and never copied.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core import hand as H
from core.calibration import HandCalibration, load_hand
from core.clock import FakeClock
from core.config import load_config
from core.recorder import Lesson, Recorder
from core.rgmp import PREFIX_DATA, GloveSource
from core.scorer import StepScorer, Tolerances
from tools.replay import CaptureClock, iter_messages

T0_US = 1_700_000_000_000_000
LEAD_US = 500_000  # data fed before the window so the newest frame per glove is fresh at its start


def window_hands(
    path: Path,
    side: str,
    start_s: float,
    seconds: float,
    rate_hz: float = 30.0,
    cfg=None,
) -> list[H.HandState]:
    """Raw HandStates of one hand in [start_s, start_s + seconds), sampled at rate_hz, t_us on a capture clock."""
    cfg = cfg or load_config(None)
    clock = FakeClock()
    src = GloveSource(cfg, clock, host="x", port=1)
    cc = CaptureClock()
    lo, hi = int(start_s * 1e6), int((start_s + seconds) * 1e6)
    step = int(1e6 / rate_hz)
    due = lo
    out: list[H.HandState] = []
    for prefix, dev, ts, raw in iter_messages(path):
        if prefix != PREFIX_DATA or dev is None:
            src.feed(raw)
            continue
        t = cc.t_us(dev, ts)
        if t >= hi:
            break
        if t < lo - LEAD_US:
            continue
        clock.set_us(T0_US + t)
        src.feed(raw)
        if src.sides.get(dev) != side or t < due or side not in src.latest:
            continue
        h = src.poll(clock.now_us())[side][0]
        if h is None or not h.tracked:
            continue
        h.t_us = T0_US + t
        out.append(h)
        due = (due + step) if due + step > t else t + step
    return out


def calibration_for(
    cfg, side: str, wearer: str, data_dir: Path | None
) -> HandCalibration | None:
    if data_dir is None:
        return None
    return load_hand(Path(data_dir), side, wearer, cfg.calibration, cfg.hand)


def apply_calibration(
    hands: list[H.HandState], cal: HandCalibration | None, cfg
) -> None:
    """As core/calibration.py Calibrations.apply: raw kept in angles_raw, angles and curl replaced."""
    for h in hands:
        if h.angles_raw is None:
            h.angles_raw = np.asarray(h.angles, dtype=float).copy()
        h.angles = h.angles_raw.copy() if cal is None else cal.apply(h.angles_raw)
        h.curl = H.curl_from_angles(
            h.angles, cfg.hand.curl_full_deg, cfg.hand.curl_full_thumb_deg
        )


def cut_lesson(
    cfg,
    hands: list[H.HandState],
    side: str,
    title: str,
    lesson_id: str,
    lessons_dir: Path | None,
    cal: HandCalibration | None,
    master_name: str = "replay",
    one_step: bool = True,
) -> Lesson:
    """Record the hands with the core's Recorder; save under lessons_dir/lesson_id when given (overwrites)."""
    if len(hands) < 10:
        raise ValueError(f"only {len(hands)} frames in the window")
    # The window is one still stretch by construction (tools/capture_inventory.py), so it is one hold step:
    # the recorder's auto cut would split it on 30 Hz sample noise across all 18 slots, so its still
    # regions are made longer than the window (one region or none gives one step, recorder.auto_boundaries).
    rec_cfg = copy.deepcopy(cfg.record)
    if one_step:
        rec_cfg.still_min_ms = (hands[-1].t_us - hands[0].t_us) / 1000 + 1
    rec = Recorder(rec_cfg, cfg.score.hold_ms_default)
    rec.start(
        hands[0].t_us,
        title,
        "general",
        {},
        side,
        source="glove",
        master_name=master_name,
    )
    for h in hands:
        rec.add(h)
    lesson = rec.stop(
        hands[-1].t_us,
        save=True,
        lesson_id=lesson_id,
        usable=None if cal is None else cal.finger_weights(),
    )
    if lesson is None:
        raise ValueError("the recorder made no lesson")
    if lessons_dir is not None:
        lesson.save(Path(lessons_dir), overwrite=True)
    return lesson


def score_take(
    cfg,
    lesson: Lesson,
    learner: list[H.HandState],
    side: str,
    cal: HandCalibration | None,
    step_index: int = 0,
) -> dict:
    """Learn mode on one hold step: the session's StepScorer with the learner calibration's masks."""
    step = lesson.steps[step_index]
    weights, slots = dict(step.weights), None
    if cal is not None:
        mask = cal.finger_weights()
        weights = {f: float(weights.get(f, 1.0)) * mask[f] for f in H.FINGERS}
        slots = cal.slot_weights()
    tol = Tolerances(float(cfg.score.perfect_deg), float(cfg.score.wrong_deg))
    sc = StepScorer(
        side, lesson, step, cfg.score, tol, weights=weights, slot_weights=slots
    )
    t0 = learner[0].t_us
    sc.reset_attempt(t0)
    overall, passed_at, err = [], None, {f: [] for f in H.FINGERS}
    for h in learner:
        fs = sc.update(h.t_us, h.angles, None)
        overall.append(fs.overall)
        for f in H.FINGERS:
            err[f].append(fs.err_deg[f])
        if fs.passed and passed_at is None:
            passed_at = (h.t_us - t0) / 1e6
    ov = np.asarray(overall)
    return {
        "frames": len(learner),
        "passed": passed_at is not None,
        "passed_at_s": None if passed_at is None else round(passed_at, 2),
        "score_mean": round(float(ov.mean()) * 100, 1),
        "score_best": round(float(ov.max()) * 100, 1),
        "time_at_pass_pct": round(
            float(np.mean(ov >= float(cfg.score.pass_score))) * 100, 1
        ),
        "err_deg_median": {f: round(float(np.median(err[f])), 1) for f in H.FINGERS},
        "weights": {f: round(float(v), 2) for f, v in weights.items()},
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("capture", type=Path)
    ap.add_argument("--side", required=True, choices=("left", "right"))
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--seconds", type=float, required=True)
    ap.add_argument("--name", required=True, help="lesson id becomes replay-<name>")
    ap.add_argument("--title", default=None)
    ap.add_argument("--learner-start", type=float, default=None)
    ap.add_argument("--learner-seconds", type=float, default=None)
    ap.add_argument("--learner-side", default=None, choices=("left", "right"))
    ap.add_argument("--wearer", default="arpan")
    ap.add_argument(
        "--calibration-dir",
        type=Path,
        default=None,
        help="backend data dir with calibrations/ and glove_calibrations/ (default: config.toml [calibration])",
    )
    ap.add_argument("--no-calibration", action="store_true")
    ap.add_argument(
        "--lessons-dir", type=Path, default=None, help="default: the core's lessons dir"
    )
    ap.add_argument("--json", type=Path, default=None)
    a = ap.parse_args()
    cfg = load_config(None)
    root = Path(str(cfg._root))
    lessons_dir = a.lessons_dir or root / cfg.server.lessons_dir
    cal_dir = (
        None
        if a.no_calibration
        else (a.calibration_dir or root / cfg.calibration.data_dir)
    )
    cal = calibration_for(cfg, a.side, a.wearer, cal_dir)
    hands = window_hands(a.capture, a.side, a.start, a.seconds, cfg=cfg)
    apply_calibration(hands, cal, cfg)
    lid = f"replay-{a.name}"
    lesson = cut_lesson(
        cfg, hands, a.side, a.title or f"Held pose {a.name}", lid, lessons_dir, cal
    )
    report = {
        "lesson": lid,
        "dir": str(lessons_dir / lid),
        "steps": [(s.kind, round((s.t1_us - s.t0_us) / 1e6, 1)) for s in lesson.steps],
        "calibration": None if cal is None else cal.summary(),
    }
    if a.learner_start is not None:
        ls = a.learner_side or a.side
        lcal = cal if ls == a.side else calibration_for(cfg, ls, a.wearer, cal_dir)
        learner = window_hands(
            a.capture, ls, a.learner_start, a.learner_seconds or a.seconds, cfg=cfg
        )
        apply_calibration(learner, lcal, cfg)
        report["score"] = score_take(cfg, lesson, learner, ls, lcal)
    print(json.dumps(report, indent=1, default=str))
    if a.json:
        a.json.write_text(json.dumps(report, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
