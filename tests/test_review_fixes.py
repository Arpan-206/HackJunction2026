"""Regression tests for the defects the overnight code review found."""
import json

import numpy as np
import pytest

from core import fake
from core import hand as H
from core.clock import FakeClock
from core.coach import Coach
from core.recorder import Lesson
from core.rcsp import RcspParser, T_OK, pack
from core.rgmp import GloveSource, build_joint_mapping, parse_definition
from core.scorer import StepScorer, Tolerances
from core.session import CommandError, Session
from tools.fake_rgmp_server import frame_bytes, make_definition, pack_definition


def test_move_step_ghost_past_end_does_not_wedge(cfg, tmp_path):
    lesson = fake.build_fake_wave_lesson(cfg, tmp_path)
    step = lesson.steps[0]
    sc = StepScorer("right", lesson, step, cfg.score, Tolerances(8, 45))
    sc.reset_attempt(0)
    a = H.angle_features(H.synth_joints({}))
    fs = sc.update(1000, a, step.t1_us + 5_000_000)     # ghost time far past the step end
    assert fs is not None and fs.timing_ms is not None and fs.step_progress == 1.0


def test_set_mode_learn_without_learner_leaves_state_untouched(cfg, tmp_path):
    s = Session(cfg, FakeClock(), tmp_path, Coach(None, cfg.coach, cfg.score.timing_hint_ms), fake=True)
    s.attempts_log = tmp_path / "a.jsonl"
    fake.build_fake_lesson(cfg, tmp_path)
    s.handle_command("lesson_load", {"lesson_id": fake.FAKE_LESSON_ID})
    s.handle_command("set_roles", {"left": "free", "right": "free"})
    s.handle_command("set_mode", {"mode": "record"})
    h = H.synth_hand(side="right", t_us=1); H.finish_hand(h, cfg.hand); s.update_hand("right", h)
    s.handle_command("record_start", {"title": "keep me"})
    with pytest.raises(CommandError) as e:
        s.handle_command("set_mode", {"mode": "learn"})
    assert e.value.code == "bad_state"
    assert s.mode == "record" and s.recorder.active       # nothing was thrown away


def test_piano_config_is_validated(cfg, tmp_path):
    s = Session(cfg, FakeClock(), tmp_path, Coach(None, cfg.coach, cfg.score.timing_hint_ms), fake=True)
    for bad in [{"tempo_bpm": 0}, {"tempo_bpm": -5}, {"notes": [{"finger": "index"}]}, {"notes": [{"beat": 1, "finger": "toe"}]}]:
        with pytest.raises(CommandError) as e:
            s.handle_command("set_task", {"task": "piano", "config": bad})
        assert e.value.code == "bad_args"
    assert s.task == "general"
    s.handle_command("set_task", {"task": "piano", "config": {"tempo_bpm": 90, "notes": [{"beat": 1, "finger": "index"}]}})
    s.handle_command("set_loop", {"on": False})
    assert s.piano is not None and s.piano.loop is False


def test_lesson_id_collision_gets_a_suffix(cfg, tmp_path):
    l1 = fake.build_fake_lesson(cfg, tmp_path)
    l2 = Lesson.from_json(l1.to_json(), trace=l1.trace)   # a second, new lesson with the same id
    l2.dir = None
    l2.save(tmp_path)
    assert l2.id == f"{l1.id}-2" and (tmp_path / l2.id / "lesson.json").exists()
    assert (tmp_path / l1.id / "lesson.json").exists()


def test_rcsp_parser_resyncs_after_fake_marker():
    good = pack(T_OK, {"TrackId": "1", "Status": "Ok", "Version": 1, "Response": {}})
    garbage = bytes([0xDC, 9, 8, 2]) + (2_000_000_000).to_bytes(4, "little")   # looks like a 2 GB body
    p = RcspParser()
    out = p.feed(garbage + good)
    assert out == [(T_OK, {"TrackId": "1", "Status": "Ok", "Version": 1, "Response": {}})]
    # non-object bodies are dropped, the stream continues
    weird = pack(T_OK, [1, 2, 3]) + pack(T_OK, None) + good
    assert len(p.feed(weird)) == 1


def test_rgmp_bad_definition_does_not_break_the_reader(cfg):
    doc = make_definition(2, "right", "transform")
    for st in doc["groups"][0]["streams"][:26]:
        st["data_type"] = "FLOAT[3]"            # TRANSFORM that cannot hold a pose
    m = build_joint_mapping(parse_definition(doc), cfg.rgmp)
    assert m is not None and len(m.poses) == 0 and len(m.positions) == 26
    src = GloveSource(cfg, FakeClock(), host="127.0.0.1", port=1)
    src.feed(pack_definition(doc))
    body = frame_bytes(0.0, 5, "right", 2, "transform")
    src.feed(body)      # the frame is sized for FLOAT[7]; positions parse, no exception
    assert src.poll(src.clock.now_us())["right"][0] is not None


def test_duel_failed_move_step_resets_both_scorers(cfg, tmp_path):
    clock = FakeClock()
    s = Session(cfg, clock, tmp_path, Coach(None, cfg.coach, cfg.score.timing_hint_ms), fake=True)
    s.attempts_log = tmp_path / "a.jsonl"
    fake.build_fake_wave_lesson(cfg, tmp_path)
    s.handle_command("lesson_load", {"lesson_id": fake.FAKE_WAVE_ID})
    s.handle_command("set_roles", {"left": "learner", "right": "learner"})
    s.handle_command("set_mode", {"mode": "duel"})
    wrong = {f: 1.0 for f in H.FINGERS}
    for _ in range(int(4.5 * 30)):
        clock.advance_us(33_333)
        for side in ("left", "right"):
            h = H.synth_hand(side=side, curl=wrong, t_us=clock.now_us()); H.finish_hand(h, cfg.hand)
            s.update_hand(side, h)
        s.tick(clock.now_us())
    assert all(sc.attempt == 2 for sc in s.scorers.values()), {k: v.attempt for k, v in s.scorers.items()}


def test_fake_lessons_overwrite_their_own_folder(cfg, tmp_path):
    fake.build_fake_lesson(cfg, tmp_path)
    fake.build_fake_lesson(cfg, tmp_path)
    fake.build_fake_wave_lesson(cfg, tmp_path)
    fake.build_fake_wave_lesson(cfg, tmp_path)
    assert sorted(d.name for d in tmp_path.iterdir() if d.is_dir()) == [fake.FAKE_LESSON_ID, fake.FAKE_WAVE_ID]


async def test_replay_paces_on_one_device_clock(tmp_path):
    """Two gloves with boot clocks 20 s apart, interleaved: the replay must take about the capture's span."""
    import time
    from tools.fake_rgmp_server import frame_bytes, make_definition, pack_definition
    from tools.replay import ReplayServer
    import asyncio
    data = pack_definition(make_definition(1, "left", "transform")) + pack_definition(make_definition(2, "right", "transform"))
    n, dt_us = 25, 12_000                     # 0.3 s of capture per device
    for i in range(n):
        data += frame_bytes(i * dt_us / 1e6, 2_728_979_320 + i * dt_us, "left", 1, "transform")
        data += frame_bytes(i * dt_us / 1e6, 2_749_204_072 + i * dt_us, "right", 2, "transform")
    cap = tmp_path / "two.rgmp"
    cap.write_bytes(data)
    srv = ReplayServer(cap, port=0, speed=1.0)
    await srv.start()
    reader, writer = await asyncio.open_connection("127.0.0.1", srv.port)
    t0 = time.monotonic()
    got = b""
    while len(got) < len(data):
        chunk = await asyncio.wait_for(reader.read(65536), 5.0)
        if not chunk:
            break
        got += chunk
    elapsed = time.monotonic() - t0
    writer.close()
    await srv.stop()
    assert len(got) == len(data)
    assert 0.2 <= elapsed <= 0.9, elapsed       # paced at about real time, not instant
