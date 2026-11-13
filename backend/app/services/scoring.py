"""Compare an attempt with a reference: per-finger DTW on normalised angles, with timing scored separately."""

import math
from dataclasses import dataclass

import numpy as np

from app import constants as c
from app.core.errors import BadRequestError
from app.schemas.common import FingerValues, Side, Tolerance
from app.schemas.frames import GloveFrame
from app.schemas.records import Recording, ScoreRequest, ScoreResult
from app.services import hints
from app.services.motion import synthesiser
from app.services.recorder import Recorder


@dataclass(frozen=True)
class Comparison:
    """Raw alignment statistics before they are turned into scores."""

    error_deg: dict[str, float]
    deviation_deg: dict[str, float]
    timing_abs_ms: float
    timing_signed_ms: float


def resample(frames: list[GloveFrame], side: Side, fps: float = c.SCORE_FPS) -> np.ndarray:
    """Return an array (T, 5, 3) of one hand's flexion on a regular time grid."""
    pairs = [(f.t, f.hand(side)) for f in frames]
    pairs = [(t, h) for t, h in pairs if h is not None]
    if len(pairs) < c.MIN_SCORE_FRAMES:
        raise BadRequestError(f"need at least {c.MIN_SCORE_FRAMES} frames with a {side} hand to score")
    times = np.array([t for t, _ in pairs])
    values = np.array([[h.flexion[f] for f in c.FINGERS] for _, h in pairs]).reshape(len(pairs), -1)
    grid = np.arange(times[0], times[-1] + 1e-9, 1.0 / fps)
    out = np.stack([np.interp(grid, times, values[:, k]) for k in range(values.shape[1])], axis=1)
    return out.reshape(len(grid), len(c.FINGERS), c.JOINTS_PER_FINGER)


def dtw_path(a: np.ndarray, b: np.ndarray, window_fraction: float = c.DTW_WINDOW_FRACTION) -> list[tuple[int, int]]:
    """Dynamic time warping path between two (T, d) series, constrained by a Sakoe-Chiba band."""
    n, m = len(a), len(b)
    window = max(c.DTW_MIN_WINDOW, int(window_fraction * max(n, m)), abs(n - m))
    cost = np.abs(a[:, None, :] - b[None, :, :]).mean(axis=2) / c.MAX_FLEXION_RAD
    acc = np.full((n + 1, m + 1), np.inf)
    acc[0, 0] = 0.0
    for i in range(1, n + 1):
        lo = max(1, i - window)
        hi = min(m, i + window)
        for j in range(lo, hi + 1):
            acc[i, j] = cost[i - 1, j - 1] + min(acc[i - 1, j], acc[i, j - 1], acc[i - 1, j - 1])
    path = []
    i, j = n, m
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        step = int(np.argmin([acc[i - 1, j - 1], acc[i - 1, j], acc[i, j - 1]]))
        i, j = (i - 1, j - 1) if step == 0 else (i - 1, j) if step == 1 else (i, j - 1)
    path.reverse()
    return path


def compare(reference: np.ndarray, attempt: np.ndarray, fps: float = c.SCORE_FPS) -> Comparison:
    """Align each finger separately and measure joint error, signed deviation and timing offset."""
    errors: dict[str, float] = {}
    deviations: dict[str, float] = {}
    lags: list[float] = []
    for fi, finger in enumerate(c.FINGERS):
        ref, att = reference[:, fi, :], attempt[:, fi, :]
        path = dtw_path(ref, att)
        ri = np.array([p[0] for p in path])
        ai = np.array([p[1] for p in path])
        diff = att[ai] - ref[ri]
        errors[finger] = math.degrees(float(np.abs(diff).mean()))
        deviations[finger] = math.degrees(float(diff.mean()))
        lags.append(float((ai - ri).mean()))
        lags.append(float(np.abs(ai - ri).mean()))
    signed = float(np.mean(lags[0::2])) / fps * 1000.0
    absolute = float(np.mean(lags[1::2])) / fps * 1000.0
    return Comparison(errors, deviations, absolute, signed)


def _gaussian_score(error: float, tolerance: float) -> float:
    """Map an error to 0..100: 100 at zero error, falling smoothly as it passes the tolerance."""
    return 100.0 * math.exp(-0.5 * (error / (c.SCORE_SIGMA_FACTOR * tolerance)) ** 2)


def to_result(cmp: Comparison, tolerance: Tolerance) -> ScoreResult:
    """Turn alignment statistics into the contract's ScoreResult."""
    per_finger = [_gaussian_score(cmp.error_deg[f], tolerance.angle_deg) for f in c.FINGERS]
    timing = _gaussian_score(cmp.timing_abs_ms, tolerance.timing_ms)
    overall = c.FINGER_WEIGHT * float(np.mean(per_finger)) + c.TIMING_WEIGHT * timing
    within = all(e <= tolerance.angle_deg for e in cmp.error_deg.values()) and cmp.timing_abs_ms <= tolerance.timing_ms
    return ScoreResult(
        overall=round(overall, 1),
        per_finger=FingerValues.from_list([round(v, 1) for v in per_finger]),
        timing=round(timing, 1),
        within_tolerance=within,
        worst_finger=max(c.FINGERS, key=lambda f: cmp.error_deg[f]),  # type: ignore[arg-type]
        hint=hints.build_hint(cmp.deviation_deg, cmp.timing_signed_ms),
    )


class ScoringService:
    """Scores stored attempts against stored recordings or synthesised motions."""

    def __init__(self, recorder: Recorder) -> None:
        """Use the recorder to load stored recordings."""
        self._recorder = recorder

    def score(self, request: ScoreRequest) -> ScoreResult:
        """Return the score for an attempt."""
        attempt = self._recorder.get(request.attempt_recording_id)
        if request.reference_recording_id is not None:
            reference = self._recorder.get(request.reference_recording_id)
            side = self._side_of(reference)
        else:
            side = self._side_of(attempt)
            reference = self._synthesised(request, attempt, side)
        return to_result(compare(resample(reference.frames, side), resample(attempt.frames, side)), request.tolerance)

    @staticmethod
    def _side_of(recording: Recording) -> Side:
        """Return the side of the first hand in a recording."""
        for frame in recording.frames:
            if frame.hands:
                return frame.hands[0].side
        raise BadRequestError("recording contains no hand frames")

    @staticmethod
    def _synthesised(request: ScoreRequest, attempt: Recording, side: Side) -> Recording:
        """Build a reference recording from a MotionSpec, as long as the attempt."""
        assert request.reference_motion is not None
        frames = synthesiser.synthesise(request.reference_motion, side, max(attempt.duration_s, 1.0 / c.SCORE_FPS * 2), c.SCORE_FPS)
        return Recording(id="synthesised", started_at="", duration_s=frames[-1].t, fps=c.SCORE_FPS, frames=frames)
