"""Per-frame and per-step scoring. Plain arithmetic, every frame, no model."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from . import hand as H
from .recorder import Lesson, Step

HINT_NONE = None


@dataclass(frozen=True)
class Tolerances:
    perfect_deg: float
    wrong_deg: float

    def score(self, err_deg: float) -> float:
        span = max(1e-6, self.wrong_deg - self.perfect_deg)
        return float(np.clip(1.0 - (err_deg - self.perfect_deg) / span, 0.0, 1.0))


@dataclass
class FrameScore:
    hand: str
    overall: float
    fingers: dict[str, float]
    err_deg: dict[str, float]
    worst: str | None
    hint: str | None
    timing_ms: int | None
    hold_ms: int
    step_progress: float
    passed: bool = False

    def to_message(self) -> dict:
        return {
            "hand": self.hand,
            "overall": round(float(np.clip(self.overall, 0, 1)), 3),
            "fingers": {
                f: round(float(np.clip(v, 0, 1)), 3) for f, v in self.fingers.items()
            },
            "err_deg": {f: round(float(v), 1) for f, v in self.err_deg.items()},
            "worst": self.worst,
            "hint": self.hint,
            "timing_ms": None if self.timing_ms is None else int(self.timing_ms),
            "hold_ms": int(self.hold_ms),
            "step_progress": round(float(np.clip(self.step_progress, 0, 1)), 3),
            "passed": bool(self.passed),
        }


def finger_errors(
    learner: np.ndarray, master: np.ndarray, spread_weight: float = 0.5
) -> tuple[dict[str, float], dict[str, float], dict[str, float]]:
    """Per finger: weighted mean absolute error, signed flexion diff, signed spread diff.

    Spread slots count `spread_weight` for each of the two fingers they separate.
    Signed diffs are learner minus master.
    """
    diff = np.asarray(learner, dtype=float) - np.asarray(master, dtype=float)
    err, flex, spread = {}, {}, {}
    for f in H.FINGERS:
        fs = H.FLEXION_SLOTS[f]
        ss = H.FINGER_SPREAD_SLOTS[f]
        w = np.array([1.0] * len(fs) + [spread_weight] * len(ss))
        d = np.concatenate([diff[fs], diff[ss]])
        err[f] = float(np.sum(w * np.abs(d)) / np.sum(w))
        flex[f] = float(np.mean(diff[fs]))
        spread[f] = float(np.mean(diff[ss])) if ss else 0.0
    return err, flex, spread


def hint_for(flex_diff: float, spread_diff: float) -> str | None:
    """Flexion below the master is too_flat, above too_curled; spread above too_spread, below too_closed."""
    if abs(flex_diff) < 1e-9 and abs(spread_diff) < 1e-9:
        return HINT_NONE
    if abs(flex_diff) >= abs(spread_diff):
        return "too_flat" if flex_diff < 0 else "too_curled"
    return "too_spread" if spread_diff > 0 else "too_closed"


def score_frame(
    hand: str,
    learner: np.ndarray,
    master: np.ndarray,
    weights: dict[str, float],
    tol: Tolerances,
    spread_weight: float = 0.5,
) -> tuple[FrameScore, dict, dict]:
    """Unsmoothed score of one learner frame against one master pose."""
    err, flex, spread = finger_errors(learner, master, spread_weight)
    fingers = {f: tol.score(err[f]) for f in H.FINGERS}
    w = np.array([float(weights.get(f, 1.0)) for f in H.FINGERS])
    overall = float(
        np.sum(w * np.array([fingers[f] for f in H.FINGERS])) / max(1e-9, np.sum(w))
    )
    worst = min(H.FINGERS, key=lambda f: (fingers[f], -err[f]))
    hint = hint_for(flex[worst], spread[worst]) if fingers[worst] < 1.0 else HINT_NONE
    return (
        FrameScore(
            hand=hand,
            overall=overall,
            fingers=fingers,
            err_deg=err,
            worst=worst,
            hint=hint,
            timing_ms=None,
            hold_ms=0,
            step_progress=0.0,
        ),
        flex,
        spread,
    )


class Ema:
    """Exponential average with a time constant, over a dict of floats and a scalar."""

    def __init__(self, tau_ms: float) -> None:
        self.tau_us = float(tau_ms) * 1000.0
        self.t_us: int | None = None
        self.values: dict[str, Any] = {}

    def reset(self) -> None:
        self.t_us = None
        self.values = {}

    def update(self, t_us: int, **fields: Any) -> dict[str, Any]:
        if self.t_us is None or not self.values:
            self.values = {
                k: (dict(v) if isinstance(v, dict) else float(v))
                for k, v in fields.items()
            }
            self.t_us = t_us
            return self.values
        dt = max(0, t_us - self.t_us)
        self.t_us = t_us
        a = 1.0 - float(np.exp(-dt / self.tau_us)) if self.tau_us > 0 else 1.0
        for k, v in fields.items():
            if isinstance(v, dict):
                cur = self.values.setdefault(k, dict(v))
                for kk, vv in v.items():
                    cur[kk] = cur.get(kk, vv) + a * (vv - cur.get(kk, vv))
            else:
                cur = self.values.get(k, v)
                self.values[k] = cur + a * (float(v) - cur)
        return self.values


class StepScorer:
    """Scores one learner hand against one lesson step, frame by frame.

    hold: the reference is key_angles; pass when the smoothed overall stays at or
    above pass_score for hold_ms. move: the reference is the master's angles
    around the ghost's lesson time (best match within +-move_window_ms); pass
    when the mean overall across the step is at least move_pass_mean once the
    ghost has played the step through.
    """

    def __init__(
        self, hand: str, lesson: Lesson, step: Step, score_cfg, tol: Tolerances
    ) -> None:
        self.hand = hand
        self.lesson = lesson
        self.step = step
        self.cfg = score_cfg
        self.tol = tol
        self.ema = Ema(score_cfg.ema_tau_ms)
        self.attempt = 1
        self.history: list[float] = []  # best overall of each finished attempt
        self.reset_attempt(0)

    # -- attempt bookkeeping -------------------------------------------------
    def reset_attempt(self, t_us: int) -> None:
        self.ema.reset()
        self.t_attempt_us = int(t_us)
        self.last_t_us: int | None = None
        self.held_us = 0
        self.best = 0.0
        self.sum_overall = 0.0
        self.n_overall = 0
        self.passed = False
        self.last: FrameScore | None = None
        self.last_flex: dict[str, float] = {}
        self.last_spread: dict[str, float] = {}
        self.learner_seq: list[tuple[int, np.ndarray]] = []
        self.last_stuck_report_us: int | None = None

    def new_attempt(self, t_us: int) -> None:
        self.history.append(round(self.best, 3))
        self.attempt += 1
        self.reset_attempt(t_us)

    # -- references ----------------------------------------------------------
    def _reference(
        self, ghost_t_us: int | None
    ) -> tuple[np.ndarray, int | None, np.ndarray]:
        """(master angles, timing_ms or None, candidate matrix) for this frame."""
        if self.step.kind == "hold" or self.lesson.trace is None or ghost_t_us is None:
            return self.step.key_angles, None, self.step.key_angles[None, :]
        w = int(self.cfg.move_window_ms) * 1000
        tr = self.lesson.trace
        gt = int(np.clip(ghost_t_us, self.step.t0_us, self.step.t1_us))
        sl = tr.window(max(self.step.t0_us, gt - w), min(self.step.t1_us, gt + w))
        cands = tr.angles[sl]
        times = tr.t_us[sl]
        if (
            cands.shape[0] == 0
        ):  # cannot happen after the clamp, but never wedge the tick loop
            return self.step.key_angles, None, self.step.key_angles[None, :]
        return cands, times, cands

    def update(
        self, t_us: int, learner_angles: np.ndarray, ghost_t_us: int | None = None
    ) -> FrameScore:
        t_us = int(t_us)
        dt_us = 0 if self.last_t_us is None else max(0, t_us - self.last_t_us)
        self.last_t_us = t_us
        learner_angles = np.asarray(learner_angles, dtype=float)
        self.learner_seq.append((t_us, learner_angles.copy()))

        timing_ms: int | None = None
        if (
            self.step.kind == "move"
            and self.lesson.trace is not None
            and ghost_t_us is not None
            and self._reference(ghost_t_us)[1] is not None
        ):
            cands, times, _ = self._reference(ghost_t_us)
            best_i, best_key, best_fs = 0, None, None
            for i in range(cands.shape[0]):
                fs, flex, spread = score_frame(
                    self.hand,
                    learner_angles,
                    cands[i],
                    self.step.weights,
                    self.tol,
                    self.cfg.spread_weight,
                )
                key = (round(fs.overall, 6), -float(np.mean(list(fs.err_deg.values()))))
                if best_key is None or key > best_key:
                    best_i, best_key, best_fs = i, key, (fs, flex, spread)
            raw, flex, spread = best_fs
            # negative = learner early (matches a pose the ghost reaches later)
            timing_ms = int((int(ghost_t_us) - int(times[best_i])) / 1000)
        else:
            raw, flex, spread = score_frame(
                self.hand,
                learner_angles,
                self.step.key_angles,
                self.step.weights,
                self.tol,
                self.cfg.spread_weight,
            )
        self.last_flex, self.last_spread = flex, spread

        sm = self.ema.update(
            t_us, overall=raw.overall, fingers=raw.fingers, err_deg=raw.err_deg
        )
        overall = float(sm["overall"])
        fingers = dict(sm["fingers"])
        err = dict(sm["err_deg"])
        worst = min(H.FINGERS, key=lambda f: (fingers[f], -err[f]))
        hint = (
            hint_for(flex[worst], spread[worst]) if fingers[worst] < 1.0 else HINT_NONE
        )

        self.best = max(self.best, overall)
        self.sum_overall += overall
        self.n_overall += 1

        hold_ms = int(self.step.hold_ms)
        if self.step.kind == "hold":
            if overall >= self.cfg.pass_score:
                self.held_us += dt_us
            else:
                self.held_us = 0
            progress = min(1.0, self.held_us / max(1, hold_ms * 1000))
            if self.held_us >= hold_ms * 1000:
                self.passed = True
        else:
            dur = max(1, self.step.duration_us)
            progress = (
                0.0
                if ghost_t_us is None
                else float(np.clip((ghost_t_us - self.step.t0_us) / dur, 0, 1))
            )
            if progress >= 1.0 and self.mean_overall >= self.cfg.move_pass_mean:
                self.passed = True

        self.last = FrameScore(
            hand=self.hand,
            overall=overall,
            fingers=fingers,
            err_deg=err,
            worst=worst,
            hint=hint,
            timing_ms=timing_ms,
            hold_ms=hold_ms,
            step_progress=progress,
            passed=self.passed,
        )
        return self.last

    @property
    def mean_overall(self) -> float:
        return self.sum_overall / self.n_overall if self.n_overall else 0.0

    def move_step_finished(self, ghost_t_us: int | None) -> bool:
        return (
            self.step.kind == "move"
            and ghost_t_us is not None
            and ghost_t_us >= self.step.t1_us
        )

    def elapsed_s(self, t_us: int) -> float:
        return (int(t_us) - self.t_attempt_us) / 1e6

    def stuck_due(self, t_us: int) -> bool:
        """True once per stuck_s while the learner has not passed."""
        if self.passed or self.elapsed_s(t_us) < self.cfg.stuck_s:
            return False
        since = (
            self.t_attempt_us
            if self.last_stuck_report_us is None
            else self.last_stuck_report_us
        )
        if (t_us - since) >= self.cfg.stuck_s * 1e6:
            self.last_stuck_report_us = int(t_us)
            return True
        return False

    # -- summary -------------------------------------------------------------
    def summary(self, t_us: int, task: str, lesson_title: str, stuck: bool) -> dict:
        fs = self.last
        fingers = {}
        if fs is not None:
            for f in H.FINGERS:
                if fs.fingers[f] < self.cfg.pass_score:
                    fingers[f] = {
                        "score": round(float(fs.fingers[f]), 3),
                        "err_deg": round(float(fs.err_deg[f]), 1),
                        "hint": hint_for(
                            self.last_flex.get(f, 0.0), self.last_spread.get(f, 0.0)
                        ),
                    }
        worst_at = None
        if (
            self.step.kind == "move"
            and self.lesson.trace is not None
            and len(self.learner_seq) >= 2
        ):
            worst_at = self.dtw_worst_at_ms()
        return {
            "task": task,
            "lesson": lesson_title,
            "hand": self.hand,
            "step": {
                "index": self.step.index,
                "name": self.step.name,
                "kind": self.step.kind,
            },
            "attempt": self.attempt,
            "passed": bool(self.passed),
            "overall": round(float(fs.overall if fs else 0.0), 3),
            "best": round(float(self.best), 3),
            "history": list(self.history),
            "fingers": fingers,
            "timing_ms": None if fs is None else fs.timing_ms,
            "stuck_s": round(self.elapsed_s(t_us), 1) if stuck else None,
            "worst_at_ms": worst_at,
        }

    def dtw_worst_at_ms(self) -> int | None:
        tr = self.lesson.trace
        sl = tr.window(self.step.t0_us, self.step.t1_us)
        master = tr.angles[sl]
        learner = np.stack([a for _, a in self.learner_seq])
        idx = np.arange(len(learner))
        if len(learner) > DTW_MAX_LEN:
            idx = np.linspace(0, len(learner) - 1, DTW_MAX_LEN).astype(int)
            learner = learner[idx]
        path_cost = dtw_path_costs(learner, master)
        if path_cost is None:
            return None
        i = int(idx[int(np.argmax(path_cost))])
        return int((self.learner_seq[i][0] - self.t_attempt_us) / 1000)


DTW_MAX_LEN = (
    300  # 300 x 300 runs in about 20 ms; it runs once per failed or stuck move step
)


def dtw_path_costs(
    a: np.ndarray, b: np.ndarray, max_len: int = DTW_MAX_LEN
) -> np.ndarray | None:
    """Dynamic time warping of two angle sequences. Returns, per sample of `a`,
    the mean absolute angle error at its matched sample of `b`. `a` is assumed
    to be at most max_len long (the caller downsamples and keeps the index map)."""
    if len(a) < 2 or len(b) < 2:
        return None
    if len(a) > max_len:
        a = a[np.linspace(0, len(a) - 1, max_len).astype(int)]
    if len(b) > max_len:
        b = b[np.linspace(0, len(b) - 1, max_len).astype(int)]
    n, m = len(a), len(b)
    cost = np.abs(a[:, None, :] - b[None, :, :]).mean(axis=2)
    D = np.full((n + 1, m + 1), np.inf)
    D[0, 0] = 0.0
    for i in range(1, n + 1):
        ci = cost[i - 1]
        prev = D[i - 1]
        row = D[i]
        # row[j] = ci[j-1] + min(prev[j-1], prev[j], row[j-1]); the row[j-1] term forces a loop
        for j in range(1, m + 1):
            row[j] = ci[j - 1] + min(prev[j - 1], prev[j], row[j - 1])
    # backtrack
    i, j = n, m
    per_a = np.zeros(n)
    while i > 0 and j > 0:
        per_a[i - 1] = max(per_a[i - 1], cost[i - 1, j - 1])
        steps = [
            (D[i - 1, j - 1], i - 1, j - 1),
            (D[i - 1, j], i - 1, j),
            (D[i, j - 1], i, j - 1),
        ]
        _, i, j = min(steps)
    return per_a


class LiveReference:
    """Ring buffer of a master hand's angles, for mirror mode."""

    def __init__(self, keep_ms: float = 2000.0) -> None:
        self.keep_us = int(keep_ms * 1000)
        self.t: list[int] = []
        self.a: list[np.ndarray] = []

    def push(self, t_us: int, angles: np.ndarray) -> None:
        self.t.append(int(t_us))
        self.a.append(np.asarray(angles, dtype=float).copy())
        while self.t and self.t[0] < t_us - self.keep_us:
            self.t.pop(0)
            self.a.pop(0)

    def around(self, t_us: int, window_us: int) -> tuple[np.ndarray, np.ndarray]:
        if not self.t:
            return np.zeros((0, H.N_ANGLES)), np.zeros(0, dtype=int)
        t = np.asarray(self.t)
        m = (t >= t_us - window_us) & (t <= t_us + window_us)
        if not m.any():
            i = int(np.argmin(np.abs(t - t_us)))
            return np.stack([self.a[i]]), t[i : i + 1]
        return np.stack([a for a, k in zip(self.a, m) if k]), t[m]


class MirrorScorer:
    """Scores a learner against a master's live angles from mirror_delay_ms ago."""

    def __init__(
        self,
        hand: str,
        score_cfg,
        tol: Tolerances,
        delay_ms: float,
        weights: dict | None = None,
    ) -> None:
        self.hand = hand
        self.cfg = score_cfg
        self.tol = tol
        self.delay_us = int(delay_ms * 1000)
        self.weights = weights or {f: 1.0 for f in H.FINGERS}
        self.ema = Ema(score_cfg.ema_tau_ms)
        self.ref = LiveReference()
        self.last: FrameScore | None = None

    def push_master(self, t_us: int, angles: np.ndarray) -> None:
        self.ref.push(t_us, angles)

    def update(self, t_us: int, learner_angles: np.ndarray) -> FrameScore | None:
        target = int(t_us) - self.delay_us
        cands, times = self.ref.around(target, int(self.cfg.move_window_ms) * 1000)
        if cands.shape[0] == 0:
            return None
        best, best_key = None, None
        for i in range(cands.shape[0]):
            fs, flex, spread = score_frame(
                self.hand,
                learner_angles,
                cands[i],
                self.weights,
                self.tol,
                self.cfg.spread_weight,
            )
            key = (round(fs.overall, 6), -float(np.mean(list(fs.err_deg.values()))))
            if best_key is None or key > best_key:
                best, best_key = (fs, flex, spread, int(times[i])), key
        raw, flex, spread, t_match = best
        sm = self.ema.update(
            t_us, overall=raw.overall, fingers=raw.fingers, err_deg=raw.err_deg
        )
        fingers, err = dict(sm["fingers"]), dict(sm["err_deg"])
        worst = min(H.FINGERS, key=lambda f: (fingers[f], -err[f]))
        hint = (
            hint_for(flex[worst], spread[worst]) if fingers[worst] < 1.0 else HINT_NONE
        )
        self.last = FrameScore(
            hand=self.hand,
            overall=float(sm["overall"]),
            fingers=fingers,
            err_deg=err,
            worst=worst,
            hint=hint,
            timing_ms=int((target - t_match) / 1000),
            hold_ms=0,
            step_progress=0.0,
        )
        return self.last
