"""Routes that let an external pipeline push hand frames into the glove stream."""

import contextlib
import json

from fastapi import APIRouter, Body, Query, WebSocket, WebSocketDisconnect

from app import constants as c
from app.api.deps import GlovesDep
from app.core.errors import AppError
from app.services.container import Services

router = APIRouter(tags=["ingest"])
ws_router = APIRouter()


@router.post("/ingest/frames")
async def ingest_frames(
    gloves: GlovesDep,
    body: dict = Body(...),  # noqa: B008
    activate: bool = Query(False, description="Switch the glove source to 'external' first if it is not active"),
) -> dict[str, int]:
    """Push one GloveFrame, one HandFrame or {"frames": [...]}; 409 if the external source is not active."""
    return {"accepted": await gloves.ingest_async(body, activate=activate)}


@ws_router.websocket(c.WS_INGEST_PATH)
async def ingest_stream(websocket: WebSocket, activate: bool = False) -> None:
    """Accept JSON messages of the /ingest/frames shapes; failures are reported per message and never close the socket."""
    services: Services = websocket.app.state.services
    await websocket.accept()
    try:
        while True:
            text = await websocket.receive_text()
            try:
                try:
                    message = json.loads(text)
                except ValueError:
                    message = None
                if not isinstance(message, dict):
                    await websocket.send_json({"type": "error", "status": 422, "detail": "Each message must be a JSON object"})
                    continue
                await services.gloves.ingest_async(message, activate=activate)
            except AppError as exc:
                await websocket.send_json({"type": "error", "status": exc.status_code, "detail": exc.detail})
    except WebSocketDisconnect:
        return
    finally:
        with contextlib.suppress(RuntimeError):
            await websocket.close()
