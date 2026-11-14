"""One depth frame and one source interface, shared by every depth camera path.

Sources today: the free Record3DStream app (PathOn) in record3dstream.py, our own
ARKit app (ios/, lane arkit-app) and replays of either. Hand tracking reads only
this type, so it does not care which phone app produced the frame.

Conventions (do not change without a note in DECISIONS.md):
- bgr is the colour image, uint8, OpenCV channel order.
- depth is float32 metres at the depth sensor's resolution (256x192 on iPhone LiDAR),
  covering the same field of view as bgr, so a depth pixel maps to the colour image by
  scaling alone. 0 or nan means no reading.
- confidence is uint8 at the depth resolution: 0 low, 1 medium, 2 high (ARKit's scale).
- K is the 3x3 pinhole matrix at bgr resolution; depth_intrinsics() scales it.
- transform is the 4x4 camera-to-world pose from the phone's tracker, if it sends one.
- plane is the 4x4 world pose of the largest horizontal plane (the table), if sent.
- t_us is the core clock in microseconds: arrival minus the configured camera latency.
- stream_t is the phone's own timestamp in seconds, useful only for intervals.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass
class DepthFrame:
    t_us: int
    bgr: np.ndarray
    depth: np.ndarray | None
    K: np.ndarray
    confidence: np.ndarray | None = None
    transform: np.ndarray | None = None
    plane: np.ndarray | None = None
    frame_id: int = 0
    stream_t: float = 0.0
    arrival_us: int = 0
    imu: np.ndarray | None = None
    source: str = ""

    def depth_at_rgb(self) -> np.ndarray | None:
        """Depth resized to the colour image, nearest neighbour."""
        if self.depth is None:
            return None
        import cv2
        return cv2.resize(self.depth, (self.bgr.shape[1], self.bgr.shape[0]), interpolation=cv2.INTER_NEAREST)

    def depth_intrinsics(self) -> np.ndarray:
        """K scaled to the depth resolution."""
        if self.depth is None:
            return self.K
        sx = self.depth.shape[1] / self.bgr.shape[1]
        sy = self.depth.shape[0] / self.bgr.shape[0]
        K = np.array(self.K, dtype=float)
        K[0, 0] *= sx
        K[0, 2] *= sx
        K[1, 1] *= sy
        K[1, 2] *= sy
        return K

    def depth_ok(self, min_confidence: int = 1) -> np.ndarray | None:
        """Boolean mask of depth pixels with a reading and at least min_confidence."""
        if self.depth is None:
            return None
        ok = np.isfinite(self.depth) & (self.depth > 0)
        if self.confidence is not None:
            ok &= self.confidence >= min_confidence
        return ok


class DepthSource(Protocol):
    """Newest frame, never blocks the 30 Hz tick. Same shape as SPEC.md's Camera adapter."""

    def start(self) -> None: ...
    def stop(self) -> None: ...
    def read(self) -> DepthFrame | None: ...
    def status(self) -> dict: ...
