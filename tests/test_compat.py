"""The teammate frontend's contract (docs/CONTRACT.md on origin/main) served by the core."""

import json
import math

from core import fake
from core import hand as H
from core.compat import hand_to_glove_hand, lesson_to_compat, rule_hint
from tests.test_server import fake_app, recv_until  # noqa: F401  (fixture reuse)

FINGERS = ["thumb", "index", "middle", "ring", "little"]


def test_hand_to_glove_hand_units_and_shape(cfg):
    fist = H.synth_hand(curl={f: 1.0 for f in FINGERS}, hand_cfg=cfg.hand)
    g = hand_to_glove_hand(fist)
    assert g["side"] == "right" and g["wrist_pos"] is None and len(g["wrist_quat"]) == 4
    assert set(g["flexion"]) == set(FINGERS) and all(
        len(v) == 3 for v in g["flexion"].values()
    )
    for f in ["index", "middle", "ring", "little"]:
        assert all(abs(x - math.pi / 2) < 0.03 for x in g["flexion"][f]), g["flexion"][
            f
        ]  # radians
    flat = H.synth_hand(curl={}, hand_cfg=cfg.hand)
    assert all(
        abs(x) < 0.02
        for f in ["index", "middle", "ring", "little"]
        for x in hand_to_glove_hand(flat)["flexion"][f]
    )
    cam = H.synth_hand(curl={}, hand_cfg=cfg.hand, wrist_p=(0.1, 0.2, -0.3))
    cam.anchor = "camera"
    assert hand_to_glove_hand(cam)["wrist_pos"] == [0.1, 0.2, -0.3]


def test_lesson_to_compat_shape(cfg, tmp_path):
    lesson = fake.build_fake_lesson(cfg, tmp_path)
    d = lesson_to_compat(lesson.to_json())
    assert (
        d["id"] == "fake-demo" and d["skill"] == "general" and d["source"] == "scratch"
    )
    assert len(d["steps"]) == 4 and d["steps"][0]["tolerance"] == {
        "angle_deg": 18,
        "timing_ms": 250,
    }
    assert (
        d["steps"][1]["title"] == "Fist"
        and d["steps"][1]["reference_recording_id"] == "fake-demo"
    )


def test_rule_hint_signs():
    assert rule_hint({"ring": -30, "index": 5}, None) == "Curl your ring finger more."
    assert rule_hint({"ring": 30}, None) == "Straighten your ring finger a little."
    assert rule_hint({"ring": 3}, 0) == "Good. Next step."
    assert rule_hint({}, 200) == "A little faster."
    assert rule_hint({}, -200).startswith("Slow down")


def test_compat_http_routes(fake_app):
    core, client = fake_app
    h = client.get("/api/health").json()
    assert (
        h["status"] == "ok"
        and h["glove_source"] == "simulator"
        and h["llm_provider"] == "fake"
    )
    lessons = client.get("/api/lessons").json()
    assert [l["id"] for l in lessons] == ["fake-demo", "fake-wave"] and lessons[0][
        "steps"
    ][0]["title"] == "Open hand"
    assert client.get("/api/lessons/fake-demo").json()["title"].startswith("Fake demo")
    assert client.get("/api/lessons/nope").status_code == 404
    assert client.get("/api/moves").json() == []
    st = client.get("/api/dev/state").json()
    assert st["glove_source"] == "simulator" and st["smoothing"]["enabled"] is True
    st2 = client.post(
        "/api/dev/state", json={"smoothing": {"beta": 0.2}, "llm_provider": "fake"}
    ).json()
    assert st2["smoothing"]["beta"] == 0.2
    hint = client.post(
        "/api/coach/hint",
        json={"instruction": "x", "deviations": {"ring": -30}, "timing_ms": 0},
    ).json()
    assert hint == {"hint": "Curl your ring finger more.", "provider": "rule"}
    assert client.post("/api/score", json={}).status_code == 501
    assert client.get("/api/calibrations/latest?side=right").status_code == 404
    cal = client.post(
        "/api/calibrations", json={"side": "right", "phase": "flat"}
    ).json()
    assert cal["side"] == "right" and set(cal["flat"]) == set(FINGERS)
    # recordings map onto record mode
    r = client.post(
        "/api/recordings/start", json={"lesson_id": "x", "step_id": "s1"}
    ).json()
    rid = r["recording_id"]
    assert core.session.mode == "record" and core.session.recorder.active
    import time

    time.sleep(0.5)
    rec = client.post(f"/api/recordings/{rid}/stop").json()
    assert (
        rec["id"] == rid
        and rec["duration_s"] > 0
        and rec["frames"] == []
        and rec["core_lesson_id"]
    )
    assert client.get(f"/api/recordings/{rid}").json()["id"] == rid
    assert client.get("/api/recordings/nope").status_code == 404


def test_ws_gloves_stream(fake_app):
    core, client = fake_app
    with client.websocket_connect("/ws/gloves") as ws:
        ws.send_text(json.dumps({"type": "set_motion", "motion": {"preset": "idle"}}))
        frames = [json.loads(ws.receive_text()) for _ in range(5)]
    for f in frames:
        assert set(f) == {"t", "source", "hands"} and f["source"] == "simulator"
        assert {h["side"] for h in f["hands"]} == {"left", "right"}
        for h in f["hands"]:
            assert set(h["flexion"]) == set(FINGERS) and all(
                len(v) == 3 for v in h["flexion"].values()
            )
            assert all(-0.1 <= x <= 3.2 for v in h["flexion"].values() for x in v)
            assert len(h["wrist_quat"]) == 4
    assert frames[-1]["t"] > frames[0]["t"]
    assert client.get("/health").json()["validation_errors"] == 0
