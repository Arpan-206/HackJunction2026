import json

import pytest
from jsonschema import ValidationError

from core.schema import MESSAGE_SCHEMAS


def test_all_schemas_load(schemas):
    for stem in ["common", "hello", "frame", "session", "lesson_message", "event", "coach", "ack", "cmd", "lesson", "step_summary", "message"]:
        assert stem in schemas.names()


def test_ack_shapes(schemas):
    ok = {"v": 1, "type": "ack", "t": 1, "id": "c-1", "ok": True, "result": {}}
    bad = {"v": 1, "type": "ack", "t": 1, "id": "c-1", "ok": False, "error": {"code": "bad_state", "message": "no lesson"}}
    schemas.validate("ack", ok)
    schemas.validate("ack", bad)
    with pytest.raises(ValidationError):
        schemas.validate("ack", {"v": 1, "type": "ack", "t": 1, "id": "c-1", "ok": True})
    with pytest.raises(ValidationError):
        schemas.validate("ack", {"v": 1, "type": "ack", "t": 1, "id": "c-1", "ok": False, "error": {"code": "nope", "message": ""}})


def test_coach_question_needs_options(schemas):
    base = {"v": 1, "type": "coach", "t": 1, "id": "k-1", "kind": "question", "text": "Which?", "focus": None, "step": 0, "speak": False, "source": "rule"}
    with pytest.raises(ValidationError):
        schemas.validate("coach", base)
    schemas.validate("coach", {**base, "options": ["a", "b"]})


def test_spec_frame_example_validates(schemas):
    joints = [[0.12, 0.08, -0.05]] * 26
    hand = {
        "device_id": 3, "hand": "right", "role": "learner", "tracked": True, "anchor": "camera", "source": "glove",
        "wrist": {"p": [0.12, 0.08, -0.05], "q": [0.0, 0.71, 0.0, 0.71]},
        "joints": joints,
        "curl": {"thumb": 0.10, "index": 0.82, "middle": 0.75, "ring": 0.31, "little": 0.28},
        "pinch": {"index": False, "middle": False, "ring": False, "little": False},
        "heading_reliable": True,
    }
    frame = {
        "v": 1, "type": "frame", "t": 1731533000123456, "seq": 4812,
        "hands": {"left": None, "right": hand},
        "ghost": {"right": {"joints": joints, "wrist": {"p": [0.12, 0.08, -0.05], "q": [0, 0.71, 0, 0.71]},
                             "placement": "on_learner", "source": "lesson", "lesson_t": 1500000}},
        "score": {"hand": "right", "overall": 0.82,
                  "fingers": {"thumb": 0.95, "index": 0.41, "middle": 0.90, "ring": 0.88, "little": 0.90},
                  "err_deg": {"thumb": 6, "index": 31, "middle": 9, "ring": 10, "little": 8},
                  "worst": "index", "hint": "too_flat", "timing_ms": -120, "hold_ms": 350, "step_progress": 0.7},
        "task": {},
    }
    schemas.validate("frame", frame)
    schemas.validate_message(frame)
    schemas.validate("message", frame)


def test_message_types_are_covered(schemas):
    assert set(MESSAGE_SCHEMAS) == {"hello", "frame", "session", "lesson", "event", "coach", "ack", "cmd"}
