"""Real-glove routes: status with fix steps, the managed solver, ReinitAlgo, per-wearer calibration and the drift check."""

from fastapi import APIRouter, Query

from app import constants as c
from app.api.deps import GloveRigDep, WearerCalibrationsDep
from app.schemas.rig import (
    CalibrationFinishRequest,
    DriftCheckRequest,
    DriftCheckResult,
    DriverActionRequest,
    GloveRigStatus,
    NeutralCaptureRequest,
    ReinitResult,
    WearerCalibration,
)

router = APIRouter(prefix="/gloves", tags=["gloves"])


@router.get("/status", response_model=GloveRigStatus)
async def glove_status(rig: GloveRigDep) -> GloveRigStatus:
    """Both gloves, the driver and solver, and the fix steps, most important first."""
    return await rig.status()


@router.post("/driver", response_model=GloveRigStatus)
async def driver_action(body: DriverActionRequest, rig: GloveRigDep) -> GloveRigStatus:
    """Start the solver (it starts the driver when none runs) or stop the one this backend started."""
    if body.action == "start":
        await rig.ensure_running()
    else:
        await rig.stop_managed()
    return await rig.status()


@router.post("/reinit", response_model=ReinitResult)
async def reinit(rig: GloveRigDep) -> ReinitResult:
    """RCSP ReinitAlgo on every glove: Rokoko's documented re-initialisation (the gloves have no calibrate command)."""
    return ReinitResult(devices=await rig.reinit())


@router.get("/calibrations", response_model=list[WearerCalibration])
async def list_calibrations(
    calibrations: WearerCalibrationsDep,
    wearer: str | None = Query(None, max_length=c.WEARER_MAX_CHARS),
) -> list[WearerCalibration]:
    """Saved calibrations, newest first, optionally for one wearer."""
    return calibrations.list(wearer)


@router.get("/calibrations/latest", response_model=WearerCalibration)
async def latest_calibration(
    calibrations: WearerCalibrationsDep,
    wearer: str = Query(..., min_length=1, max_length=c.WEARER_MAX_CHARS),
) -> WearerCalibration:
    """The wearer's newest calibration, or 404."""
    return calibrations.latest(wearer)


@router.post("/calibrations/neutral", response_model=WearerCalibration)
async def capture_neutral(
    body: NeutralCaptureRequest, calibrations: WearerCalibrationsDep
) -> WearerCalibration:
    """Capture the neutral pose (hands flat, thumbs together, still) for a wearer and store it with its quality."""
    return await calibrations.capture_neutral(body.wearer, body.duration_s, body.reinit)


@router.post("/calibrations/{calibration_id}/finish", response_model=WearerCalibration)
async def finish_calibration(
    calibration_id: str,
    body: CalibrationFinishRequest,
    calibrations: WearerCalibrationsDep,
) -> WearerCalibration:
    """Attach the flat and fist range calibration ids and whether the hand followed in the verification step."""
    return calibrations.finish(calibration_id, body)


@router.post("/drift_check", response_model=DriftCheckResult)
async def drift_check(
    body: DriftCheckRequest, calibrations: WearerCalibrationsDep
) -> DriftCheckResult:
    """Demo mode: hold still and compare with the wearer's last saved neutral pose."""
    return await calibrations.drift_check(body.wearer, body.duration_s)
