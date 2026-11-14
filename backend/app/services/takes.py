"""Several expert takes into one step model: "best take + spread".

The medoid take (smallest total per-finger DTW distance to the other takes) becomes the reference, and each finger's
tolerance comes from how far the other takes stray from it on that finger, so a finger the expert holds steady is
judged strictly and a finger that naturally varies gets more room. All distances reuse the scorer's per-finger DTW
(services/scoring.py), so a take's numbers here are the numbers POST /score would give it as an attempt.
"""

import numpy as np

from app import constants as c
from app.core.errors import BadRequestError
from app.schemas.common import FingerValues, Side, Tolerance
from app.schemas.records import (
    Recording,
    TakeConsistency,
    TakesModel,
    TakesModelRequest,
)
from app.services.recorder import Recorder
from app.services.scoring import Comparison, compare, resample, to_result


def distance(cmp: Comparison) -> float:
    """One number for how far two takes are apart: the mean over fingers of the DTW total-flexion error, in degrees."""
    return float(np.mean([cmp.error_deg[f] for f in c.FINGERS]))


def tolerance_from_spread(spread_deg: float) -> float:
    """Map one finger's spread around the reference to its tolerance: scaled, then clamped to the floor and ceiling."""
    return float(
        np.clip(
            spread_deg * c.TAKES_TOLERANCE_SCALE,
            c.TAKES_TOLERANCE_FLOOR_DEG,
            c.TAKES_TOLERANCE_CEIL_DEG,
        )
    )


def common_side(recordings: list[Recording], wanted: Side | None) -> Side:
    """Return the hand to model: the requested one, else the first hand of the first take that every take has."""
    present = [{h.side for f in r.frames for h in f.hands} for r in recordings]
    if wanted is not None:
        if all(wanted in p for p in present):
            return wanted
        raise BadRequestError(f"not every take has a {wanted} hand")
    for frame in recordings[0].frames:
        for hand in frame.hands:
            if all(hand.side in p for p in present):
                return hand.side
    raise BadRequestError("the takes share no hand")


def _outliers(
    pair_dist: np.ndarray, to_reference: dict[int, float], medoid: int
) -> set[int]:
    """Takes far from the rest: further from the medoid than TAKES_OUTLIER_FACTOR times the median distance between the
    other takes, and at least TAKES_OUTLIER_MIN_DEG. Needs 3 takes; with 2 nobody can tell which one strayed."""
    n = len(pair_dist)
    if n < c.TAKES_MIN:
        return set()
    flagged = set()
    for k, d in to_reference.items():
        others = [
            pair_dist[i, j]
            for i in range(n)
            for j in range(i + 1, n)
            if k not in (i, j)
        ]
        if (
            d >= c.TAKES_OUTLIER_MIN_DEG
            and d > c.TAKES_OUTLIER_FACTOR * float(np.median(others))
            and k != medoid
        ):
            flagged.add(k)
    return flagged


def build_model(
    series: list[np.ndarray],
    ids: list[str],
    side: Side,
    timing_ms: float = c.DEFAULT_TOLERANCE_TIMING_MS,
) -> TakesModel:
    """Build the model from resampled takes (each (T, 5, 3), as scoring.resample returns), in request order."""
    n = len(series)
    pair_dist = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            pair_dist[i, j] = pair_dist[j, i] = distance(compare(series[i], series[j]))
    medoid = int(np.argmin(pair_dist.sum(axis=1)))
    against = {k: compare(series[medoid], series[k]) for k in range(n) if k != medoid}
    to_reference = {k: distance(cmp) for k, cmp in against.items()}
    outliers = _outliers(pair_dist, to_reference, medoid)
    # The spread ignores outliers while a steady take remains, so one stray take cannot loosen the whole model.
    steady = [k for k in against if k not in outliers] or list(against)
    spread = {
        f: float(
            np.percentile(
                [against[k].error_deg[f] for k in steady], c.TAKES_SPREAD_PERCENTILE
            )
        )
        for f in c.FINGERS
    }
    fingers = {f: round(tolerance_from_spread(spread[f]), 1) for f in c.FINGERS}
    tolerance = Tolerance(
        angle_deg=round(float(np.median(list(fingers.values()))), 1),
        timing_ms=timing_ms,
        finger_angle_deg=fingers,  # type: ignore[arg-type]
    )
    takes = []
    for k, take_id in enumerate(ids):
        if k == medoid:
            takes.append(
                TakeConsistency(
                    recording_id=take_id,
                    is_reference=True,
                    distance_deg=0.0,
                    score=100.0,
                    error_deg=FingerValues(),
                    worst_finger=None,
                    outlier=False,
                )
            )
            continue
        cmp = against[k]
        takes.append(
            TakeConsistency(
                recording_id=take_id,
                is_reference=False,
                distance_deg=round(to_reference[k], 1),
                score=to_result(cmp, tolerance).overall,
                error_deg=FingerValues.from_list(
                    [round(cmp.error_deg[f], 1) for f in c.FINGERS]
                ),
                worst_finger=max(c.FINGERS, key=lambda f: cmp.error_deg[f]),  # type: ignore[arg-type]
                outlier=k in outliers,
            )
        )
    others = [t.score for t in takes if not t.is_reference]
    warnings = []
    if n < c.TAKES_MIN:
        warnings.append(
            f"Only {n} takes: record {c.TAKES_MIN} to {c.TAKES_MAX} so one uneven take cannot set the reference."
        )
    for k in sorted(outliers):
        warnings.append(
            f"Take {k + 1} strays from the others, mostly on the {takes[k].worst_finger}. Record it again or leave it out."
        )
    return TakesModel(
        side=side,
        reference_recording_id=ids[medoid],
        take_ids=list(ids),
        tolerance=tolerance,
        spread_deg=FingerValues.from_list([round(spread[f], 1) for f in c.FINGERS]),
        takes=takes,
        consistency=round(float(np.mean(others)), 1),
        steadiest_finger=min(c.FINGERS, key=lambda f: spread[f]),  # type: ignore[arg-type]
        loosest_finger=max(c.FINGERS, key=lambda f: spread[f]),  # type: ignore[arg-type]
        enough_takes=n >= c.TAKES_MIN,
        warnings=warnings,
    )


class TakesService:
    """Loads stored takes and builds a step model from them."""

    def __init__(self, recorder: Recorder) -> None:
        """Use the recorder to load stored takes."""
        self._recorder = recorder

    def model(self, request: TakesModelRequest) -> TakesModel:
        """Return the model for the requested takes (404 for an unknown id, 400 for takes without a shared hand)."""
        recordings = [self._recorder.get(i) for i in request.recording_ids]
        side = common_side(recordings, request.side)
        series = [resample(r.frames, side) for r in recordings]
        return build_model(series, request.recording_ids, side, request.timing_ms)
