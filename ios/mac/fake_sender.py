"""FAKE phone: speaks the GeppettoDepth protocol (ios/PROTOCOL.md) with a synthetic workbench scene.

Not real data. Use it to test the reader, recorder and replay without an iPhone.

Scene: the phone looks straight down from 0.55 m at a table (world y = 0, gravity up).
A hand-sized blob (palm disc and four finger bars) circles 0.10 m above the table.
Depth is in metres along the optical axis, as ARKit gives it.

    python -m ios.mac.fake_sender                # serve on 127.0.0.1:7700 at 30 Hz
    python -m ios.mac.fake_sender --port 7701 --seconds 10
"""
from __future__ import annotations

import argparse
import logging
import math
import time

import numpy as np

from .geppetto_depth import DEFAULT_PORT, build_packet
from .serve import PacketServer

DEPTH_W, DEPTH_H = 256, 192
JPEG_W, JPEG_H = 640, 480
CAM_W, CAM_H = 1920, 1440
FX = FY = 1450.0
TABLE_M = 0.55
HAND_M = 0.45
K_CAM = np.array([[FX, 0, CAM_W / 2], [0, FY, CAM_H / 2], [0, 0, 1]])

# ARKit camera axes in world: x right = world x, y up (image up) = world -z, z back = world +y.
CAMERA_POSE = np.array([[1, 0, 0, 0], [0, 0, 1, TABLE_M], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=float)
PLANE_POSE = np.eye(4)
PLANE_EXTENT = (1.2, 0.8)


def hand_mask(w: int, h: int, t: float) -> np.ndarray:
    """Palm disc plus four finger bars, circling the image centre, at image size w x h."""
    yy, xx = np.mgrid[0:h, 0:w]
    s = w / DEPTH_W
    cx = w / 2 + 40 * s * math.cos(t)
    cy = h / 2 + 25 * s * math.sin(t)
    r = 22 * s
    m = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    for i in range(4):
        fx = cx + (-15 + 10 * i) * s
        m |= (np.abs(xx - fx) <= 3 * s) & (yy <= cy - r * 0.6) & (yy >= cy - r - 28 * s)
    return m


def make_frame(i: int, fps: float = 30.0):
    """(bgr, depth, confidence) for frame i."""
    import cv2
    t = i / fps
    depth = np.full((DEPTH_H, DEPTH_W), TABLE_M, np.float32)
    mask_d = hand_mask(DEPTH_W, DEPTH_H, t)
    depth[mask_d] = HAND_M
    conf = np.full((DEPTH_H, DEPTH_W), 2, np.uint8)
    edge = mask_d ^ cv2.erode(mask_d.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    conf[edge] = 1
    conf[:8, :8] = 0
    depth[:8, :8] = 0.0
    bgr = np.empty((JPEG_H, JPEG_W, 3), np.uint8)
    bgr[:] = (60, 110, 160)                      # wood, BGR
    bgr[hand_mask(JPEG_W, JPEG_H, t)] = (120, 160, 220)  # skin, BGR
    return bgr, depth, conf


def make_packet(i: int, fps: float = 30.0) -> bytes:
    bgr, depth, conf = make_frame(i, fps)
    return build_packet(bgr, depth, K_CAM, conf, frame_id=i + 1, timestamp=1000.0 + i / fps,
                        transform=CAMERA_POSE, plane=PLANE_POSE, plane_extent=PLANE_EXTENT,
                        cam_wh=(CAM_W, CAM_H))


def run(port: int = DEFAULT_PORT, fps: float = 30.0, seconds: float = 0.0, host: str = "127.0.0.1") -> None:
    srv = PacketServer(host, port)
    print(f"FAKE GeppettoDepth sender on {host}:{srv.port} at {fps:g} Hz (synthetic scene, not a phone)")
    t0 = time.monotonic()
    i = 0
    try:
        while not seconds or time.monotonic() - t0 < seconds:
            if srv.has_client:
                srv.send(make_packet(i, fps))
            i += 1
            time.sleep(max(0.0, t0 + i / fps - time.monotonic()))
    except KeyboardInterrupt:
        pass
    finally:
        srv.close()
        print(f"sent {srv.sent} frames")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--fps", type=float, default=30.0)
    p.add_argument("--seconds", type=float, default=0.0, help="stop after this long (0 runs until Ctrl-C)")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO)
    run(a.port, a.fps, a.seconds, a.host)


if __name__ == "__main__":
    main()
