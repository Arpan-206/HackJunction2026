import struct

import numpy as np

from ios.mac.fake_sender import CAMERA_POSE, HAND_M, TABLE_M, make_frame, make_packet
from ios.mac.geppetto_depth import (
    FLAG_CONFIDENCE,
    FLAG_PLANE,
    HEADER_SIZE,
    MAGIC,
    PREFIX,
    SOURCE,
    PacketReader,
    build_packet,
    opencv_pose,
    parse_header,
    parse_packet,
)


def _small():
    bgr = np.zeros((48, 64, 3), np.uint8)
    bgr[:, :, 1] = 200
    depth = np.full((12, 16), 0.75, np.float32)
    depth[0, 0] = 0.0
    depth[1, 1] = 0.3337
    conf = np.full((12, 16), 2, np.uint8)
    conf[0, 0] = 0
    K = np.array([[1366.8, 0, 961.6], [0, 1366.8, 718.7], [0, 0, 1]])
    return bgr, depth, conf, K


def test_header_is_216_bytes_and_layout_matches_protocol_md():
    bgr, depth, conf, K = _small()
    pkt = build_packet(
        bgr,
        depth,
        K,
        conf,
        frame_id=9,
        timestamp=12.5,
        plane=np.eye(4),
        plane_extent=(1.0, 0.5),
        cam_wh=(1920, 1440),
    )
    assert HEADER_SIZE == 216 and pkt[:4] == MAGIC
    magic, n = PREFIX.unpack_from(pkt, 0)
    assert n == len(pkt) - 8
    p = pkt[8:]
    # spot-check offsets written in ios/PROTOCOL.md
    assert struct.unpack_from("<H", p, 0)[0] == 1
    assert struct.unpack_from("<H", p, 2)[0] == FLAG_PLANE | FLAG_CONFIDENCE
    assert struct.unpack_from("<I", p, 4)[0] == 9
    assert struct.unpack_from("<d", p, 8)[0] == 12.5
    assert struct.unpack_from("<HHHHHH", p, 16) == (16, 12, 64, 48, 1920, 1440)
    assert struct.unpack_from("<I", p, 28)[0] == 16 * 12 * 2
    assert struct.unpack_from("<I", p, 32)[0] == 16 * 12
    assert abs(struct.unpack_from("<f", p, 40)[0] - 1366.8) < 1e-3  # K[0,0]
    assert (
        abs(struct.unpack_from("<f", p, 40 + 2 * 4)[0] - 961.6) < 1e-3
    )  # K[0,2], row-major
    assert struct.unpack_from("<ff", p, 204) == (1.0, 0.5)
    assert p[212] == 2
    assert n == HEADER_SIZE + 16 * 12 * 2 + 16 * 12 + struct.unpack_from("<I", p, 36)[0]


def test_round_trip_decodes_float16_to_float32_and_scales_K():
    bgr, depth, conf, K = _small()
    T = np.eye(4)
    T[:3, 3] = [0.1, 0.2, 0.3]
    pkt = build_packet(
        bgr,
        depth,
        K,
        conf,
        frame_id=7,
        timestamp=1.25,
        transform=T,
        cam_wh=(1920, 1440),
    )
    f = parse_packet(pkt, arrival_us=1_000_000, latency_us=60_000)
    assert f is not None and f.source == SOURCE == "geppetto-depth"
    assert (
        f.t_us == 940_000
        and f.arrival_us == 1_000_000
        and f.frame_id == 7
        and f.stream_t == 1.25
    )
    assert f.depth.dtype == np.float32 and f.depth.shape == (12, 16)
    assert np.allclose(
        f.depth, depth, atol=5e-4
    )  # float16 keeps about 0.1 mm at 0.3 to 1 m
    assert f.depth_ok().sum() == 12 * 16 - 1
    assert f.confidence.dtype == np.uint8 and np.array_equal(f.confidence, conf)
    assert f.bgr.shape == (48, 64, 3)
    assert (
        abs(f.K[0, 0] - 1366.8 * 64 / 1920) < 1e-3
        and abs(f.K[1, 2] - 718.7 * 48 / 1440) < 1e-3
    )
    assert np.allclose(f.transform, T) and f.plane is None
    assert abs(f.depth_intrinsics()[0, 0] - 1366.8 * 16 / 1920) < 1e-3


def test_plane_and_no_confidence():
    bgr, depth, _, K = _small()
    P = np.eye(4)
    P[1, 3] = -0.4
    f = parse_packet(
        build_packet(bgr, depth, K, None, plane=P, plane_extent=(1.2, 0.8)), 0
    )
    assert f.confidence is None and np.allclose(f.plane, P)
    h = parse_header(
        build_packet(bgr, depth, K, None, plane=P, plane_extent=(1.2, 0.8))[8:]
    )
    assert h.flags == FLAG_PLANE and np.allclose(h.plane_extent, (1.2, 0.8))


def test_reader_splits_resyncs_and_skips_bogus_lengths():
    bgr, depth, conf, K = _small()
    p1, p2, p3 = (build_packet(bgr, depth, K, conf, frame_id=i) for i in (1, 2, 3))
    bogus = MAGIC + struct.pack("<I", 0xFFFFFFF0)  # a magic with an absurd length
    # joined mid-packet (the tail of an earlier packet), then a bogus length, then good packets
    data = p3[300:] + p1 + bogus + p2 + p3
    r = PacketReader()
    got = []
    for i in range(0, len(data), 777):
        got += r.feed(data[i : i + 777])
    ids = [parse_header(g[8:]).frame_id for g in got]
    assert ids == [1, 2, 3] and r.resyncs >= 2


def test_unknown_version_and_bad_jpeg_give_none():
    bgr, depth, conf, K = _small()
    pkt = bytearray(build_packet(bgr, depth, K, conf))
    pkt[8] = 9
    assert parse_packet(bytes(pkt), 0) is None
    pkt = bytearray(build_packet(bgr, depth, K, conf))
    pkt[8 + HEADER_SIZE + 16 * 12 * 3 :] = b"\0" * (
        len(pkt) - 8 - HEADER_SIZE - 16 * 12 * 3
    )
    assert parse_packet(bytes(pkt), 0) is None


def test_fake_scene_geometry_is_consistent():
    """Back-project the fake depth with K and the pose: the table lands on y = 0, the hand above it."""
    f = parse_packet(make_packet(0), 0)
    _, depth, _ = make_frame(0)
    Kd = f.depth_intrinsics()
    T = opencv_pose(f.transform)
    for (v, u), want_y in (((180, 250), 0.0), ((96, 128 + 40), TABLE_M - HAND_M)):
        d = f.depth[v, u]
        assert abs(d - depth[v, u]) < 1e-3
        p_cam = np.array(
            [(u - Kd[0, 2]) / Kd[0, 0] * d, (v - Kd[1, 2]) / Kd[1, 1] * d, d, 1.0]
        )
        p_world = T @ p_cam
        assert abs(p_world[1] - want_y) < 1e-3, (u, v, p_world)
    assert np.allclose(f.transform, CAMERA_POSE)
    assert np.allclose(f.plane, np.eye(4))
