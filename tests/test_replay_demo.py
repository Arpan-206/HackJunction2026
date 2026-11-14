"""replay-demo lane: replay windows, streaming, continuous loops, and the capture inventory."""

import asyncio
import json
import time

import numpy as np

from core.clock import Clock
from core.rgmp import DATA_HDR, OUTER, PREFIX_DATA, GloveSource
from tools import capture_inventory as inv
from tools.fake_rgmp_server import frame_bytes, make_definition, pack_definition, pack_disconnect
from tools.replay import CaptureClock, ReplayServer, cut_window, iter_messages, restamp, split_capture

RATE = 83.33


def make_capture(path, seconds=3.0, late_left_s=1.0, boot=(5_000_000, 90_000_000)):
    """Right glove from 0 s, left glove joining at late_left_s with its own boot clock, then a disconnect."""
    out = bytearray(pack_definition(make_definition(2, "right", "transform")))
    n = int(seconds * RATE)
    left_def = False
    for k in range(n):
        t = k / RATE
        out += frame_bytes(t, boot[0] + int(t * 1e6), "right", 2, "transform")
        if t >= late_left_s:
            if not left_def:
                out += pack_definition(make_definition(1, "left", "transform"))
                left_def = True
            out += frame_bytes(t, boot[1] + int((t - late_left_s) * 1e6), "left", 1, "transform")
    out += pack_disconnect(2)
    path.write_bytes(bytes(out))
    return path


def data_times(messages):
    cc = CaptureClock()
    return [cc.t_us(DATA_HDR.unpack_from(raw, OUTER.size)[0], ts) / 1e6
            for p, ts, raw in messages if p == PREFIX_DATA]


def test_iter_messages_matches_split_capture(tmp_path):
    cap = make_capture(tmp_path / "c.rgmp")
    a = [(p, ts, raw) for p, _, ts, raw in iter_messages(cap, chunk=1000)]
    assert a == split_capture(cap.read_bytes())


def test_capture_clock_offsets_a_late_device():
    cc = CaptureClock()
    assert cc.t_us(2, 5_000_000) == 0
    assert cc.t_us(2, 5_900_000) == 900_000
    assert cc.t_us(1, 90_000_000) == 900_000  # joins at the pacer's time, not at its own boot clock
    assert cc.t_us(1, 90_500_000) == 1_400_000
    assert cc.t_us(2, 1_000) == 1_400_000 + 12_000  # the glove came back with a fresh boot clock
    assert cc.t_us(2, 101_000) == 1_512_000 and cc.rebased == 1


def test_cut_window_keeps_definitions_and_only_the_window(tmp_path):
    cap = make_capture(tmp_path / "c.rgmp")
    defs, win = cut_window(cap, 1.5, 1.0)
    assert len(defs) == 2  # the left definition came mid-file, before the window end
    ts = data_times(win)
    devs = {DATA_HDR.unpack_from(raw, OUTER.size)[0] for p, _, raw in win if p == PREFIX_DATA}
    assert devs == {1, 2}
    # window times are relative to the window's own first frame here; length about 1 s, both gloves
    assert 0.9 < max(ts) - min(ts) < 1.05
    n_right = sum(1 for p, _, raw in win if p == PREFIX_DATA and DATA_HDR.unpack_from(raw, OUTER.size)[0] == 2)
    assert abs(n_right - RATE) <= 2


def test_cut_window_empty_raises(tmp_path):
    cap = make_capture(tmp_path / "c.rgmp")
    try:
        cut_window(cap, 50.0, 1.0)
    except ValueError as e:
        assert "no data frames" in str(e)
    else:
        raise AssertionError("expected ValueError")


def test_restamp_moves_only_the_timestamp(tmp_path):
    cap = make_capture(tmp_path / "c.rgmp", seconds=0.1)
    raw = next(raw for p, ts, raw in split_capture(cap.read_bytes()) if p == PREFIX_DATA)
    moved = restamp(raw, 1234)
    d0, g0, t0 = DATA_HDR.unpack_from(raw, OUTER.size)
    d1, g1, t1 = DATA_HDR.unpack_from(moved, OUTER.size)
    assert (d1, g1, t1) == (d0, g0, t0 + 1234) and moved[OUTER.size + DATA_HDR.size:] == raw[OUTER.size + DATA_HDR.size:]


async def _read_all(port, seconds):
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    buf = bytearray()
    end = time.monotonic() + seconds
    try:
        while time.monotonic() < end:
            try:
                data = await asyncio.wait_for(reader.read(65536), 0.2)
            except TimeoutError:
                continue
            if not data:
                break
            buf += data
    finally:
        writer.close()
    return split_capture(bytes(buf))


async def test_window_loops_continuously_without_clock_jump(tmp_path):
    cap = make_capture(tmp_path / "c.rgmp")
    srv = ReplayServer(cap, port=0, loop=True, speed=4.0, start_s=1.2, seconds=0.5, continuous=True)
    await srv.start()
    msgs = await _read_all(srv.port, 0.6)
    await srv.stop()
    assert srv.passes >= 2
    per_dev: dict[int, list[int]] = {}
    for p, ts, raw in msgs:
        if p == PREFIX_DATA:
            per_dev.setdefault(DATA_HDR.unpack_from(raw, OUTER.size)[0], []).append(ts)
    for dev, tss in per_dev.items():
        assert all(b > a for a, b in zip(tss, tss[1:])), f"device {dev} timestamps went back"


async def test_stream_mode_feeds_the_glove_source(cfg, tmp_path):
    cap = make_capture(tmp_path / "c.rgmp", seconds=1.5, late_left_s=0.2)
    srv = ReplayServer(cap, port=0, speed=4.0, stream=True)
    assert srv.messages == [] and len(srv.definitions) == 2
    src = GloveSource(cfg, Clock(), logs_dir=tmp_path / "logs", replay=srv)
    await src.start()
    for _ in range(40):
        await asyncio.sleep(0.05)
        if srv.finished:
            break
    await src.stop()
    assert srv.finished and src.frames == sum(1 for p, _, _ in split_capture(cap.read_bytes()) if p == PREFIX_DATA)
    assert set(src.sides.values()) == {"left", "right"}


def test_default_replay_server_is_unchanged(tmp_path):
    cap = make_capture(tmp_path / "c.rgmp", seconds=0.5)
    srv = ReplayServer(cap, port=0)
    assert srv.messages == split_capture(cap.read_bytes()) and not srv.stream and not srv.continuous


def test_still_stretches_and_pose_words():
    t = np.arange(0, 10, 0.05)
    a = np.zeros((len(t), 18))
    a[:, inv.FLEX] = 30.0
    moving = (t > 3) & (t < 5)
    a[np.ix_(moving, inv.FLEX)] = 30 + 40 * np.sin(2 * np.pi * t[moving])[:, None]
    tracked = np.ones(len(t), dtype=bool)
    st = inv.still_stretches(t, a, tracked)
    spans = [(round(t[i0], 1), round(t[i1], 1)) for i0, i1 in st]
    assert len(spans) == 2 and spans[0][0] == 0.0 and spans[1][1] >= 9.9
    assert spans[0][1] < 3.0 and spans[1][0] >= 5.0
    assert inv.describe_pose({"thumb": 0.9, "index": 0.9, "middle": 0.9, "ring": 0.9, "little": 0.9}) == "fist, thumb closed"
    assert inv.describe_pose({"thumb": 0.2, "index": 0.1, "middle": 0.1, "ring": 0.2, "little": 0.3}) == "flat hand, thumb open"
    assert inv.describe_pose({"thumb": 0.9, "index": 0.1, "middle": 0.1, "ring": 0.9, "little": 0.9}).startswith("index+middle out")


def test_inventory_walk_on_a_synthetic_capture(tmp_path):
    cap = make_capture(tmp_path / "c.rgmp", seconds=3.0, late_left_s=1.0)
    w = inv.walk(cap, rate_hz=20)
    assert {v["side"] for v in w["devices"].values()} == {"left", "right"}
    assert abs(w["right"]["t_s"][-1] - 3.0) < 0.1 and abs(w["left"]["t_s"][0] - 1.0) < 0.1
    assert 50 < len(w["right"]["t_s"]) <= 61
    inv.save_cache(tmp_path / "c.npz", w)
    back = inv.load_cache(tmp_path / "c.npz")
    assert np.allclose(back["right"]["angles"], w["right"]["angles"])
    assert json.loads(json.dumps(back["devices"]))
