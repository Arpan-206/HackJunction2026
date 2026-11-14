"""Hand root: the wrist's position in 3D from the phone's colour frame plus its LiDAR depth.

The gloves give joint angles and the wrist orientation, but no position, so the hand
stays at its rest pose. This module finds where the wrist is on the bench:

1. MediaPipe Hand Landmarker (tasks API, VIDEO mode) on the colour frame (640x480).
   Three landmarks per hand: the wrist (0), the index knuckle (5), the little knuckle (17).
2. Depth at each landmark: the colour pixel scales to the depth pixel (same field of
   view, core/camera/depth.py). A small window of depth pixels that pass
   DepthFrame.depth_ok gives a near percentile, so the table behind an edge pixel does
   not win. The wrist keeps its own depth when it agrees with the knuckles, else it
   takes their median (a wrist in a sleeve or off the depth map still gets a depth).
3. Back-projection with DepthFrame.depth_intrinsics(), then the phone's camera-to-world
   transform (ARKit world, gravity up), then the bench frame: the table plane (the app's
   plane, else a RANSAC fit) with y up and the core's yaw convention, as
   core/camera/depth_track.py DepthTracker.bench_axes defines it. The bench frame is
   frozen once found, so a growing ARKit plane cannot move it. If the phone moves (the
   stand is bumped), fixes stop until the phone is still again, then the bench re-anchors.
4. Core world. origin = "lock" (default): the first confident fix of a side lands on
   that side's [rest_pose] and later motion is relative to it, so the hand starts where
   the viewer already draws it. origin = "bench": bench coordinates plus a fixed offset.
5. Smoothing: a One Euro filter per hand with a high beta, so a still hand is steady and
   a moving one lags by much less than one frame.

Output per hand: a WristFix (position in the core world, a confidence 0 to 1, the
handedness MediaPipe reports, flipped only if [camera.root] swap_handedness). Fusion with the glove is
core/root_fuse.py. The thread wrapper for the live core is HandRootLive at the end.

Verified on captures/bench-stand-1.gdrec.gz (a bare hand). Not verified: a gloved hand
(black fabric may defeat MediaPipe and the LiDAR both), two hands at once.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .. import geom
from ..delay import STATS
from .depth import DepthFrame
from .depth_track import ARKIT_TO_OPENCV, DepthTracker, Table, TrackerConfig, app_table, backproject, fit_table

log = logging.getLogger("geppetto.camera.hand_root")

LM_WRIST, LM_INDEX_MCP, LM_LITTLE_MCP = 0, 5, 17
SIDES = ("left", "right")


@dataclass
class RootConfig:
    min_confidence: int = 1          # depth confidence (0 low, 1 medium, 2 high)
    window_px: int = 2               # half window at the depth resolution (5x5)
    near_pct: float = 30.0           # percentile of the window's depths (low = nearer the camera)
    agree_m: float = 0.06            # wrist depth must be within this of the knuckles' median
    max_range_m: float = 1.5         # from the camera
    min_height_m: float = -0.03      # above the table
    max_height_m: float = 0.6
    swap_handedness: bool = False    # True flips MediaPipe's label (the stand clip needed it, the riser does not)
    origin: str = "lock"             # "lock" or "bench"
    bench_offset_m: tuple = (0.0, 0.0, 0.0)  # origin = "bench": added to bench coordinates
    one_euro_min_cutoff: float = 2.0
    one_euro_beta: float = 4.0
    one_euro_d_cutoff: float = 1.0
    moved_deg: float = 10.0          # camera turned this far from the anchor: the phone moved
    moved_m: float = 0.05
    still_s: float = 1.0             # still this long after a move: re-anchor the bench
    forget_s: float = 0.5            # a hand unseen this long restarts its filter
    camera_yaw_deg: float = 180.0    # from [camera.depth]: 180 when the phone faces the person
    motion_scale: float = 0.6        # the 3D hand moves this much of the real hand's motion
    height_from_table: bool = True   # core y = floor_y_m + motion_scale * height above the table
    floor_y_m: float = 0.05          # core y of the table (the work box floor)
    tracker_filter: bool = False     # the fuser's One Euro filter smooths; a second one only adds lag
    mode: str = "auto"               # "auto": depth blobs first (gloves), MediaPipe if none; "blobs"; "mediapipe"
    max_blobs: int = 2
    min_darkness: float = 0.0        # blobs lighter than this are ignored (0 keeps bare hands too)
    use_led: bool = True
    track_gate_m: float = 0.12       # a blob within this of a recent blob is the same track (its filter)
    rotate: str = "auto"             # "auto" (world up to image top) or quarter turns clockwise "0".."3"
    clahe: bool = True               # grey plus local contrast: 12 to 46 percent of frames on the stand clip
    num_hands: int = 2
    min_detection_confidence: float = 0.3
    min_presence_confidence: float = 0.3
    min_tracking_confidence: float = 0.3

    @classmethod
    def from_config(cls, cfg) -> "RootConfig":
        c = cls()
        cam = cfg.camera
        dep = cam.get("depth") if "depth" in cam else None
        if dep is not None and "camera_yaw_deg" in dep:
            c.camera_yaw_deg = float(dep.camera_yaw_deg)
        if "num_hands" in cam:
            c.num_hands = int(cam.num_hands)
        sec = cam.get("root") if "root" in cam else None
        if sec is not None:
            for k in c.__dataclass_fields__:
                if k in sec:
                    v = sec[k]
                    setattr(c, k, tuple(float(x) for x in v) if isinstance(getattr(c, k), tuple) else
                            type(getattr(c, k))(v))
        return c


@dataclass
class WristFix:
    side: str                    # MediaPipe's handedness, after the swap: "left" or "right"
    score: float                 # MediaPipe's handedness score
    p: np.ndarray                # (3,) core world, metres, smoothed
    p_bench: np.ndarray          # (3,) bench frame, metres, raw
    confidence: float            # 0 to 1: share of the three landmarks with depth, less if the wrist borrowed
    px: tuple[float, float]      # wrist pixel in the colour frame
    t_us: int
    frame_id: int
    knuckles_bench: list = field(default_factory=list)
    darkness: float | None = None  # blob fixes: 1 = black (a glove); None for MediaPipe fixes
    led: bool = False            # a ring LED was found on this blob
    source: str = "mediapipe"    # "blob" or "mediapipe"
    key: str = ""                # the tracker's short-lived track id


@dataclass
class Detection:
    """One hand from the landmarker: 21 normalised (x, y) image landmarks, label, score."""
    lm: np.ndarray               # (21, 2) or more columns; x, y in 0..1 of the colour frame
    label: str                   # "Left" or "Right", as MediaPipe says
    score: float


class MediaPipeDetector:
    """The MediaPipe Hand Landmarker in VIDEO mode, made lazily (the import is slow)."""

    def __init__(self, model_path: str | Path, cfg: RootConfig) -> None:
        self.model_path = Path(model_path)
        self.cfg = cfg
        self._lm = None
        self._mp = None
        self._last_ms = -1

    def _make(self) -> None:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        if not self.model_path.exists():
            raise FileNotFoundError(f"MediaPipe model missing at {self.model_path}. Run: python -m tools.fetch_models")
        opts = vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(self.model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=int(self.cfg.num_hands),
            min_hand_detection_confidence=float(self.cfg.min_detection_confidence),
            min_hand_presence_confidence=float(self.cfg.min_presence_confidence),
            min_tracking_confidence=float(self.cfg.min_tracking_confidence),
        )
        self._mp = mp
        self._lm = vision.HandLandmarker.create_from_options(opts)

    def __call__(self, bgr: np.ndarray, t_us: int, rot: int = 0) -> list[Detection]:
        """rot: quarter turns clockwise applied before detection; landmarks come back in bgr's coordinates."""
        import cv2
        if self._lm is None:
            self._make()
        ts = int(t_us // 1000)
        if ts <= self._last_ms:
            ts = self._last_ms + 1
        self._last_ms = ts
        img = rotate_image(bgr, rot)
        if self.cfg.clahe:
            g = cv2.createCLAHE(2.0, (8, 8)).apply(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
            rgb = cv2.cvtColor(g, cv2.COLOR_GRAY2RGB)
        else:
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        res = self._lm.detect_for_video(self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb), ts)
        out = []
        for lms, handed in zip(res.hand_landmarks, res.handedness):
            c = handed[0] if handed else None
            lm = unrotate_points(np.array([[p.x, p.y] for p in lms], dtype=float), rot)
            out.append(Detection(lm, c.category_name if c else "Right", float(c.score) if c else 0.0))
        return out

    def close(self) -> None:
        if self._lm is not None:
            self._lm.close()
            self._lm = None


def rotate_image(img: np.ndarray, rot: int) -> np.ndarray:
    """Turn img by rot quarter turns clockwise."""
    import cv2
    rot %= 4
    if rot == 0:
        return img
    return cv2.rotate(img, (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE)[rot - 1])


def unrotate_points(p: np.ndarray, rot: int) -> np.ndarray:
    """Normalised (x, y) in an image turned rot quarter turns clockwise, back to the original image."""
    rot %= 4
    x, y = p[:, 0], p[:, 1]
    if rot == 1:      # clockwise: original (x, y) went to (1 - y, x)
        return np.stack([y, 1 - x], -1)
    if rot == 2:
        return np.stack([1 - x, 1 - y], -1)
    if rot == 3:      # counter-clockwise: original (x, y) went to (y, 1 - x)
        return np.stack([1 - y, x], -1)
    return p.copy()


def upright_rotation(transform: np.ndarray | None) -> int:
    """Quarter turns clockwise that bring world up to the top of the image (0 without a pose).

    The phone streams its sensor image, which is landscape whatever way the phone is held
    or mounted. MediaPipe finds hands best in an upright picture, so the image is turned
    until gravity points down in it.
    """
    if transform is None or np.allclose(transform, np.eye(4)):
        return 0
    Rcv = (np.asarray(transform, dtype=float) @ ARKIT_TO_OPENCV)[:3, :3]
    up = Rcv.T @ np.array([0.0, 1.0, 0.0])   # world up in OpenCV camera axes (x right, y down)
    ux, uy = float(up[0]), float(up[1])
    if math.hypot(ux, uy) < 0.2:               # looking almost straight down or up: no clear up
        return 0
    if abs(uy) >= abs(ux):
        return 0 if uy < 0 else 2
    return 3 if ux > 0 else 1                  # up points right: turn counter-clockwise


@dataclass
class Bench:
    R: np.ndarray                # rows: bench axes in the world
    origin: np.ndarray           # world point on the table
    cam: np.ndarray              # camera centre when anchored (world)
    fwd: np.ndarray              # camera viewing direction when anchored (world)
    table: Table


def sample_depth(frame: DepthFrame, ok: np.ndarray, u: float, v: float, half: int, pct: float) -> float | None:
    """Near-percentile depth (metres) around normalised colour pixel (u, v), or None."""
    H, W = frame.depth.shape
    x, y = int(u * W), int(v * H)
    if x < 0 or y < 0 or x >= W or y >= H:
        return None
    x0, x1, y0, y1 = max(0, x - half), min(W, x + half + 1), max(0, y - half), min(H, y + half + 1)
    d = frame.depth[y0:y1, x0:x1][ok[y0:y1, x0:x1]]
    if d.size == 0:
        return None
    return float(np.percentile(d, pct))


def pixel_to_world(frame: DepthFrame, u: float, v: float, z: float) -> np.ndarray:
    """Normalised colour pixel (u, v) at camera depth z to the ARKit world (the same maths as backproject)."""
    H, W = frame.depth.shape
    K = frame.depth_intrinsics()
    pc = np.array([(u * W - K[0, 2]) / K[0, 0] * z, (v * H - K[1, 2]) / K[1, 1] * z, z])
    Tcv = np.asarray(frame.transform, dtype=float) @ ARKIT_TO_OPENCV
    return Tcv[:3, :3] @ pc + Tcv[:3, 3]


def _has_world(frame: DepthFrame) -> bool:
    return frame.transform is not None and not np.allclose(frame.transform, np.eye(4))


class HandRootTracker:
    """Per DepthFrame: the wrists in the core world. Keeps the bench frame, the lock and the filters."""

    def __init__(self, cfg: RootConfig | None = None, rest_p: dict | None = None, detector=None,
                 model_path: str | Path | None = None) -> None:
        self.cfg = cfg or RootConfig()
        self.rest_p = {s: np.asarray(p, dtype=float) for s, p in (rest_p or {
            "left": (-0.15, 0.10, -0.20), "right": (0.15, 0.10, -0.20)}).items()}
        self.detector = detector if detector is not None else MediaPipeDetector(
            model_path or "models/hand_landmarker.task", self.cfg)
        self._axes = DepthTracker(TrackerConfig(camera_yaw_deg=self.cfg.camera_yaw_deg))
        self.bench: Bench | None = None
        self.offset: np.ndarray | None = None     # bench to core world, set by the lock
        self.anchor_b = np.zeros(3)               # the bench point the lock put on the rest pose
        self.filters: dict[str, geom.OneEuroFilter] = {}
        self.seen_us: dict[str, int] = {}
        self._moved_since: float | None = None    # stream time the phone was last seen moving
        self._prev_pose: tuple[np.ndarray, np.ndarray] | None = None
        self.moving = False
        self.rot = 0
        from .hand_root_led import LedConfig
        self.led_cfg = LedConfig()
        self._tracks: dict[str, tuple[np.ndarray, int]] = {}
        self._used_keys: set[str] = set()
        self._next_key = 0
        self.blob_source = ""
        self.blob_frames = 0
        self.rings_seen = 0
        self.rings_on_blobs = 0
        # counters for status and the check tool
        self.frames = 0
        self.detections = 0
        self.fixes = 0
        self.no_depth = 0
        self.rejected = 0
        self.reanchors = 0
        self.process_ms = 0.0

    # -- bench frame -----------------------------------------------------------
    def _pose(self, frame: DepthFrame) -> tuple[np.ndarray, np.ndarray]:
        Tcv = np.asarray(frame.transform, dtype=float) @ ARKIT_TO_OPENCV
        return Tcv[:3, 3].copy(), Tcv[:3, 2].copy()

    @staticmethod
    def _angle(a: np.ndarray, b: np.ndarray) -> float:
        return math.degrees(math.acos(float(np.clip(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)), -1, 1))))

    def _anchor(self, frame: DepthFrame, cam: np.ndarray, fwd: np.ndarray) -> Bench | None:
        table = app_table(frame, cam, True)
        if table is None:
            p, valid, _ = backproject(frame)
            conf = frame.confidence.reshape(-1) if frame.confidence is not None else np.full(len(p), 2, np.uint8)
            near = valid & (conf >= 2) & (np.linalg.norm(p - cam, axis=1) <= 2.0)
            table = fit_table(p[near], cam, np.array([0.0, 1.0, 0.0]), self._axes.cfg, self._axes.rng)
        if table is None:
            return None
        self._axes.ref_fwd = None
        R = self._axes.bench_axes(table, fwd, True)
        log.info("hand root: bench anchored (%s plane, camera %.2f m above it)", table.source,
                 table.camera_height_m)
        return Bench(R=R, origin=table.point.copy(), cam=cam, fwd=fwd, table=table)

    def _update_bench(self, frame: DepthFrame) -> bool:
        """Keep the bench frame. False while the phone moves or before a table is found."""
        cam, fwd = self._pose(frame)
        t = frame.stream_t or frame.t_us / 1e6
        prev = self._prev_pose
        self._prev_pose = (cam, fwd)
        step_moving = prev is not None and (np.linalg.norm(cam - prev[0]) > 0.005 or self._angle(fwd, prev[1]) > 1.0)
        if self.bench is not None:
            off = (np.linalg.norm(cam - self.bench.cam) > self.cfg.moved_m
                   or self._angle(fwd, self.bench.fwd) > self.cfg.moved_deg)
            if not off:
                self.moving = False
                return True
            self.moving = True
        if step_moving or self._moved_since is None:
            self._moved_since = t
        if self.bench is not None and t - self._moved_since < self.cfg.still_s:
            return False
        b = self._anchor(frame, cam, fwd)
        if b is None:
            return False
        if self.bench is not None:
            self.reanchors += 1
            self.offset = None
            self.anchor_b = np.zeros(3)
            for f in self.filters.values():
                f.reset()
        self.bench = b
        self.moving = False
        return True

    # -- one frame -------------------------------------------------------------
    def wrist_bench(self, frame: DepthFrame, ok: np.ndarray, det: Detection) -> tuple[np.ndarray, float, list] | None:
        """(wrist in the bench frame, confidence, knuckles in the bench frame) or None without depth."""
        c = self.cfg
        lm = det.lm
        pts = [LM_WRIST, LM_INDEX_MCP, LM_LITTLE_MCP]
        zs = [sample_depth(frame, ok, float(lm[i, 0]), float(lm[i, 1]), c.window_px, c.near_pct) for i in pts]
        valid = [z for z in zs if z is not None]
        if not valid:
            return None
        zmed = float(np.median(valid))
        zw = zs[0]
        own = zw is not None and abs(zw - zmed) <= c.agree_m
        z = zw if own else zmed
        if z > c.max_range_m:
            return None
        pw = pixel_to_world(frame, float(lm[0, 0]), float(lm[0, 1]), z)
        b = self.bench
        pb = b.R @ (pw - b.origin)
        if not (c.min_height_m <= pb[1] <= c.max_height_m):
            return None
        knuckles = [b.R @ (pixel_to_world(frame, float(lm[i, 0]), float(lm[i, 1]), zz) - b.origin)
                    for i, zz in zip(pts[1:], zs[1:]) if zz is not None]
        conf = len(valid) / 3.0 * (1.0 if own else 0.8)
        return pb, conf, knuckles

    def process(self, frame: DepthFrame) -> list[WristFix]:
        t0 = time.perf_counter()
        self.frames += 1
        out: list[WristFix] = []
        try:
            if frame.depth is None or not _has_world(frame):
                return out
            if not self._update_bench(frame):
                return out
            self.rot = upright_rotation(frame.transform) if self.cfg.rotate == "auto" else int(self.cfg.rotate) % 4
            ok = frame.depth_ok(self.cfg.min_confidence)
            if self.cfg.mode in ("auto", "blobs"):
                out = self._blob_fixes(frame, ok)
                self._used_keys.clear()
                if out or self.cfg.mode == "blobs":
                    return out
            dets = self.detector(frame.bgr, frame.t_us, self.rot)
            if not dets:
                return out
            for det in dets:
                self.detections += 1
                side = det.label.strip().lower()
                if side not in SIDES:
                    continue
                if self.cfg.swap_handedness:
                    side = "left" if side == "right" else "right"
                r = self.wrist_bench(frame, ok, det)
                if r is None:
                    self.no_depth += 1
                    continue
                pb, conf, kn = r
                if self.offset is None:
                    if self.cfg.origin == "lock":
                        self.offset = self.rest_p[side] - pb
                    else:
                        self.offset = np.asarray(self.cfg.bench_offset_m, dtype=float)
                    self.anchor_b = pb.copy()
                p = self.to_core(pb)
                last = self.seen_us.get(side)
                if side not in self.filters:
                    self.filters[side] = geom.OneEuroFilter(self.cfg.one_euro_min_cutoff, self.cfg.one_euro_beta,
                                                            self.cfg.one_euro_d_cutoff)
                if last is not None and frame.t_us - last > self.cfg.forget_s * 1e6:
                    self.filters[side].reset()
                self.seen_us[side] = frame.t_us
                ps = self.filters[side](p, frame.t_us) if self.cfg.tracker_filter else p
                out.append(WristFix(side=side, score=det.score, p=ps, p_bench=pb, confidence=conf,
                                    px=(float(det.lm[0, 0]) * frame.bgr.shape[1], float(det.lm[0, 1]) * frame.bgr.shape[0]),
                                    t_us=int(frame.t_us), frame_id=int(frame.frame_id),
                                    knuckles_bench=[k.tolist() for k in kn]))
                self.fixes += 1
            return out
        finally:
            self.process_ms = (time.perf_counter() - t0) * 1000

    # -- gloved hands: depth blobs first, ring LED for identity -------------------
    def _track_key(self, pb: np.ndarray, t_us: int) -> str:
        """A short-lived track id for the filter: the nearest recent blob track, else a new one."""
        best, bd = None, self.cfg.track_gate_m
        for k, (q, t) in self._tracks.items():
            if k in self._used_keys or t_us - t > self.cfg.forget_s * 1e6:
                continue
            d = float(np.linalg.norm(pb - q))
            if d < bd:
                best, bd = k, d
        if best is None:
            self._next_key += 1
            best = f"blob{self._next_key}"
        self._tracks[best] = (pb.copy(), t_us)
        self._used_keys.add(best)
        return best

    def _blob_fixes(self, frame: DepthFrame, ok: np.ndarray) -> list[WristFix]:
        from .hand_root_blobs import find_blobs
        from .hand_root_led import find_rings
        b = self.bench
        blobs, self.blob_source = find_blobs(frame, b.table, max_n=self.cfg.max_blobs)
        blobs = [x for x in blobs if x.darkness >= self.cfg.min_darkness]
        if not blobs:
            return []
        self.blob_frames += 1
        union = np.zeros_like(blobs[0].mask)
        for x in blobs:
            union |= x.mask
        rings = find_rings(frame.bgr, union, self.led_cfg) if self.cfg.use_led else []
        self.rings_seen += len(rings)
        H, W = union.shape
        pbs = [b.R @ (x.centre_world - b.origin) for x in blobs]
        if self.offset is None:
            if self.cfg.origin == "lock":
                if len(pbs) >= 2:
                    self.offset = (self.rest_p["left"] + self.rest_p["right"]) / 2 - (pbs[0] + pbs[1]) / 2
                    self.anchor_b = (pbs[0] + pbs[1]) / 2
                else:
                    cam_x = (b.R @ (self.bench.cam - b.origin))[0]
                    side = "right" if pbs[0][0] > cam_x else "left"
                    self.offset = self.rest_p[side] - pbs[0]
                    self.anchor_b = pbs[0].copy()
            else:
                self.offset = np.asarray(self.cfg.bench_offset_m, dtype=float)
        out = []
        for x, pb in zip(blobs, pbs):
            ring = None
            for r in rings:
                u, v = int(r.uv[0] * W), int(r.uv[1] * H)
                y0, y1, x0, x1 = max(0, v - 3), v + 4, max(0, u - 3), u + 4
                if x.mask[y0:y1, x0:x1].any():
                    ring = r
                    break
            px = x.centre_uv
            if ring is not None:
                self.rings_on_blobs += 1
                px = ring.uv
                z = sample_depth(frame, ok, ring.uv[0], ring.uv[1], self.cfg.window_px, self.cfg.near_pct)
                if z is not None:
                    hub = b.R @ (pixel_to_world(frame, ring.uv[0], ring.uv[1], z) - b.origin)
                    if np.linalg.norm(hub - pb) < 0.12:
                        pb = 0.5 * pb + 0.5 * hub     # the hub sits on the back of the hand by the wrist
            key = self._track_key(pb, frame.t_us)
            if key not in self.filters:
                self.filters[key] = geom.OneEuroFilter(self.cfg.one_euro_min_cutoff, self.cfg.one_euro_beta,
                                                       self.cfg.one_euro_d_cutoff)
            ps = self.to_core(pb)
            if self.cfg.tracker_filter:
                ps = self.filters[key](ps, frame.t_us)
            side = ring.side if ring is not None and ring.side else None
            out.append(WristFix(side=side or "", score=1.0, p=ps, p_bench=pb, confidence=1.0,
                                px=(px[0] * frame.bgr.shape[1], px[1] * frame.bgr.shape[0]),
                                t_us=int(frame.t_us), frame_id=int(frame.frame_id), darkness=float(x.darkness),
                                led=ring is not None, source="blob", key=key))
            self.fixes += 1
        return out

    def to_core(self, pb: np.ndarray) -> np.ndarray:
        """Bench to core world: about the lock anchor, scaled by motion_scale; height from the table."""
        if self.cfg.origin != "lock":
            return pb * self.cfg.motion_scale + self.offset
        k = self.cfg.motion_scale
        q = self.anchor_b + self.offset + k * (pb - self.anchor_b)
        if self.cfg.height_from_table:
            q[1] = self.cfg.floor_y_m + k * pb[1]
        return q

    def status(self) -> dict:
        return {"frames": self.frames, "detections": self.detections, "fixes": self.fixes,
                "no_depth": self.no_depth, "bench": self.bench is not None, "moving": self.moving,
                "reanchors": self.reanchors, "locked": self.offset is not None, "rotation": self.rot,
                "camera_height_m": None if self.bench is None else round(self.bench.table.camera_height_m, 3),
                "table_source": None if self.bench is None else self.bench.table.source,
                "blob_frames": self.blob_frames, "blob_source": self.blob_source, "rings_seen": self.rings_seen,
                "rings_on_blobs": self.rings_on_blobs, "process_ms": round(self.process_ms, 1)}


class HandRootLive:
    """The live core's hand root: a thread runs HandRootTracker on the newest DepthFrame, and
    apply(hands, t_us) fuses the newest fixes into the glove hands (core/root_fuse.py).

    The DepthFrame source is shared with the depth step (core/camera/depth_live.py), because
    the phone serves one client at a time; this class never starts or stops a shared source.
    With threaded=False, apply() processes the newest frame itself (tests and replays).
    """

    def __init__(self, source, tracker: HandRootTracker, fuser, owns_source: bool = False,
                 threaded: bool = True) -> None:
        self.source = source
        self.tracker = tracker
        self.fuser = fuser
        self.owns_source = owns_source
        self.threaded = threaded
        self._fixes: list[WristFix] = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_fid: int | None = None
        self.errors = 0
        self.error: str | None = None
        self._ages: list[float] = []
        self._last_log = 0.0
        # delay per stage (core/delay.py): stamps of the newest processed frame, counted once at the tick
        self._meta: tuple | None = None      # (frame_id, arrival_us, done_us, excess_ms)
        self._counted_fid: int | None = None
        self._offsets: list[tuple[float, float]] = []   # (arrival s, arrival minus the phone's stamp)

    @classmethod
    def from_config(cls, cfg, source, owns_source: bool = False, threaded: bool = True) -> "HandRootLive":
        from ..config import REPO_ROOT
        from ..root_fuse import FuseConfig, RootFuser
        rc = RootConfig.from_config(cfg)
        mp = Path(cfg.camera.get("model_path", "models/hand_landmarker.task"))
        if not mp.is_absolute():
            mp = Path(cfg.get_path("_root", str(REPO_ROOT))) / mp
        rest = {s: cfg.rest_pose[s].p for s in SIDES}
        tracker = HandRootTracker(rc, rest_p=rest, model_path=mp)
        return cls(source, tracker, RootFuser(FuseConfig.from_config(cfg)), owns_source=owns_source,
                   threaded=threaded)

    def start(self) -> None:
        if self._thread is not None or not self.threaded:
            return
        if self.owns_source:
            self.source.start()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="hand-root", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        if self.owns_source:
            self.source.stop()

    def _run(self) -> None:
        while not self._stop.is_set():
            if not self.step():
                self._stop.wait(0.005)

    def step(self) -> bool:
        f = self.source.read()
        if f is None or f.frame_id == self._last_fid:
            return False
        self._last_fid = f.frame_id
        try:
            fixes = self.tracker.process(f)
        except Exception as e:      # one bad frame must not stop the thread
            self.errors += 1
            self.error = f"{type(e).__name__}: {e}"
            log.exception("hand root frame %s failed", f.frame_id)
            return True
        done = self._now_us()
        excess = None
        if f.arrival_us and f.stream_t:
            a = f.arrival_us / 1e6
            self._offsets.append((a, a - float(f.stream_t)))
            while self._offsets and a - self._offsets[0][0] > 60.0:
                self._offsets.pop(0)
            excess = (a - float(f.stream_t) - min(o for _, o in self._offsets)) * 1000.0
        with self._lock:
            self._fixes = fixes
            self._meta = (f.frame_id, int(f.arrival_us), done, excess)
        return True

    def _now_us(self) -> int:
        clock = getattr(self.source, "clock", None)
        return int(clock.now_us()) if clock is not None else time.monotonic_ns() // 1000

    def latest(self) -> list[WristFix]:
        with self._lock:
            return list(self._fixes)

    def apply(self, hands: dict, t_us: int) -> None:
        """Called by Session.tick after the depth step's yaw correction. Starts the thread lazily."""
        if self.threaded:
            if self._thread is None:
                self.start()
        else:
            self.step()
        fixes = self.latest()
        self.fuser.apply(hands, fixes, t_us)
        # end-to-end delay: phone capture (arrival minus [camera] latency_us) to this frame message
        for f in self.fuser.last_assigned.values():
            self._ages.append((t_us - f.t_us) / 1000.0)
        del self._ages[:-300]
        with self._lock:
            meta = self._meta
        if meta is not None and meta[0] != self._counted_fid and self.fuser.last_assigned:
            self._counted_fid = meta[0]
            _, arrival, done, excess = meta
            if excess is not None:
                STATS.add("capture_to_arrival_over_fastest", excess)
            if arrival:
                STATS.add("arrival_to_done", (done - arrival) / 1000.0)
            STATS.add("done_to_tick", (t_us - done) / 1000.0)
        now = time.monotonic()
        if self._ages and now - self._last_log >= 5.0:
            self._last_log = now
            a = np.array(self._ages)
            log.info("hand root: delay capture to frame p50 %.0f ms, p95 %.0f ms; tracker %.0f ms a frame; %s",
                     np.percentile(a, 50), np.percentile(a, 95), self.tracker.process_ms, self.fuser.applied)
            log.info("hand root stages (ms): %s", STATS.line())

    def status(self) -> dict:
        a = np.array(self._ages) if self._ages else None
        return {**self.tracker.status(), **self.fuser.status(), "errors": self.errors, "error": self.error,
                "delay_ms_p50": None if a is None else round(float(np.percentile(a, 50)), 1),
                "delay_ms_p95": None if a is None else round(float(np.percentile(a, 95)), 1)}
