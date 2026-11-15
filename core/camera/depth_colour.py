"""Colour proposes, depth confirms: hands in the phone's colour image, checked against depth.

Off by default ([camera.depth] colour_confirm = false). MediaPipe's hand landmarker takes
about 55 ms a frame on this Mac (bench-stand-1), too slow to run inline at 30 Hz, so the
live step runs it in its own thread on the newest frame and pairs it with the depth.

Proposal: MediaPipe hand landmarks on the colour image (bare skin). No colour thresholds:
the landmarker works from shape and contrast, which survives the venue's magenta light.
Confirmation: the landmarks, mapped to the depth image (same field of view, scaling only),
must have depth that lies on or above the table plane and within reach of the camera.
A picture of a hand, a reflection or a bottle fails: no landmarks, or landmarks off the table.

Output, for the view and the yaw:
- hand direction in the bench frame: wrist (landmark 0) to middle knuckle (landmark 9), the
  same direction the glove's wrist yaw measures (fingers forward);
- a hand mask at depth resolution (landmark hull, dilated) that pulls a flat hand out of
  the table band in the point cloud.

Not done: the dark-glove outline (black Smartglove on the table). MediaPipe finds no hand
in any glove frame of bench-stand-1, and a contrast outline was not built by the time box.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .depth import DepthFrame
from .depth_track import DepthObs, backproject, yaw_of_dir

WRIST, MIDDLE_MCP, INDEX_MCP, LITTLE_MCP = 0, 9, 5, 17
PALM = [
    0,
    1,
    5,
    9,
    13,
    17,
]  # wrist, thumb base and the four knuckles: fingertips sit on depth edges


@dataclass
class ColourConfig:
    """[camera.depth] colour_* keys."""

    colour_confirm: bool = False
    colour_model: str = "models/hand_landmarker.task"
    colour_min_detection: float = 0.5
    colour_min_valid: float = (
        0.8  # this share of the palm landmarks needs a depth reading
    )
    colour_h_min_m: float = (
        -0.01
    )  # landmark heights above the table, all within this band
    colour_h_max_m: float = 0.20
    colour_max_range_m: float = 1.0
    colour_max_age_ms: float = (
        150.0  # a colour result older than this is not paired with depth
    )

    @classmethod
    def from_section(cls, sec) -> ColourConfig:
        c = cls()
        if sec is None:
            return c
        for k in c.__dataclass_fields__:
            if k in sec:
                setattr(c, k, type(getattr(c, k))(sec[k]))
        return c


@dataclass
class ColourHand:
    landmarks_px: np.ndarray  # (21, 2) at colour resolution
    score: float
    confirmed: bool = False
    valid_share: float = 0.0
    heights_m: np.ndarray | None = None
    dir_bench: np.ndarray | None = None
    yaw_deg: float | None = None
    mask: np.ndarray | None = None  # depth resolution
    reason: str = ""


@dataclass
class ColourObs:
    frame_id: int
    t_us: int
    hands: list[ColourHand] = field(default_factory=list)
    ms: float = 0.0

    @property
    def confirmed(self) -> ColourHand | None:
        c = [h for h in self.hands if h.confirmed]
        return max(c, key=lambda h: h.score) if c else None


class ColourHands:
    """MediaPipe hand landmarker in VIDEO mode, plus the depth confirmation."""

    def __init__(
        self, cfg: ColourConfig | None = None, root: Path | None = None
    ) -> None:
        self.cfg = cfg or ColourConfig()
        model = Path(self.cfg.colour_model)
        if not model.is_absolute():
            from ..config import REPO_ROOT

            model = (root or REPO_ROOT) / model
            if not model.exists():  # a worktree has no models/; use the main checkout's
                alt = (
                    Path(REPO_ROOT).parents[2] / self.cfg.colour_model
                    if ".claude" in Path(REPO_ROOT).parts
                    else model
                )
                model = alt if alt.exists() else model
        if not model.exists():
            raise FileNotFoundError(
                f"MediaPipe model missing at {model}. Run: python -m tools.fetch_models"
            )
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self._mp = mp
        opts = vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model)),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=self.cfg.colour_min_detection,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.lm = vision.HandLandmarker.create_from_options(opts)
        self._last_ms = -1

    def close(self) -> None:
        self.lm.close()

    def detect(self, frame: DepthFrame) -> ColourObs:
        import cv2

        t0 = time.perf_counter()
        ts = int(frame.stream_t * 1000) if frame.stream_t else int(frame.t_us / 1000)
        ts = max(ts, self._last_ms + 1)
        self._last_ms = ts
        rgb = cv2.cvtColor(frame.bgr, cv2.COLOR_BGR2RGB)
        r = self.lm.detect_for_video(
            self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb), ts
        )
        W, H = frame.bgr.shape[1], frame.bgr.shape[0]
        out = ColourObs(frame_id=frame.frame_id, t_us=frame.t_us)
        for lms, hd in zip(r.hand_landmarks, r.handedness):
            px = np.array([[l.x * W, l.y * H] for l in lms], dtype=float)
            out.hands.append(
                ColourHand(landmarks_px=px, score=float(hd[0].score) if hd else 0.0)
            )
        out.ms = (time.perf_counter() - t0) * 1000
        return out

    def confirm(self, cobs: ColourObs, frame: DepthFrame, dobs: DepthObs) -> ColourObs:
        """Check every proposed hand against the depth frame and the table from dobs."""
        import cv2

        cfg = self.cfg
        if frame.depth is None or dobs.table is None or dobs.bench_R is None:
            for h in cobs.hands:
                h.reason = "no table"
            return cobs
        Hd, Wd = frame.depth.shape
        sx, sy = Wd / frame.bgr.shape[1], Hd / frame.bgr.shape[0]
        p, valid, in_world = backproject(frame)
        if frame.confidence is not None:
            valid = valid & (frame.confidence.reshape(-1) >= 1)
        cam = None
        if in_world:
            from .depth_track import camera_pose

            cam, _ = camera_pose(frame, in_world)
        for h in cobs.hands:
            uv = np.clip(
                np.round(h.landmarks_px * [sx, sy] - 0.5).astype(int),
                0,
                [Wd - 1, Hd - 1],
            )
            # landmarks sit on the hand's outline, where depth jumps to what lies behind it;
            # the hand is the nearest surface, so take the nearest valid pixel in a 5x5 window
            dz = np.where(valid, frame.depth.reshape(-1), np.inf).reshape(Hd, Wd)
            idx = np.empty(len(uv), int)
            for j, (u, v) in enumerate(uv):
                u0, u1, v0, v1 = (
                    max(0, u - 2),
                    min(Wd, u + 3),
                    max(0, v - 2),
                    min(Hd, v + 3),
                )
                win = dz[v0:v1, u0:u1]
                a = int(np.argmin(win))
                idx[j] = (v0 + a // win.shape[1]) * Wd + (u0 + a % win.shape[1])
            ok = valid[idx]
            h.valid_share = float(ok.mean())
            palm = ok[PALM]
            if (
                palm.mean() < cfg.colour_min_valid
                or not ok[WRIST]
                or not ok[MIDDLE_MCP]
            ):
                h.reason = "landmarks without depth"
                continue
            P = p[idx]
            h.heights_m = dobs.table.height(P)
            hv = h.heights_m[PALM][palm]
            if hv.min() < cfg.colour_h_min_m or hv.max() > cfg.colour_h_max_m:
                h.reason = "off the table band"
                continue
            if (
                cam is not None
                and np.linalg.norm(P[PALM][palm] - cam, axis=1).max()
                > cfg.colour_max_range_m
            ):
                h.reason = "out of reach"
                continue
            q = (P - dobs.bench_origin) @ dobs.bench_R.T
            d = q[MIDDLE_MCP] - q[WRIST]
            d[1] = 0.0
            n = float(np.linalg.norm(d))
            if not (
                0.03 <= n <= 0.15
            ):  # wrist to middle knuckle on a real hand is 7 to 11 cm
                h.reason = f"palm length {n:.3f} m"
                continue
            h.dir_bench = d / n
            h.yaw_deg = round(yaw_of_dir(h.dir_bench), 2)
            hull = cv2.convexHull(np.round(h.landmarks_px * [sx, sy]).astype(np.int32))
            m = np.zeros((Hd, Wd), np.uint8)
            cv2.fillConvexPoly(m, hull, 1)
            h.mask = cv2.dilate(m, np.ones((5, 5), np.uint8)).astype(bool)
            h.confirmed = True
            h.reason = "ok"
        return cobs


def hand_direction_disagreement(
    a_deg: float | None, b_deg: float | None
) -> float | None:
    if a_deg is None or b_deg is None:
        return None
    return abs((a_deg - b_deg + 180.0) % 360.0 - 180.0)


__all__ = [
    "ColourConfig",
    "ColourHand",
    "ColourHands",
    "ColourObs",
    "hand_direction_disagreement",
    "math",
]
