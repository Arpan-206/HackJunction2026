"""Depth camera source: the free Record3DStream app (PathOn) on an iPhone or iPad with LiDAR.

The app serves a binary TCP stream (no HTTP): every packet starts with "REC3D"
and carries, in order, a header, the 3x3 RGB intrinsics, a 4x4 camera-to-world
transform, the depth map (float32 metres, 256x192), a JPEG colour image
(1920x1440), the confidence map (uint8, 0 low, 1 medium, 2 high) and an IMU
sample. The layout follows the protocol description in PathOn's open-source
repository (software/iphone_sensor_suite/Record3DStream/sdk/sdk/protocol.py);
this file is our own reader of that documented format, so nothing of theirs is
vendored. ARKit's depth is already aligned to the colour camera, so a depth
pixel maps to the colour image by plain scaling.

Address and port come from config.toml [camera.record3dstream], never from code.
"""
from __future__ import annotations

import json
import logging
import socket
import struct
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
import numpy as np

from .depth import DepthFrame, DepthSource  # noqa: F401  (DepthSource re-exported for callers)

log = logging.getLogger("geppetto.camera.record3dstream")

MAGIC = b"REC3D"
HEADER_V1 = 32
HEADER_V2 = 48
INTRINSICS_BYTES = 36
TRANSFORM_BYTES = 64
IMU_BYTES = 56


@dataclass
class R3DHeader:
    version: int
    frame_id: int
    timestamp: float          # seconds since the app started streaming
    depth_w: int
    depth_h: int
    depth_size: int
    rgb_size: int
    rgb_w: int = 0
    rgb_h: int = 0
    confidence_size: int = 0
    imu_size: int = 0

    @property
    def header_size(self) -> int:
        return HEADER_V2 if self.version >= 2 else HEADER_V1

    @property
    def packet_size(self) -> int:
        return (self.header_size + INTRINSICS_BYTES + TRANSFORM_BYTES + self.depth_size + self.rgb_size
                + self.confidence_size + self.imu_size)


def parse_header(data: bytes) -> R3DHeader | None:
    if len(data) < HEADER_V1 or data[:5] != MAGIC:
        return None
    version = data[5]
    frame_id, ts = struct.unpack_from("<Id", data, 6)
    dw, dh, dsize, rsize = struct.unpack_from("<HHII", data, 18)
    h = R3DHeader(version, frame_id, ts, dw, dh, dsize, rsize)
    if version >= 2:
        if len(data) < HEADER_V2:
            return None
        h.rgb_w, h.rgb_h, h.confidence_size, h.imu_size = struct.unpack_from("<HHII", data, 30)
    return h


def parse_packet(data: bytes, arrival_us: int, latency_us: int = 0) -> DepthFrame | None:
    """One complete packet -> DepthFrame, or None when the JPEG does not decode."""
    import cv2
    h = parse_header(data)
    if h is None or len(data) < h.packet_size:
        return None
    o = h.header_size
    K = np.frombuffer(data, dtype=np.float32, count=9, offset=o).reshape(3, 3).astype(float)
    o += INTRINSICS_BYTES
    T = np.frombuffer(data, dtype=np.float32, count=16, offset=o).reshape(4, 4).astype(float)
    o += TRANSFORM_BYTES
    depth = None
    if h.depth_size >= h.depth_w * h.depth_h * 4 and h.depth_w and h.depth_h:
        depth = np.frombuffer(data, dtype=np.float32, count=h.depth_w * h.depth_h, offset=o).reshape(h.depth_h, h.depth_w).copy()
    o += h.depth_size
    bgr = cv2.imdecode(np.frombuffer(data, dtype=np.uint8, count=h.rgb_size, offset=o), cv2.IMREAD_COLOR)
    o += h.rgb_size
    if bgr is None:
        return None
    conf = None
    if h.confidence_size >= h.depth_w * h.depth_h and h.depth_w and h.depth_h:
        conf = np.frombuffer(data, dtype=np.uint8, count=h.depth_w * h.depth_h, offset=o).reshape(h.depth_h, h.depth_w).copy()
    o += h.confidence_size
    imu = None
    if h.imu_size >= IMU_BYTES:
        imu = np.array(struct.unpack_from("<7d", data, o))
    return DepthFrame(t_us=arrival_us - latency_us, bgr=bgr, depth=depth, K=K, confidence=conf, transform=T,
                      frame_id=h.frame_id, stream_t=h.timestamp, arrival_us=arrival_us, imu=imu, source="record3dstream")


def build_packet(bgr: np.ndarray, depth: np.ndarray, K: np.ndarray, confidence: np.ndarray | None = None,
                 frame_id: int = 1, timestamp: float = 0.0, transform: np.ndarray | None = None) -> bytes:
    """The inverse of parse_packet, for tests and fake streams (protocol v2)."""
    import cv2
    ok, jpg = cv2.imencode(".jpg", bgr)
    assert ok
    rgb = jpg.tobytes()
    d = depth.astype(np.float32).tobytes()
    c = confidence.astype(np.uint8).tobytes() if confidence is not None else b""
    T = (np.eye(4) if transform is None else transform).astype(np.float32).tobytes()
    imu = struct.pack("<7d", 0, 0, -9.81, 0, 0, 0, timestamp)
    head = MAGIC + bytes([2]) + struct.pack("<Id", frame_id, timestamp) + struct.pack("<HHII", depth.shape[1], depth.shape[0], len(d), len(rgb))
    head += struct.pack("<HHII", bgr.shape[1], bgr.shape[0], len(c), len(imu)) + b"\0" * 6
    return head + np.asarray(K, dtype=np.float32).tobytes() + T + d + rgb + c + imu


class PacketReader:
    """Feed bytes, get complete packets. Resyncs on the magic if the stream slips."""

    def __init__(self) -> None:
        self.buf = bytearray()
        self.resyncs = 0

    def feed(self, data: bytes) -> list[bytes]:
        self.buf += data
        out = []
        while True:
            if len(self.buf) < HEADER_V1:
                break
            if self.buf[:5] != MAGIC:
                i = self.buf.find(MAGIC, 1)
                if i < 0:
                    self.buf = self.buf[-4:]
                    break
                del self.buf[:i]
                self.resyncs += 1
                continue
            h = parse_header(bytes(self.buf[:HEADER_V2]))
            if h is None or (h.version >= 2 and len(self.buf) < HEADER_V2):
                break
            n = h.packet_size
            if len(self.buf) < n:
                break
            out.append(bytes(self.buf[:n]))
            del self.buf[:n]
        return out


class Record3DStreamCamera:
    """DepthSource for the PathOn app: newest frame, never blocks. Reads config [camera.record3dstream]."""

    def __init__(self, cfg, clock) -> None:
        r = cfg.camera.record3dstream
        self.host, self.port = str(r.host), int(r.port)
        self.timeout = float(r.timeout_s)
        self.latency_us = int(cfg.camera.latency_us)
        self.min_confidence = int(r.get("min_confidence", 1))
        self.usb = bool(r.get("usb", False))
        self._iproxy: subprocess.Popen | None = None
        self.clock = clock
        self._latest: DepthFrame | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.frames = 0
        self.bytes = 0
        self.connected = False
        self.error: str | None = None
        self._arrivals: list[float] = []

    def start(self) -> None:
        if self.usb:
            # USB: iproxy (libimobiledevice, brew install libimobiledevice) forwards
            # localhost:port to the phone's port over the cable, no WiFi involved.
            self._iproxy = subprocess.Popen(["iproxy", f"{self.port}:{self.port}"],
                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.host = "127.0.0.1"
            time.sleep(0.5)
        self._thread = threading.Thread(target=self._run, name="record3dstream", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        if self._iproxy is not None:
            self._iproxy.terminate()
            self._iproxy = None

    def _run(self) -> None:
        reader = PacketReader()
        while not self._stop.is_set():
            try:
                with socket.create_connection((self.host, self.port), timeout=self.timeout) as s:
                    s.settimeout(self.timeout)
                    self.connected = True
                    self.error = None
                    log.info("Record3DStream connected to %s:%d", self.host, self.port)
                    while not self._stop.is_set():
                        chunk = s.recv(1 << 18)
                        if not chunk:
                            break
                        self.bytes += len(chunk)
                        for pkt in reader.feed(chunk):
                            now = int(self.clock.now_us())
                            f = parse_packet(pkt, now, self.latency_us)
                            if f is None:
                                continue
                            with self._lock:
                                self._latest = f
                            self.frames += 1
                            self._arrivals.append(time.monotonic())
                            del self._arrivals[:-120]
            except (OSError, socket.timeout) as e:
                self.error = f"{type(e).__name__}: {e}"
                log.warning("Record3DStream %s:%d: %s; retrying", self.host, self.port, self.error)
            self.connected = False
            if not self._stop.is_set():
                time.sleep(1.0)

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
        return {"host": self.host, "port": self.port, "usb": self.usb, "connected": self.connected, "frames": self.frames,
                "fps": None if self.fps() is None else round(self.fps(), 1), "error": self.error,
                "rgb": None if f is None else [f.bgr.shape[1], f.bgr.shape[0]],
                "depth": None if f is None or f.depth is None else [f.depth.shape[1], f.depth.shape[0]]}


def save_frame(f: DepthFrame, out_dir: Path) -> dict:
    """One file per stream: rgb.jpg, depth.npy, depth.png (colour-mapped), confidence.png, intrinsics.json."""
    import cv2
    out_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_dir / "rgb.jpg"), f.bgr)
    info: dict = {"frame_id": f.frame_id, "stream_t": f.stream_t, "arrival_us": f.arrival_us,
                  "rgb": [f.bgr.shape[1], f.bgr.shape[0]], "K": f.K.tolist(),
                  "transform": None if f.transform is None else f.transform.tolist(),
                  "imu": None if f.imu is None else f.imu.tolist()}
    if f.depth is not None:
        np.save(out_dir / "depth.npy", f.depth)
        d = f.depth
        valid = np.isfinite(d) & (d > 0)
        info["depth"] = {"shape": [d.shape[1], d.shape[0]], "valid_fraction": round(float(valid.mean()), 4),
                         "min_m": round(float(d[valid].min()), 3) if valid.any() else None,
                         "median_m": round(float(np.median(d[valid])), 3) if valid.any() else None,
                         "max_m": round(float(d[valid].max()), 3) if valid.any() else None}
        vis = np.zeros(d.shape, np.uint8)
        if valid.any():
            lo, hi = np.percentile(d[valid], [2, 98])
            vis[valid] = np.clip((d[valid] - lo) / max(1e-6, hi - lo) * 255, 0, 255).astype(np.uint8)
        cv2.imwrite(str(out_dir / "depth.png"), cv2.applyColorMap(vis, cv2.COLORMAP_TURBO))
        info["depth_K"] = f.depth_intrinsics().tolist()
    if f.confidence is not None:
        c = f.confidence
        cv2.imwrite(str(out_dir / "confidence.png"), (c.astype(np.uint16) * 127).clip(0, 255).astype(np.uint8))
        hist = np.bincount(c.ravel(), minlength=3)[:3]
        info["confidence"] = {"shape": [c.shape[1], c.shape[0]], "fraction": {"low": round(float(hist[0] / c.size), 4),
                              "medium": round(float(hist[1] / c.size), 4), "high": round(float(hist[2] / c.size), 4)}}
    (out_dir / "intrinsics.json").write_text(json.dumps({"K_rgb": f.K.tolist(), "rgb": info["rgb"],
                                                         "K_depth": info.get("depth_K"), "depth": info.get("depth", {}).get("shape")}, indent=2))
    (out_dir / "frame.json").write_text(json.dumps(info, indent=2))
    return info
