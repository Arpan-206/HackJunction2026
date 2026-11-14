"""Learn mode end to end on a raw RGMP capture: record a lesson from one glove, score the other against it.

    python -m tools.score_capture capture.rgmp [--master right] [--learner left] [--marks 3] [--json out.json]

Prints what the per-frame scores look like on real hands and which thresholds
would change the outcome. No server, no hardware: the capture is parsed with
core.rgmp, hands are built with GloveSource.poll on a fake clock, the lesson
is cut with the recorder (marks spread evenly over the take) and the learner
is scored with the session's own StepScorer.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core import hand as H
from core.clock import FakeClock
from core.config import load_config
from core.recorder import Recorder
from core.rgmp import DATA_HDR, OUTER, PREFIX_DATA, GloveSource
from core.scorer import StepScorer, Tolerances
from tools.replay import split_capture


def hands_from_capture(cfg, path: Path) -> dict[str, list[H.HandState]]:
    """Replay the capture through GloveSource at the capture's own pace (per-device clock)."""
    clock = FakeClock()
    src = GloveSource(cfg, clock, host="x", port=1)
    out: dict[str, list[H.HandState]] = {"left": [], "right": []}
    t_dev: dict[int, int] = {}
    base: dict[int, int] = {}
    for prefix, ts, raw in split_capture(path.read_bytes()):
        if prefix == PREFIX_DATA:
            dev = DATA_HDR.unpack_from(raw, OUTER.size)[0]
            base.setdefault(dev, ts)
            t_core = clock._t + 0 if dev not in t_dev else clock._t
            # map every device onto one core timeline: elapsed since its own first frame
            elapsed = ts - base[dev]
            clock.set_us(1_700_000_000_000_000 + elapsed)
            src.feed(raw)
            polled = src.poll(clock.now_us())
            side = src.sides.get(dev)
            if side and polled[side][0] is not None and polled[side][0].tracked:
                h = polled[side][0]
                h.t_us = clock.now_us()
                out[side].append(h)
        else:
            src.feed(raw)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--master", default="right")
    ap.add_argument("--learner", default="left")
    ap.add_argument(
        "--marks", type=int, default=3, help="cut the master take into this many steps"
    )
    ap.add_argument("--config", default=None)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    cfg = load_config(a.config)
    hands = hands_from_capture(cfg, Path(a.capture))
    master, learner = hands[a.master], hands[a.learner]
    print(
        f"capture: {len(master)} master ({a.master}) frames, {len(learner)} learner ({a.learner}) frames"
    )
    if len(master) < 10 or len(learner) < 10:
        print("not enough frames")
        return 1
    # 1. record the lesson from the master hand, marks evenly spaced
    rec = Recorder(cfg.record, cfg.score.hold_ms_default)
    t0 = master[0].t_us
    rec.start(
        t0,
        "real capture",
        "general",
        {},
        a.master,
        source="glove",
        master_name="capture",
    )
    for h in master:
        rec.add(h)
    span = master[-1].t_us - t0
    for k in range(1, a.marks):
        rec.mark(t0 + span * k // a.marks)
    lesson = rec.stop(master[-1].t_us, save=True, lesson_id="capture-eval")
    print(
        f"lesson: {len(lesson.steps)} steps, {lesson.duration_us / 1e6:.1f} s, rate {lesson.rate_hz} Hz"
    )
    for s in lesson.steps:
        print(
            f"  step {s.index} {s.kind:4s} {s.t0_us / 1e6:5.1f}..{s.t1_us / 1e6:5.1f} s  weights {s.weights}  key angles {np.round(s.key_angles).astype(int).tolist()}"
        )
    # 2. score the learner hand against each step, the whole take per step
    tol = Tolerances(cfg.score.perfect_deg, cfg.score.wrong_deg)
    report = {"steps": [], "thresholds": {}}
    all_err = {f: [] for f in H.FINGERS}
    for step in lesson.steps:
        sc = StepScorer(a.learner, lesson, step, cfg.score, tol)
        t_start = learner[0].t_us
        sc.reset_attempt(t_start)
        overall, passed_at, hints = [], None, {}
        for h in learner:
            gt = step.t0_us + (h.t_us - t_start) if step.kind == "move" else None
            fs = sc.update(h.t_us, h.angles, gt)
            overall.append(fs.overall)
            for f in H.FINGERS:
                all_err[f].append(fs.err_deg[f])
            if fs.passed and passed_at is None:
                passed_at = (h.t_us - t_start) / 1e6
            if fs.hint:
                hints[(fs.worst, fs.hint)] = hints.get((fs.worst, fs.hint), 0) + 1
        ov = np.asarray(overall)
        top_hint = max(hints.items(), key=lambda kv: kv[1])[0] if hints else None
        best = sc.summary(learner[-1].t_us, "general", lesson.title, stuck=False)
        print(
            f"  step {step.index}: overall mean {ov.mean():.2f} max {ov.max():.2f}  time at >= {cfg.score.pass_score}: {np.mean(ov >= cfg.score.pass_score) * 100:.0f}%"
            f"  passed at {passed_at if passed_at is None else f'{passed_at:.1f} s'}  commonest hint {top_hint}"
        )
        print(
            "      per finger err_deg mean: "
            + " ".join(
                f"{f} {np.mean([e for e in all_err[f][-len(learner) :]]):.0f}"
                for f in H.FINGERS
            )
            + "  | finger scores at end: "
            + " ".join(
                f"{f} {best['fingers'].get(f, {}).get('score', 1.0):.2f}"
                for f in H.FINGERS
            )
        )
        report["steps"].append(
            {
                "index": step.index,
                "kind": step.kind,
                "overall_mean": float(ov.mean()),
                "overall_max": float(ov.max()),
                "passed_at_s": passed_at,
                "top_hint": top_hint,
            }
        )
    # 3. what the thresholds would do
    err_all = np.concatenate([np.asarray(all_err[f]) for f in H.FINGERS])
    pcts = {p: float(np.percentile(err_all, p)) for p in (10, 25, 50, 75, 90)}
    print("\nper-finger absolute error over the whole take, degrees:")
    print(
        "  "
        + " ".join(
            f"{f}: median {np.median(all_err[f]):.0f} p90 {np.percentile(all_err[f], 90):.0f}"
            for f in H.FINGERS
        )
    )
    print(
        f"  all fingers: p10 {pcts[10]:.0f} p25 {pcts[25]:.0f} median {pcts[50]:.0f} p75 {pcts[75]:.0f} p90 {pcts[90]:.0f}"
    )
    print(
        "\nwhat the per-frame overall would be with other dead zones (perfect_deg / wrong_deg), same frames:"
    )
    for perfect, wrong in ((8, 45), (12, 45), (15, 60), (20, 60), (25, 70)):
        t2 = Tolerances(perfect, wrong)
        scores = []
        for step in lesson.steps:
            for h in learner:
                err = {
                    f: float(
                        np.mean(
                            np.abs(
                                h.angles[H.FLEXION_SLOTS[f]]
                                - step.key_angles[H.FLEXION_SLOTS[f]]
                            )
                        )
                    )
                    for f in H.FINGERS
                }
                scores.append(np.mean([t2.score(e) for e in err.values()]))
        sc_arr = np.asarray(scores)
        print(
            f"  {perfect:>2}/{wrong:<2}: mean overall {sc_arr.mean():.2f}, frames at or above 0.85: {np.mean(sc_arr >= 0.85) * 100:.0f}%, above 0.75: {np.mean(sc_arr >= 0.75) * 100:.0f}%"
        )
        report["thresholds"][f"{perfect}/{wrong}"] = {
            "mean": float(sc_arr.mean()),
            "pass85": float(np.mean(sc_arr >= 0.85)),
        }
    if a.json:
        Path(a.json).write_text(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
