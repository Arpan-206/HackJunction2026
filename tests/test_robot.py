import json
import math

import pytest

from core import fake
from core import hand as H
from core.clock import FakeClock
from core.coach import Coach
from core.robot import Retargeter, RobotModel
from core.session import CommandError, Session
from tests.conftest import ROOT
from tests.test_server import fake_app, recv_until  # noqa: F401


@pytest.fixture(scope="module")
def rt(cfg):
    return Retargeter(cfg.robot, ROOT)


def test_urdf_loads_joints_and_limits():
    m = RobotModel.from_urdf(ROOT / "models/robots/dex3_1/dex3_1_r.urdf")
    assert m.name == "dex3_1_r" and len(m.joints) == 7
    j = m.joints["right_hand_index_0_joint"]
    assert (
        j.type == "revolute"
        and j.lower == 0
        and j.upper == pytest.approx(1.5708, abs=1e-3)
    )
    assert j.axis == (0.0, 0.0, 1.0) and j.parent == "right_hand_palm_link"


def test_retargeter_describes_the_hand(rt):
    d = rt.describe()
    assert (
        d["model"] == "dex3_1"
        and d["fingers"] == ["thumb", "index", "middle"]
        and d["missing"] == ["ring", "little"]
    )
    assert len(d["joints"]["left"]) == 7 and all(
        n.startswith("left_hand_") for n in d["joints"]["left"]
    )


def test_flat_hand_gives_near_zero_flexion(rt):
    a = H.angle_features(H.synth_joints({}, side="right"))
    t = rt.targets(a, "right")
    for name in (
        "right_hand_index_0_joint",
        "right_hand_index_1_joint",
        "right_hand_middle_0_joint",
        "right_hand_thumb_1_joint",
    ):
        assert abs(t.q[name]) < 0.05, (name, t.q[name])
    assert t.missing == ["ring", "little"] and set(t.fidelity) == {
        "thumb",
        "index",
        "middle",
    }
    assert t.fidelity["index"] == pytest.approx(
        2 / 3, abs=1e-6
    )  # two robot joints for three human ones
    assert t.fidelity["thumb"] == pytest.approx(1.0, abs=1e-6)


def test_fist_flexes_toward_the_limits_with_mirrored_signs(rt):
    fist = H.angle_features(H.synth_joints({f: 1.0 for f in H.FINGERS}, side="right"))
    r = rt.targets(fist, "right")
    l = rt.targets(fist, "left")
    assert r.q["right_hand_index_0_joint"] == pytest.approx(
        1.5708, abs=1e-3
    )  # clamped at +upper
    assert l.q["left_hand_index_0_joint"] == pytest.approx(
        -1.5708, abs=1e-3
    )  # clamped at -lower
    assert (
        r.q["right_hand_index_1_joint"] > 1.0 and l.q["left_hand_index_1_joint"] < -1.0
    )
    # a 90 degree MCP asks for pi/2, exactly the limit: fidelity stays high; index_1 asks 0.7*90+0.5*90=108 deg > 100 deg limit: clipped
    assert 0.5 < r.fidelity["index"] <= 2 / 3
    assert all(0 <= v <= 1 for v in r.q_norm.values())


def test_robot_block_validates(rt, schemas):
    a = H.angle_features(H.synth_joints({"index": 0.5}, side="left"))
    msg = {
        "v": 1,
        "type": "robot",
        "t": 1,
        **rt.targets(a, "left").to_message("learner", "hand"),
    }
    schemas.validate("robot", msg)
    frame = {
        "v": 1,
        "type": "frame",
        "t": 1,
        "seq": 1,
        "hands": {"left": None, "right": None},
        "ghost": {},
        "score": None,
        "task": {},
        "robot": rt.targets(a, "left").to_message("lesson", "lesson"),
    }
    schemas.validate("frame", frame)


def test_session_sources(cfg, tmp_path, schemas):
    clock = FakeClock()
    s = Session(
        cfg,
        clock,
        tmp_path,
        Coach(None, cfg.coach, cfg.score.timing_hint_ms),
        fake=True,
    )
    s.attempts_log = tmp_path / "a.jsonl"
    fake.build_fake_lesson(cfg, tmp_path)
    assert s.robot is not None and s.robot_source == "off"
    assert s.tick(clock.now_us())["robot"] is None
    with pytest.raises(CommandError):
        s.handle_command("set_robot_source", {"source": "banana"})
    s.handle_command("set_robot_source", {"source": "learner"})
    assert (
        s.session_state()["robot_source"] == "learner"
        and s.hello()["robot"]["model"] == "dex3_1"
    )
    clock.advance_us(33_333)
    h = H.synth_hand(side="right", curl={"index": 0.8}, t_us=clock.now_us())
    H.finish_hand(h, cfg.hand)
    s.update_hand("right", h)
    f = s.tick(clock.now_us())
    assert (
        f["robot"]["source"] == "learner"
        and f["robot"]["hand"] == "right"
        and f["robot"]["angles_from"] == "hand"
    )
    assert f["robot"]["q"]["right_hand_index_0_joint"] > 1.0
    schemas.validate_message(f)
    # lesson source: the current step is the demonstrator in learn and playback, nothing in idle
    s.handle_command("set_robot_source", {"source": "lesson"})
    assert s.tick(clock.now_us())["robot"] is None
    s.handle_command("lesson_load", {"lesson_id": fake.FAKE_LESSON_ID})
    s.handle_command("set_mode", {"mode": "learn"})
    s.handle_command(
        "step_goto", {"index": 1}
    )  # the fist pose: curl 0.95 = 85.5 degrees at the knuckle
    f = s.tick(clock.now_us())
    assert f["robot"]["angles_from"] == "lesson" and f["robot"]["hand"] == "right"
    assert f["robot"]["q"]["right_hand_index_0_joint"] == pytest.approx(
        math.radians(85.5), abs=0.05
    )
    s.handle_command("set_mode", {"mode": "playback"})
    f = s.tick(clock.now_us())
    assert f["robot"] is not None and f["robot"]["source"] == "lesson"
    # master source with no master hand gives nothing
    s.handle_command("set_robot_source", {"source": "master"})
    assert s.tick(clock.now_us())["robot"] is None


def test_ws_robot_socket(fake_app, schemas):
    core, client = fake_app
    with client.websocket_connect("/ws/robot") as ws:
        hello = json.loads(ws.receive_text())
        assert hello["type"] == "hello" and hello["robot"]["model"] == "dex3_1"
        ws.send_text(
            json.dumps(
                {
                    "v": 1,
                    "type": "cmd",
                    "id": "r1",
                    "name": "set_robot_source",
                    "args": {"source": "learner"},
                }
            )
        )
        ack, _ = recv_until(ws, "ack")
        assert ack["ok"] and ack["result"]["model"] == "dex3_1"
        msg, _ = recv_until(ws, "robot")
        schemas.validate_message(msg)
        assert (
            msg["hand"] == "right"
            and len(msg["q"]) == 7
            and msg["missing"] == ["ring", "little"]
        )
    assert client.get("/health").json()["robot"] == {
        "model": "dex3_1",
        "source": "learner",
    }
    assert core.validation_errors == 0, core.last_validation_error
