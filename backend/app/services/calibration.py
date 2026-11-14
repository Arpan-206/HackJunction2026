"""Hand calibration: average flexion over a short capture, for a flat hand and a loose fist."""

import asyncio
import time

import numpy as np

from app import constants as c
from app.core.errors import BadRequestError, NotFoundError
from app.core.utils import new_id, utc_now_iso
from app.schemas.common import Side
from app.schemas.records import Calibration
from app.services.gloves.manager import GloveManager
from app.services.storage.json_store import JsonStore

Phase = str


class CalibrationService:
    """Captures phases from the live glove stream and stores the merged result."""

    def __init__(self, store: JsonStore[Calibration], gloves: GloveManager) -> None:
        """Wire the store and the live glove pipeline."""
        self._store = store
        self._gloves = gloves
        self._pending: dict[
            Side, dict[Phase, dict[str, tuple[float, float, float]]]
        ] = {}

    async def _capture(
        self, side: Side, duration_s: float
    ) -> dict[str, tuple[float, float, float]]:
        """Average flexion for a side over duration_s of live frames."""
        queue = self._gloves.subscribe()
        samples: list[np.ndarray] = []
        deadline = time.monotonic() + duration_s
        try:
            while (remaining := deadline - time.monotonic()) > 0:
                try:
                    frame = await asyncio.wait_for(queue.get(), timeout=remaining)
                except TimeoutError:
                    break
                hand = frame.hand(side)
                if hand is not None:
                    samples.append(np.array([hand.flexion[f] for f in c.FINGERS]))
        finally:
            self._gloves.unsubscribe(queue)
        if not samples:
            raise BadRequestError(f"no {side} hand frames received during calibration")
        mean = np.mean(samples, axis=0)
        return {
            f: (round(float(a), 4), round(float(b), 4), round(float(d), 4))
            for f, (a, b, d) in zip(c.FINGERS, mean, strict=True)
        }

    async def capture(self, side: Side, phase: Phase, duration_s: float) -> Calibration:
        """Capture one phase and return the calibration so far (flat or fist is zeros, thumb None, until captured)."""
        averaged = await self._capture(side, duration_s)
        phases = self._pending.setdefault(side, {})
        phases[phase] = averaged
        calibration = Calibration(
            id=new_id(),
            side=side,
            **{
                name: phases[name]
                for name in ("flat", "fist", "thumb")
                if name in phases
            },
            created_at=utc_now_iso(),
        )
        return self._store.save(calibration)

    def latest(self, side: Side) -> Calibration:
        """Return the most recent calibration for a side or raise NotFoundError."""
        matches = [cal for cal in self._store.list() if cal.side == side]
        if not matches:
            raise NotFoundError(f"no calibration for {side} hand")
        return max(matches, key=lambda cal: cal.created_at)

    def get(self, calibration_id: str) -> Calibration:
        """Return a calibration by id or raise NotFoundError."""
        found = self._store.get(calibration_id)
        if found is None:
            raise NotFoundError(f"calibration {calibration_id} not found")
        return found
