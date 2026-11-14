"""FAKE depth phone: a synthetic bench scene in the exact GeppettoDepth wire format (ios/PROTOCOL.md).

Not real data. Every depth test runs on this, because there is no real bench recording
with a hand and a forearm yet.

Scene, in the ARKit world (metres, y up, gravity aligned, the camera looks along -z at t=0):
- The phone stands on the bench 0.14 m above the table top, pitched 30 degrees down,
  facing the person across the bench.
- The table is the plane y = 0, 1.2 m wide (x) and 0.8 m deep (z), centred 0.35 m ahead.
  Past its edges the rays hit the floor (y = -0.75) or a wall (z = -1.6).
- A forearm (capsule from 0.64 m ahead and 0.12 m up, past the top of the image, to
  the wrist about 0.28 m ahead and 0.055 m up) and a hand (palm, four fingers
  and a thumb, all capsules) lie above the table. The fingers point toward the phone.
  The arm swings about the elbow: that swing is the hand yaw the depth tracker must find.

Sensor model, from the bench capture (STATUS.md "Bench capture"): depth noise 1.8 mm
standard deviation on high confidence pixels and 59 mm on low confidence pixels. Medium
(12 mm) is a guess. Depth edges and far pixels get lower confidence, as ARKit does.

Variant dark_hand (black gloves): the hand returns no usable depth. Its pixels carry
confidence 0 and a depth smoothly interpolated from the surroundings, which is how ARKit
behaved on black fabric. The forearm (sleeve) still returns depth.

    python -m core.camera.fake_depth                         # serve on 127.0.0.1:7700 at 30 Hz
    python -m core.camera.fake_depth --dark-hand --port 7701 --seconds 20
    python -m core.camera.fake_depth --record logs/depth/fake.gdrec.gz --seconds 10 [--dark-hand] [--no-plane]

Core yaw convention (core/rgmp.py _yaw_of): yaw 0 is the fingers pointing away from the
person (core world -z). With this scene and [camera.depth] camera_yaw_deg = 180, the core
yaw of the hand equals FakeDepthScene.yaw_deg(t).
"""
from __future__ import annotations

import argparse
import logging
import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .gdp_server import PacketServer
from .gdrec import RecordingWriter
from .geppetto_depth import DEFAULT_PORT, build_packet

DEPTH_W, DEPTH_H = 256, 192
JPEG_W, JPEG_H = 640, 480
CAM_W, CAM_H = 1920, 1440
FX = FY = 1450.0
K_CAM = np.array([[FX, 0, CAM_W / 2], [0, FY, CAM_H / 2], [0, 0, 1]])

SIGMA_HIGH_M = 0.0018     # measured, bench capture
SIGMA_MEDIUM_M = 0.012    # guess
SIGMA_LOW_M = 0.059       # measured, bench capture
SIGMA_DARK_M = 0.003      # black fabric: filled and smooth (bench capture), small ripple

LABEL_BG, LABEL_TABLE, LABEL_ARM, LABEL_HAND = 0, 1, 2, 3
COLOURS = {LABEL_BG: (45, 45, 50), LABEL_TABLE: (60, 110, 160), LABEL_ARM: (120, 95, 70),
           LABEL_HAND: (120, 160, 220)}
BLACK_GLOVE = (22, 22, 24)

TABLE_CENTRE_Z = -0.35
TABLE_EXTENT = (1.2, 0.8)
FLOOR_Y = -0.75
WALL_Z = -1.6


def rot_x(deg: float) -> np.ndarray:
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(deg: float) -> np.ndarray:
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def default_yaw(t: float) -> float:
    """The arm's swing in degrees: two slow sines, about +-23 degrees."""
    return 17.0 * math.sin(2 * math.pi * t / 6.0) + 6.0 * math.sin(2 * math.pi * t / 2.3)


@dataclass
class FakeDepthScene:
    """A bench, a forearm and a hand. yaw_fn(t) gives the hand yaw in core degrees."""

    cam_height_m: float = 0.14
    pitch_deg: float = 30.0
    dark_hand: bool = False
    with_plane: bool = True
    plane_after_s: float = 0.0              # ARKit finds the plane only after a moment
    yaw_fn: Callable[[float], float] = default_yaw
    seed: int = 0
    no_arm: bool = False                     # an empty bench
    _rays: np.ndarray = field(init=False, repr=False)

    def __post_init__(self) -> None:
        K_d = K_CAM.copy()
        K_d[0] *= DEPTH_W / CAM_W
        K_d[1] *= DEPTH_H / CAM_H
        self.K_depth = K_d
        v, u = np.mgrid[0:DEPTH_H, 0:DEPTH_W]
        x = (u + 0.5 - K_d[0, 2]) / K_d[0, 0]
        y = (v + 0.5 - K_d[1, 2]) / K_d[1, 1]
        r_cv = np.stack([x, y, np.ones_like(x)], -1).reshape(-1, 3)     # OpenCV camera rays, z = 1
        self.R_arkit = rot_x(-self.pitch_deg)                             # camera to world, ARKit axes
        R_cv = self.R_arkit @ np.diag([1.0, -1.0, -1.0])
        d = r_cv @ R_cv.T
        n = np.linalg.norm(d, axis=1, keepdims=True)
        self._rays = d / n                                                # unit rays in the world
        self._zscale = (1.0 / n[:, 0])                                    # depth along the axis per metre of ray
        self.origin = np.array([0.0, self.cam_height_m, 0.0])

    # -- poses ---------------------------------------------------------------
    @property
    def transform(self) -> np.ndarray:
        T = np.eye(4)
        T[:3, :3] = self.R_arkit
        T[:3, 3] = self.origin
        return T

    @property
    def plane_pose(self) -> np.ndarray:
        P = np.eye(4)
        P[2, 3] = TABLE_CENTRE_Z
        return P

    def yaw_deg(self, t: float) -> float:
        return float(self.yaw_fn(t))

    def arm(self, t: float) -> dict:
        """Elbow, wrist and pointing direction (elbow to fingers) in the ARKit world at time t."""
        yaw = self.yaw_deg(t)
        # core yaw 0 points away from the person, which here is toward the phone (+z)
        fwd = rot_y(yaw) @ np.array([0.0, 0.0, 1.0])
        elbow = np.array([0.03 * math.sin(2 * math.pi * t / 9.0), 0.12, -0.64])
        wrist = elbow + 0.36 * fwd
        wrist[1] = 0.055 + 0.01 * math.sin(2 * math.pi * t / 3.1)
        return {"yaw_deg": yaw, "elbow": elbow, "wrist": wrist, "fwd": fwd}

    def capsules(self, t: float) -> list[tuple[np.ndarray, np.ndarray, float, int]]:
        """(a, b, radius, label) for the forearm and every part of the hand."""
        if self.no_arm:
            return []
        a = self.arm(t)
        fwd, wrist, elbow = a["fwd"], a["wrist"], a["elbow"]
        side = np.cross(np.array([0.0, 1.0, 0.0]), fwd)
        side /= np.linalg.norm(side)
        down = np.array([0.0, -1.0, 0.0])
        caps = [(elbow, wrist - 0.01 * fwd, 0.034, LABEL_ARM)]
        palm_end = wrist + 0.09 * fwd + 0.008 * down
        for k in (-0.024, 0.0, 0.024):
            caps.append((wrist + k * side * 0.8, palm_end + k * side, 0.014, LABEL_HAND))
        for k, length in zip((-0.027, -0.009, 0.009, 0.027), (0.065, 0.08, 0.075, 0.06)):
            base = palm_end + k * side
            tip = base + length * fwd + 0.025 * down
            caps.append((base, tip, 0.0085, LABEL_HAND))
        tb = wrist + 0.03 * fwd + 0.035 * side
        caps.append((tb, tb + 0.05 * (fwd + 0.6 * side) / np.linalg.norm(fwd + 0.6 * side) + 0.02 * down,
                     0.010, LABEL_HAND))
        return caps

    # -- rendering -----------------------------------------------------------
    def _background(self) -> tuple[np.ndarray, np.ndarray]:
        """Ray length and label for the table, floor and wall (the phone is still, so cached)."""
        if getattr(self, "_bg", None) is None:
            self._bg = self._background_uncached()
        return self._bg[0].copy(), self._bg[1].copy()

    def _background_uncached(self) -> tuple[np.ndarray, np.ndarray]:
        o, d = self.origin, self._rays
        t = np.full(len(d), np.inf)
        lab = np.full(len(d), LABEL_BG, np.uint8)
        with np.errstate(divide="ignore", invalid="ignore"):
            tt = -o[1] / d[:, 1]
            p = o + tt[:, None] * d
            on_table = (tt > 0) & (np.abs(p[:, 0]) <= TABLE_EXTENT[0] / 2) \
                & (np.abs(p[:, 2] - TABLE_CENTRE_Z) <= TABLE_EXTENT[1] / 2)
            t[on_table] = tt[on_table]
            lab[on_table] = LABEL_TABLE
            tf = (FLOOR_Y - o[1]) / d[:, 1]
            use = ~on_table & (tf > 0)
            t[use] = tf[use]
            tw = (WALL_Z - o[2]) / d[:, 2]
            use = (tw > 0) & (tw < t)
            t[use] = tw[use]
            lab[use & ~on_table] = LABEL_BG
        return t, lab

    def _capsule(self, a: np.ndarray, b: np.ndarray, r: float) -> np.ndarray:
        """Ray length to a capsule for every ray (inf on a miss). Rays that miss its bounding sphere skip the maths."""
        c = (a + b) / 2
        R = np.linalg.norm(b - a) / 2 + r
        oc = c - self.origin
        along = self._rays @ oc
        near = (oc @ oc - along * along) <= R * R
        out = np.full(len(self._rays), np.inf)
        idx = np.nonzero(near)[0]
        if len(idx):
            out[idx] = self._capsule_rays(self._rays[idx], a, b, r)
        return out

    def _capsule_rays(self, rd: np.ndarray, a: np.ndarray, b: np.ndarray, r: float) -> np.ndarray:
        """Inigo Quilez's closed-form ray-capsule intersection, vectorised over unit rays rd."""
        ro = self.origin
        ba, oa = b - a, ro - a
        baba = ba @ ba
        bard = rd @ ba
        baoa = oa @ ba
        rdoa = rd @ oa
        oaoa = oa @ oa
        A = baba - bard * bard
        B = baba * rdoa - baoa * bard
        C = baba * oaoa - baoa * baoa - r * r * baba
        h = B * B - A * C
        out = np.full(len(rd), np.inf)
        hit = h >= 0
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (-B - np.sqrt(np.where(hit, h, 0))) / A
            y = baoa + t * bard
            body = hit & (y > 0) & (y < baba) & (t > 0)
            out[body] = t[body]
            cap = hit & ~body
            if cap.any():
                oc = np.where((y <= 0)[:, None], oa, ro - b)
                b2 = np.einsum("ij,ij->i", rd, oc)
                c2 = np.einsum("ij,ij->i", oc, oc) - r * r
                h2 = b2 * b2 - c2
                tc = -b2 - np.sqrt(np.where(h2 > 0, h2, 0))
                ok = cap & (h2 > 0) & (tc > 0)
                out[ok] = tc[ok]
        return out

    def render(self, t: float, frame_index: int = 0) -> dict:
        """Depth (float32 metres), confidence (uint8), labels and colour (BGR, 640x480) at time t."""
        import cv2
        rng = np.random.default_rng(self.seed * 1_000_003 + frame_index)
        tl, lab = self._background()
        tl_behind = None
        for a, b, r, label in self.capsules(t):
            if label == LABEL_HAND and tl_behind is None:
                tl_behind = tl.copy()          # what lies behind the hand: table and forearm
            tc = self._capsule(a, b, r)
            closer = tc < tl
            tl[closer] = tc[closer]
            lab[closer] = label
        depth = (tl * self._zscale).reshape(DEPTH_H, DEPTH_W)
        labels = lab.reshape(DEPTH_H, DEPTH_W)
        depth[~np.isfinite(depth)] = 0.0

        # confidence: depth edges and far range are less sure, as ARKit reports
        pad = np.pad(depth, 1, mode="edge")
        jump = np.max(np.abs(np.stack([pad[1:-1, :-2], pad[1:-1, 2:], pad[:-2, 1:-1], pad[2:, 1:-1]]) - depth), axis=0)
        conf = np.full(depth.shape, 2, np.uint8)
        conf[(jump > 0.01) | (depth > 1.5)] = 1
        strong = (jump > 0.03) | (depth > 2.5) | (depth <= 0)
        strong = cv2.dilate(strong.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        conf[strong] = 0
        conf[rng.random(depth.shape) < 0.005] = 0

        hand = labels == LABEL_HAND
        sigma = np.choose(conf, [SIGMA_LOW_M, SIGMA_MEDIUM_M, SIGMA_HIGH_M])
        noisy = depth + rng.normal(0.0, 1.0, depth.shape) * sigma
        if self.dark_hand and hand.any() and tl_behind is not None:
            m = cv2.dilate(hand.astype(np.uint8), np.ones((3, 3), np.uint8))
            behind = (tl_behind * self._zscale).reshape(DEPTH_H, DEPTH_W).astype(np.float32)
            behind[~np.isfinite(behind)] = 0.0
            filled = cv2.GaussianBlur(behind, (15, 15), 4.0)
            mb = m.astype(bool)
            noisy[mb] = filled[mb] + rng.normal(0.0, SIGMA_DARK_M, int(mb.sum()))
            conf[mb] = 0
        noisy[depth <= 0] = 0.0
        noisy = np.clip(noisy, 0.0, 60.0).astype(np.float32)

        lab_rgb = cv2.resize(labels, (JPEG_W, JPEG_H), interpolation=cv2.INTER_NEAREST)
        bgr = np.zeros((JPEG_H, JPEG_W, 3), np.uint8)
        for k, c in COLOURS.items():
            bgr[lab_rgb == k] = c
        if self.dark_hand:
            bgr[lab_rgb == LABEL_HAND] = BLACK_GLOVE
        shade = cv2.resize(np.clip(1.2 - 0.6 * depth, 0.4, 1.1), (JPEG_W, JPEG_H))
        bgr = np.clip(bgr * shade[..., None], 0, 255).astype(np.uint8)
        bgr = cv2.GaussianBlur(bgr, (3, 3), 0.8)
        return {"depth": noisy, "confidence": conf, "labels": labels, "bgr": bgr, "truth_depth": depth}

    def packet(self, i: int, fps: float = 30.0) -> bytes:
        """Frame i as the phone sends it."""
        t = i / fps
        r = self.render(t, i)
        plane = self.plane_pose if self.with_plane and t >= self.plane_after_s else None
        return build_packet(r["bgr"], r["depth"], K_CAM, r["confidence"], frame_id=i + 1,
                            timestamp=1000.0 + t, transform=self.transform, plane=plane,
                            plane_extent=TABLE_EXTENT if plane is not None else (0.0, 0.0),
                            cam_wh=(CAM_W, CAM_H), tracking=2)


def write_recording(path: Path, scene: FakeDepthScene, seconds: float = 10.0, fps: float = 30.0,
                    t0_us: int = 1_700_000_000_000_000, note: str = "") -> int:
    """Write a .gdrec(.gz) of the scene without a socket. Arrival times are t0 plus 1/fps steps."""
    n = int(round(seconds * fps))
    meta = {"source": "FAKE core.camera.fake_depth", "dark_hand": scene.dark_hand,
            "with_plane": scene.with_plane, "fps": fps, "note": note or "synthetic bench scene, not a phone"}
    with RecordingWriter(Path(path), meta) as w:
        for i in range(n):
            w.write(t0_us + int(i * 1e6 / fps), scene.packet(i, fps))
    return n


def serve(scene: FakeDepthScene, port: int = DEFAULT_PORT, fps: float = 30.0, seconds: float = 0.0,
          host: str = "127.0.0.1", server: PacketServer | None = None) -> int:
    """Serve the scene like the phone: one client, frames dropped while nobody listens."""
    srv = server or PacketServer(host, port)
    print(f"FAKE depth phone on {host}:{srv.port} at {fps:g} Hz, dark_hand={scene.dark_hand} (synthetic, not a phone)")
    t0 = time.monotonic()
    i = 0
    try:
        while not seconds or time.monotonic() - t0 < seconds:
            if srv.has_client:
                srv.send(scene.packet(i, fps))
            i += 1
            time.sleep(max(0.0, t0 + i / fps - time.monotonic()))
    except KeyboardInterrupt:
        pass
    finally:
        if server is None:
            srv.close()
    return srv.sent


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--fps", type=float, default=30.0)
    p.add_argument("--seconds", type=float, default=0.0, help="stop after this long (0 runs until Ctrl-C)")
    p.add_argument("--dark-hand", action="store_true", help="black gloves: no usable depth on the hand")
    p.add_argument("--no-plane", action="store_true", help="send no table plane (the core must fit its own)")
    p.add_argument("--record", type=Path, help="write a .gdrec.gz instead of serving")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO)
    scene = FakeDepthScene(dark_hand=a.dark_hand, with_plane=not a.no_plane)
    if a.record:
        n = write_recording(a.record, scene, a.seconds or 10.0, a.fps)
        print(f"wrote {n} FAKE frames to {a.record}")
    else:
        serve(scene, a.port, a.fps, a.seconds, a.host)


if __name__ == "__main__":
    main()
