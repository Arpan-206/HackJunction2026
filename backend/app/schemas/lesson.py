"""Lesson, step, move and test contract types."""

from typing import Literal

from pydantic import BaseModel, Field

from app import constants as c
from app.core.utils import new_id
from app.schemas.common import Prop, Side, Skill, Tolerance
from app.schemas.media import MediaRef
from app.schemas.motion import MotionSpec


class MoveKind(BaseModel):
    """A move the master can pick when starting from scratch."""

    id: str
    skill: Skill
    name: str
    description: str
    hands: Side | Literal["both"]
    prop: Prop
    default_motion: MotionSpec
    default_repetitions: int = c.DEFAULT_REPETITIONS


class Step(BaseModel):
    """One lesson step."""

    id: str = Field(default_factory=new_id)
    title: str
    instruction: str
    move_id: str | None = None
    hands: Side | Literal["both"] = "right"
    prop: Prop = "none"
    motion: MotionSpec | None = None
    reference_recording_id: str | None = None
    take_ids: list[str] = Field(
        default_factory=list,
        max_length=c.TAKES_MAX,
        description="The expert's takes the step's model was built from (POST /recordings/model); empty for one take.",
        json_schema_extra={c.LLM_SCHEMA_SKIP_KEY: True},
    )
    repetitions: int = Field(default=c.DEFAULT_REPETITIONS, ge=1)
    tolerance: Tolerance = Field(default_factory=Tolerance)
    video_url: str | None = Field(
        default=None,
        description="Older single video link; read as a tutorial video synced at 0 s when tutorial_video is absent.",
    )
    tutorial_video: MediaRef | None = Field(
        default=None,
        description="The expert talking the step through (POST /media), with the second at which the reference "
        "take starts; the learner's Tutorial plays the reference hand in sync with it.",
        json_schema_extra={c.LLM_SCHEMA_SKIP_KEY: True},
    )


class TestSpec(BaseModel):
    """The "Test your skills" finale."""

    __test__ = False

    kind: Literal["table_tennis_rally", "piano_play_along", "air_typing"]
    opponent: Literal["bot", "two_player"] = "bot"
    rounds: int = Field(default=3, ge=1)


class LessonBase(BaseModel):
    """A lesson without server-assigned fields; the POST body and the LLM output shape."""

    title: str
    skill: Skill
    summary: str = ""
    master_name: str = c.DEFAULT_MASTER_NAME
    source: Literal["scratch", "generated", "seed"] = "scratch"
    steps: list[Step] = Field(min_length=1)
    test: TestSpec | None = None


class Lesson(LessonBase):
    """A stored lesson."""

    id: str
    created_at: str
