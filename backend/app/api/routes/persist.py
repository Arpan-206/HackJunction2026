"""Expert training persistence routes: the scratch draft on disk, bundle export and import, and the calibrations in use."""

from fastapi import APIRouter, Query, Response
from fastapi.responses import JSONResponse

from app.api.deps import (
    BundlesDep,
    CalibrationsDep,
    DraftsDep,
    LessonsDep,
    WearerCalibrationsDep,
)
from app.core.errors import NotFoundError
from app.schemas.persist import (
    ActiveCalibration,
    Bundle,
    DraftDoc,
    DraftKind,
    DraftPut,
    ImportReport,
)
from app.services.bundles import bundle_filename

router = APIRouter(tags=["persistence"])


@router.get("/drafts/{kind}", response_model=DraftDoc)
async def latest_draft(kind: DraftKind, drafts: DraftsDep) -> DraftDoc:
    """The most recently saved draft of a kind (404 when none), so a new tab or laptop carries on where it was."""
    return drafts.latest(kind)


@router.get("/drafts/{kind}/{draft_id}", response_model=DraftDoc)
async def get_draft(kind: DraftKind, draft_id: str, drafts: DraftsDep) -> DraftDoc:
    """One saved draft."""
    return drafts.get(kind, draft_id)


@router.put("/drafts/{kind}/{draft_id}", response_model=DraftDoc)
async def put_draft(
    kind: DraftKind, draft_id: str, body: DraftPut, drafts: DraftsDep
) -> DraftDoc:
    """Save a draft under its id (one JSON file each under data/drafts)."""
    return drafts.save(kind, draft_id, body)


@router.delete("/drafts/{kind}/{draft_id}", status_code=204)
async def delete_draft(kind: DraftKind, draft_id: str, drafts: DraftsDep) -> Response:
    """Delete a draft (after a publish or "Start fresh"); an unknown id is fine."""
    drafts.delete(kind, draft_id)
    return Response(status_code=204)


def _download(bundle: Bundle) -> JSONResponse:
    """The bundle as a JSON download named after it."""
    return JSONResponse(
        content=bundle.model_dump(mode="json"),
        headers={
            "Content-Disposition": f'attachment; filename="{bundle_filename(bundle.name)}"'
        },
    )


@router.get("/lessons/{lesson_id}/export", response_model=Bundle)
def export_lesson(
    lesson_id: str, lessons: LessonsDep, bundles: BundlesDep
) -> JSONResponse:
    """One lesson as a `.geppetto.json` bundle with every take, takes model, calibration and video it uses.

    A plain def: rebuilding the takes models runs DTW, which must not stall the glove WebSocket.
    """
    return _download(bundles.export_lessons([lessons.get(lesson_id)]))


@router.get("/export/lessons", response_model=Bundle)
def export_lessons(
    lessons: LessonsDep,
    bundles: BundlesDep,
    ids: str = Query(
        ...,
        min_length=1,
        description="Comma-separated lesson ids, e.g. every lesson of one skill.",
    ),
    name: str = Query(
        "",
        max_length=120,
        description="The bundle's name (the skill); the first lesson's title if empty.",
    ),
) -> JSONResponse:
    """Several lessons (one skill) as one bundle."""
    wanted = [i for i in (s.strip() for s in ids.split(",")) if i]
    return _download(
        bundles.export_lessons(
            [lessons.get(i) for i in dict.fromkeys(wanted)], name or None
        )
    )


@router.get("/export/all", response_model=Bundle)
def export_all(bundles: BundlesDep) -> JSONResponse:
    """A backup of everything in the data folder except video bytes (videos are listed by id)."""
    return _download(bundles.export_all())


@router.post("/lessons/import", response_model=ImportReport)
def import_bundle(
    body: Bundle, bundles: BundlesDep, overwrite: bool = False
) -> ImportReport:
    """Load a bundle. Idempotent by id; a local copy that differs is kept and reported as a conflict unless
    overwrite=true."""
    return bundles.import_bundle(body, overwrite)


@router.get("/calibrations/active", response_model=ActiveCalibration)
async def active_calibration(
    calibrations: CalibrationsDep, wearers: WearerCalibrationsDep
) -> ActiveCalibration:
    """The newest saved calibration per hand and the newest per-wearer calibration, read from disk."""

    def latest_side(side: str):
        try:
            return calibrations.latest(side)  # type: ignore[arg-type]
        except NotFoundError:
            return None

    newest = wearers.list()
    return ActiveCalibration(
        left=latest_side("left"),
        right=latest_side("right"),
        wearer=newest[0] if newest else None,
    )
