"""The core's depth step: a DepthSource, the tracker in its own thread, the glove yaw correction.

Off by default: config.toml [camera] depth_enabled = false, turned on with
`python -m core --depth`. When off, nothing here is imported or run and the frame
message has no "depth" key.

- A thread reads the newest DepthFrame and runs DepthTracker on it (about 5 to 25 ms),
  so the 30 Hz tick never waits for depth.
- Session.tick calls apply(hands, t_us) before it builds the frame: for the configured
  side, the glove's yaw before correction and the newest forearm yaw feed YawCorrector,
  and the offset turns the hand's wrist_q about world up. The hand's joints are local to
  the wrist, so the whole hand turns with it. The correction is applied once per
  HandState object, so a held hand is never turned twice.
- block() is the "depth" block of the frame message (schema/depth.json $defs/block).
- cloud_message() is the /ws/depth message (schema/depth.json), at most cloud_hz.
"""
from __future__ import annotations

import logging
import math
import threading
import time

import numpy as np

from .. import geom
from .depth_track import DepthObs, DepthTracker, TrackerConfig, YawCorrector, YawCorrectorConfig, wrap_deg

log = logging.getLogger("geppetto.camera.depth")

_APPLIED = "_depth_yaw_applied_deg"


def glove_yaw_deg(q: np.ndarray) -> float:
    """Core yaw of a wrist quaternion, as core/rgmp.py GloveSource._yaw_of."""
    fwd = geom.rotate(q, np.array([0.0, 0.0, -1.0]))
    return math.degrees(math.atan2(-fwd[0], -fwd[2]))


class DepthTracking:
    def __init__(self, source, tracker_cfg: TrackerConfig | None = None,
                 corrector_cfg: YawCorrectorConfig | None = None, cloud_hz: float = 10.0,
                 correct: bool = True) -> None:
        self.source = source
        self.tracker = DepthTracker(tracker_cfg)
        self.corrector = YawCorrector(corrector_cfg)
        self.side = self.corrector.cfg.side
        self.cloud_hz = float(cloud_hz)
        self.correct = bool(correct)
        self._obs: DepthObs | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_fid: int | None = None
        self._used_fid: int | None = None
        self.processed = 0
        self.errors = 0
        self.error: str | None = None
        self.applied = False
        self.last_glove_yaw: float | None = None
        self.last_t_us = 0

    @classmethod
    def from_config(cls, cfg, clock, source=None) -> "DepthTracking":
        sec = cfg.camera.get("depth") if "depth" in cfg.camera else None
        if source is None:
            from .geppetto_depth import GeppettoDepthCamera
            source = GeppettoDepthCamera.from_config(cfg, clock)
        return cls(source, TrackerConfig.from_section(sec), YawCorrectorConfig.from_section(sec),
                   cloud_hz=float(sec.get("cloud_hz", 10.0)) if sec else 10.0,
                   correct=bool(sec.get("correct_yaw", True)) if sec else True)

    # -- lifecycle -------------------------------------------------------------
    def start(self) -> None:
        self.source.start()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="depth-track", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        self.source.stop()

    def _run(self) -> None:
        while not self._stop.is_set():
            if not self.step():
                self._stop.wait(0.005)

    def step(self) -> bool:
        """Process the newest frame if it is new. True if one was processed. Tests call this directly."""
        f = self.source.read()
        if f is None or f.frame_id == self._last_fid:
            return False
        self._last_fid = f.frame_id
        try:
            obs = self.tracker.process(f, want_cloud=True)
        except Exception as e:     # one bad frame must not stop the thread
            self.errors += 1
            self.error = f"{type(e).__name__}: {e}"
            log.exception("depth frame %s failed", f.frame_id)
            return True
        with self._lock:
            self._obs = obs
        self.processed += 1
        return True

    def latest(self) -> DepthObs | None:
        with self._lock:
            return self._obs

    # -- the tick --------------------------------------------------------------
    def apply(self, hands: dict, t_us: int) -> None:
        """Update the correction from the newest depth frame and turn the configured hand. Called by Session.tick."""
        self.last_t_us = int(t_us)
        self.applied = False
        h = hands.get(self.side)
        if h is None or h.source != "glove":
            return
        prev = float(getattr(h, _APPLIED, 0.0))
        raw_q = h.wrist_q if prev == 0.0 else geom.quat_mul(geom.yaw_quat(-math.radians(prev)), h.wrist_q)
        self.last_glove_yaw = glove_yaw_deg(raw_q)
        obs = self.latest()
        fresh = obs is not None and abs(t_us - obs.t_us) <= self.corrector.cfg.stale_ms * 1000
        if (self.correct and fresh and obs.forearm_ok and obs.forearm_yaw_deg is not None and h.tracked
                and obs.frame_id != self._used_fid):
            self._used_fid = obs.frame_id
            self.corrector.update(int(obs.t_us), self.last_glove_yaw, obs.forearm_yaw_deg)
        off = self.corrector.offset_deg if self.correct else 0.0
        if off != prev:
            h.wrist_q = geom.quat_normalize(geom.quat_mul(geom.yaw_quat(math.radians(off)), raw_q))
            setattr(h, _APPLIED, off)
        self.applied = self.correct and self.corrector.locked and off != 0.0

    # -- messages --------------------------------------------------------------
    def block(self) -> dict:
        obs = self.latest()
        age = None if obs is None else round(max(0.0, (self.last_t_us - obs.t_us) / 1000.0), 1)
        return {
            "side": self.side,
            "connected": bool(self.source.status().get("connected", True)),
            "frame_id": None if obs is None else int(obs.frame_id),
            "age_ms": age,
            "table": bool(obs is not None and obs.table is not None),
            "hand": bool(obs is not None and obs.arm_found),
            "hand_depth": bool(obs is not None and obs.arm_found and obs.hand_depth),
            "forearm_yaw_deg": None if obs is None or obs.forearm_yaw_deg is None else round(obs.forearm_yaw_deg, 1),
            "forearm_ok": bool(obs is not None and obs.forearm_ok),
            "glove_yaw_deg": None if self.last_glove_yaw is None else round(self.last_glove_yaw, 1),
            "correction_deg": round(self.corrector.offset_deg, 2),
            "locked": self.corrector.locked,
            "applied": bool(self.applied),
        }

    def cloud_message(self, t_us: int) -> dict | None:
        obs = self.latest()
        if obs is None or obs.cloud is None:
            return None
        c = obs.cloud
        tab = obs.table
        return {
            "v": 1,
            "type": "depth",
            "t": int(t_us),
            "frame_id": int(obs.frame_id),
            "frame": "bench" if tab is not None else "camera",
            "n": int(len(c["labels"])),
            "points": [round(float(x), 4) for x in np.asarray(c["points"]).reshape(-1)],
            "labels": [int(x) for x in c["labels"]],
            "rgb": [int(x) for x in np.asarray(c["rgb"]).reshape(-1)],
            "table": {
                "found": tab is not None,
                "source": None if tab is None else tab.source,
                "camera_height_m": None if tab is None else round(tab.camera_height_m, 4),
                "agree_deg": obs.agree_deg,
                "agree_mm": obs.agree_mm,
            },
            "arm": {
                "found": obs.arm_found,
                "hand_depth": bool(obs.arm_found and obs.hand_depth),
                "forearm_ok": obs.forearm_ok,
                "yaw_deg": None if obs.forearm_yaw_deg is None else round(obs.forearm_yaw_deg, 2),
                "dir": None if obs.dir_bench is None else [round(float(x), 4) for x in obs.dir_bench],
                "entry": None if obs.entry_bench is None else [round(float(x), 4) for x in obs.entry_bench],
                "length_m": round(obs.length_m, 3),
                "elongation": round(obs.elongation, 2),
            },
            "correction": {k: v for k, v in self.block().items()
                           if k in ("side", "correction_deg", "locked", "applied", "glove_yaw_deg")},
            "process_ms": round(obs.process_ms, 1),
        }

    def status(self) -> dict:
        return {"source": self.source.status(), "processed": self.processed, "errors": self.errors,
                "error": self.error, "correction_deg": round(self.corrector.offset_deg, 2),
                "locked": self.corrector.locked, "updates": self.corrector.updates,
                "outliers": self.corrector.outliers}


class FakeDepthSource:
    """DepthSource that renders the fake bench scene in process, through the exact wire format.

    For tests and `python -m core --fake --depth-fake`; no socket. Frames are made on read()
    at the scene's own rate against the given clock.
    """

    def __init__(self, scene=None, clock=None, fps: float = 30.0) -> None:
        from .fake_depth import FakeDepthScene
        self.scene = scene or FakeDepthScene()
        self.clock = clock
        self.fps = float(fps)
        self._t0: int | None = None
        self._last_i = -1
        self._frame = None
        self.frames = 0

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def _now(self) -> int:
        return int(self.clock.now_us()) if self.clock is not None else time.monotonic_ns() // 1000

    def read(self):
        from .geppetto_depth import parse_packet
        now = self._now()
        if self._t0 is None:
            self._t0 = now
        i = int((now - self._t0) * self.fps / 1e6)
        if i != self._last_i:
            self._last_i = i
            self._frame = parse_packet(self.scene.packet(i, self.fps), now)
            self.frames += 1
        return self._frame

    def status(self) -> dict:
        return {"source": "fake-depth", "connected": True, "frames": self.frames,
                "dark_hand": self.scene.dark_hand}
