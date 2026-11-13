"""Calibration routes."""

from fastapi import APIRouter

from app.api.deps import CalibrationsDep
from app.schemas.api import CalibrationRequest
from app.schemas.common import Side
from app.schemas.records import Calibration

router = APIRouter(tags=["calibrations"])


@router.post("/calibrations", response_model=Calibration)
async def capture_calibration(body: CalibrationRequest, calibrations: CalibrationsDep) -> Calibration:
    """Capture one calibration phase from the live glove stream."""
    return await calibrations.capture(body.side, body.phase, body.duration_s)


@router.get("/calibrations/latest", response_model=Calibration)
async def latest_calibration(side: Side, calibrations: CalibrationsDep) -> Calibration:
    """Return the most recent calibration for a side."""
    return calibrations.latest(side)
