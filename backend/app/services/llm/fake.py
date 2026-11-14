"""Deterministic offline provider: lesson templates for table tennis, piano and a general fallback."""

import json
import re

from app import constants as c
from app.core.utils import new_id
from app.schemas.api import (
    CoachHintRequest,
    CoachPlanDraft,
    CoachPlanRequest,
    CoachReviewRequest,
    Drill,
    MotionDraft,
)
from app.schemas.common import FingerValues, Skill
from app.schemas.lesson import LessonBase, Step
from app.schemas.motion import FingerSequence, GripAndSwing, HoldPose, Idle, Pinch
from app.services import hints
from app.services.llm.base import LLMRequest
from app.services.moves import MoveCatalog
from app.services.storage.seed import load_seed_lessons

_KEYWORDS: dict[Skill, re.Pattern[str]] = {
    "piano": re.compile(r"piano|keyboard|keys|scale|chord|melody", re.IGNORECASE),
    "table_tennis": re.compile(
        r"table tennis|ping|pong|racket|paddle|forehand|backhand|shakehand|penhold",
        re.IGNORECASE,
    ),
}
_SEED_BY_SKILL: dict[Skill, str] = {
    "table_tennis": "seed-table-tennis",
    "piano": "seed-piano",
}
_GENERAL_MOVES = ("general_pinch", "general_power_grip", "general_point")


def detect_skill(text: str, hint: Skill | None) -> Skill:
    """Pick a skill from an explicit hint or by keywords in the request."""
    if hint is not None:
        return hint
    for skill, pattern in _KEYWORDS.items():
        if pattern.search(text):
            return skill
    return "general"


def template_lesson(text: str, hint: Skill | None = None) -> LessonBase:
    """Build the deterministic template lesson for a request."""
    skill = detect_skill(text, hint)
    seed_id = _SEED_BY_SKILL.get(skill)
    if seed_id is not None:
        seed = next(lesson for lesson in load_seed_lessons() if lesson.id == seed_id)
        base = LessonBase.model_validate(seed.model_dump(exclude={"id", "created_at"}))
        return base.model_copy(
            update={
                "source": "generated",
                "steps": [s.model_copy(update={"id": new_id()}) for s in base.steps],
            }
        )
    catalog = MoveCatalog()
    steps = []
    for number, move_id in enumerate(_GENERAL_MOVES, start=1):
        move = catalog.get(move_id)
        assert move is not None
        steps.append(
            Step(
                title=f"Lesson {number}: {move.name}",
                instruction=move.description,
                move_id=move.id,
                hands=move.hands,
                prop=move.prop,
                motion=move.default_motion,
                repetitions=move.default_repetitions,
            )
        )
    topic = " ".join(text.split())[:48] or "hand skill"
    return LessonBase(
        title=f"Hand skill: {topic}",
        skill="general",
        summary="A short general hand-control warm-up.",
        source="generated",
        steps=steps,
    )


_MOTION_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"pinch", re.IGNORECASE), "pinch"),
    (
        re.compile(r"grip|forehand|backhand|penhold|shakehand|swing", re.IGNORECASE),
        "grip_and_swing",
    ),
    (re.compile(r"scale|sequence|piano", re.IGNORECASE), "finger_sequence"),
    (re.compile(r"fist|hold", re.IGNORECASE), "hold_pose"),
)
_SLOWER = re.compile(r"\bslow(?:er|ly)?\b", re.IGNORECASE)


def template_motion(text: str) -> MotionDraft:
    """Pick a motion preset from keywords; 'slow' doubles the beat length within bounds."""
    preset = next(
        (name for pattern, name in _MOTION_RULES if pattern.search(text)), "idle"
    )
    lowered = text.lower()
    if preset == "pinch":
        motion = Pinch(fingers=[3] if "middle" in lowered else [2])
    elif preset == "grip_and_swing":
        motion = GripAndSwing(
            grip="penhold" if "penhold" in lowered else "shakehand",
            swing="backhand" if "backhand" in lowered else "forehand",
        )
    elif preset == "finger_sequence":
        motion = FingerSequence(sequence=list(c.MOTION_SCALE_SEQUENCE))
    elif preset == "hold_pose":
        motion = HoldPose(pose=FingerValues.from_list(list(c.MOTION_FIST_POSE)))
    else:
        motion = Idle()
    beat = getattr(motion, "beat_ms", None)
    if beat is not None and _SLOWER.search(text):
        motion = motion.model_copy(
            update={"beat_ms": min(beat * c.MOTION_SLOWER_FACTOR, c.MOTION_MAX_BEAT_MS)}
        )
    return MotionDraft(
        motion=motion,
        explanation=f"Chose the {preset.replace('_', ' ')} preset for your request.",
    )


def template_plan(request: CoachPlanRequest) -> CoachPlanDraft:
    """Derive drills from the weakest finger of the weakest steps, deterministically."""
    titles = {s.step_id: s.title for s in request.steps}
    by_step: dict[str, list[FingerValues]] = {}
    overall: dict[str, list[float]] = {}
    for attempt in request.attempts:
        by_step.setdefault(attempt.step_id, []).append(attempt.score.per_finger)
        overall.setdefault(attempt.step_id, []).append(attempt.score.overall)
    ranked = sorted(
        by_step, key=lambda sid: (sum(overall[sid]) / len(overall[sid]), sid)
    )
    drills: list[Drill] = []
    weak: list[str] = []
    for step_id in ranked[: c.PLAN_MAX_DRILLS]:
        means = [
            sum(v.as_list()[i] for v in by_step[step_id]) / len(by_step[step_id])
            for i in range(len(c.FINGERS))
        ]
        finger = c.FINGERS[means.index(min(means))]
        title = titles.get(step_id, step_id)
        drills.append(
            Drill(
                step_id=step_id,
                focus_finger=finger,  # type: ignore[arg-type]
                exercise=f"Repeat '{title}' slowly five times, keeping your {finger} finger relaxed and in line with the guide hand.",
            )
        )
        weak.append(f"{finger} in '{title}'")
    if not drills:
        first = request.steps[0] if request.steps else None
        drills.append(
            Drill(
                step_id=first.step_id if first else "",
                focus_finger=None,
                exercise=f"Run through '{first.title if first else request.lesson_title}' once, slowly, to set a baseline.",
            )
        )
        return CoachPlanDraft(
            summary=f"You have not scored an attempt in {request.lesson_title} yet. Start with one slow pass to set a baseline.",
            drills=drills,
            master_note="No attempts recorded yet, so there is nothing to report.",
        )
    summary = f"Good effort on {request.lesson_title}. Your biggest gain is in the {weak[0]}. Slow down and practise the drills below."
    return CoachPlanDraft(
        summary=summary,
        drills=drills,
        master_note=f"This learner struggles most with: {'; '.join(weak)}.",
    )


class FakeLLM:
    """Offline provider with no network access; output depends only on the request."""

    name = "fake"

    async def generate_json(self, request: LLMRequest) -> str:
        """Return the template lesson, plan or motion for the request as JSON."""
        if request.task == "hint":
            return hints.build_hint_draft(
                CoachHintRequest.model_validate_json(request.user_text)
            ).model_dump_json()
        if request.task == "review":
            from app.services.llm.review import build_review  # local: review imports the chain

            return build_review(
                CoachReviewRequest.model_validate_json(request.user_text)
            ).model_dump_json()
        if request.task == "plan":
            return template_plan(
                CoachPlanRequest.model_validate(json.loads(request.user_text))
            ).model_dump_json()
        if request.task == "motion":
            return template_motion(request.user_text).model_dump_json()
        return template_lesson(request.user_text, request.skill).model_dump_json()

    async def generate_text(self, request: LLMRequest) -> str:
        """Return the supplied draft text unchanged, so coaching stays algorithmic offline."""
        return request.user_text
