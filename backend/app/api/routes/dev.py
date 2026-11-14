"""Development routes: the live-tunable pipeline state, the stored-file reveal and the glove compare captures."""

import base64
import json

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool

from app import constants as c
from app.api.deps import DevDep, FilesDep, ServicesDep
from app.core.errors import AppError
from app.schemas.api import (
    DevState,
    DevStatePatch,
    FileKind,
    FileLocation,
    GloveCompareSave,
    GloveCompareSaved,
    RevealRequest,
)
from app.services import files as file_manager

router = APIRouter(tags=["dev"])


class ForbiddenError(AppError):
    """The dev file reveal is off, or the request did not come from this machine."""

    status_code = 403


def _local_dev_only(request: Request, services: ServicesDep) -> None:
    """Allow the file routes only from localhost and only while DEV_REVEAL is on."""
    if not services.settings.dev_reveal:
        raise ForbiddenError("the dev file reveal is off (DEV_REVEAL=false)")
    host = request.client.host if request.client else ""
    if host not in c.DEV_LOCAL_HOSTS:
        raise ForbiddenError(
            "the dev file reveal answers only requests from this machine"
        )


@router.get("/dev/state", response_model=DevState)
async def get_dev_state(dev: DevDep) -> DevState:
    """Return the live-tunable pipeline state."""
    return dev.state()


@router.post("/dev/state", response_model=DevState)
async def set_dev_state(body: DevStatePatch, dev: DevDep) -> DevState:
    """Apply a partial update and return the new state."""
    return await dev.apply(body)


@router.get(
    "/dev/locate",
    response_model=FileLocation,
    dependencies=[Depends(_local_dev_only)],
)
async def locate_file(
    files: FilesDep,
    kind: FileKind = Query(...),
    id: str = Query(..., min_length=1, max_length=160),
) -> FileLocation:
    """The absolute path of a stored file inside the data folder, without opening anything (for "Copy path")."""
    path = files.locate(kind, id)
    return FileLocation(kind=kind, id=id, path=str(path), opened=False)


@router.post(
    "/dev/reveal",
    response_model=FileLocation,
    dependencies=[Depends(_local_dev_only)],
)
async def reveal_file(body: RevealRequest, files: FilesDep) -> FileLocation:
    """Open the file manager on this machine with the stored file selected, and return its path."""
    path = files.locate(body.kind, body.id)
    opened = await run_in_threadpool(file_manager.open_in_file_manager, path)
    return FileLocation(kind=body.kind, id=body.id, path=str(path), opened=opened)


def _write_glove_compare(root, body: GloveCompareSave) -> GloveCompareSaved:
    """Write one capture under <data>/glove_compare/<session>/ as <nn>-<slug>.json, and the snapshot as .png."""
    folder = root / c.GLOVE_COMPARE_DIR / body.session
    folder.mkdir(parents=True, exist_ok=True)
    stem = f"{body.index:02d}-{body.slug}"
    json_path = folder / f"{stem}.json"
    json_path.write_text(json.dumps(body.data, separators=(",", ":")), encoding="utf-8")
    png_path = None
    prefix = "data:image/png;base64,"
    if body.png and body.png.startswith(prefix):
        png_path = folder / f"{stem}.png"
        png_path.write_bytes(base64.b64decode(body.png[len(prefix) :]))
    return GloveCompareSaved(
        json_path=str(json_path.resolve()),
        png_path=str(png_path.resolve()) if png_path else None,
    )


@router.post(
    "/dev/glove_compare",
    response_model=GloveCompareSaved,
    dependencies=[Depends(_local_dev_only)],
)
async def save_glove_compare(
    body: GloveCompareSave, services: ServicesDep
) -> GloveCompareSaved:
    """Save one guided capture of the glove compare page (core frames beside what the frontend drew)."""
    return await run_in_threadpool(
        _write_glove_compare, services.settings.data_dir, body
    )
