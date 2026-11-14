"""Learn mode end to end on a raw RGMP capture: record a lesson from one glove, score the other against it.

    python -m tools.score_capture capture.rgmp [--master right] [--learner left] [--marks 3] [--json out.json]
        [--calibrate none|capture|store] [--calibration-out DIR] [--wearer NAME]

--calibrate capture: the capture is Szymon's scripted take (slices flat, fist,
open, thumb, index, middle, ring, little, cut by time gaps). Each hand's flat
and fist slices become a calibration in the backend's own file format
(`calibrations/<id>.json`, written to --calibration-out), which is then read
back with core/calibration.py exactly as the live core reads it, and applied.
--calibrate store: use the backend's saved calibrations ([calibration] in
config.toml, --wearer). With a calibration the report adds the time-aligned
cross-hand error on the six phases not used to calibrate.

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
from core.calibration import angles_to_triples, load_hand
from core.clock import FakeClock
from core.compat import thumb_cmc_deg
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


PHASES = ["flat", "fist", "open", "thumb", "index", "middle", "ring", "little"]
SEGMENT_GAP_US = 100_000  # as backend/tests/test_glove_rgmp_replay.py


def phase_segments(hands: list[H.HandState]) -> list[list[H.HandState]]:
    """Contiguous runs of frames, cut where time jumps by more than SEGMENT_GAP_US."""
    out: list[list[H.HandState]] = []
    for h in hands:
        if not out or h.t_us - out[-1][-1].t_us > SEGMENT_GAP_US:
            out.append([])
        out[-1].append(h)
    return out


def write_capture_calibration(
    side: str, hands: list[H.HandState], out_dir: Path
) -> str | None:
    """Flat and fist (median over the first two slices) as a backend `Calibration` file; returns its id."""
    segs = phase_segments(hands)
    if len(segs) < 2:
        return None
    phases = {}
    for name, seg in zip(("flat", "fist"), segs[:2]):
        a = np.median([h.angles for h in seg], axis=0)
        cmc = float(np.radians(np.median([thumb_cmc_deg(h.joints_local) for h in seg])))
        phases[name] = angles_to_triples(a, cmc)
    cid = f"capture-{side}"
    d = out_dir / "calibrations"
    d.mkdir(parents=True, exist_ok=True)
    body = {
        "id": cid,
        "side": side,
        "flat": phases["flat"],
        "fist": phases["fist"],
        "created_at": "2026-11-14T00:00:00Z",
    }
    (d / f"{cid}.json").write_text(json.dumps(body, indent=1))
    return cid


def calibrate_hands(cfg, hands: dict, mode: str, out_dir: Path, wearer: str) -> dict:
    """Apply the calibration to every HandState in place (raw kept in angles_raw); returns the summaries."""
    summaries = {}
    for side, hs in hands.items():
        if mode == "capture":
            if write_capture_calibration(side, hs, out_dir) is None:
                summaries[side] = None
                continue
            cal = load_hand(out_dir, side, "", cfg.calibration, cfg.hand)
        else:
            d = Path(str(cfg.calibration.data_dir))
            if not d.is_absolute():
                d = Path(str(cfg._root)) / d
            cal = load_hand(d, side, wearer, cfg.calibration, cfg.hand)
        summaries[side] = None if cal is None else cal.summary()
        if cal is None:
            continue
        for h in hs:
            h.angles_raw = np.asarray(h.angles, dtype=float).copy()
            h.angles = cal.apply(h.angles_raw)
    return summaries


def aligned_phase_error(hands: dict, use_raw: bool, wrong: bool = False) -> dict:
    """Left against right, phase by phase, frames paired in order: per-finger abs error in degrees.

    Only the six phases after flat and fist, so a calibration taken from those
    two slices is never scored on its own data. With wrong=True every left
    phase is paired with every other right phase instead: a learner holding
    the wrong pose, mostly one finger off (the phases move one finger each).
    """
    sl, sr = phase_segments(hands["left"]), phase_segments(hands["right"])
    if len(sl) != len(PHASES) or len(sr) != len(PHASES):
        return {}
    per_phase: dict[str, dict[str, float]] = {}
    frames = {f: [] for f in H.FINGERS}
    held = range(2, len(PHASES))
    for k, m in (
        [(k, m) for k in held for m in held if m != k]
        if wrong
        else [(k, k) for k in held]
    ):
        n = min(len(sl[k]), len(sr[m]))
        row = {}
        for f in H.FINGERS:
            slots = H.FLEXION_SLOTS[f]
            errs = []
            for hl, hr in zip(sl[k][:n], sr[m][:n]):
                al = (
                    hl.angles_raw
                    if use_raw and hl.angles_raw is not None
                    else hl.angles
                )
                ar = (
                    hr.angles_raw
                    if use_raw and hr.angles_raw is not None
                    else hr.angles
                )
                errs.append(float(np.mean(np.abs(al[slots] - ar[slots]))))
            frames[f].extend(errs)
            row[f] = float(np.median(errs))
        per_phase[PHASES[k] if k == m else f"{PHASES[k]}/{PHASES[m]}"] = row
    return {"per_phase_median": per_phase, "frames": frames}


def print_aligned(title: str, res: dict) -> None:
    print(f"\n{title}")
    print("  phase    " + " ".join(f"{f:>7s}" for f in H.FINGERS))
    for ph, row in res["per_phase_median"].items():
        print(f"  {ph:8s} " + " ".join(f"{row[f]:7.0f}" for f in H.FINGERS))
    fr = res["frames"]
    print("  median   " + " ".join(f"{np.median(fr[f]):7.0f}" for f in H.FINGERS))
    print(
        "  p90      " + " ".join(f"{np.percentile(fr[f], 90):7.0f}" for f in H.FINGERS)
    )
    allv = np.concatenate([np.asarray(fr[f]) for f in H.FINGERS])
    print(
        f"  all fingers: median {np.median(allv):.1f} p75 {np.percentile(allv, 75):.1f} p90 {np.percentile(allv, 90):.1f}"
    )


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
    ap.add_argument("--calibrate", choices=("none", "capture", "store"), default="none")
    ap.add_argument(
        "--calibration-out",
        default=None,
        help="where --calibrate capture writes its backend-format files (default: a temp dir)",
    )
    ap.add_argument("--wearer", default="", help="wearer name for --calibrate store")
    a = ap.parse_args()
    cfg = load_config(a.config)
    hands = hands_from_capture(cfg, Path(a.capture))
    cal_report = None
    if a.calibrate != "none":
        import tempfile

        out_dir = Path(a.calibration_out or tempfile.mkdtemp(prefix="geppetto-cal-"))
        cal_report = calibrate_hands(cfg, hands, a.calibrate, out_dir, a.wearer)
        print(f"calibration ({a.calibrate}, files in {out_dir}):")
        for side, summ in cal_report.items():
            print(f"  {side}: {summ}")
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
    report = {"steps": [], "thresholds": {}, "calibration": cal_report}
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
    if cal_report is not None:
        raw = aligned_phase_error(hands, use_raw=True)
        cal = aligned_phase_error(hands, use_raw=False)
        if raw and cal:
            print_aligned(
                "time-aligned left against right, held-out phases, RAW angles (deg):",
                raw,
            )
            print_aligned(
                "time-aligned left against right, held-out phases, CALIBRATED angles (deg):",
                cal,
            )
            fr = np.concatenate([np.asarray(cal["frames"][f]) for f in H.FINGERS])
            print(
                "\n  dead zone on the held-out frames, raw and calibrated (mean of 5 finger scores):"
            )
            n = len(cal["frames"]["thumb"])
            bad = aligned_phase_error(hands, use_raw=False, wrong=True)
            bad_raw = aligned_phase_error(hands, use_raw=True, wrong=True)
            n_bad = len(bad["frames"]["thumb"])
            report["aligned"] = {
                "raw": raw["per_phase_median"],
                "calibrated": cal["per_phase_median"],
                "dead_zones": {},
                "dead_zones_raw": {},
            }
            ps = float(cfg.score.pass_score)
            print(
                f"  right pose: left and right in the same phase ({n} frames); "
                f"wrong pose: other phases ({n_bad} frames); pass_score {ps}"
            )

            def overall(res, k, t2):
                return np.mean([t2.score(res["frames"][f][k]) for f in H.FINGERS])

            for perfect, wrong in (
                (8, 45),
                (10, 40),
                (12, 45),
                (12, 50),
                (15, 45),
                (15, 60),
                (20, 60),
            ):
                t2 = Tolerances(perfect, wrong)
                for label, gres, bres, key in (
                    ("raw", raw, bad_raw, "dead_zones_raw"),
                    ("cal", cal, bad, "dead_zones"),
                ):
                    good = np.asarray([overall(gres, k, t2) for k in range(n)])
                    badv = np.asarray([overall(bres, k, t2) for k in range(n_bad)])
                    print(
                        f"  {label} {perfect:>2}/{wrong:<2}: right pose mean {good.mean():.2f}, at or above pass {np.mean(good >= ps) * 100:3.0f}%"
                        f" | wrong pose mean {badv.mean():.2f}, at or above pass {np.mean(badv >= ps) * 100:3.0f}%"
                    )
                    report["aligned"][key][f"{perfect}/{wrong}"] = {
                        "right_mean": float(good.mean()),
                        "right_pass": float(np.mean(good >= ps)),
                        "wrong_mean": float(badv.mean()),
                        "wrong_pass": float(np.mean(badv >= ps)),
                    }
            report["aligned"]["all_median"] = float(np.median(fr))
            report["aligned"]["all_p90"] = float(np.percentile(fr, 90))
    if a.json:
        Path(a.json).write_text(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
