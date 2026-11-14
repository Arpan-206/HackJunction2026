"""File bundles of expert work: export a lesson (or everything) as one `.geppetto.json`, import one back, and write a
backup bundle after every publish.

A lesson bundle holds the lesson, every take its steps refer to (reference and take_ids), each step's takes model
recomputed from those takes, the calibrations in use when they were recorded, and the videos they refer to (embedded
when small). Import is idempotent by id and never replaces a local copy that differs unless asked to: it is reported as
a conflict instead.
"""

import base64
import binascii
import logging
import re
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from app import constants as c
from app.core.errors import AppError, BadRequestError
from app.core.utils import utc_now_iso
from app.schemas.lesson import Lesson
from app.schemas.media import MediaInfo
from app.schemas.persist import (
    Bundle,
    BundleMedia,
    BundleTakesModel,
    ImportItem,
    ImportKind,
    ImportReport,
)
from app.schemas.records import Calibration, Recording, TakesModelRequest
from app.schemas.rig import WearerCalibration
from app.services.drafts import DraftService
from app.services.storage.json_store import JsonStore
from app.services.takes import TakesService

log = logging.getLogger(__name__)
M = TypeVar("M", bound=BaseModel)
_STAMP = "%Y%m%dT%H%M%S%f"


class BundleVersionError(AppError):
    """The bundle was written by a newer Geppetto than this one."""

    status_code = 422


def slug(name: str) -> str:
    """A file-safe lower-case name: letters and digits joined by hyphens, never empty."""
    s = (
        re.sub(r"[^a-z0-9]+", "-", name.casefold())
        .strip("-")[: c.EXPORT_SLUG_MAX_CHARS]
        .strip("-")
    )
    return s or "lesson"


def bundle_filename(name: str) -> str:
    """The download name of a bundle: `<skill-name>.geppetto.json`."""
    return f"{slug(name)}{c.BUNDLE_FILE_SUFFIX}"


def _same(a: BaseModel, b: BaseModel) -> bool:
    """Whether two models hold the same data as JSON."""
    return a.model_dump(mode="json") == b.model_dump(mode="json")


def _media_ids(lessons: Iterable[Lesson], recordings: Iterable[Recording]) -> list[str]:
    """Every media id the lessons' tutorial videos and the takes' webcams refer to, in first-seen order."""
    ids: list[str] = []
    for lesson in lessons:
        for step in lesson.steps:
            if step.tutorial_video is not None:
                ids.append(step.tutorial_video.media_id)
            if step.video_url and step.video_url.startswith(c.MEDIA_URL_PREFIX):
                ids.append(step.video_url[len(c.MEDIA_URL_PREFIX) :])
    for rec in recordings:
        if rec.video is not None:
            ids.append(rec.video.media_id)
    return list(dict.fromkeys(ids))


def _sides(rec: Recording) -> set[str]:
    """The hands a take holds."""
    return {h.side for f in rec.frames for h in f.hands} or (
        {"left", "right"} if rec.hands == "both" else {rec.hands}
    )


class BundleService:
    """Builds bundles from the stores, writes imported ones back, and keeps rolling backups under <data_dir>/exports."""

    def __init__(
        self, data_dir: Path, takes: TakesService, drafts: DraftService
    ) -> None:
        """Open the same stores the other services use (a JsonStore keeps no state beyond its folder)."""
        self._lessons = JsonStore(data_dir / "lessons", Lesson)
        self._recordings = JsonStore(data_dir / "recordings", Recording)
        self._calibrations = JsonStore(data_dir / "calibrations", Calibration)
        self._wearers = JsonStore(data_dir / "glove_calibrations", WearerCalibration)
        self._media_dir = data_dir / c.MEDIA_DIR_NAME
        self._media = JsonStore(self._media_dir, MediaInfo)
        self._exports = data_dir / c.EXPORTS_DIR_NAME
        self._takes = takes
        self._drafts = drafts

    # ------------------------------------------------------------------ export

    def _media_file(self, info: MediaInfo) -> Path:
        """Where a stored video's bytes live."""
        return (
            self._media_dir / f"{info.id}{c.MEDIA_SUFFIXES.get(info.content_type, '')}"
        )

    def _bundle_media(
        self, ids: Iterable[str], embed: bool, warnings: list[str]
    ) -> list[BundleMedia]:
        """The media records for the ids, with the bytes of small files when embed is set."""
        out: list[BundleMedia] = []
        for media_id in ids:
            info = self._media.get(media_id)
            if info is None:
                warnings.append(f"video {media_id} is referenced but not stored")
                continue
            data = None
            path = self._media_file(info)
            if (
                embed
                and info.size_bytes <= c.BUNDLE_MEDIA_EMBED_MAX_BYTES
                and path.exists()
            ):
                data = base64.b64encode(path.read_bytes()).decode("ascii")
            elif embed:
                warnings.append(
                    f"video {media_id} is listed only ({info.size_bytes} bytes); copy backend/data/media to move it"
                )
            out.append(BundleMedia(info=info, data_base64=data))
        return out

    def _calibrations_for(
        self, recordings: list[Recording]
    ) -> tuple[list[Calibration], list[WearerCalibration]]:
        """For each take and hand, the newest calibration saved before it was recorded (else the newest), and the
        per-wearer calibrations that point at them."""
        cals = sorted(self._calibrations.list(), key=lambda x: x.created_at)
        chosen: dict[str, Calibration] = {}
        for rec in recordings:
            for side in _sides(rec):
                same = [x for x in cals if x.side == side]
                before = [x for x in same if x.created_at <= rec.started_at]
                pick = (before or same)[-1:] if same else []
                for x in pick:
                    chosen[x.id] = x
        wearers = [
            w
            for w in self._wearers.list()
            if set(w.range_calibration_ids.values()) & set(chosen)
        ]
        return list(chosen.values()), wearers

    def _takes_models(
        self, lesson: Lesson, warnings: list[str]
    ) -> list[BundleTakesModel]:
        """Each step's takes model, rebuilt from its takes (the same numbers POST /recordings/model gave)."""
        out: list[BundleTakesModel] = []
        for step in lesson.steps:
            if len(step.take_ids) < c.TAKES_HARD_MIN:
                continue
            try:
                model = self._takes.model(
                    TakesModelRequest(
                        recording_ids=step.take_ids,
                        side=None if step.hands == "both" else step.hands,
                        timing_ms=step.tolerance.timing_ms,
                    )
                )
            except AppError as exc:
                warnings.append(
                    f"takes model of step {step.title!r} not rebuilt: {exc.detail}"
                )
                continue
            out.append(
                BundleTakesModel(lesson_id=lesson.id, step_id=step.id, model=model)
            )
        return out

    def export_lessons(self, lessons: list[Lesson], name: str | None = None) -> Bundle:
        """One bundle for the given lessons: every take, takes model, calibration and video they use."""
        warnings: list[str] = []
        rec_ids: list[str] = []
        for lesson in lessons:
            for step in lesson.steps:
                if step.reference_recording_id:
                    rec_ids.append(step.reference_recording_id)
                rec_ids.extend(step.take_ids)
        recordings: list[Recording] = []
        for rid in dict.fromkeys(rec_ids):
            rec = self._recordings.get(rid)
            if rec is None:
                warnings.append(f"take {rid} is referenced but not stored")
            else:
                recordings.append(rec)
        calibrations, wearers = self._calibrations_for(recordings)
        models = [m for lesson in lessons for m in self._takes_models(lesson, warnings)]
        return Bundle(
            kind="lessons",
            name=name or (lessons[0].title if lessons else ""),
            exported_at=utc_now_iso(),
            lessons=lessons,
            recordings=recordings,
            takes_models=models,
            calibrations=calibrations,
            wearer_calibrations=wearers,
            media=self._bundle_media(_media_ids(lessons, recordings), True, warnings),
            warnings=warnings,
        )

    def export_all(self) -> Bundle:
        """Everything under the data folder except video bytes: lessons, takes, calibrations, drafts, video records."""
        warnings: list[str] = []
        lessons = self._lessons.list()
        recordings = self._recordings.list()
        media_ids = [m.id for m in self._media.list()]
        return Bundle(
            kind="all",
            name="geppetto-backup",
            exported_at=utc_now_iso(),
            lessons=lessons,
            recordings=recordings,
            calibrations=self._calibrations.list(),
            wearer_calibrations=self._wearers.list(),
            media=self._bundle_media(media_ids, False, warnings),
            drafts=self._drafts.list(),
            warnings=warnings,
        )

    # ------------------------------------------------------------------ import

    def _merge(
        self,
        kind: ImportKind,
        items: Iterable[M],
        get: Callable[[str], M | None],
        put: Callable[[M], object],
        overwrite: bool,
        report: ImportReport,
    ) -> None:
        """Write each item that is new; leave identical ones; report (or with overwrite, replace) differing ones."""
        for item in items:
            item_id: str = item.id  # type: ignore[attr-defined]
            local = get(item_id)
            entry = ImportItem(kind=kind, id=item_id)
            if local is None:
                put(item)
                report.created.append(entry)
            elif _same(local, item):
                report.unchanged.append(entry)
            elif overwrite:
                put(item)
                report.overwritten.append(entry)
            else:
                entry.note = "a different copy is already here; it was kept"
                report.conflicts.append(entry)

    def _put_media(self, media: BundleMedia, report: ImportReport) -> None:
        """Write a bundled video's bytes and record; a video bundled without bytes is only noted."""
        if media.data_base64 is None:
            report.warnings.append(
                f"video {media.info.id} was not in the file; copy it into backend/data/media"
            )
            return
        if media.info.content_type not in c.MEDIA_SUFFIXES:
            raise BadRequestError(
                f"video {media.info.id} has an unsupported type {media.info.content_type}"
            )
        try:
            data = base64.b64decode(media.data_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise BadRequestError(f"video {media.info.id} is not valid base64") from exc
        self._media_file(media.info).write_bytes(data)
        self._media.save(media.info)

    def import_bundle(self, bundle: Bundle, overwrite: bool = False) -> ImportReport:
        """Write a bundle into the stores, idempotent by id; differing local copies are kept unless overwrite is set."""
        if bundle.format_version > c.BUNDLE_FORMAT_VERSION:
            raise BundleVersionError(
                f"this file is format {bundle.format_version}; this Geppetto reads up to {c.BUNDLE_FORMAT_VERSION}"
            )
        report = ImportReport(warnings=list(bundle.warnings))
        for media in bundle.media:
            local = self._media.get(media.info.id)
            entry = ImportItem(kind="media", id=media.info.id)
            if local is not None and self._media_file(local).exists():
                if _same(local, media.info):
                    report.unchanged.append(entry)
                elif overwrite and media.data_base64 is not None:
                    self._put_media(media, report)
                    report.overwritten.append(entry)
                else:
                    entry.note = (
                        "a different video is already stored under this id; it was kept"
                    )
                    report.conflicts.append(entry)
            elif media.data_base64 is not None:
                self._put_media(media, report)
                report.created.append(entry)
            else:
                report.warnings.append(
                    f"video {media.info.id} was listed only; copy it into backend/data/media"
                )
        self._merge(
            "calibration",
            bundle.calibrations,
            self._calibrations.get,
            self._calibrations.save,
            overwrite,
            report,
        )
        self._merge(
            "wearer_calibration",
            bundle.wearer_calibrations,
            self._wearers.get,
            self._wearers.save,
            overwrite,
            report,
        )
        self._merge(
            "recording",
            bundle.recordings,
            self._recordings.get,
            self._recordings.save,
            overwrite,
            report,
        )
        self._merge(
            "lesson",
            bundle.lessons,
            self._lessons.get,
            self._lessons.save,
            overwrite,
            report,
        )
        self._merge(
            "draft",
            bundle.drafts,
            self._drafts.find,
            self._drafts.put_doc,
            overwrite,
            report,
        )
        report.lesson_ids = [lesson.id for lesson in bundle.lessons]
        return report

    # ------------------------------------------------------------------ backups

    def write_backup(self, lesson_id: str) -> Path | None:
        """Write the lesson's bundle to <data_dir>/exports/<name>-<time>.geppetto.json and keep the newest
        EXPORT_BACKUPS_KEEP of that name. Never raises: a failed backup must not fail a publish."""
        try:
            lesson = self._lessons.get(lesson_id)
            if lesson is None:
                return None
            self._exports.mkdir(parents=True, exist_ok=True)
            name = slug(lesson.title)
            stamp = datetime.now(UTC).strftime(_STAMP)
            path = self._exports / f"{name}-{stamp}{c.BUNDLE_FILE_SUFFIX}"
            tmp = path.with_suffix(".tmp")
            tmp.write_text(
                self.export_lessons([lesson]).model_dump_json(), encoding="utf-8"
            )
            tmp.replace(path)
            self._prune_backups(name)
            return path
        except Exception:
            log.exception("backup of lesson %s failed", lesson_id)
            return None

    def backups(self, name: str) -> list[Path]:
        """The backup files of one lesson name, oldest first."""
        pattern = re.compile(
            rf"^{re.escape(name)}-\d{{8}}T\d{{12}}{re.escape(c.BUNDLE_FILE_SUFFIX)}$"
        )
        return sorted(
            p
            for p in self._exports.glob(f"{name}-*{c.BUNDLE_FILE_SUFFIX}")
            if pattern.match(p.name)
        )

    def _prune_backups(self, name: str) -> None:
        """Delete the oldest backups of a name beyond EXPORT_BACKUPS_KEEP."""
        files = self.backups(name)
        for old in files[: max(0, len(files) - c.EXPORT_BACKUPS_KEEP)]:
            old.unlink(missing_ok=True)
