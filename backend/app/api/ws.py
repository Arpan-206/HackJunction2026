"""WebSocket endpoint streaming smoothed glove frames."""

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import TypeAdapter, ValidationError

from app import constants as c
from app.schemas.motion import MotionSpec
from app.services.container import Services
from app.services.gloves.manager import GloveManager

router = APIRouter()
_motion_adapter: TypeAdapter[MotionSpec] = TypeAdapter(MotionSpec)


async def _pump(websocket: WebSocket, gloves: GloveManager) -> None:
    """Forward frames from the manager to the client until cancelled."""
    queue = gloves.subscribe()
    try:
        while True:
            frame = await queue.get()
            await websocket.send_text(frame.model_dump_json())
    finally:
        gloves.unsubscribe(queue)


async def _listen(websocket: WebSocket, gloves: GloveManager) -> None:
    """Handle client messages; currently only set_motion, which drives the simulator."""
    while True:
        message = await websocket.receive_json()
        if isinstance(message, dict) and message.get("type") == "set_motion":
            with contextlib.suppress(ValidationError):
                gloves.set_simulator_motion(_motion_adapter.validate_python(message.get("motion")))


@router.websocket(c.WS_GLOVES_PATH)
async def glove_stream(websocket: WebSocket) -> None:
    """Stream GloveFrame JSON and accept simulator motion changes."""
    services: Services = websocket.app.state.services
    await websocket.accept()
    pump = asyncio.create_task(_pump(websocket, services.gloves))
    listen = asyncio.create_task(_listen(websocket, services.gloves))
    try:
        await asyncio.wait({pump, listen}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in (pump, listen):
            task.cancel()
        await asyncio.gather(pump, listen, return_exceptions=True)
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        await websocket.close()
