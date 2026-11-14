"""Feedback after a rep in plain words: the algorithmic sentences, the prompt and the checks on model output."""

import re

from app import constants as c
from app.schemas.api import CoachReviewRequest
from app.services.llm import review
from fastapi.testclient import TestClient


def _score(**kw: object) -> dict:
    base = {
        "overall": 92,
        "per_finger": {"thumb": 96, "index": 86, "middle": 82, "ring": 95, "little": 97},
        "timing": 100,
        "within_tolerance": True,
        "worst_finger": "middle",
        "hint": "Great match. Keep the same shape and rhythm.",
        "warnings": [],
        "margin": "relaxed",
    }
    return {**base, **kw}


def _req(score: dict | None = None, **kw: object) -> CoachReviewRequest:
    return CoachReviewRequest.model_validate({"score": score or _score(), **kw})


def test_route_answers_in_plain_words(client: TestClient) -> None:
    """Only the score is needed; the answer has no number and no measuring word."""
    body = client.post("/api/coach/review", json={"score": _score()}).json()
    assert body["provider"] == "fake"
    assert body["feedback"] and not re.search(r"\d", body["feedback"])
    assert review.acceptable(body["feedback"], _req())
    assert len(body["feedback"].split()) <= c.REVIEW_MAX_WORDS


def test_a_failed_rep_names_the_finger_and_the_direction() -> None:
    s = _score(
        overall=90,
        per_finger={"thumb": 78, "index": 94, "middle": 81, "ring": 86, "little": 97},
        within_tolerance=False,
        worst_finger="thumb",
        hint="Curl your thumb more, it is about 19 degrees (in total) too straight.",
    )
    text = review.build_review(_req(s)).feedback
    assert "thumb" in text and "curl" in text and "Nearly there" in text
    assert not re.search(r"\d|degree|tolerance", text)
    relax = _score(per_finger={"thumb": 96, "index": 60, "middle": 90, "ring": 95, "little": 97}, worst_finger="index",
                   hint="Relax your index finger, it is curled about 30 degrees (in total) too much.")
    assert "index finger relax" in review.build_review(_req(relax)).feedback


def test_a_light_finger_is_never_the_subject() -> None:
    """Table tennis weights the little finger at 0.1: a weak little finger is not mentioned."""
    s = _score(per_finger={"thumb": 96, "index": 92, "middle": 90, "ring": 95, "little": 40}, worst_finger="little")
    r = _req(s, weights={"thumb": 1, "index": 1, "middle": 0.6, "ring": 0.25, "little": 0.1})
    assert review.ignored(r) == ["ring", "little"] and review.weakest(r) is None
    assert "little" not in review.build_review(r).feedback
    prompt = review.build_prompt(r, review.build_review(r))
    assert "Ignore: ring finger, little finger" in prompt and "little finger: " not in prompt
    assert not review.acceptable("Lovely grip. Tuck your little finger in next time.", r)
    assert not review.acceptable("Lovely grip. Tuck your pinky in next time.", r)


def test_timing_and_the_prompt_carry_no_numbers() -> None:
    late = _score(timing=55, per_finger={"thumb": 96, "index": 92, "middle": 90, "ring": 95, "little": 97})
    assert "beat" in review.build_review(_req(late)).feedback
    r = _req(late, move_name="The shakehand grip", attempt=3, previous_overall=70, last_feedback="Good one.")
    prompt = review.build_prompt(r, review.build_review(r))
    assert "Timing: off the beat" in prompt and "Compared with the last repetition: better" in prompt
    facts = [line for line in prompt.splitlines() if not line.startswith(("Repetition:", "Previous feedback:"))]
    assert not any(re.search(r"\d", line) for line in facts)


def test_model_answers_are_checked() -> None:
    r = _req(last_feedback="Good rep. Do it again.")
    assert review.acceptable("Your grip looked settled and steady. Keep the same shape and try it once more.", r)
    assert not review.acceptable("You scored 92, well done.", r)
    assert not review.acceptable("You were within the tolerance.", r)
    assert not review.acceptable("Your thumb was off by a few degrees.", r)
    assert not review.acceptable("good rep. do it again.", r)
    assert not review.acceptable("word " * (c.REVIEW_MAX_WORDS + c.REVIEW_WORD_SLACK + 1), r)
    assert not review.acceptable("  ", r)
