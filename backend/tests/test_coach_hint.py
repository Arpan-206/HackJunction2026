"""The live coach hint: algorithmic wording, schema, repeat avoidance and validation of model output."""

import pytest
from fastapi.testclient import TestClient

from app import constants as c
from app.schemas.api import CoachHintRequest
from app.services import hints


def _req(**kw: object) -> CoachHintRequest:
    """Build a request from keyword fields."""
    return CoachHintRequest.model_validate(kw)


def test_old_request_shape_still_works(client: TestClient) -> None:
    """The original three fields give hint and provider plus the new cue fields."""
    body = client.post("/api/coach/hint", json={"instruction": "Grip", "deviations": {"ring": 25}, "timing_ms": 0}).json()
    assert body["provider"] == "fake" and "ring" in body["hint"]
    assert body["focus_finger"] == "ring" and body["cue_type"] == "extend" and body["severity"] == "medium"


@pytest.mark.parametrize(("kw", "cue", "finger", "words"), [
    ({"deviations": {"index": 14}, "move_name": "Pinch"}, "extend", "index", ("lift", "pinch")),
    ({"deviations": {"ring": -22}}, "curl", "ring", ("curl", "ring")),
    ({"deviations": {"thumb": -10}}, "curl", "thumb", ("thumb",)),
    ({"timing_ms": 210}, "timing", None, ("late",)),
    ({"timing_ms": -180}, "timing", None, ("early",)),
    ({"wrist_error_deg": 16, "wrist_axis": "yaw"}, "wrist", None, ("wrist", "left")),
    ({"wrist_error_deg": -20, "wrist_axis": "pitch"}, "wrist", None, ("raise", "wrist")),
    ({"deviations": {"index": 2}, "timing_ms": 30}, "praise", None, ()),
])
def test_algorithmic_hint_is_specific_and_short(kw: dict, cue: str, finger: str | None, words: tuple[str, ...]) -> None:
    """Each cue names its finger and direction in at most 14 words."""
    draft = hints.build_hint_draft(_req(**kw))
    assert draft.cue_type == cue and draft.focus_finger == finger
    assert len(draft.hint.split()) <= c.HINT_MAX_WORDS
    assert all(w in draft.hint.lower() for w in words)


def test_biggest_problem_relative_to_tolerance_wins() -> None:
    """A large timing error outranks a small finger error."""
    assert hints.build_hint_draft(_req(deviations={"index": 6}, timing_ms=400)).cue_type == "timing"
    assert hints.build_hint_draft(_req(deviations={"index": 30}, timing_ms=130)).cue_type == "extend"


def test_joint_phrase_names_the_worst_joint() -> None:
    """When one joint carries the error the hint says where."""
    draft = hints.build_hint_draft(_req(deviations={"index": 12}, joint_deviations={"index": [1, 2, 9]}))
    assert "fingertip" in draft.hint


def test_hint_varies_from_last_hint() -> None:
    """The same measurements with the previous wording as last_hint give different wording."""
    first = hints.build_hint_draft(_req(deviations={"index": 14}))
    second = hints.build_hint_draft(_req(deviations={"index": 14}, last_hint=first.hint, attempt=2))
    assert second.hint != first.hint and second.focus_finger == "index"


def test_severity_scales_with_tolerance() -> None:
    """Error up to the tolerance is low, beyond double it is high."""
    assert hints.build_hint_draft(_req(deviations={"index": 12})).severity == "low"
    assert hints.build_hint_draft(_req(deviations={"index": 25})).severity == "medium"
    assert hints.build_hint_draft(_req(deviations={"index": 50})).severity == "high"


class ScriptedLLM:
    """A gemini-named provider that returns a canned answer."""

    name = "gemini"

    def __init__(self, answer: str) -> None:
        """Answer every call with this text."""
        self.answer = answer
        self.requests: list = []

    async def generate_json(self, request: object) -> str:
        """Return the canned answer."""
        self.requests.append(request)
        return self.answer

    async def generate_text(self, request: object) -> str:
        """Unused."""
        return ""


@pytest.mark.parametrize("answer", [
    "not json",
    '{"hint": "Lift your index finger slightly.", "focus_finger": "middle", "cue_type": "extend", "severity": "low"}',
    '{"hint": "Lift it.", "focus_finger": "index", "cue_type": "extend", "severity": "low"}',
    '{"hint": "' + " ".join(["word"] * 20) + '", "focus_finger": "index", "cue_type": "extend", "severity": "low"}',
    '{"hint": "Curl your index finger.", "focus_finger": "index", "cue_type": "curl", "severity": "low"}',
])
def test_bad_model_output_keeps_algorithmic_hint(client: TestClient, answer: str) -> None:
    """Invalid, off-target or over-long model output is replaced by the algorithmic cue."""
    client.app.state.services.llm.use(ScriptedLLM(answer))
    body = client.post("/api/coach/hint", json={"deviations": {"index": 25}}).json()
    assert body["provider"] == "algorithmic" and body["focus_finger"] == "index" and body["cue_type"] == "extend"


def test_praise_never_calls_the_model(client: TestClient) -> None:
    """When nothing needs fixing the algorithmic praise is returned without spending a request."""
    stub = ScriptedLLM("{}")
    client.app.state.services.llm.use(stub)
    body = client.post("/api/coach/hint", json={"deviations": {"index": 1}}).json()
    assert body["cue_type"] == "praise" and body["provider"] == "algorithmic" and not stub.requests


def test_repeat_of_last_hint_is_rejected(client: TestClient) -> None:
    """A model answer equal to last_hint is replaced."""
    answer = '{"hint": "Lift your index finger slightly.", "focus_finger": "index", "cue_type": "extend", "severity": "medium"}'
    client.app.state.services.llm.use(ScriptedLLM(answer))
    body = client.post("/api/coach/hint", json={"deviations": {"index": 25}, "last_hint": "Lift your index finger slightly."}).json()
    assert body["provider"] == "algorithmic" and body["hint"] != "Lift your index finger slightly."


def test_hint_request_validation(client: TestClient) -> None:
    """Attempt must be positive and text fields are length limited."""
    assert client.post("/api/coach/hint", json={"attempt": 0}).status_code == 422
    assert client.post("/api/coach/hint", json={"last_hint": "x" * 201}).status_code == 422


def test_margin_scales_the_live_hint() -> None:
    """Relaxed stays quiet inside its widened band, strict speaks up below the standard threshold, standard is unchanged."""
    off = {"deviations": {"ring": -22}}
    assert hints.build_hint_draft(_req(**off)) == hints.build_hint_draft(_req(**off, margin="standard"))
    assert hints.build_hint_draft(_req(**off)).cue_type == "curl"
    assert hints.build_hint_draft(_req(**off, margin="relaxed")).cue_type == "praise"
    assert hints.build_hint_draft(_req(**off, margin="just_trying")).cue_type == "praise"
    slight = {"deviations": {"index": 3}}
    assert hints.build_hint_draft(_req(**slight)).cue_type == "praise"
    strict = hints.build_hint_draft(_req(**slight, margin="strict"))
    assert strict.cue_type == "extend" and strict.focus_finger == "index"
    assert hints.thresholds() == hints.STANDARD and hints.STANDARD.finger_deg == c.HINT_MIN_DEVIATION_DEG


def test_margin_reaches_the_hint_endpoint(client: TestClient) -> None:
    """POST /coach/hint accepts the margin; relaxed praises a rep the standard margin would correct."""
    body = {"instruction": "Grip", "deviations": {"ring": 25}, "timing_ms": 0}
    assert client.post("/api/coach/hint", json=body).json()["cue_type"] == "extend"
    assert client.post("/api/coach/hint", json={**body, "margin": "relaxed"}).json()["cue_type"] == "praise"
    assert client.post("/api/coach/hint", json={**body, "margin": "sloppy"}).status_code == 422
