"""Builds the singleton services once, in the application lifespan."""

from dataclasses import dataclass

from app.core.config import Settings
from app.schemas.lesson import Lesson
from app.schemas.records import Calibration, Recording
from app.services.calibration import CalibrationService
from app.services.dev import DevService
from app.services.gloves.manager import GloveManager
from app.services.lessons import LessonService
from app.services.llm.coach import CoachService
from app.services.llm.lesson_generator import LessonGenerator
from app.services.llm.registry import LLMState
from app.services.moves import MoveCatalog
from app.services.recorder import Recorder
from app.services.scoring import ScoringService
from app.services.smoothing.one_euro import GloveSmoother
from app.services.storage.json_store import JsonStore
from app.services.storage.seed import install_seed_lessons
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
    gloves: GloveManager
    recorder: Recorder
    calibrations: CalibrationService
    scoring: ScoringService
    vision: MediaPipeHands
    dev: DevService


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
    return Services(
        settings=settings,
        moves=moves,
        lessons=LessonService(lesson_store),
        llm=llm,
        generator=LessonGenerator(llm, moves),
        coach=CoachService(llm),
        gloves=gloves,
        recorder=recorder,
        calibrations=CalibrationService(JsonStore(data / "calibrations", Calibration), gloves),
        scoring=ScoringService(recorder),
        vision=MediaPipeHands(),
        dev=DevService(gloves, llm),
    )
