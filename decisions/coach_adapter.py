"""DecisionsCoach: the core's ``CoachClient`` backed by the Decisions API, rules when offline.

The core builds its coach in ``core/server.py`` with ``Coach(None, cfg.coach, cfg.score.timing_hint_ms)``.
Register this adapter instead (two lines, see STATUS-decisions.md):

    from decisions.coach_adapter import DecisionsCoach
    self.coach = Coach(DecisionsCoach.from_env(cfg), cfg.coach, cfg.score.timing_hint_ms)

``tip`` calls ``pick_action`` and turns the chosen action into one coach line.
The text always comes from a fixed table (no free text from any model), so the
line stays under 120 characters and names no provider. ``source`` is ``"gemma"``
when a model chose the line and ``"rule"`` otherwise: the frozen coach schema
allows only those two values, and "gemma" there means "a model".

This module imports ``core.coach`` read-only. It never edits the core.
"""

from __future__ import annotations

from typing import Any

from core.coach import RULE_LINES, CoachLine, RuleCoach

from . import config as C
from .client import DecisionsClient, choice_answer
from .judgements import ActionDecision, finger_rubric, get_client, pick_action
from .rules import worst_finger

ACTION_LINES = {
    "repeat": "Once more, same shape.",
    "slow_down": "Slow down, you are ahead of the hand.",
    "isolate_finger": "Just the {finger} finger now. Keep the others still.",
    "show_keyframe": "Look at the key pose in the margin, then try again.",
    "move_on": RULE_LINES["passed"],
}

# Closed set of names for auto-cut steps (name_steps). Keys are the names a learner reads.
SHAPE_NAMES = {
    "Open hand": "All fingers straight and relaxed.",
    "Fist": "All fingers curled into the palm.",
    "Pinch": "Thumb tip touches the index tip, other fingers loose.",
    "Point": "Index straight, the other fingers curled.",
    "Thumbs up": "Thumb straight, the other fingers curled.",
    "OK sign": "Thumb and index make a ring, other fingers straight.",
    "Two fingers": "Index and middle straight, the others curled.",
    "Half curl": "All fingers half bent, as if holding a glass.",
    "Spread hand": "Fingers straight and spread wide apart.",
    "Flat hand": "Fingers straight and held together.",
}

TASK_DESCRIPTIONS = {
    "general": "Hand shapes and grips with no instrument: poses, pinches, gestures.",
    "piano": "Piano or keyboard playing: keys, scales, notes.",
    "chords": "Guitar or ukulele chords and fretting.",
    "boxing": "Punches: jab, hook, uppercut, guard.",
}


class DecisionsCoach:
    """Implements core.coach.CoachClient. Every method returns None to let the rules take over."""

    def __init__(
        self,
        client: DecisionsClient | None = None,
        *,
        timing_hint_ms: float = 150.0,
        speak: bool = True,
    ) -> None:
        self.client = client or get_client()
        self.rules = RuleCoach(timing_hint_ms, speak)
        self.speak = bool(speak)
        self.last: dict[str, ActionDecision] = {}

    @classmethod
    def from_env(
        cls, cfg: Any = None, client: DecisionsClient | None = None
    ) -> DecisionsCoach:
        """Build from the core's config Section (timing and speak) and the environment (key, budget)."""
        timing = float(cfg.score.timing_hint_ms) if cfg is not None else 150.0
        speak = bool(cfg.coach.speak) if cfg is not None else True
        return cls(client, timing_hint_ms=timing, speak=speak)

    def describe(self) -> dict:
        return {"coach": "decisions", **self.client.describe()}

    # ------------------------------------------------------------------ CoachClient
    def tip(self, summary: dict) -> CoachLine | None:
        d = pick_action(summary, client=self.client)
        hand = summary.get("hand")
        step = (summary.get("step") or {}).get("index")
        self.last[hand or "any"] = d
        source = "gemma" if d.source == "model" else "rule"
        if d.action == "move_on":
            return CoachLine(
                "praise",
                ACTION_LINES["move_on"],
                None,
                step,
                self.speak,
                source,
                hand=hand,
            )
        if d.action == "isolate_finger":
            finger = d.focus
            if finger not in C.FINGERS:
                w = worst_finger(summary.get("fingers") or {})
                finger = w[0] if w else "index"
            return CoachLine(
                "tip",
                ACTION_LINES["isolate_finger"].format(finger=finger),
                finger,
                step,
                self.speak,
                source,
                hand=hand,
            )
        if d.action in ("slow_down", "show_keyframe"):
            return CoachLine(
                "tip", ACTION_LINES[d.action], None, step, self.speak, source, hand=hand
            )
        # repeat: the concrete finger correction from the rule table when there is one
        line = self.rules.tip(summary)
        if line is None:
            return CoachLine(
                "tip",
                ACTION_LINES["repeat"],
                d.focus if d.focus in C.FINGERS else None,
                step,
                self.speak,
                source,
                hand=hand,
            )
        line.source = source
        return line

    def name_steps(self, lesson_json: dict, digests: list[dict]) -> list[dict] | None:
        """Closed-set names for auto-cut steps: one request, one choice question per step.

        Returns ``[{"index", "name", "named_by": "gemma"}]`` for the steps the model was sure about,
        or None to keep the recorder's names.
        """
        if not digests:
            return None
        lines = [
            f'Lesson "{lesson_json.get("title", "")}", task {lesson_json.get("task", "general")}, '
            f"{len(digests)} steps recorded with a motion glove."
        ]
        for d in digests:
            lines.append(
                f"Step {int(d.get('index', 0)) + 1}: {d.get('kind', 'hold')} step, "
                f"{int(d.get('duration_ms', 0))} ms, pose: {d.get('pose', '')}."
            )
        questions = {
            f"step_{int(d.get('index', 0))}": {
                "type": "choice",
                "instructions": f"Which name fits the hand shape of step {int(d.get('index', 0)) + 1}?",
                "criteria": SHAPE_NAMES,
            }
            for d in digests
        }
        res = self.client.decide(
            "name_steps", [{"type": "text", "text": "\n".join(lines)}], questions
        )
        out: list[dict] = []
        if res.ok:
            names = tuple(SHAPE_NAMES)
            for d in digests:
                parsed = choice_answer(
                    res.answers.get(f"step_{int(d.get('index', 0))}", {}), names
                )
                if parsed is not None and parsed[1] >= 0.4:
                    out.append(
                        {
                            "index": int(d.get("index", 0)),
                            "name": parsed[0],
                            "named_by": "gemma",
                        }
                    )
        self.client.log.write(
            {
                **res.record(),
                "model": self.client.model,
                "budget_ms": self.client.budget_ms,
                "source": "model" if out else "rule",
                "result": {"named": len(out), "of": len(digests)},
            }
        )
        return out or None

    def configure(self, text: str, task_names: list[str]) -> dict | None:
        """Pick the task a spoken or typed request means, from the core's task list. Keywords when offline."""
        options = {t: TASK_DESCRIPTIONS.get(t, f"The {t} task.") for t in task_names}
        options["none"] = "None of these tasks."
        res = None
        if len(options) >= 2 and text.strip():
            q = {
                "task": {
                    "type": "choice",
                    "instructions": "Which practice task does this request ask for?",
                    "criteria": options,
                }
            }
            res = self.client.decide("configure", [{"type": "text", "text": text}], q)
            if res.ok:
                parsed = choice_answer(res.answers.get("task", {}), tuple(options))
                if parsed is not None and parsed[0] != "none" and parsed[1] >= 0.5:
                    self.client.log.write(
                        {
                            **res.record(),
                            "model": self.client.model,
                            "source": "model",
                            "result": {"task": parsed[0]},
                        }
                    )
                    return {"task": parsed[0], "config": {}}
        picked = self.rules.configure(text, task_names)
        if res is not None:
            self.client.log.write(
                {
                    **res.record(),
                    "model": self.client.model,
                    "source": "rule",
                    "result": {"task": (picked or {}).get("task")},
                }
            )
        return picked

    def phrase_question(self, context: dict) -> CoachLine | None:
        return self.rules.phrase_question(context)

    # ------------------------------------------------------------------ extra, for the session
    def rubric(
        self, step_json: dict, lesson_json: dict | None = None
    ) -> dict[str, float]:
        """Per-finger weights for one lesson step (``Step.to_json()``), for the scorer."""
        return finger_rubric(
            step_json, step_json, lesson=lesson_json, client=self.client
        ).weights
