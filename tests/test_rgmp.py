import asyncio
import json
import struct
import time
from pathlib import Path

import numpy as np
import pytest

from core import geom
from core import hand as H
from core.clock import Clock
from core.rgmp import (ClockMapper, GloveSource, RgmpParser, build_joint_mapping, detect_hand, parse_data_type,
                       parse_definition)
from tools.fake_rgmp_server import FakeRgmpServer, frame_bytes, make_definition, pack_definition, pack_disconnect
from tools.replay import ReplayServer, split_capture


def test_parse_data_types():
    assert parse_data_type("FLOAT[7]") == ("f", 7, 28)
    assert parse_data_type("float") == ("f", 1, 4)
    assert parse_data_type("UINT64") == ("Q", 1, 8)
    assert parse_data_type("FLOAT[3,3]") == ("f", 9, 36)
    assert parse_data_type("vec3f") == ("f", 3, 12)
    with pytest.raises(ValueError):
        parse_data_type("BANANA")


@pytest.mark.parametrize("layout", ["transform", "split"])
@pytest.mark.parametrize("names", ["openxr", "xr_enum"])
def test_definition_offsets_and_mapping(cfg, layout, names):
    doc = make_definition(2, "right", layout, names=names)
    d = parse_definition(doc)
    g = d.group("joints_openxr")
    assert g is not None
    per_joint = 28 if layout == "transform" else 28
    assert g.size == 26 * per_joint + 4
    m = build_joint_mapping(d, cfg.rgmp)
    assert m is not None and m.complete() and not m.by_order and m.flags is not None
    # a frame round-trips through the parser
    local = H.synth_joints({"index": 0.5}, side="right")
    q = geom.yaw_quat(0.4)
    raw = frame_bytes(0.0, 123456789, "right", 2, layout)
    p = RgmpParser()
    msgs = p.feed(pack_definition(doc) + raw, arrival_us=1_000)
    assert [k for k, _ in msgs] == ["definition", "data"]
    frame = msgs[1][1]
    joints, rots, reliable = m.extract(frame)
    assert joints.shape == (26, 3) and rots.shape == (26, 4) and reliable is True
    assert np.allclose(joints[1], 0.0)          # wrist at origin
    a = H.angle_features(joints)
    assert np.all(a[2:14] >= 0) and a.shape == (18,)


def test_mapping_falls_back_to_enum_order(cfg):
    doc = make_definition(1, "left", "transform")
    for i, s in enumerate(doc["groups"][0]["streams"][:26]):
        s["target_frame"] = f"mystery_{i}"
    m = build_joint_mapping(parse_definition(doc), cfg.rgmp)
    assert m is not None and m.by_order and m.complete()


@pytest.mark.parametrize("hand_field,expect", [("device_info", "left"), ("static_data", "left"), ("none", None)])
def test_detect_hand(cfg, hand_field, expect):
    doc = make_definition(4, "left", "transform", hand_field=hand_field)
    assert detect_hand(parse_definition(doc), cfg.rgmp) == expect


def test_parser_resyncs_after_garbage():
    doc = make_definition(2, "right", "transform")
    p = RgmpParser()
    data = b"\xff\x13garbage" + pack_definition(doc) + frame_bytes(0.1, 5, "right", 2, "transform") + pack_disconnect(2)
    kinds = [k for k, _ in p.feed(data)]
    assert kinds == ["definition", "data", "disconnect"]
    assert p.bad_frames > 0


def test_parser_handles_split_tcp_chunks():
    doc = make_definition(2, "right", "transform")
    data = pack_definition(doc) + b"".join(frame_bytes(i / 83.0, 1000 + i, "right", 2, "transform") for i in range(5))
    p = RgmpParser()
    kinds = []
    for i in range(0, len(data), 37):
        kinds += [k for k, _ in p.feed(data[i:i + 37])]
    assert kinds == ["definition"] + ["data"] * 5


def test_clock_mapper_uses_minimum_delay():
    cm = ClockMapper(window_s=5.0)
    # device timestamps start at 0, arrivals have jitter 10..30 ms
    outs = []
    for i in range(10):
        ts = i * 12_000
        arrival = 1_000_000 + ts + [20_000, 30_000, 10_000, 25_000, 15_000, 10_000, 30_000, 20_000, 10_000, 12_000][i]
        outs.append(cm.map(ts, arrival) - ts)
    assert outs[-1] == 1_000_000 + 10_000       # the smallest delay seen


async def _collect(src: GloveSource, seconds: float, clock: Clock):
    polls = []
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        await asyncio.sleep(1 / 30)
        polls.append(src.poll(clock.now_us()))
    return polls


@pytest.mark.parametrize("layout", ["transform", "split"])
async def test_glove_source_reads_fake_solver_and_capture_replays(cfg, tmp_path, layout):
    clock = Clock()
    cap = tmp_path / "cap.rgmp"
    server = FakeRgmpServer(port=0, layout=layout, rate_hz=83.33, max_frames=60, capture=cap)
    await server.start()
    src = GloveSource(cfg, clock, logs_dir=tmp_path / "logs", host="127.0.0.1", port=server.port)
    await src.start()
    polls = await _collect(src, 1.2, clock)
    await src.stop()
    await server.stop()
    hands = [p for p in polls if p["left"][0] is not None and p["right"][0] is not None]
    assert hands, "no hands received from the fake solver"
    tracked = [p for p in hands if p["left"][0].tracked and p["right"][0].tracked]
    assert tracked
    h = tracked[-1]["right"][0]
    assert h.source == "glove" and h.device_id == 2 and h.joints_local.shape == (26, 3) and h.rots_local.shape == (26, 4)
    assert 0 <= h.curl["index"] <= 1 and h.angles.shape == (18,)
    # definition dumped to logs/
    assert (tmp_path / "logs" / "rgmp_definition_2.json").exists()
    # after the disconnect message the hands are marked lost -> untracked, last pose held
    last = polls[-1]["right"][0]
    assert last is not None and last.tracked is False
    assert src.frames == 120
    # capture round trip through the replay server
    msgs = split_capture(cap.read_bytes())
    assert sum(1 for p, _, _ in msgs if p == 1) == 2 and sum(1 for p, _, _ in msgs if p == 2) == 120
    replay = ReplayServer(cap, port=0, speed=4.0)
    src2 = GloveSource(cfg, clock, logs_dir=tmp_path / "logs2", replay=replay)
    await src2.start()
    polls2 = await _collect(src2, 0.8, clock)
    await src2.stop()
    assert src2.frames == 120 and replay.finished
    got = [p for p in polls2 if p["left"][0] is not None]
    assert got and got[0]["left"][0].joints_local.shape == (26, 3)


async def test_glove_source_marks_silence(cfg, tmp_path):
    clock = Clock()
    src = GloveSource(cfg, clock, host="127.0.0.1", port=1)
    doc = make_definition(2, "right", "transform")
    src.feed(pack_definition(doc) + frame_bytes(0.0, int(time.time() * 1e6), "right", 2, "transform"))
    now = clock.now_us()
    first = src.poll(now)["right"][0]
    assert first.tracked
    assert src.poll(now + 300_000)["right"][0].tracked is False
    assert first.tracked is True       # the held copy must not change the hand handed out earlier


def test_calibrate_zeroes_yaw(cfg, tmp_path):
    from core.clock import FakeClock
    clock = FakeClock()
    src = GloveSource(cfg, clock, host="127.0.0.1", port=1)
    doc = make_definition(2, "right", "transform")
    src.feed(pack_definition(doc))
    # hand rotated 0.5 rad about Y
    local = H.synth_joints({}, side="right")
    q = geom.yaw_quat(0.5)
    from tools.fake_rgmp_server import joint_transform, pack_frame
    xr, rots = joint_transform(local, H.joint_rotations(local), q)
    t0 = clock.now_us()
    src.feed(pack_frame(2, 0, t0, xr, rots, "transform"))
    before = src.poll(t0)["right"][0]
    assert abs(GloveSource._yaw_of(before.wrist_q) - 0.5) < 1e-6
    src.calibrate(duration_s=0.5)
    for i in range(5):
        clock.set_us(t0 + i * 10_000)
        src.feed(pack_frame(2, 0, t0 + i * 10_000, xr, rots, "transform"))
        src.poll(t0 + i * 10_000)
    clock.set_us(t0 + 600_000)
    src.feed(pack_frame(2, 0, t0 + 600_000, xr, rots, "transform"))
    after = src.poll(t0 + 600_000)["right"][0]
    assert abs(GloveSource._yaw_of(after.wrist_q)) < 1e-6
    assert np.allclose(after.angles, before.angles, atol=1e-3)
