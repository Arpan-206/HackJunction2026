"""WebSocket endpoint streaming smoothed glove frames."""

import contextlib
from collections.abc import Coroutine
from typing import Any

import anyio
import anyio.abc
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
                gloves.set_simulator_motion(
                    _motion_adapter.validate_python(message.get("motion"))
                )


async def _until_done(
    group: anyio.abc.TaskGroup, work: Coroutine[Any, Any, None]
) -> None:
    """Run one half of the socket; when it ends for any reason (disconnect, send error) stop the other half."""
    try:
        with contextlib.suppress(
            Exception
        ):  # a dead socket ends the session; nothing to report to the client
            await work
    finally:
        group.cancel_scope.cancel()


@router.websocket(c.WS_GLOVES_PATH)
async def glove_stream(websocket: WebSocket) -> None:
    """Stream GloveFrame JSON and accept simulator motion changes."""
    services: Services = websocket.app.state.services
    await websocket.accept()
    # An anyio task group (not asyncio.create_task + gather) so that an outer cancellation arriving while the
    # children are being torn down keeps anyio's cancel message; gather replaced it with our own bare
    # CancelledError, which the enclosing anyio scope then failed to recognise and let escape.
    async with anyio.create_task_group() as group:
        group.start_soon(_until_done, group, _pump(websocket, services.gloves))
        group.start_soon(_until_done, group, _listen(websocket, services.gloves))
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        await websocket.close()
