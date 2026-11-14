import numpy as np

from core.camera.record3dstream import PacketReader, build_packet, parse_header, parse_packet, save_frame


def _frame():
    bgr = np.zeros((48, 64, 3), np.uint8); bgr[:, :, 1] = 200
    depth = np.full((12, 16), 0.75, np.float32); depth[0, 0] = 0.0
    conf = np.full((12, 16), 2, np.uint8); conf[0, 0] = 0
    K = np.array([[1366.8, 0, 961.6], [0, 1366.8, 718.7], [0, 0, 1]])
    return bgr, depth, conf, K


def test_packet_round_trip(tmp_path):
    bgr, depth, conf, K = _frame()
    pkt = build_packet(bgr, depth, K, conf, frame_id=7, timestamp=1.25)
    h = parse_header(pkt)
    assert h.version == 2 and h.frame_id == 7 and h.depth_w == 16 and h.depth_h == 12 and h.rgb_w == 64 and h.packet_size == len(pkt)
    f = parse_packet(pkt, arrival_us=1_000_000, latency_us=60_000)
    assert f is not None and f.source == "record3dstream" and f.depth_ok().sum() == 12 * 16 - 1 and f.t_us == 940_000 and f.frame_id == 7 and f.stream_t == 1.25
    assert f.bgr.shape == (48, 64, 3) and np.allclose(f.depth, depth) and np.array_equal(f.confidence, conf)
    assert np.allclose(f.K, K) and f.transform.shape == (4, 4) and f.imu.shape == (7,)
    assert f.depth_at_rgb().shape == (48, 64) and abs(f.depth_intrinsics()[0, 0] - 1366.8 * 16 / 64) < 1e-3
    info = save_frame(f, tmp_path / "snap")
    assert (tmp_path / "snap" / "rgb.jpg").exists() and (tmp_path / "snap" / "depth.npy").exists()
    assert info["confidence"]["fraction"]["high"] > 0.99 and info["depth"]["valid_fraction"] < 1.0


def test_reader_splits_and_resyncs():
    bgr, depth, conf, K = _frame()
    p1, p2 = build_packet(bgr, depth, K, conf, frame_id=1), build_packet(bgr, depth, K, conf, frame_id=2)
    data = b"junk" + p1 + p2
    r = PacketReader()
    got = []
    for i in range(0, len(data), 1000):
        got += r.feed(data[i:i + 1000])
    assert [parse_header(g).frame_id for g in got] == [1, 2] and r.resyncs == 1
