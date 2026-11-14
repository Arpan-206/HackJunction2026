"""Coaching lines. Tonight: rule lines only, behind an interface a model client can implement later.

No network calls live in this module or anywhere else in the core.
"""

from __future__ import annotations

import itertools
import logging
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import Protocol

log = logging.getLogger("geppetto.coach")

RULE_LINES = {
    "too_flat": "Curl your {finger} finger more.",
    "too_curled": "Straighten your {finger} finger a little.",
    "too_spread": "Bring your {finger} finger in.",
    "too_closed": "Spread your {finger} finger out.",
    "early": "Slow down, you are ahead of the hand.",
    "late": "A little faster.",
    "passed": "Good. Next step.",
}

TASK_KEYWORDS = {
    "typing": ["typing", "touch typing", "touch-type", "type"],
    "chords": ["chord", "guitar", "ukulele", "fret"],
    "piano": ["piano", "keyboard", "scale", "keys"],
    "boxing": ["box", "punch", "jab", "hook", "uppercut"],
    "general": ["general", "shape", "pose", "grip"],
}


@dataclass
class CoachLine:
    kind: str  # tip | praise | question | status
    text: str
    focus: str | None = None
    step: int | None = None
    speak: bool = True
    source: str = "rule"
    options: list[str] | None = None
    hand: str | None = None
    id: str = ""

    def to_message(self) -> dict:
        msg = {
            "id": self.id,
            "kind": self.kind,
            "text": self.text[:120],
            "focus": self.focus,
            "step": self.step,
            "speak": bool(self.speak),
            "source": self.source,
            "hand": self.hand,
        }
        if self.kind == "question":
            msg["options"] = list(self.options or ["Yes", "No"])[:3]
        return msg


class CoachClient(Protocol):
    """What a model-backed coach must provide. Return None to fall back to rules."""

    def tip(self, summary: dict) -> CoachLine | None: ...
    def name_steps(
        self, lesson_json: dict, digests: list[dict]
    ) -> list[dict] | None: ...
    def configure(self, text: str, task_names: list[str]) -> dict | None: ...
    def phrase_question(self, context: dict) -> CoachLine | None: ...


class RuleCoach:
    """The SPEC rule table. Deterministic, instant, offline."""

    def __init__(self, timing_hint_ms: float = 150.0, speak: bool = True) -> None:
        self.timing_hint_ms = float(timing_hint_ms)
        self.speak = bool(speak)

    def tip(self, summary: dict) -> CoachLine | None:
        step = summary.get("step", {}).get("index")
        hand = summary.get("hand")
        if summary.get("passed"):
            return CoachLine(
                "praise",
                RULE_LINES["passed"],
                None,
                step,
                self.speak,
                "rule",
                hand=hand,
            )
        timing = summary.get("timing_ms")
        if timing is not None and abs(timing) >= self.timing_hint_ms:
            key = "early" if timing < 0 else "late"
            return CoachLine(
                "tip", RULE_LINES[key], None, step, self.speak, "rule", hand=hand
            )
        # Optional prior facts (core/priors/facts.py, PRIORS_ASL / PRIORS_PIANO,
        # off by default): the first one leads the rule line.
        facts = (summary.get("priors") or {}).get("facts") or []
        lead = (facts[0][:1].upper() + facts[0][1:] + ". ") if facts else ""
        fingers = summary.get("fingers") or {}
        if not fingers:
            if lead:
                return CoachLine(
                    "tip", lead.strip(), None, step, self.speak, "rule", hand=hand
                )
            return None
        worst = min(fingers.items(), key=lambda kv: kv[1].get("score", 1.0))
        finger, info = worst
        hint = info.get("hint")
        if hint not in RULE_LINES:
            return None
        return CoachLine(
            "tip",
            lead + RULE_LINES[hint].format(finger=finger),
            finger,
            step,
            self.speak,
            "rule",
            hand=hand,
        )

    def name_steps(self, lesson_json: dict, digests: list[dict]) -> list[dict] | None:
        return None  # keeps the recorder's "auto" names

    def configure(self, text: str, task_names: list[str]) -> dict | None:
        low = text.lower()
        for task, words in TASK_KEYWORDS.items():
            if task in task_names and any(w in low for w in words):
                return {"task": task, "config": {}}
        return None

    def phrase_question(self, context: dict) -> CoachLine | None:
        return CoachLine(
            "question",
            "You did this two ways. Which one should I teach?",
            None,
            context.get("step"),
            self.speak,
            "rule",
            options=["The first", "The second"],
        )


class Coach:
    """Rate-limits and numbers lines from a CoachClient, falling back to rules."""

    def __init__(
        self, client: CoachClient | None, coach_cfg, timing_hint_ms: float
    ) -> None:
        self.rules = RuleCoach(timing_hint_ms, coach_cfg.speak)
        self.client = client or self.rules
        self.min_interval_us = int(float(coach_cfg.min_interval_s) * 1e6)
        self.text_max = int(coach_cfg.text_max_chars)
        self._ids = itertools.count(1)
        self._last_tip_us: dict[str, int] = {}
        self.pending: dict[str, dict] = {}
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="coach")
        self.inflight: dict[str, Future] = {}
        self._inflight_summary: dict[str, dict] = {}

    def _stamp(self, line: CoachLine) -> CoachLine:
        line.id = f"k-{next(self._ids)}"
        line.text = line.text[: self.text_max]
        return line

    def on_summary(
        self, t_us: int, summary: dict, force: bool = False
    ) -> CoachLine | None:
        """One tip per learner at most every min_interval_s. A newer summary replaces a queued one.

        Rule lines come back at once. A model client runs in a worker thread and its
        line is collected by poll() on a later tick, so a slow call never stalls the
        frame loop. While a call is in flight for a hand, newer summaries queue.
        """
        hand = summary.get("hand") or "any"
        last = self._last_tip_us.get(hand)
        if not force and last is not None and t_us - last < self.min_interval_us:
            self.pending[hand] = summary
            return None
        if hand in self.inflight and not self.inflight[hand].done():
            self.pending[hand] = summary
            return None
        if self.client is self.rules:
            line = self.rules.tip(summary)
            if line is None:
                return None
            self._last_tip_us[hand] = int(t_us)
            self.pending.pop(hand, None)
            return self._stamp(line)
        self._last_tip_us[hand] = int(t_us)
        self.pending.pop(hand, None)
        self.inflight[hand] = self._pool.submit(self.client.tip, summary)
        self._inflight_summary[hand] = summary
        return None

    def poll(self, t_us: int) -> list[CoachLine]:
        """Lines from model calls that finished since the last tick; the rule line when a call failed."""
        out: list[CoachLine] = []
        for hand, fut in list(self.inflight.items()):
            if not fut.done():
                continue
            summary = self._inflight_summary.pop(hand, {})
            del self.inflight[hand]
            try:
                line = fut.result()
            except Exception as e:
                log.warning("coach model call failed, using the rule line: %s", e)
                line = None
            if line is None:
                line = self.rules.tip(summary)
            if line is not None:
                out.append(self._stamp(line))
        return out

    def flush_pending(self, t_us: int) -> list[CoachLine]:
        out = self.poll(t_us)
        for hand, summary in list(self.pending.items()):
            line = self.on_summary(t_us, summary)
            if line is not None:
                out.append(line)
        return out

    def status(
        self, text: str, step: int | None = None, speak: bool = False
    ) -> CoachLine:
        return self._stamp(CoachLine("status", text, None, step, speak, "rule"))

    def praise(self, step: int | None, hand: str | None) -> CoachLine:
        return self._stamp(
            CoachLine(
                "praise",
                RULE_LINES["passed"],
                None,
                step,
                self.rules.speak,
                "rule",
                hand=hand,
            )
        )
