"""The second coach_tune job (COACH_TUNE_TASK=review): its filter, its own output folder, and the unchanged hint job."""

import importlib
import sys
from pathlib import Path

import pytest

LANE = Path(__file__).resolve().parents[1] / "coach_tune"


def load(monkeypatch, task: str | None):
    if task is None:
        monkeypatch.delenv("COACH_TUNE_TASK", raising=False)
    else:
        monkeypatch.setenv("COACH_TUNE_TASK", task)
    monkeypatch.syspath_prepend(str(LANE))
    sys.modules.pop("prompt", None)
    return importlib.import_module("prompt")


def test_hint_job_is_unchanged_without_the_variable(monkeypatch):
    p = load(monkeypatch, None)
    assert p.TASK == "hint" and p.OUT_ROOT == LANE / "out" and p.MAX_TOKENS == 48
    assert p.check("Curl your thumb more.", "thumb", "too_flat", "en")["ok"]
    ex = {"task": "t", "step_index": 0, "step_name": "s", "kind": "hold", "hand": "right", "score": 50, "errors": [], "lang": "en"}
    assert p.messages(ex)[0]["content"] == p.SYSTEM


def test_review_job_has_its_own_folder_and_filter(monkeypatch):
    p = load(monkeypatch, "review")
    assert p.OUT_ROOT == LANE / "out" / "review" and p.MAX_TOKENS == 96
    ok = p.check("Your other fingers held the shape well. Curl your thumb a little more.", "thumb", "too_flat", "en")
    assert ok["ok"] and ok["finger_ok"] and ok["direction_ok"] and ok["style_ok"]
    # praise may say other fingers are curled; only the last sentence carries the fix
    assert p.check("Your fingers are nicely curled around the handle. Straighten your index finger a little.", "index", "too_curled", "en")["ok"]
    bad = [
        ("Curl your thumb a little more.", "one sentence"),
        ("Good hand. Nice shape. Curl your thumb more.", "three sentences"),
        ("Your hand was good. Curl your index finger more.", "wrong finger"),
        ("Your hand was good. Straighten your thumb.", "wrong direction"),
        ("You scored well. Curl your thumb more.", "scoring word"),
        ("Your hand was 80 percent right. Curl your thumb more.", "number"),
        ("Your thumb was good. Curl it more.", "finger not in the fix sentence"),
        ("Your hand " + "really " * 30 + "was good. Curl your thumb more.", "too long"),
    ]
    for text, why in bad:
        assert not p.check(text, "thumb", "too_flat", "en")["ok"], why
    assert p.check("Die Hand war ruhig und sicher. Beuge den Daumen etwas mehr.", "thumb", "too_flat", "de")["ok"]
    assert p.check("Muut sormet pysyivät hyvin paikallaan. Koukista peukaloa hieman enemmän.", "thumb", "too_flat", "fi")["ok"]


def test_unknown_task_is_refused(monkeypatch):
    with pytest.raises(SystemExit):
        load(monkeypatch, "essay")
