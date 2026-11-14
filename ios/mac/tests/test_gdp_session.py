"""Reader, recorder and replay on a recorded session.

The committed session fixtures/FAKE_sender_session.gdrec.gz was recorded over TCP from
ios/mac/fake_sender.py with ios/mac/record.py. It is synthetic, not a phone capture.
"""
import time
from pathlib import Path

import numpy as np

from ios.mac.fake_sender import PLANE_EXTENT
from ios.mac.geppetto_depth import SOURCE, GeppettoDepthCamera
from ios.mac.record import record
from ios.mac.recording import read_note, read_recording
from ios.mac.replay import frames, info, serve
from ios.mac.serve import PacketServer

FIXTURE = Path(__file__).parent / "fixtures" / "FAKE_sender_session.gdrec.gz"


def test_committed_fake_session_reads_as_depth_frames():
    note = read_note(FIXTURE)
    assert "FAKE" in note["note"]
    fs = list(frames(FIXTURE, latency_us=60_000))
    assert len(fs) >= 10
    ids = [f.frame_id for f in fs]
    assert ids == sorted(ids) and len(set(ids)) == len(ids)
    for f in fs:
        assert f.source == SOURCE and f.t_us == f.arrival_us - 60_000
        assert f.depth.dtype == np.float32 and f.depth.shape == (192, 256)
        assert f.confidence.shape == (192, 256) and set(np.unique(f.confidence)) <= {0, 1, 2}
        assert f.bgr.shape == (480, 640, 3) and f.depth_at_rgb().shape == (480, 640)
        assert f.plane is not None and f.transform.shape == (4, 4)
        assert abs(f.K[0, 2] - 320) < 1e-3                       # scaled from 1920 to 640
        ok = f.depth_ok()
        assert 0.95 < ok.mean() < 1.0 and abs(np.median(f.depth[ok]) - 0.55) < 1e-3
    s = info(FIXTURE)
    assert s["frames"] == len(fs) and s["with_plane"] == len(fs) and s["depth"] == [256, 192]
    assert 15 <= s["fps"] <= 60


def test_hand_moves_between_frames():
    fs = list(frames(FIXTURE))
    near = [np.argwhere((f.depth > 0) & (f.depth < 0.5)).mean(axis=0) for f in (fs[0], fs[-1])]
    assert np.linalg.norm(near[0] - near[1]) > 2.0


def test_replay_serves_the_recording_to_the_live_reader(tmp_path):
    """Replay the fixture on a port, read it with the live camera class and record it again."""
    srv = PacketServer("127.0.0.1", 0)
    out = tmp_path / "again.gdrec"
    import threading
    th = threading.Thread(target=lambda: serve(FIXTURE, server=srv, speed=2.0), daemon=True)
    th.start()
    n = len(list(read_recording(FIXTURE)))
    r = record(out, port=srv.port, frames=n, seconds=10, note={"note": "FAKE replay"}, quiet=True)
    th.join(timeout=10)
    srv.close()
    assert r["packets"] == n and r["bad"] == 0
    a = [p for _, p in read_recording(FIXTURE)]
    b = [p for _, p in read_recording(out)]
    assert a == b                                               # byte for byte


def test_camera_status_and_newest_frame_from_fake_sender():
    from ios.mac.fake_sender import make_packet
    srv = PacketServer("127.0.0.1", 0)
    cam = GeppettoDepthCamera("127.0.0.1", srv.port, timeout_s=2.0)
    assert cam.read() is None and cam.status()["connected"] is False
    cam.start()
    try:
        t0 = time.monotonic()
        while not srv.has_client and time.monotonic() - t0 < 3:
            time.sleep(0.01)
        for i in range(5):
            srv.send(make_packet(i))
            time.sleep(0.03)
        while cam.frames < 5 and time.monotonic() - t0 < 5:
            time.sleep(0.01)
        f = cam.read()
        s = cam.status()
        assert f is not None and f.frame_id == 5 and s["frames"] == 5 and s["connected"]
        assert s["depth"] == [256, 192] and s["rgb"] == [640, 480] and s["plane"] and s["tracking"] == "normal"
    finally:
        cam.stop()
        srv.close()


def test_plane_extent_constant_is_what_the_fake_sends():
    from ios.mac.fake_sender import make_packet
    from ios.mac.geppetto_depth import parse_header
    h = parse_header(make_packet(3)[8:])
    assert np.allclose(h.plane_extent, PLANE_EXTENT)
