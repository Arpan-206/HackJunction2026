"""Depth camera source: our own iPhone app GeppettoDepth (ios/GeppettoDepth), over USB or WiFi.

The app serves a length-prefixed binary TCP stream on the phone's port 7700. The Mac
forwards that port over USB with iproxy (ios/mac/forward.sh), so this reader connects
to 127.0.0.1:7700. The wire format is ios/PROTOCOL.md. Depth arrives as float16 metres
and is decoded to float32 here, so DepthFrame keeps the conventions in
core/camera/depth.py. K arrives at the full camera resolution and is scaled here to the
JPEG resolution, because DepthFrame.K belongs to bgr.

Contents: parse_header, parse_packet, build_packet (for tests and the fake senders),
PacketReader (resyncs on the magic) and GeppettoDepthCamera, a DepthSource that keeps
only the newest frame and never blocks the 30 Hz tick. This module lives in core/ so the
core does not import ios/ at run time; ios/mac/geppetto_depth.py re-exports it.
"""
from __future__ import annotations

import logging
import socket
import struct
import threading
import time
from dataclasses import dataclass

import numpy as np

from core.camera.depth import DepthFrame, DepthSource  # noqa: F401  (DepthSource re-exported for callers)

log = logging.getLogger("geppetto.camera.geppetto_depth")

SOURCE = "geppetto-depth"
MAGIC = b"GDP1"
PREFIX = struct.Struct("<4sI")            # magic, payload length
HEADER = struct.Struct("<HHIdHHHHHHIII9f16f16f2fB3x")
HEADER_SIZE = HEADER.size                  # 216
VERSION = 1
DEFAULT_PORT = 7700
MAX_PAYLOAD = 16 << 20                     # anything larger is a slipped stream, not a frame

FLAG_PLANE = 1 << 0
FLAG_CONFIDENCE = 1 << 1

TRACKING = {0: "not_available", 1: "limited", 2: "normal"}

# ARKit camera (x right, y up, z back) to OpenCV camera (x right, y down, z forward)
ARKIT_TO_OPENCV = np.diag([1.0, -1.0, -1.0, 1.0])

assert HEADER_SIZE == 216, HEADER_SIZE


@dataclass
class GDPHeader:
    version: int
    flags: int
    frame_id: int
    timestamp: float
    depth_w: int
    depth_h: int
    jpeg_w: int
    jpeg_h: int
    cam_w: int
    cam_h: int
    depth_size: int
    confidence_size: int
    jpeg_size: int
    K: np.ndarray            # 3x3 at cam_w x cam_h
    transform: np.ndarray    # 4x4 camera to world (ARKit axes)
    plane: np.ndarray | None # 4x4 plane to world, None when flag 0 is clear
    plane_extent: tuple[float, float]
    tracking: int

    @property
    def blobs_size(self) -> int:
        return self.depth_size + self.confidence_size + self.jpeg_size


def parse_header(payload: bytes | memoryview) -> GDPHeader | None:
    """The fixed payload header, or None if it is short or of an unknown version."""
    if len(payload) < HEADER_SIZE:
        return None
    v = HEADER.unpack_from(payload, 0)
    version, flags, frame_id, ts, dw, dh, jw, jh, cw, ch, dsize, csize, jsize = v[:13]
    if version != VERSION:
        return None
    K = np.array(v[13:22], dtype=float).reshape(3, 3)
    T = np.array(v[22:38], dtype=float).reshape(4, 4)
    P = np.array(v[38:54], dtype=float).reshape(4, 4)
    ext = (float(v[54]), float(v[55]))
    return GDPHeader(version, flags, frame_id, ts, dw, dh, jw, jh, cw, ch, dsize, csize, jsize, K, T,
                     P if flags & FLAG_PLANE else None, ext, int(v[56]))


def scale_K(K: np.ndarray, from_wh: tuple[int, int], to_wh: tuple[int, int]) -> np.ndarray:
    """Intrinsics for the same camera at another image size (scaling only, same field of view)."""
    K = np.array(K, dtype=float)
    if not from_wh[0] or not from_wh[1]:
        return K
    sx, sy = to_wh[0] / from_wh[0], to_wh[1] / from_wh[1]
    K[0, 0] *= sx
    K[0, 2] *= sx
    K[1, 1] *= sy
    K[1, 2] *= sy
    return K


def parse_packet(packet: bytes, arrival_us: int, latency_us: int = 0) -> DepthFrame | None:
    """One complete packet (prefix and payload) to a DepthFrame, or None if it is broken."""
    import cv2
    if len(packet) < PREFIX.size + HEADER_SIZE:
        return None
    magic, n = PREFIX.unpack_from(packet, 0)
    if magic != MAGIC or len(packet) < PREFIX.size + n:
        return None
    payload = memoryview(packet)[PREFIX.size:PREFIX.size + n]
    h = parse_header(payload)
    if h is None or HEADER_SIZE + h.blobs_size > n:
        return None
    o = HEADER_SIZE
    depth = None
    if h.depth_w and h.depth_h and h.depth_size >= h.depth_w * h.depth_h * 2:
        depth = np.frombuffer(payload, dtype="<f2", count=h.depth_w * h.depth_h, offset=o) \
            .reshape(h.depth_h, h.depth_w).astype(np.float32)
    o += h.depth_size
    conf = None
    if h.flags & FLAG_CONFIDENCE and h.depth_w and h.depth_h and h.confidence_size >= h.depth_w * h.depth_h:
        conf = np.frombuffer(payload, dtype=np.uint8, count=h.depth_w * h.depth_h, offset=o) \
            .reshape(h.depth_h, h.depth_w).copy()
    o += h.confidence_size
    bgr = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8, count=h.jpeg_size, offset=o), cv2.IMREAD_COLOR)
    if bgr is None:
        return None
    K = scale_K(h.K, (h.cam_w, h.cam_h), (bgr.shape[1], bgr.shape[0]))
    return DepthFrame(t_us=arrival_us - latency_us, bgr=bgr, depth=depth, K=K, confidence=conf,
                      transform=h.transform, plane=h.plane, frame_id=h.frame_id, stream_t=h.timestamp,
                      arrival_us=arrival_us, source=SOURCE)


def opencv_pose(transform: np.ndarray) -> np.ndarray:
    """ARKit camera-to-world pose to an OpenCV camera-to-world pose (y down, z forward)."""
    return np.asarray(transform, dtype=float) @ ARKIT_TO_OPENCV


def build_packet(bgr: np.ndarray, depth: np.ndarray, K: np.ndarray, confidence: np.ndarray | None = None,
                 frame_id: int = 1, timestamp: float = 0.0, transform: np.ndarray | None = None,
                 plane: np.ndarray | None = None, plane_extent: tuple[float, float] = (0.0, 0.0),
                 cam_wh: tuple[int, int] | None = None, tracking: int = 2, jpeg_quality: int = 80) -> bytes:
    """The inverse of parse_packet: what the phone sends. For tests and the fake sender.

    K is given at cam_wh (default: the bgr size), as the phone gives ARCamera.intrinsics
    at the full camera resolution.
    """
    import cv2
    ok, jpg = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    assert ok
    jpeg = jpg.tobytes()
    d = np.asarray(depth, dtype="<f2").tobytes()
    c = b"" if confidence is None else np.asarray(confidence, dtype=np.uint8).tobytes()
    cam_w, cam_h = cam_wh or (bgr.shape[1], bgr.shape[0])
    flags = (FLAG_PLANE if plane is not None else 0) | (FLAG_CONFIDENCE if confidence is not None else 0)
    T = np.eye(4) if transform is None else np.asarray(transform, dtype=float)
    P = np.eye(4) if plane is None else np.asarray(plane, dtype=float)
    head = HEADER.pack(VERSION, flags, frame_id, timestamp, depth.shape[1], depth.shape[0], bgr.shape[1], bgr.shape[0],
                       cam_w, cam_h, len(d), len(c), len(jpeg), *np.asarray(K, dtype=float).ravel(),
                       *T.ravel(), *P.ravel(), float(plane_extent[0]), float(plane_extent[1]), int(tracking))
    payload = head + d + c + jpeg
    return PREFIX.pack(MAGIC, len(payload)) + payload


class PacketReader:
    """Feed bytes, get complete packets (prefix included). Resyncs on the magic if the stream slips."""

    def __init__(self) -> None:
        self.buf = bytearray()
        self.resyncs = 0

    def _skip(self) -> bool:
        i = self.buf.find(MAGIC, 1)
        if i < 0:
            del self.buf[:max(0, len(self.buf) - (len(MAGIC) - 1))]
            return False
        del self.buf[:i]
        self.resyncs += 1
        return True

    def feed(self, data: bytes) -> list[bytes]:
        self.buf += data
        out = []
        while len(self.buf) >= PREFIX.size:
            magic, n = PREFIX.unpack_from(self.buf, 0)
            if magic != MAGIC or n < HEADER_SIZE or n > MAX_PAYLOAD:
                if not self._skip():
                    break
                continue
            if len(self.buf) < PREFIX.size + n:
                break
            version, = struct.unpack_from("<H", self.buf, PREFIX.size)
            blobs = sum(struct.unpack_from("<III", self.buf, PREFIX.size + 28))
            if version != VERSION or HEADER_SIZE + blobs > n:
                if not self._skip():
                    break
                continue
            out.append(bytes(self.buf[:PREFIX.size + n]))
            del self.buf[:PREFIX.size + n]
        return out


class _MonotonicClock:
    def now_us(self) -> int:
        return time.monotonic_ns() // 1000


class GeppettoDepthCamera:
    """DepthSource for the GeppettoDepth iPhone app: newest frame, never blocks.

    Construct directly, or with from_config(cfg), which reads [camera.geppetto_depth]
    (host, port, timeout_s) and [camera] latency_us. The clock is the core clock.
    """

    def __init__(self, host: str = "127.0.0.1", port: int = DEFAULT_PORT, clock=None, latency_us: int = 0,
                 timeout_s: float = 5.0, on_packet=None) -> None:
        self.host, self.port = host, int(port)
        self.timeout = float(timeout_s)
        self.latency_us = int(latency_us)
        self.clock = clock or _MonotonicClock()
        self.on_packet = on_packet       # called with (arrival_us, packet bytes); the recorder uses it
        self._latest: DepthFrame | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.frames = 0
        self.bytes = 0
        self.bad = 0
        self.resyncs = 0
        self.connected = False
        self.error: str | None = None
        self.tracking: str | None = None
        self._arrivals: list[float] = []

    @classmethod
    def from_config(cls, cfg, clock) -> "GeppettoDepthCamera":
        g = cfg.camera.geppetto_depth
        return cls(host=str(g.host), port=int(g.port), clock=clock, latency_us=int(cfg.camera.latency_us),
                   timeout_s=float(g.timeout_s))

    def start(self) -> None:
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="geppetto-depth", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)

    def _run(self) -> None:
        while not self._stop.is_set():
            reader = PacketReader()
            try:
                with socket.create_connection((self.host, self.port), timeout=self.timeout) as s:
                    s.settimeout(min(self.timeout, 0.5))
                    self.connected = True
                    log.info("GeppettoDepth connected to %s:%d", self.host, self.port)
                    last_data = time.monotonic()
                    while not self._stop.is_set():
                        try:
                            chunk = s.recv(1 << 18)
                        except socket.timeout:
                            if time.monotonic() - last_data > self.timeout:
                                raise
                            continue
                        if not chunk:
                            break
                        last_data = time.monotonic()
                        self.bytes += len(chunk)
                        for pkt in reader.feed(chunk):
                            self._handle(pkt)
                        self.resyncs = reader.resyncs
            except OSError as e:     # socket.timeout and ConnectionRefusedError are OSErrors
                self.error = f"{type(e).__name__}: {e}"
                log.warning("GeppettoDepth %s:%d: %s; retrying", self.host, self.port, self.error)
            self.connected = False
            if not self._stop.is_set():
                self._stop.wait(1.0)

    def _handle(self, pkt: bytes) -> None:
        now = int(self.clock.now_us())
        if self.on_packet is not None:
            self.on_packet(now, pkt)
        f = parse_packet(pkt, now, self.latency_us)
        if f is None:
            self.bad += 1
            return
        h = parse_header(memoryview(pkt)[PREFIX.size:])
        self.tracking = TRACKING.get(h.tracking) if h else None
        with self._lock:
            self._latest = f
        self.error = None
        self.frames += 1
        self._arrivals.append(time.monotonic())
        del self._arrivals[:-120]

    def read(self) -> DepthFrame | None:
        with self._lock:
            return self._latest

    def fps(self) -> float | None:
        a = self._arrivals
        if len(a) < 2 or a[-1] <= a[0]:
            return None
        return (len(a) - 1) / (a[-1] - a[0])

    def status(self) -> dict:
        f = self.read()
        fps = self.fps()
        return {"source": SOURCE, "host": self.host, "port": self.port, "connected": self.connected,
                "frames": self.frames, "bad": self.bad, "resyncs": self.resyncs,
                "fps": None if fps is None else round(fps, 1), "error": self.error, "tracking": self.tracking,
                "rgb": None if f is None else [f.bgr.shape[1], f.bgr.shape[0]],
                "depth": None if f is None or f.depth is None else [f.depth.shape[1], f.depth.shape[0]],
                "plane": None if f is None else f.plane is not None}


def save_frame(f: DepthFrame, out_dir) -> dict:
    """One file per stream: rgb.jpg, depth.npy, depth.png (colour-mapped), confidence.png, frame.json."""
    import json
    from pathlib import Path

    import cv2
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_dir / "rgb.jpg"), f.bgr)
    info: dict = {"frame_id": f.frame_id, "stream_t": f.stream_t, "arrival_us": f.arrival_us,
                  "rgb": [f.bgr.shape[1], f.bgr.shape[0]], "K": f.K.tolist(),
                  "transform": None if f.transform is None else f.transform.tolist(),
                  "plane": None if f.plane is None else f.plane.tolist()}
    if f.depth is not None:
        np.save(out_dir / "depth.npy", f.depth)
        d = f.depth
        valid = np.isfinite(d) & (d > 0)
        info["depth"] = {"shape": [d.shape[1], d.shape[0]], "valid_fraction": round(float(valid.mean()), 4),
                         "min_m": round(float(d[valid].min()), 3) if valid.any() else None,
                         "median_m": round(float(np.median(d[valid])), 3) if valid.any() else None,
                         "max_m": round(float(d[valid].max()), 3) if valid.any() else None}
        cv2.imwrite(str(out_dir / "depth.png"), colour_depth(d))
        info["depth_K"] = f.depth_intrinsics().tolist()
    if f.confidence is not None:
        c = f.confidence
        cv2.imwrite(str(out_dir / "confidence.png"), (c.astype(np.uint16) * 127).clip(0, 255).astype(np.uint8))
        hist = np.bincount(c.ravel(), minlength=3)[:3]
        info["confidence"] = {"shape": [c.shape[1], c.shape[0]], "fraction": {
            "low": round(float(hist[0] / c.size), 4), "medium": round(float(hist[1] / c.size), 4),
            "high": round(float(hist[2] / c.size), 4)}}
    (out_dir / "frame.json").write_text(json.dumps(info, indent=2))
    return info


def colour_depth(d: np.ndarray) -> np.ndarray:
    """Depth to a BGR picture (turbo colour map, 2nd to 98th percentile), black where there is no reading."""
    import cv2
    valid = np.isfinite(d) & (d > 0)
    vis = np.zeros(d.shape, np.uint8)
    if valid.any():
        lo, hi = np.percentile(d[valid], [2, 98])
        vis[valid] = np.clip((d[valid] - lo) / max(1e-6, hi - lo) * 255, 0, 255).astype(np.uint8)
    out = cv2.applyColorMap(vis, cv2.COLORMAP_TURBO)
    out[~valid] = 0
    return out
