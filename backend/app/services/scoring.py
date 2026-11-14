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


def resample(
    frames: list[GloveFrame], side: Side, fps: float = c.SCORE_FPS
) -> np.ndarray:
    """Return an array (T, 5, 3) of one hand's flexion on a regular time grid."""
    pairs = [(f.t, f.hand(side)) for f in frames]
    pairs = [(t, h) for t, h in pairs if h is not None]
    if len(pairs) < c.MIN_SCORE_FRAMES:
        raise BadRequestError(
            f"need at least {c.MIN_SCORE_FRAMES} frames with a {side} hand to score"
        )
    times = np.array([t for t, _ in pairs])
    values = np.array([[h.flexion[f] for f in c.FINGERS] for _, h in pairs]).reshape(
        len(pairs), -1
    )
    grid = np.arange(times[0], times[-1] + 1e-9, 1.0 / fps)
    out = np.stack(
        [np.interp(grid, times, values[:, k]) for k in range(values.shape[1])], axis=1
    )
    return out.reshape(len(grid), len(c.FINGERS), c.JOINTS_PER_FINGER)


def dtw_path(
    a: np.ndarray, b: np.ndarray, window_fraction: float = c.DTW_WINDOW_FRACTION
) -> list[tuple[int, int]]:
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
            acc[i, j] = cost[i - 1, j - 1] + min(
                acc[i - 1, j], acc[i, j - 1], acc[i - 1, j - 1]
            )
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
    return (
        math.degrees(float((total.max(axis=0) - total.min(axis=0)).max()))
        < c.STATIC_REFERENCE_RANGE_DEG
    )


def compare(
    reference: np.ndarray,
    attempt: np.ndarray,
    fps: float = c.SCORE_FPS,
    static: bool | None = None,
    joint_mask: np.ndarray | None = None,
) -> Comparison:
    """Align each finger separately and measure total-flexion error, signed deviation and timing offset.

    DTW aligns on per-joint angles, but the error and deviation are of each finger's total flexion (the sum of its
    three joints), the same metric the frontend live coach compares against the tolerance.

    A held pose (static=True, or static unset and the reference barely moves) has no beat to be early or late for: the
    warp path on a near-constant series is arbitrary, so the timing offset is reported as 0 instead of that noise.

    `joint_mask` (5, 3) of 0 or 1 leaves joints out of the total flexion: a joint the attempt's calibration could not
    read stays raw while its neighbours are calibrated, so its difference means nothing.
    """
    errors: dict[str, float] = {}
    deviations: dict[str, float] = {}
    lags: list[float] = []
    for fi, finger in enumerate(c.FINGERS):
        ref, att = reference[:, fi, :], attempt[:, fi, :]
        path = dtw_path(ref, att)
        ri = np.array([p[0] for p in path])
        ai = np.array([p[1] for p in path])
        if joint_mask is None:
            diff = att[ai].sum(axis=1) - ref[ri].sum(axis=1)
        else:
            m = np.asarray(joint_mask, dtype=float)[fi]
            diff = (att[ai] * m).sum(axis=1) - (ref[ri] * m).sum(axis=1)
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


def weight_map(weights: FingerValues | dict[str, float] | None) -> dict[str, float]:
    """Per-finger weights clipped to 0..1; None (or a missing finger) counts fully."""
    if weights is None:
        return {f: 1.0 for f in c.FINGERS}
    raw = weights.model_dump() if isinstance(weights, FingerValues) else dict(weights)
    return {f: float(min(1.0, max(0.0, raw.get(f, 1.0)))) for f in c.FINGERS}


def focus_fingers(
    weights: dict[str, float], min_weight: float = c.FOCUS_MIN_WEIGHT
) -> list[str]:
    """Fingers that may be named as the one to fix: weight at or above min_weight, else the heaviest non-zero ones."""
    out = [f for f in c.FINGERS if weights[f] >= min_weight and weights[f] > 0]
    if out:
        return out
    top = max(weights.values())
    return [f for f in c.FINGERS if top > 0 and weights[f] == top]


def to_result(
    cmp: Comparison,
    tolerance: Tolerance,
    margin: Margin = c.DEFAULT_MARGIN,
    weights: FingerValues | dict[str, float] | None = None,
) -> ScoreResult:
    """Turn alignment statistics into the contract's ScoreResult, judged with the learner's margin of error.

    The margin widens (or narrows) the step's tolerance before anything is computed, and the hint thresholds with it.
    A per-finger tolerance (tolerance.finger_angle_deg) gives each finger its own band; the worst finger is then the one
    furthest outside its own band, which is the largest error when every band is the same.
    With step weights, the finger part of `overall` is their weighted mean, a zero-weight finger never breaks
    `within_tolerance`, and the worst finger and the hint only name a finger weighted at least FOCUS_MIN_WEIGHT.
    """
    limits = hints.thresholds(margin, tolerance.angle_deg, tolerance.timing_ms)
    finger_limits = {
        f: hints.thresholds(margin, tolerance.angle_for(f), tolerance.timing_ms)
        for f in c.FINGERS
    }
    tolerance = tolerance.widened(margin)
    band = {f: tolerance.angle_for(f) for f in c.FINGERS}
    per_finger = [_gaussian_score(cmp.error_deg[f], band[f]) for f in c.FINGERS]
    timing = _gaussian_score(cmp.timing_abs_ms, tolerance.timing_ms)
    w = weight_map(weights)
    if weights is None:
        fingers_part = float(np.mean(per_finger))
    else:
        total = sum(w.values())
        fingers_part = (
            sum(w[f] * v for f, v in zip(c.FINGERS, per_finger)) / total
            if total > 0
            else 100.0
        )
    overall = c.FINGER_WEIGHT * fingers_part + c.TIMING_WEIGHT * timing
    within = (
        all(cmp.error_deg[f] <= band[f] for f in c.FINGERS if w[f] > 0)
        and cmp.timing_abs_ms <= tolerance.timing_ms
    )
    focus = focus_fingers(w) or list(c.FINGERS)
    return ScoreResult(
        overall=round(overall, 1),
        per_finger=FingerValues.from_list([round(v, 1) for v in per_finger]),
        timing=round(timing, 1),
        within_tolerance=within,
        worst_finger=max(focus, key=lambda f: cmp.error_deg[f] / band[f]),  # type: ignore[arg-type]
        hint=hints.build_hint(
            {f: cmp.deviation_deg[f] for f in focus},
            cmp.timing_signed_ms,
            limits,
            finger_limits,
        ),
        margin=margin,
    )


def calibration_masks(cal: Calibration) -> tuple[np.ndarray, dict[str, float]] | None:
    """(joint mask (5, 3), finger weights) from a calibration's usable joints; None if a phase is missing.

    A joint whose flat-to-fist range is below the epsilon cannot be read on this glove and wearer: mask 0. A finger
    with no usable joint gets weight 0, so it is never scored or named.
    """
    r = _ranges(cal)
    if r is None:
        return None
    usable = r[2]
    return usable.astype(float), {
        f: 1.0 if bool(usable[i].any()) else 0.0 for i, f in enumerate(c.FINGERS)
    }


def take_weights(takes: list[np.ndarray]) -> tuple[dict[str, float], dict[str, float]]:
    """(weights, spread in degrees) per finger from several takes of one step, each (T, 5, 3) radians.

    The spread is the standard deviation across takes of each take's mean total flexion. At or below
    TAKE_CONSISTENT_DEG the weight is 1, at or above TAKE_INCONSISTENT_DEG it is TAKE_INCONSISTENT_FLOOR, linear
    between. One take gives weight 1. The same rule as the core's consistency weights, on total flexion.
    """
    if len(takes) < 2:
        return {f: 1.0 for f in c.FINGERS}, {f: 0.0 for f in c.FINGERS}
    means = np.array([np.degrees(t.sum(axis=2).mean(axis=0)) for t in takes])
    sd = means.std(axis=0)
    span = c.TAKE_INCONSISTENT_DEG - c.TAKE_CONSISTENT_DEG
    frac = np.clip((sd - c.TAKE_CONSISTENT_DEG) / span, 0.0, 1.0)
    w = 1.0 - frac * (1.0 - c.TAKE_INCONSISTENT_FLOOR)
    return (
        {f: round(float(w[i]), 2) for i, f in enumerate(c.FINGERS)},
        {f: round(float(sd[i]), 1) for i, f in enumerate(c.FINGERS)},
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
    attempt: np.ndarray,
    own: Calibration,
    reference: Calibration | None,
    warnings: list[str],
) -> np.ndarray:
    """Normalise an attempt (T, 5, 3) by its own flat/fist range, then map it into the reference's angle space.

    Joints whose calibrated range is below the epsilon are left unchanged, so nothing divides by zero.
    """
    own_range = _ranges(own)
    if own_range is None:
        warnings.append(
            "attempt calibration is incomplete (flat or fist not captured); scored without calibration"
        )
        return attempt
    flat, fist, usable = own_range
    ref_flat, ref_fist = _standard()
    if reference is not None:
        ref_range = _ranges(reference)
        if ref_range is None:
            warnings.append(
                "reference calibration is incomplete; using nominal reference ranges"
            )
        else:
            ref_flat, ref_fist = ref_range[0], ref_range[1]
    if not usable.all():
        warnings.append(
            "some joints have too small a calibrated range and were left uncalibrated"
        )
    span = np.where(usable, fist - flat, 1.0)
    normalised = np.clip((attempt - flat) / span, 0.0, 1.0)
    mapped = ref_flat + normalised * (ref_fist - ref_flat)
    return np.where(usable, mapped, attempt)


class ScoringService:
    """Scores stored attempts against stored recordings or synthesised motions."""

    def __init__(
        self, recorder: Recorder, calibrations: CalibrationService | None = None
    ) -> None:
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
        joint_mask = None
        weights = request.weights
        if own is not None:
            attempt_data = calibrate_attempt(attempt_data, own, ref_cal, warnings)
            masks = calibration_masks(own)
            if masks is not None and not masks[0].all():
                joint_mask, cal_weights = masks
                w = weight_map(weights)
                weights = FingerValues(**{f: w[f] * cal_weights[f] for f in c.FINGERS})
                dropped = [f for f in c.FINGERS if cal_weights[f] == 0]
                if dropped:
                    warnings.append(
                        f"this calibration cannot read the {', '.join(dropped)}; not scored"
                    )
        result = to_result(
            compare(
                reference_data,
                attempt_data,
                static=self._static(request),
                joint_mask=joint_mask,
            ),
            request.tolerance,
            request.margin,
            weights,
        )
        return result.model_copy(update={"warnings": warnings})

    @staticmethod
    def _static(request: ScoreRequest) -> bool | None:
        """Return True when the request's reference motion is declared a held pose; None lets the motion range decide."""
        motion = request.reference_motion
        return (
            True if motion is not None and motion.preset in c.STATIC_PRESETS else None
        )

    def _calibrations_for(
        self, request: ScoreRequest, side: Side
    ) -> tuple[Calibration | None, Calibration | None]:
        """Resolve the attempt and reference calibrations the request asks for."""
        wanted = (
            request.attempt_calibration_id
            or request.reference_calibration_id
            or request.use_latest_calibration
        )
        if not wanted:
            return None, None
        if self._calibrations is None:
            raise BadRequestError("calibration is not available")
        if request.attempt_calibration_id is not None:
            own: Calibration | None = self._calibrations.get(
                request.attempt_calibration_id
            )
        elif request.use_latest_calibration:
            own = self._calibrations.latest(side)
        else:
            own = None
        ref = (
            self._calibrations.get(request.reference_calibration_id)
            if request.reference_calibration_id
            else None
        )
        return own, ref

    def _attempt(self, request: ScoreRequest) -> Recording:
        """Return the attempt: inline frames win over a stored recording, since only they carry client-side changes."""
        if request.attempt_frames is not None:
            frames = request.attempt_frames
            duration = frames[-1].t - frames[0].t if frames else 0.0
            return Recording(
                id="inline",
                started_at="",
                duration_s=duration,
                fps=c.SCORE_FPS,
                frames=frames,
            )
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
    def _synthesised(
        request: ScoreRequest, attempt: Recording, side: Side
    ) -> Recording:
        """Build a reference recording from a MotionSpec, as long as the attempt."""
        assert request.reference_motion is not None
        frames = synthesiser.synthesise(
            request.reference_motion,
            side,
            max(attempt.duration_s, 1.0 / c.SCORE_FPS * 2),
            c.SCORE_FPS,
        )
        return Recording(
            id="synthesised",
            started_at="",
            duration_s=frames[-1].t,
            fps=c.SCORE_FPS,
            frames=frames,
        )
