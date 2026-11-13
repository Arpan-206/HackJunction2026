"""FastAPI dependencies that expose the singleton services held on app.state."""

from typing import Annotated

from fastapi import Depends, Request

from app.services.calibration import CalibrationService
from app.services.container import Services
from app.services.dev import DevService
from app.services.gloves.manager import GloveManager
from app.services.lessons import LessonService
from app.services.llm.coach import CoachService
from app.services.llm.lesson_generator import LessonGenerator
from app.services.llm.registry import LLMState
from app.services.moves import MoveCatalog
from app.services.recorder import Recorder
from app.services.scoring import ScoringService
from app.services.vision.mediapipe_hands import MediaPipeHands


def get_services(request: Request) -> Services:
    """Return the service container for the running app."""
    return request.app.state.services


ServicesDep = Annotated[Services, Depends(get_services)]


def _moves(s: ServicesDep) -> MoveCatalog:
    """Return the move catalogue."""
    return s.moves


def _lessons(s: ServicesDep) -> LessonService:
    """Return the lesson service."""
    return s.lessons


def _generator(s: ServicesDep) -> LessonGenerator:
    """Return the lesson generator."""
    return s.generator


def _calibrations(s: ServicesDep) -> CalibrationService:
    """Return the calibration service."""
    return s.calibrations


def _recorder(s: ServicesDep) -> Recorder:
    """Return the recorder."""
    return s.recorder


def _scoring(s: ServicesDep) -> ScoringService:
    """Return the scoring service."""
    return s.scoring


def _coach(s: ServicesDep) -> CoachService:
    """Return the coach service."""
    return s.coach


def _vision(s: ServicesDep) -> MediaPipeHands:
    """Return the vision service."""
    return s.vision


def _dev(s: ServicesDep) -> DevService:
    """Return the dev service."""
    return s.dev


def _gloves(s: ServicesDep) -> GloveManager:
    """Return the glove manager."""
    return s.gloves


def _llm(s: ServicesDep) -> LLMState:
    """Return the LLM state."""
    return s.llm


MovesDep = Annotated[MoveCatalog, Depends(_moves)]
LessonsDep = Annotated[LessonService, Depends(_lessons)]
GeneratorDep = Annotated[LessonGenerator, Depends(_generator)]
CalibrationsDep = Annotated[CalibrationService, Depends(_calibrations)]
RecorderDep = Annotated[Recorder, Depends(_recorder)]
ScoringDep = Annotated[ScoringService, Depends(_scoring)]
CoachDep = Annotated[CoachService, Depends(_coach)]
VisionDep = Annotated[MediaPipeHands, Depends(_vision)]
DevDep = Annotated[DevService, Depends(_dev)]
GlovesDep = Annotated[GloveManager, Depends(_gloves)]
LLMDep = Annotated[LLMState, Depends(_llm)]
