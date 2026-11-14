"""Expert training persistence contract types: the scratch draft on disk, file bundles and the import report."""

from typing import Any, Literal

from pydantic import BaseModel, Field

from app import constants as c
from app.schemas.lesson import Lesson
from app.schemas.media import MediaInfo
from app.schemas.records import Calibration, Recording, TakesModel
from app.schemas.rig import WearerCalibration

DraftKind = Literal["scratch"]


class DraftPut(BaseModel):
    """PUT /drafts/{kind}/{id}: the frontend's draft object and the version of its shape."""

    schema_version: int = Field(
        ge=1,
        description="Version of the draft object's shape (the frontend's ScratchDraft.v).",
    )
    draft: dict[str, Any] = Field(
        description="The draft exactly as the frontend keeps it; the backend stores it without reading it."
    )


class DraftDoc(BaseModel):
    """A stored draft: one file per draft under <data_dir>/drafts."""

    id: str
    kind: DraftKind = "scratch"
    schema_version: int
    updated_at: str
    draft: dict[str, Any]


class ActiveCalibration(BaseModel):
    """GET /calibrations/active: the saved calibrations in use now, read from disk (they survive a restart)."""

    left: Calibration | None = None
    right: Calibration | None = None
    wearer: WearerCalibration | None = Field(
        default=None,
        description="The newest per-wearer calibration (/gloves/calibrate), if any.",
    )


class BundleMedia(BaseModel):
    """A video a bundled lesson or take refers to: its record, and its bytes when small enough."""

    info: MediaInfo
    data_base64: str | None = Field(
        default=None,
        description=f"The file as base64 when it is at most {c.BUNDLE_MEDIA_EMBED_MAX_BYTES} bytes; null when only "
        "listed (copy the media folder to move it).",
    )


class BundleTakesModel(BaseModel):
    """The takes model of one published step, recomputed from its takes at export time."""

    lesson_id: str
    step_id: str
    model: TakesModel


class Bundle(BaseModel):
    """A `.geppetto.json` file: lessons with every take, the takes models, calibrations and media they use."""

    format: Literal["geppetto.bundle"] = c.BUNDLE_FORMAT
    format_version: int = Field(default=c.BUNDLE_FORMAT_VERSION, ge=1)
    kind: Literal["lessons", "all"] = "lessons"
    name: str = ""
    exported_at: str = ""
    lessons: list[Lesson] = Field(default_factory=list)
    recordings: list[Recording] = Field(default_factory=list)
    takes_models: list[BundleTakesModel] = Field(default_factory=list)
    calibrations: list[Calibration] = Field(default_factory=list)
    wearer_calibrations: list[WearerCalibration] = Field(default_factory=list)
    media: list[BundleMedia] = Field(default_factory=list)
    drafts: list[DraftDoc] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


ImportKind = Literal[
    "lesson", "recording", "calibration", "wearer_calibration", "media", "draft"
]


class ImportItem(BaseModel):
    """One item of an import and what happened to it."""

    kind: ImportKind
    id: str
    note: str = ""


class ImportReport(BaseModel):
    """POST /lessons/import: what was added, what was already there, and what differs locally (kept, not overwritten)."""

    created: list[ImportItem] = Field(default_factory=list)
    unchanged: list[ImportItem] = Field(default_factory=list)
    overwritten: list[ImportItem] = Field(default_factory=list)
    conflicts: list[ImportItem] = Field(
        default_factory=list,
        description="A local copy with the same id differs; it was kept. Import again with overwrite=true to replace it.",
    )
    lesson_ids: list[str] = Field(
        default_factory=list,
        description="Every lesson of the bundle, now on this backend.",
    )
    warnings: list[str] = Field(default_factory=list)
