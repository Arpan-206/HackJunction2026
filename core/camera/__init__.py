"""Camera hand source: MediaPipe Hand Landmarker on a bare hand, as a fallback for a glove.

21 landmarks become the same 26-joint HandState as a glove, so the scorer and
the viewer contract are unchanged. `source` is "camera", `anchor` is "camera".
Checked against the installed MediaPipe (1.2.x tasks API); see STATUS.md for
what is tested (synthetic landmarks, video files) and what is not (live webcam).
"""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from .. import geom
from .. import hand as H
from ..config import REPO_ROOT

log = logging.getLogger("geppetto.camera")

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
DEVICE_IDS = {"left": 1000, "right": 1001}


def camera_to_world(xyz: np.ndarray, mirror: bool) -> np.ndarray:
    """MediaPipe (x right in the image, y down, z into the scene) -> world (X to the
    person's right, Y up, Z toward the person). With mirror=True the image is a
    mirror of the person, as a selfie camera shows it; that is a reflection and
    MediaPipe's handedness label is then already correct (its docs assume a
    mirrored image). With mirror=False swap the label (done by the caller)."""
    v = np.asarray(xyz, dtype=float)
    out = np.empty_like(v)
    out[..., 0] = v[..., 0] if mirror else -v[..., 0]
    out[..., 1] = -v[..., 1]
    out[..., 2] = v[..., 2]
    return out


def landmarks_to_hand(world_lm: np.ndarray, norm_lm: np.ndarray, label: str, cam_cfg, t_us: int,
                      wrist_filter: geom.OneEuroFilter | None = None) -> H.HandState:
    """Pure conversion: 21 world landmarks (metres) + 21 normalised landmarks + 'Left'/'Right'."""
    mirror = bool(cam_cfg.mirror)
    side = label.strip().lower()
    if side not in ("left", "right"):
        raise ValueError(f"handedness label {label!r}")
    if not mirror:
        side = "right" if side == "left" else "left"
    J21 = camera_to_world(np.asarray(world_lm, dtype=float), mirror)
    J26 = H.joints_from_mediapipe(J21, float(cam_cfg.metacarpal_fraction))
    h = H.hand_from_joints_world(J26, side, DEVICE_IDS[side], "camera", t_us, anchor="camera")
    # wrist position: no depth from a plain webcam, so a plane in front of the viewer
    xn, yn = float(norm_lm[0][0]), float(norm_lm[0][1])
    sx = 1.0 if mirror else -1.0
    p = np.array([sx * (xn - 0.5) * float(cam_cfg.plane_width_m),
                  float(cam_cfg.plane_y_m) + (0.5 - yn) * float(cam_cfg.plane_height_m),
                  float(cam_cfg.plane_z_m)])
    if wrist_filter is not None:
        p = wrist_filter(p, t_us)
    h.wrist_p = p
    h.heading_reliable = True
    return h


def _lm_array(lms) -> np.ndarray:
    return np.array([[lm.x, lm.y, lm.z] for lm in lms], dtype=float)


class CameraSource:
    """Reads a webcam (camera.device) or a video file (camera.video), runs the
    MediaPipe hand landmarker in a thread, and serves HandStates to the Core."""

    def __init__(self, cfg, clock, model_path: str | Path | None = None, video: str | None = None,
                 device: int | None = None) -> None:
        self.cfg = cfg
        self.clock = clock
        self.cam = cfg.camera
        self.model_path = Path(model_path or self.cam.model_path)
        if not self.model_path.is_absolute():
            self.model_path = Path(cfg.get_path("_root", str(REPO_ROOT))) / self.model_path
        self.video = video if video is not None else (self.cam.video or None)
        self.device = int(self.cam.device if device is None else device)
        self.latest: dict[str, tuple[int, np.ndarray, np.ndarray]] = {}
        self.pinch = {s: H.PinchTracker(cfg.hand.pinch_on_m, cfg.hand.pinch_off_m) for s in ("left", "right")}
        self.filters = {s: geom.OneEuroFilter(self.cam.one_euro_min_cutoff, self.cam.one_euro_beta, self.cam.one_euro_d_cutoff)
                        for s in ("left", "right")}
        self._last_hand: dict[str, H.HandState] = {}
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self.frames = 0
        self.detections = 0
        self.error: str | None = None
        self.finished = False
        if not self.model_path.exists():
            raise FileNotFoundError(f"MediaPipe model missing at {self.model_path}. Run: python -m tools.fetch_models")

    # -- lifecycle -----------------------------------------------------------
    async def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="camera", daemon=True)
        self._thread.start()

    async def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    def _make_landmarker(self):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision
        opts = vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(self.model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=int(self.cam.num_hands),
            min_hand_detection_confidence=float(self.cam.min_detection_confidence),
            min_hand_presence_confidence=float(self.cam.min_presence_confidence),
            min_tracking_confidence=float(self.cam.min_tracking_confidence),
        )
        return mp, vision.HandLandmarker.create_from_options(opts)

    def _run(self) -> None:
        try:
            import cv2
            mp, landmarker = self._make_landmarker()
            cap = cv2.VideoCapture(self.video if self.video else self.device)
            if not cap.isOpened():
                raise RuntimeError(f"cannot open camera {self.video or self.device}")
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            t_start = time.monotonic()
            ts_ms_last = -1
            while not self._stop.is_set():
                ok, bgr = cap.read()
                if not ok:
                    if self.video:
                        self.finished = True
                        log.info("video finished after %d frames", self.frames)
                        break
                    time.sleep(0.01)
                    continue
                self.frames += 1
                if self.video:
                    ts_ms = int(self.frames * 1000.0 / fps)
                    # pace a video file like a live camera
                    target = t_start + self.frames / fps
                    delay = target - time.monotonic()
                    if delay > 0:
                        time.sleep(delay)
                else:
                    ts_ms = int((time.monotonic() - t_start) * 1000)
                if ts_ms <= ts_ms_last:
                    ts_ms = ts_ms_last + 1
                ts_ms_last = ts_ms
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = landmarker.detect_for_video(image, ts_ms)
                self.ingest(result, int(self.clock.now_us()) - int(self.cam.latency_us))
            cap.release()
            landmarker.close()
        except Exception as e:
            self.error = f"{type(e).__name__}: {e}"
            log.exception("camera thread stopped")

    def ingest(self, result: Any, t_us: int) -> None:
        """Store the newest landmarks per side from a HandLandmarkerResult."""
        found = {}
        for hand_lm, world_lm, handed in zip(result.hand_landmarks, result.hand_world_landmarks, result.handedness):
            label = handed[0].category_name if handed else "Right"
            side = label.lower()
            if not self.cam.mirror:
                side = "right" if side == "left" else "left"
            found[side] = (t_us, _lm_array(world_lm), _lm_array(hand_lm), label)
        with self._lock:
            for side, (t, w, n, label) in found.items():
                self.latest[side] = (t, w, n, label)
                self.detections += 1

    # -- output --------------------------------------------------------------
    def poll(self, t_us: int) -> dict[str, tuple[H.HandState | None, list]]:
        out: dict[str, tuple[H.HandState | None, list]] = {}
        silence_us = int(self.cam.silence_ms) * 1000
        with self._lock:
            latest = dict(self.latest)
        for side in ("left", "right"):
            item = latest.get(side)
            if item is None:
                out[side] = (None, [])
                continue
            t_seen, world, norm, label = item
            tracked = (t_us - t_seen) < silence_us
            prev = self._last_hand.get(side)
            if prev is not None and prev.t_us == t_seen:
                prev.tracked = tracked
                out[side] = (prev, [])
                continue
            try:
                h = landmarks_to_hand(world, norm, label, self.cam, t_seen, self.filters[side])
            except Exception as e:
                log.warning("landmark conversion failed: %s", e)
                out[side] = (None, [])
                continue
            h.tracked = tracked
            events = H.finish_hand(h, self.cfg.hand, self.pinch[side])
            self._last_hand[side] = h
            out[side] = (h, events)
        return out


def run_on_video(cfg, clock, video: str, max_frames: int | None = None) -> dict:
    """Headless check: run the landmarker over a video file, return counts."""
    src = CameraSource(cfg, clock, video=video)
    src._stop.clear()
    src._run()
    return {"frames": src.frames, "detections": src.detections, "error": src.error}
