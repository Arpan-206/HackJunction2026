"""DecisionsCoach inside the core's Coach: every line validates against schema/coach.json."""

from __future__ import annotations

from pathlib import Path

import pytest
from conftest import ROOT, canned_transport, choice_body, read_log
from test_judgements import action_body

from core.coach import Coach, CoachClient, CoachLine
from core.config import load_config
from core.schema import SchemaRegistry
from decisions import config as C
from decisions.client import DecisionsClient
from decisions.coach_adapter import ACTION_LINES, SHAPE_NAMES, DecisionsCoach
from decisions.log import JsonlLog

EM_DASH = chr(
    0x2014
)  # banned everywhere in this repo (CLAUDE.md rule 4), so built from its code point


@pytest.fixture(scope="module")
def cfg():
    return load_config(ROOT / "config.toml")


@pytest.fixture(scope="module")
def schemas():
    return SchemaRegistry(ROOT / "schema")


def envelope(line: CoachLine, t_us: int = 1_000_000) -> dict:
    return {"v": 1, "type": "coach", "t": t_us, **line.to_message()}


def offline_coach(log_file: Path, cfg) -> DecisionsCoach:
    return DecisionsCoach.from_env(
        cfg, client=DecisionsClient(api_key=None, enabled=False, log=JsonlLog(log_file))
    )


def model_coach(make_client, body, cfg) -> tuple[DecisionsCoach, list]:
    seen: list = []
    return DecisionsCoach.from_env(
        cfg, client=make_client(canned_transport(body, seen=seen))
    ), seen


# ---------------------------------------------------------------------- protocol
def test_is_a_coach_client(log_file, cfg):
    dc = offline_coach(log_file, cfg)
    for name in ("tip", "name_steps", "configure", "phrase_question"):
        assert callable(getattr(dc, name)), name
        assert (
            name in CoachClient.__protocol_attrs__
            if hasattr(CoachClient, "__protocol_attrs__")
            else True
        )
    assert dc.describe()["coach"] == "decisions" and dc.describe()["enabled"] is False
    assert dc.rules.timing_hint_ms == float(
        cfg.score.timing_hint_ms
    ) and dc.speak == bool(cfg.coach.speak)


# ---------------------------------------------------------------------- offline, inside the core's Coach
def _drain(coach, t_us, wait_s: float = 2.0):
    """The core's Coach runs a model client off the tick; collect its line like the session does on later ticks."""
    import time

    end = time.monotonic() + wait_s
    while time.monotonic() < end:
        lines = coach.poll(t_us)
        if lines:
            return lines[0]
        time.sleep(0.005)
    return None


def test_offline_lines_validate_for_every_recorded_summary(
    log_file, cfg, schemas, summaries
):
    dc = offline_coach(log_file, cfg)
    coach = Coach(dc, cfg.coach, cfg.score.timing_hint_ms)
    produced = 0
    for i, s in enumerate(summaries):
        line = coach.on_summary(1_000_000 * (i + 1), s, force=True) or _drain(
            coach, 1_000_000 * (i + 1)
        )
        if line is None:
            continue
        produced += 1
        msg = envelope(line, 1_000_000 * (i + 1))
        schemas.validate("coach", msg)
        assert (
            msg["source"] == "rule"
            and len(msg["text"]) <= 120
            and EM_DASH not in msg["text"]
        )
        assert msg["kind"] in ("tip", "praise")
        assert msg["hand"] == s["hand"] and msg["step"] == s["step"]["index"]
    assert (
        produced >= len(summaries) - 1
    )  # a summary with no finger below the mark and not passed gives no line
    passed = next(s for s in summaries if s["passed"])
    assert (
        coach.on_summary(99_000_000, passed, force=True) or _drain(coach, 99_000_000)
    ).kind == "praise"
    assert len(read_log(log_file)) == len(summaries) + 1


def test_offline_isolates_the_lone_finger(log_file, cfg, summaries):
    dc = offline_coach(log_file, cfg)
    line = dc.tip(summaries[17])  # ring alone, 47.7 degrees too flat
    assert (
        line.kind == "tip"
        and line.focus == "ring"
        and "ring" in line.text
        and line.source == "rule"
    )
    assert dc.last["left"].action == "isolate_finger"


# ---------------------------------------------------------------------- model-backed lines
@pytest.mark.parametrize(
    "action,kind,expect",
    [
        ("move_on", "praise", "Good. Next step."),
        ("slow_down", "tip", ACTION_LINES["slow_down"]),
        ("show_keyframe", "tip", ACTION_LINES["show_keyframe"]),
    ],
)
def test_model_action_lines(make_client, cfg, schemas, summaries, action, kind, expect):
    dc, _ = model_coach(make_client, action_body(action, 0.9), cfg)
    line = dc.tip(summaries[4])
    assert (
        line.kind == kind
        and line.text == expect
        and line.source == "gemma"
        and line.focus is None
    )
    schemas.validate("coach", envelope(line))


def test_model_isolate_finger_uses_the_focus(make_client, cfg, schemas, summaries):
    dc, _ = model_coach(make_client, action_body("isolate_finger", 0.8, "little"), cfg)
    line = dc.tip(summaries[22])
    assert (
        line.focus == "little"
        and line.text == "Just the little finger now. Keep the others still."
    )
    assert line.source == "gemma"
    schemas.validate("coach", envelope(line))
    dc2, _ = model_coach(make_client, action_body("isolate_finger", 0.8, "none"), cfg)
    assert dc2.tip(summaries[12]).focus == "middle"


def test_model_repeat_keeps_the_concrete_correction(make_client, cfg, summaries):
    dc, _ = model_coach(make_client, action_body("repeat", 0.7), cfg)
    line = dc.tip(summaries[3])  # index 37.4 degrees too curled
    assert (
        line.text == "Straighten your index finger a little."
        and line.focus == "index"
        and line.source == "gemma"
    )
    line = dc.tip(
        {**summaries[9], "passed": False}
    )  # nothing below the mark: the generic repeat line
    assert line.text == ACTION_LINES["repeat"]


def test_every_action_line_is_short_and_plain():
    for a, text in ACTION_LINES.items():
        assert len(text.format(finger="little")) <= 120 and EM_DASH not in text
        for banned in ("Gemini", "Gemma", "coach", "master"):
            assert banned not in text


# ---------------------------------------------------------------------- name_steps and configure
def test_name_steps_closed_set(make_client, cfg, lesson_meta):
    digests = [
        {"index": 0, "kind": "hold", "duration_ms": 8000, "pose": "all half bent"},
        {"index": 1, "kind": "hold", "duration_ms": 8000, "pose": "all straight"},
        {"index": 2, "kind": "hold", "duration_ms": 8000, "pose": "ring curled"},
    ]
    names = tuple(SHAPE_NAMES)
    body = choice_body(
        step_0=("Half curl", {"Half curl": 0.8}, 0.8),
        step_1=("Open hand", {"Open hand": 0.9}, 0.9),
        step_2=("Fist", {"Fist": 0.3}, 0.3),
    )
    dc, seen = model_coach(make_client, body, cfg)
    out = dc.name_steps(lesson_meta, digests)
    assert out == [
        {"index": 0, "name": "Half curl", "named_by": "gemma"},
        {"index": 1, "name": "Open hand", "named_by": "gemma"},
    ]
    payload = seen[0][0]
    assert set(payload["questions"]) == {"step_0", "step_1", "step_2"}
    assert tuple(payload["questions"]["step_0"]["criteria"]) == names
    assert dc.name_steps(lesson_meta, []) is None


def test_name_steps_offline_keeps_auto_names(log_file, cfg, lesson_meta):
    dc = offline_coach(log_file, cfg)
    assert (
        dc.name_steps(
            lesson_meta, [{"index": 0, "kind": "hold", "duration_ms": 1, "pose": "x"}]
        )
        is None
    )


def test_configure_model_then_keywords(make_client, cfg, log_file):
    dc, seen = model_coach(
        make_client, choice_body(task=("piano", {"piano": 0.9, "none": 0.1}, 0.9)), cfg
    )
    assert dc.configure("let us do some keys", ["general", "piano", "chords"]) == {
        "task": "piano",
        "config": {},
    }
    assert set(seen[0][0]["questions"]["task"]["criteria"]) == {
        "general",
        "piano",
        "chords",
        "none",
    }
    dc2, _ = model_coach(
        make_client, choice_body(task=("none", {"none": 0.9}, 0.9)), cfg
    )
    assert dc2.configure("play a scale on the keyboard", ["general", "piano"]) == {
        "task": "piano",
        "config": {},
    }
    assert dc2.configure("knit a scarf", ["general", "piano"]) is None
    off = offline_coach(log_file, cfg)
    assert off.configure("strum a chord", ["general", "chords"]) == {
        "task": "chords",
        "config": {},
    }


def test_phrase_question_and_rubric(log_file, cfg, steps, lesson_meta, schemas):
    dc = offline_coach(log_file, cfg)
    q = dc.phrase_question({"step": 1})
    assert q.kind == "question" and len(q.options) == 2
    schemas.validate("coach", envelope(q))
    w = dc.rubric(steps[2], lesson_meta)
    assert set(w) == set(C.FINGERS) and w["ring"] == 1.0
