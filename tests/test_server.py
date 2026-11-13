import json
import time

import pytest
from fastapi.testclient import TestClient

from core.config import load_config
from core.server import Core, create_app
from tests.conftest import ROOT


@pytest.fixture
def fake_app(tmp_path):
    cfg = load_config(ROOT / "config.toml")
    core = Core(cfg, fake=True, validate=True, lessons_dir=tmp_path / "lessons", logs_dir=tmp_path / "logs")
    core.session.attempts_log = tmp_path / "logs" / "attempts.jsonl"
    app = create_app(core)
    with TestClient(app) as client:
        yield core, client


def recv_until(ws, kind, limit=200):
    seen = []
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        seen.append(msg)
        if msg["type"] == kind:
            return msg, seen
    raise AssertionError(f"no {kind} in {[m['type'] for m in seen]}")


def test_http_routes(fake_app):
    core, client = fake_app
    h = client.get("/health").json()
    assert h["ok"] and h["fake"] and h["mode"] == "learn" and h["lesson_id"] == "fake-demo"
    lessons = client.get("/lessons").json()
    assert lessons[0]["id"] == "fake-demo" and lessons[0]["steps_total"] == 4
    lj = client.get("/lessons/fake-demo").json()
    assert lj["schema"] == "geppetto.lesson/1"
    core.schemas.validate("lesson", lj)
    assert client.get("/lessons/nope").status_code == 404
    assert client.get("/lessons/fake-demo/frames/step_00.jpg").status_code == 404
    assert client.get("/schema/frame.json").json()["$id"].endswith("frame.json")
    assert client.get("/schema/nope.json").status_code == 404


def test_ws_hello_frames_and_acks(fake_app, schemas):
    core, client = fake_app
    with client.websocket_connect("/ws") as ws:
        hello = json.loads(ws.receive_text())
        assert hello["type"] == "hello"
        schemas.validate_message(hello)
        assert hello["session"]["mode"] == "learn" and hello["lessons"][0]["id"] == "fake-demo"
        sess = json.loads(ws.receive_text())
        assert sess["type"] == "session"
        schemas.validate_message(sess)
        lesson_msg = json.loads(ws.receive_text())
        assert lesson_msg["type"] == "lesson"
        schemas.validate_message(lesson_msg)

        frame, seen = recv_until(ws, "frame")
        schemas.validate_message(frame)
        assert frame["hands"]["right"]["role"] == "learner" and frame["hands"]["right"]["source"] == "glove"
        assert frame["ghost"]["right"]["placement"] == "on_learner"
        assert frame["score"]["hand"] == "right"
        # several more frames, all valid, seq increasing
        last = frame["seq"]
        for _ in range(10):
            f, _ = recv_until(ws, "frame")
            schemas.validate_message(f)
            assert f["seq"] > last
            last = f["seq"]

        ws.send_text(json.dumps({"v": 1, "type": "cmd", "id": "c-1", "name": "ping"}))
        ack, _ = recv_until(ws, "ack")
        schemas.validate_message(ack)
        assert ack["id"] == "c-1" and ack["ok"] and "t" in ack["result"]

        ws.send_text(json.dumps({"v": 1, "type": "cmd", "id": "c-2", "name": "set_mode", "args": {"mode": "nope"}}))
        ack, _ = recv_until(ws, "ack")
        assert ack["id"] == "c-2" and not ack["ok"] and ack["error"]["code"] == "bad_args"

        ws.send_text("this is not json")
        ack, _ = recv_until(ws, "ack")
        assert not ack["ok"] and ack["error"]["code"] == "bad_args"

        ws.send_text(json.dumps({"v": 1, "type": "cmd", "id": "c-3", "name": "subscribe", "args": {"rate_hz": 15, "rots": True}}))
        ack, _ = recv_until(ws, "ack")
        assert ack["ok"] and ack["result"] == {"rate_hz": 15.0, "rots": True}
        f, _ = recv_until(ws, "frame")
        f, _ = recv_until(ws, "frame")
        assert len(f["hands"]["right"]["rots"]) == 26
        schemas.validate_message(f)

        ws.send_text(json.dumps({"v": 1, "type": "cmd", "id": "c-4", "name": "set_mode", "args": {"mode": "playback"}}))
        ack, seen = recv_until(ws, "ack")
        assert ack["ok"]
        sess, _ = recv_until(ws, "session")
        assert sess["mode"] == "playback"
        f, _ = recv_until(ws, "frame")
        assert f["score"] is None and f["ghost"]["right"]["placement"] == "recorded"
        schemas.validate_message(f)
    assert core.validation_errors == 0, core.last_validation_error


def test_fake_learner_passes_steps(fake_app, schemas):
    """The fake learner must pass a hold step within a few seconds of lesson time."""
    core, client = fake_app
    with client.websocket_connect("/ws") as ws:
        deadline = time.time() + 12.0
        passed = None
        kinds = set()
        while time.time() < deadline:
            msg = json.loads(ws.receive_text())
            kinds.add(msg["type"])
            schemas.validate_message(msg)
            if msg["type"] == "event" and msg["name"] == "step_passed":
                passed = msg
                break
        assert passed is not None, f"no step_passed within 12 s; saw {kinds}"
        assert passed["hand"] == "right" and passed["data"]["step"] == 0
        coach, _ = recv_until(ws, "coach")
        assert coach["kind"] == "praise" and coach["source"] == "rule"
    assert core.validation_errors == 0, core.last_validation_error
