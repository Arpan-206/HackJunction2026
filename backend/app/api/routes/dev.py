"""Development state routes."""

from fastapi import APIRouter

from app.api.deps import DevDep
from app.schemas.api import DevState, DevStatePatch

router = APIRouter(tags=["dev"])


@router.get("/dev/state", response_model=DevState)
async def get_dev_state(dev: DevDep) -> DevState:
    """Return the live-tunable pipeline state."""
    return dev.state()


@router.post("/dev/state", response_model=DevState)
async def set_dev_state(body: DevStatePatch, dev: DevDep) -> DevState:
    """Apply a partial update and return the new state."""
    return await dev.apply(body)
