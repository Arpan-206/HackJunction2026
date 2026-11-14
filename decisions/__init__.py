"""Fast closed-set judgements for practice, on the Gemini Decisions API with rule fallbacks.

Three functions, each with a hard time budget (600 ms by default) and a
rule-based answer when the model is slow, offline or not configured:

* ``pick_action(step_summary)``: the tutor's next action from a fixed list.
* ``check_outcome(image, question)``: a yes/no check on a camera frame.
* ``finger_rubric(keyframe, step)``: how much each of the five fingers matters.

Every call is appended to ``logs/decisions.jsonl`` with its latency.
``decisions.coach_adapter.DecisionsCoach`` plugs these into the core's
``CoachClient`` interface. Nothing here edits ``core/``.
"""
from .config import ACTIONS, FINGERS, MODEL
from .judgements import (
    ActionDecision,
    FingerRubric,
    OutcomeDecision,
    check_outcome,
    finger_rubric,
    get_client,
    pick_action,
    set_client,
)

__all__ = [
    "ACTIONS",
    "FINGERS",
    "MODEL",
    "ActionDecision",
    "FingerRubric",
    "OutcomeDecision",
    "check_outcome",
    "finger_rubric",
    "pick_action",
    "get_client",
    "set_client",
]
