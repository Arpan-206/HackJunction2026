"""Calibration area and demo mode: neutral pose per wearer, the quality reading, and the drift check.

The neutral pose is hands flat on the table, thumbs together, still: per joint flexion offsets (the app stream's 15
joint angles per hand), the wrist yaw that becomes zero, and how still the hands were. The flat and fist range comes
from the existing POST /calibrations and is attached by id. Everything is stored per wearer with a timestamp.
"""

import asyncio
import math
import time
from collections.abc import Iterable

import numpy as np

from app import constants as c
from app.core.errors import BadRequestError, NotFoundError
from app.core.utils import new_id, utc_now_iso
from app.schemas.common import Side
from app.schemas.frames import GloveFrame
from app.schemas.rig import (
    CalibrationFinishRequest,
    CalibrationQuality,
    DriftCheckResult,
    DriftHand,
    NeutralHand,
    WearerCalibration,
)
from app.services.calibration import CalibrationService
from app.services.gloves.manager import GloveManager
from app.services.rig.service import GloveRigService
from app.services.storage.json_store import JsonStore


def wrist_yaw_deg(quat: Iterable[float]) -> float:
    """Heading of the hand in degrees: rotation about +y of the fingers' direction (-z at rest), x y z w quaternion."""
    x, y, z, w = (float(v) for v in quat)
    # The rotated -z axis (third column of the rotation matrix, negated).
    fx = -(2 * (x * z + w * y))
    fz = -(1 - 2 * (x * x + y * y))
    return math.degrees(math.atan2(-fx, -fz))


def circular_mean_deg(angles: Iterable[float]) -> float:
    """Mean of angles in degrees, safe across the +-180 seam."""
    rad = np.radians(np.asarray(list(angles), dtype=float))
    return float(np.degrees(np.arctan2(np.mean(np.sin(rad)), np.mean(np.cos(rad)))))


def angle_diff_deg(a: float, b: float) -> float:
    """Smallest absolute difference between two headings in degrees."""
    return abs((a - b + 180.0) % 360.0 - 180.0)


def summarise_hand(side: Side, flex: np.ndarray, yaws: list[float]) -> NeutralHand:
    """Neutral offsets and stillness from (frames, 15) joint flexion in radians and the wrist yaws."""
    mean = flex.mean(axis=0)
    zero = circular_mean_deg(yaws)
    spread = (
        float(np.sqrt(np.mean([angle_diff_deg(y, zero) ** 2 for y in yaws])))
        if yaws
        else 0.0
    )
    offsets = {
        f: tuple(round(float(v), 4) for v in mean[i * 3 : (i + 1) * 3])
        for i, f in enumerate(c.FINGERS)
    }
    return NeutralHand(
        side=side,
        offsets=offsets,  # type: ignore[arg-type]
        yaw_zero_deg=round(zero, 2),
        noise_deg=round(float(np.degrees(flex.std(axis=0)).mean()), 2),
        yaw_spread_deg=round(spread, 2),
        frames=int(flex.shape[0]),
    )


def _grade(
    value: float | None, good: float, fair: float, higher_is_better: bool = False
) -> int:
    """0 good, 1 fair, 2 poor; unknown counts as good so a missing reading never fails a calibration."""
    if value is None:
        return 0
    if higher_is_better:
        return 0 if value >= good else 1 if value >= fair else 2
    return 0 if value <= good else 1 if value <= fair else 2


def quality_of(
    hands: list[NeutralHand], heading_share: float | None
) -> CalibrationQuality:
    """Noise at rest and bias away from a flat hand, graded by the bands in constants.py.

    The heading share is reported as measured but no longer graded: the glove compass settles on its own once the
    wearer moves, so it never blocks or downgrades a capture.
    """
    noise = round(max(h.noise_deg for h in hands), 2) if hands else None
    bias = None
    if hands:
        bias = round(
            max(
                float(np.degrees(np.abs(np.array(list(h.offsets.values()))).mean()))
                for h in hands
            ),
            2,
        )
    grades = (
        _grade(noise, c.QUALITY_NOISE_GOOD_DEG, c.QUALITY_NOISE_FAIR_DEG),
        _grade(bias, c.QUALITY_BIAS_GOOD_DEG, c.QUALITY_BIAS_FAIR_DEG),
    )
    notes: list[str] = []
    if grades[0]:
        notes.append(
            "The hands moved during the capture. Rest them on the table and hold still."
        )
    if grades[1]:
        notes.append(
            "The flat hands read as bent. Lay the fingers flat and straight, then capture again."
        )
    return CalibrationQuality(
        noise_deg=noise,
        bias_deg=bias,
        heading_reliable=None if heading_share is None else round(heading_share, 3),
        grade=("good", "fair", "poor")[max(grades)],
        notes=notes,
    )


class WearerCalibrationService:
    """Captures and stores calibrations per wearer, and runs demo mode's drift check."""

    def __init__(
        self,
        store: JsonStore[WearerCalibration],
        gloves: GloveManager,
        rig: GloveRigService,
        ranges: CalibrationService,
    ) -> None:
        """Wire the store, the live stream, the rig (heading flags, ReinitAlgo) and the range calibrations."""
        self._store = store
        self._gloves = gloves
        self._rig = rig
        self._ranges = ranges

    async def _capture(
        self, duration_s: float
    ) -> tuple[dict[Side, np.ndarray], dict[Side, list[float]], list[bool]]:
        """Joint flexion and wrist yaw per hand over duration_s of live frames, plus heading samples."""
        queue = self._gloves.subscribe()
        flex: dict[Side, list[list[float]]] = {}
        yaws: dict[Side, list[float]] = {}
        heading: list[bool] = []
        deadline = time.monotonic() + duration_s
        try:
            while (remaining := deadline - time.monotonic()) > 0:
                try:
                    frame: GloveFrame = await asyncio.wait_for(
                        queue.get(), timeout=remaining
                    )
                except TimeoutError:
                    break
                for hand in frame.hands:
                    flex.setdefault(hand.side, []).append(
                        [v for f in c.FINGERS for v in hand.flexion[f]]
                    )
                    yaws.setdefault(hand.side, []).append(
                        wrist_yaw_deg(hand.wrist_quat)
                    )
                    reliable = self._rig.heading_reliable(hand.side)
                    if reliable is not None:
                        heading.append(reliable)
        finally:
            self._gloves.unsubscribe(queue)
        arrays = {
            s: np.asarray(v, dtype=float)
            for s, v in flex.items()
            if len(v) >= c.NEUTRAL_MIN_FRAMES
        }
        if not arrays:
            raise BadRequestError(
                "No glove frames arrived while capturing. Check the gloves screen, then try again."
            )
        return arrays, yaws, heading

    async def capture_neutral(
        self, wearer: str, duration_s: float, reinit: bool
    ) -> WearerCalibration:
        """Optionally re-initialise the sensor fusion, then capture and store the neutral pose with its quality."""
        reinit_done = False
        if reinit:
            reinit_done = await self._rig.reinit() > 0
            if reinit_done:
                await asyncio.sleep(c.REINIT_SETTLE_S)
        arrays, yaws, heading = await self._capture(duration_s)
        hands = [summarise_hand(s, arrays[s], yaws[s]) for s in c.SIDES if s in arrays]  # type: ignore[arg-type]
        share = (sum(heading) / len(heading)) if heading else None
        record = WearerCalibration(
            id=new_id(),
            wearer=wearer,
            created_at=utc_now_iso(),
            neutral=hands,
            quality=quality_of(hands, share),
            reinit=reinit_done,
        )
        return self._store.save(record)

    def get(self, calibration_id: str) -> WearerCalibration:
        """A stored calibration or 404."""
        found = self._store.get(calibration_id)
        if found is None:
            raise NotFoundError(f"glove calibration {calibration_id} not found")
        return found

    def finish(
        self, calibration_id: str, body: CalibrationFinishRequest
    ) -> WearerCalibration:
        """Attach the flat and fist range ids (each must exist and match its side) and the verification result."""
        record = self.get(calibration_id)
        if body.range_calibration_ids is not None:
            for side, rid in body.range_calibration_ids.items():
                if self._ranges.get(rid).side != side:
                    raise BadRequestError(
                        f"calibration {rid} is not for the {side} hand"
                    )
            record.range_calibration_ids = {
                **record.range_calibration_ids,
                **body.range_calibration_ids,
            }
        if body.verified is not None:
            record.verified = body.verified
        return self._store.save(record)

    def list(self, wearer: str | None = None) -> list[WearerCalibration]:
        """Stored calibrations, newest first, optionally for one wearer (names compare case-insensitively)."""
        items = [
            r
            for r in self._store.list()
            if wearer is None or r.wearer.casefold() == wearer.casefold()
        ]
        return sorted(items, key=lambda r: r.created_at, reverse=True)

    def latest(self, wearer: str) -> WearerCalibration:
        """The wearer's newest calibration or 404."""
        items = self.list(wearer)
        if not items:
            raise NotFoundError(f"no glove calibration saved for {wearer}")
        return items[0]

    async def drift_check(self, wearer: str, duration_s: float) -> DriftCheckResult:
        """Hold still for duration_s and compare with the wearer's last neutral pose."""
        saved = self.latest(wearer)
        arrays, yaws, _ = await self._capture(duration_s)
        return compare_drift(saved, arrays, yaws)


def compare_drift(
    saved: WearerCalibration,
    arrays: dict[Side, np.ndarray],
    yaws: dict[Side, list[float]],
) -> DriftCheckResult:
    """Per hand: mean joint flexion change and yaw change against the saved neutral pose, judged by the thresholds."""
    hands: list[DriftHand] = []
    for neutral in saved.neutral:
        live = arrays.get(neutral.side)
        if live is None:
            continue
        ref = np.array([v for f in c.FINGERS for v in neutral.offsets[f]])
        flex = float(np.degrees(np.abs(live.mean(axis=0) - ref)).mean())
        yaw = angle_diff_deg(
            circular_mean_deg(yaws[neutral.side]), neutral.yaw_zero_deg
        )
        hands.append(
            DriftHand(
                side=neutral.side,
                flex_drift_deg=round(flex, 2),
                yaw_drift_deg=round(yaw, 2),
            )
        )
    if not hands:
        raise BadRequestError(
            "The saved calibration has no hand that is streaming now. Calibrate again."
        )
    worst = max(
        hands,
        key=lambda h: max(
            h.flex_drift_deg / c.DRIFT_MAX_FLEX_DEG,
            h.yaw_drift_deg / c.DRIFT_MAX_YAW_DEG,
        ),
    )
    ok = all(
        h.flex_drift_deg <= c.DRIFT_MAX_FLEX_DEG
        and h.yaw_drift_deg <= c.DRIFT_MAX_YAW_DEG
        for h in hands
    )
    if ok:
        message = "The gloves still match the saved calibration."
    elif worst.flex_drift_deg > c.DRIFT_MAX_FLEX_DEG:
        message = f"The {worst.side} hand reads {round(worst.flex_drift_deg)} degrees away from the saved flat pose. Recalibrate."
    else:
        message = f"The {worst.side} hand's heading moved {round(worst.yaw_drift_deg)} degrees since calibration. Recalibrate."
    return DriftCheckResult(
        ok=ok,
        calibration_id=saved.id,
        hands=hands,
        max_flex_deg=c.DRIFT_MAX_FLEX_DEG,
        max_yaw_deg=c.DRIFT_MAX_YAW_DEG,
        message=message,
    )
