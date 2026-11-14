"""Builds the singleton services once, in the application lifespan."""

import logging
from dataclasses import dataclass

from app import constants as c
from app.core.config import Settings
from app.core.errors import NotFoundError
from app.schemas.lesson import Lesson
from app.schemas.persist import DraftDoc
from app.schemas.records import Calibration, Recording
from app.schemas.rig import WearerCalibration
from app.services.bundles import BundleService
from app.services.calibration import CalibrationService
from app.services.core_export import CoreLessonExporter
from app.services.dev import DevService
from app.services.drafts import DraftService
from app.services.files import FileLocator
from app.services.gloves.manager import GloveManager
from app.services.lessons import LessonService
from app.services.llm.coach import CoachService
from app.services.llm.lesson_generator import LessonGenerator
from app.services.llm.motion_text import MotionTextService
from app.services.llm.plan import PlanService
from app.services.llm.registry import LLMState
from app.services.media import MediaService
from app.services.moves import MoveCatalog
from app.services.recorder import Recorder
from app.services.rig.calibration import WearerCalibrationService
from app.services.rig.service import GloveRigService
from app.services.scoring import ScoringService
from app.services.smoothing.one_euro import GloveSmoother
from app.services.storage.json_store import JsonStore
from app.services.storage.seed import install_seed_lessons
from app.services.takes import TakesService
from app.services.vision.mediapipe_hands import MediaPipeHands


@dataclass
class Services:
    """Every long-lived service, held on app.state."""

    settings: Settings
    moves: MoveCatalog
    lessons: LessonService
    llm: LLMState
    generator: LessonGenerator
    coach: CoachService
    planner: PlanService
    motion_text: MotionTextService
    gloves: GloveManager
    recorder: Recorder
    media: MediaService
    calibrations: CalibrationService
    scoring: ScoringService
    takes: TakesService
    vision: MediaPipeHands
    dev: DevService
    rig: GloveRigService
    wearer_calibrations: WearerCalibrationService
    # Expert training persistence: the scratch draft on disk and file bundles.
    drafts: DraftService
    bundles: BundleService
    # Dev aid: stored files by kind and id, for "Open file location".
    files: FileLocator
    # Every take and lesson also as a local core lesson folder (services/core_export.py).
    core_export: CoreLessonExporter


log = logging.getLogger(__name__)


def _log_saved_calibrations(calibrations: CalibrationService) -> None:
    """Say at start-up which saved calibration each hand uses: they are read from disk, so none is ever lost."""
    for side in c.SIDES:
        try:
            cal = calibrations.latest(side)
        except NotFoundError:
            log.info("No saved %s hand calibration yet", side)
            continue
        except Exception:
            log.warning(
                "Saved %s hand calibrations could not be read", side, exc_info=True
            )
            continue
        log.info(
            "Using the saved %s hand calibration %s from %s",
            side,
            cal.id,
            cal.created_at,
        )


def build_services(settings: Settings) -> Services:
    """Wire all services together from the settings."""
    data = settings.data_dir
    lesson_store = JsonStore(data / "lessons", Lesson)
    install_seed_lessons(lesson_store)
    moves = MoveCatalog()
    llm = LLMState(settings)
    gloves = GloveManager(settings, GloveSmoother())
    recorder = Recorder(JsonStore(data / "recordings", Recording))
    gloves.add_sink(recorder.push)
    calibrations = CalibrationService(
        JsonStore(data / "calibrations", Calibration), gloves
    )
    rig = GloveRigService(settings, gloves)
    _log_saved_calibrations(calibrations)
    drafts = DraftService(JsonStore(data / c.DRAFTS_DIR_NAME, DraftDoc))
    lessons = LessonService(lesson_store)
    media = MediaService(data / c.MEDIA_DIR_NAME)
    bundles = BundleService(data, TakesService(recorder), drafts)
    core_export = CoreLessonExporter(
        data, settings.core_export_dir, settings.core_export
    )
    recorder.on_change.append(core_export.notify)
    lessons.on_change.append(core_export.notify)
    return Services(
        settings=settings,
        moves=moves,
        lessons=lessons,
        llm=llm,
        generator=LessonGenerator(llm, moves),
        coach=CoachService(llm),
        planner=PlanService(llm),
        motion_text=MotionTextService(llm),
        gloves=gloves,
        recorder=recorder,
        media=media,
        calibrations=calibrations,
        scoring=ScoringService(recorder, calibrations),
        takes=TakesService(recorder),
        vision=MediaPipeHands(),
        dev=DevService(gloves, llm),
        rig=rig,
        wearer_calibrations=WearerCalibrationService(
            JsonStore(data / "glove_calibrations", WearerCalibration),
            gloves,
            rig,
            calibrations,
        ),
        drafts=drafts,
        bundles=bundles,
        files=FileLocator(data, media, lessons, bundles),
        core_export=core_export,
    )
