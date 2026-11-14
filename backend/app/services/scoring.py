"""Compare an attempt with a reference: per-finger DTW on normalised angles, with timing scored separately."""

import math
from dataclasses import dataclass

import numpy as np

from app import constants as c
from app.core.errors import BadRequestError
from app.schemas.common import FingerValues, Margin, Side, Tolerance
from app.schemas.frames import GloveFrame
from app.schemas.records import Calibration, Recording, ScoreRequest, ScoreResult
from app.services import hints
from app.services.calibration import CalibrationService
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


def is_static(reference: np.ndarray) -> bool:
    """Return True when no finger's total flexion moves more than the static range, i.e. the reference is a held pose."""
    total = reference.sum(axis=2)
    return math.degrees(float((total.max(axis=0) - total.min(axis=0)).max())) < c.STATIC_REFERENCE_RANGE_DEG


def compare(reference: np.ndarray, attempt: np.ndarray, fps: float = c.SCORE_FPS, static: bool | None = None) -> Comparison:
    """Align each finger separately and measure total-flexion error, signed deviation and timing offset.

    DTW aligns on per-joint angles, but the error and deviation are of each finger's total flexion (the sum of its
    three joints), the same metric the frontend live coach compares against the tolerance.

    A held pose (static=True, or static unset and the reference barely moves) has no beat to be early or late for: the
    warp path on a near-constant series is arbitrary, so the timing offset is reported as 0 instead of that noise.
    """
    errors: dict[str, float] = {}
    deviations: dict[str, float] = {}
    lags: list[float] = []
    for fi, finger in enumerate(c.FINGERS):
        ref, att = reference[:, fi, :], attempt[:, fi, :]
        path = dtw_path(ref, att)
        ri = np.array([p[0] for p in path])
        ai = np.array([p[1] for p in path])
        diff = att[ai].sum(axis=1) - ref[ri].sum(axis=1)
        errors[finger] = math.degrees(float(np.abs(diff).mean()))
        deviations[finger] = math.degrees(float(diff.mean()))
        lags.append(float((ai - ri).mean()))
        lags.append(float(np.abs(ai - ri).mean()))
    signed = float(np.mean(lags[0::2])) / fps * 1000.0
    absolute = float(np.mean(lags[1::2])) / fps * 1000.0
    if is_static(reference) if static is None else static:
        signed = absolute = 0.0
    return Comparison(errors, deviations, absolute, signed)


def _gaussian_score(error: float, tolerance: float) -> float:
    """Map an error to 0..100: 100 at zero error, falling smoothly as it passes the tolerance."""
    return 100.0 * math.exp(-0.5 * (error / (c.SCORE_SIGMA_FACTOR * tolerance)) ** 2)


def to_result(cmp: Comparison, tolerance: Tolerance, margin: Margin = c.DEFAULT_MARGIN) -> ScoreResult:
    """Turn alignment statistics into the contract's ScoreResult, judged with the learner's margin of error.

    The margin widens (or narrows) the step's tolerance before anything is computed, and the hint thresholds with it.
    """
    limits = hints.thresholds(margin, tolerance.angle_deg, tolerance.timing_ms)
    tolerance = tolerance.widened(margin)
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
        hint=hints.build_hint(cmp.deviation_deg, cmp.timing_signed_ms, limits),
        margin=margin,
    )


def _ranges(cal: Calibration) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Return (flat, fist, usable mask) as (5, 3) arrays, or None if a phase is missing (all zeros)."""
    flat = np.array([cal.flat[f] for f in c.FINGERS], dtype=float)
    fist = np.array([cal.fist[f] for f in c.FINGERS], dtype=float)
    if not flat.any() or not fist.any():
        return None
    return flat, fist, (fist - flat) > c.CALIBRATION_MIN_RANGE_RAD


def _standard() -> tuple[np.ndarray, np.ndarray]:
    """Return the nominal (flat, fist) flexion of the guide hand (curl 0 and curl 1), used when the reference has no calibration."""
    scale = np.array([c.THUMB_FLEXION_SCALE] + [1.0] * (len(c.FINGERS) - 1))[:, None]
    relaxed = np.array(c.RELAXED_FLEXION, dtype=float)
    return relaxed * scale, (relaxed + np.array(c.FULL_FLEXION, dtype=float)) * scale


def calibrate_attempt(
    attempt: np.ndarray, own: Calibration, reference: Calibration | None, warnings: list[str]
) -> np.ndarray:
    """Normalise an attempt (T, 5, 3) by its own flat/fist range, then map it into the reference's angle space.

    Joints whose calibrated range is below the epsilon are left unchanged, so nothing divides by zero.
    """
    own_range = _ranges(own)
    if own_range is None:
        warnings.append("attempt calibration is incomplete (flat or fist not captured); scored without calibration")
        return attempt
    flat, fist, usable = own_range
    ref_flat, ref_fist = _standard()
    if reference is not None:
        ref_range = _ranges(reference)
        if ref_range is None:
            warnings.append("reference calibration is incomplete; using nominal reference ranges")
        else:
            ref_flat, ref_fist = ref_range[0], ref_range[1]
    if not usable.all():
        warnings.append("some joints have too small a calibrated range and were left uncalibrated")
    span = np.where(usable, fist - flat, 1.0)
    normalised = np.clip((attempt - flat) / span, 0.0, 1.0)
    mapped = ref_flat + normalised * (ref_fist - ref_flat)
    return np.where(usable, mapped, attempt)


class ScoringService:
    """Scores stored attempts against stored recordings or synthesised motions."""

    def __init__(self, recorder: Recorder, calibrations: CalibrationService | None = None) -> None:
        """Use the recorder to load stored recordings and, optionally, calibrations."""
        self._recorder = recorder
        self._calibrations = calibrations

    def score(self, request: ScoreRequest) -> ScoreResult:
        """Return the score for an attempt."""
        attempt = self._attempt(request)
        if request.reference_recording_id is not None:
            reference = self._recorder.get(request.reference_recording_id)
            side = request.side or self._side_of(attempt, reference)
        else:
            side = request.side or self._side_of(attempt)
            reference = self._synthesised(request, attempt, side)
        reference_data = resample(reference.frames, side)
        attempt_data = resample(attempt.frames, side)
        warnings: list[str] = []
        own, ref_cal = self._calibrations_for(request, side)
        if own is not None:
            attempt_data = calibrate_attempt(attempt_data, own, ref_cal, warnings)
        result = to_result(compare(reference_data, attempt_data, static=self._static(request)), request.tolerance, request.margin)
        return result.model_copy(update={"warnings": warnings})

    @staticmethod
    def _static(request: ScoreRequest) -> bool | None:
        """Return True when the request's reference motion is declared a held pose; None lets the motion range decide."""
        motion = request.reference_motion
        return True if motion is not None and motion.preset in c.STATIC_PRESETS else None

    def _calibrations_for(self, request: ScoreRequest, side: Side) -> tuple[Calibration | None, Calibration | None]:
        """Resolve the attempt and reference calibrations the request asks for."""
        wanted = request.attempt_calibration_id or request.reference_calibration_id or request.use_latest_calibration
        if not wanted:
            return None, None
        if self._calibrations is None:
            raise BadRequestError("calibration is not available")
        if request.attempt_calibration_id is not None:
            own: Calibration | None = self._calibrations.get(request.attempt_calibration_id)
        elif request.use_latest_calibration:
            own = self._calibrations.latest(side)
        else:
            own = None
        ref = self._calibrations.get(request.reference_calibration_id) if request.reference_calibration_id else None
        return own, ref

    def _attempt(self, request: ScoreRequest) -> Recording:
        """Return the attempt: inline frames win over a stored recording, since only they carry client-side changes."""
        if request.attempt_frames is not None:
            frames = request.attempt_frames
            duration = frames[-1].t - frames[0].t if frames else 0.0
            return Recording(id="inline", started_at="", duration_s=duration, fps=c.SCORE_FPS, frames=frames)
        assert request.attempt_recording_id is not None
        return self._recorder.get(request.attempt_recording_id)

    @staticmethod
    def _side_of(recording: Recording, reference: Recording | None = None) -> Side:
        """Return the side to score: the first hand in the attempt, preferring one the reference also has.

        A two-handed reference must never make a one-handed attempt fail, so the attempt decides the side.
        """
        wanted = [h.side for frame in recording.frames for h in frame.hands]
        if not wanted:
            raise BadRequestError("recording contains no hand frames")
        if reference is not None:
            present = {h.side for frame in reference.frames for h in frame.hands}
            wanted = [side for side in wanted if side in present] or wanted
        return wanted[0]

    @staticmethod
    def _synthesised(request: ScoreRequest, attempt: Recording, side: Side) -> Recording:
        """Build a reference recording from a MotionSpec, as long as the attempt."""
        assert request.reference_motion is not None
        frames = synthesiser.synthesise(request.reference_motion, side, max(attempt.duration_s, 1.0 / c.SCORE_FPS * 2), c.SCORE_FPS)
        return Recording(id="synthesised", started_at="", duration_s=frames[-1].t, fps=c.SCORE_FPS, frames=frames)
