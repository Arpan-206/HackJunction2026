"""A fake rkk-hand-solver: serves a plausible solved_hand RGMP stream on a TCP port.

    python -m tools.fake_rgmp_server --port 12277 [--layout transform|split] [--capture out.rgmp]

Two devices: id 1 is the left hand, id 2 the right. Fingers move sinusoidally.
The definition layout is a guess at Rokoko's real one (see DECISIONS D9), so
the layout is switchable to prove the parser reads offsets from the definition.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import struct
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core import geom  # noqa: E402
from core import hand as H  # noqa: E402

log = logging.getLogger("fake_rgmp")
OUTER = struct.Struct("<II")
DATA_HDR = struct.Struct("<IIQ")


def joint_transform(local: np.ndarray, rots_local: np.ndarray, q: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Wrist-frame joints -> xr_base (wrist at origin, world-aligned axes)."""
    xr = geom.rotate(q, local)
    rots = np.array([geom.quat_mul(q, r) for r in rots_local])
    return xr, rots


def make_definition(device_id: int, side: str, layout: str, hand_field: str = "device_info",
                    rate_hz: float = 83.33, names: str = "openxr") -> dict:
    streams = []
    for j in H.JOINT_NAMES:
        name = j if names == "openxr" else f"XR_HAND_JOINT_{j.upper()}_EXT"
        if layout == "transform":
            streams.append({"data_type": "FLOAT[7]", "measure_type": "TRANSFORM", "target_frame": name, "reference_frame": "xr_base"})
        else:
            streams.append({"data_type": "FLOAT[3]", "measure_type": "POSITION", "target_frame": name, "reference_frame": "xr_base"})
            streams.append({"data_type": "FLOAT[4]", "measure_type": "ORIENTATION", "target_frame": name, "reference_frame": "xr_base"})
    streams.append({"data_type": "UINT32", "measure_type": "STATUS_FLAGS", "target_frame": "hub",
                    "bit_mapping": {"0": "is_heading_reliable", "1": "is_calibrated"}})
    rest = H.synth_joints({}, side=side)
    rest_rots = H.joint_rotations(rest)
    static = [{"data_type": "FLOAT[7]", "measure_type": "TRANSFORM", "target_frame": j, "reference_frame": "xr_base",
               "value": [*map(float, rest[i]), *map(float, rest_rots[i])]} for i, j in enumerate(H.JOINT_NAMES)]
    device_info = {"name": "Smartgloves II solved" + (f" ({side})" if hand_field != "none" else ""), "firmware": "fake"}
    if hand_field == "device_info":
        device_info["hand"] = side
    elif hand_field == "static_data":
        static.append({"data_type": "UINT8", "measure_type": "CUSTOM", "custom_label": "hand", "value": side})
    # hand_field == "none": the reader must fall back to device_id parity
    return {
        "protocol_name": "RGMP", "protocol_version": "2.0.0",
        "device_id": device_id, "device_type": "solved_hand", "timestamp_epoch": "unix_epoch",
        "device_info": device_info, "static_data": static,
        "groups": [{"name": "joints_openxr", "expected_rate_hz": rate_hz, "streams": streams}],
    }


def pack_definition(doc: dict) -> bytes:
    body = json.dumps(doc).encode("utf-8")
    return OUTER.pack(1, len(body)) + body


def pack_frame(device_id: int, group_id: int, ts_us: int, joints: np.ndarray, rots: np.ndarray, layout: str,
               flags: int = 1) -> bytes:
    vals = []
    for i in range(26):
        vals.extend(map(float, joints[i]))
        vals.extend(map(float, rots[i]))
    body = DATA_HDR.pack(device_id, group_id, ts_us) + struct.pack(f"<{len(vals)}f", *vals) + struct.pack("<I", flags)
    return OUTER.pack(2, len(body)) + body


def pack_disconnect(device_id: int) -> bytes:
    body = json.dumps({"device_id": device_id}).encode()
    return OUTER.pack(3, len(body)) + body


def curl_at(t_s: float, side: str) -> dict[str, float]:
    ph = 0.0 if side == "right" else 1.3
    return {f: float(0.5 + 0.45 * np.sin(2 * np.pi * t_s / 4.0 + 0.5 * i + ph)) for i, f in enumerate(H.FINGERS)}


def frame_bytes(t_s: float, ts_us: int, side: str, device_id: int, layout: str) -> bytes:
    local = H.synth_joints(curl_at(t_s, side), side=side)
    rots_local = H.joint_rotations(local)
    q = geom.quat_mul(geom.yaw_quat(0.3 * np.sin(0.4 * t_s)), geom.quat_from_axis_angle([1, 0, 0], 0.15 * np.sin(0.7 * t_s)))
    xr, rots = joint_transform(local, rots_local, q)
    return pack_frame(device_id, 0, ts_us, xr, rots, layout)


class FakeRgmpServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 0, layout: str = "transform", rate_hz: float = 83.33,
                 hand_field: str = "device_info", names: str = "openxr", max_frames: int | None = None,
                 capture: Path | None = None, sides=("left", "right")) -> None:
        self.host, self.port = host, port
        self.layout, self.rate_hz, self.hand_field, self.names = layout, rate_hz, hand_field, names
        self.max_frames = max_frames
        self.capture = capture
        self.sides = sides
        self.server: asyncio.base_events.Server | None = None
        self.frames_sent = 0

    async def start(self) -> None:
        self.server = await asyncio.start_server(self.handle, self.host, self.port)
        self.port = self.server.sockets[0].getsockname()[1]
        log.info("fake RGMP solver on %s:%d (layout %s)", self.host, self.port, self.layout)

    async def stop(self) -> None:
        if self.server:
            self.server.close()
            try:   # Python 3.12 wait_closed() can block while a handler lingers
                await asyncio.wait_for(self.server.wait_closed(), 1.0)
            except asyncio.TimeoutError:
                pass

    def device_id(self, side: str) -> int:
        return 1 if side == "left" else 2

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        cap = open(self.capture, "wb") if self.capture else None
        try:
            for side in self.sides:
                data = pack_definition(make_definition(self.device_id(side), side, self.layout, self.hand_field, self.rate_hz, self.names))
                writer.write(data)
                if cap:
                    cap.write(data)
            await writer.drain()
            t0 = time.monotonic()
            n = 0
            while self.max_frames is None or n < self.max_frames:
                t_s = n / self.rate_hz
                target = t0 + t_s
                delay = target - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
                ts_us = int(time.time() * 1e6)
                for side in self.sides:
                    data = frame_bytes(t_s, ts_us, side, self.device_id(side), self.layout)
                    writer.write(data)
                    if cap:
                        cap.write(data)
                await writer.drain()
                n += 1
                self.frames_sent += 1
            for side in self.sides:
                data = pack_disconnect(self.device_id(side))
                writer.write(data)
                if cap:
                    cap.write(data)
            await writer.drain()
        except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
            pass
        finally:
            if cap:
                cap.close()
            writer.close()


async def _main(args) -> None:
    srv = FakeRgmpServer(args.host, args.port, args.layout, args.rate, args.hand_field, args.names, args.frames,
                         Path(args.capture) if args.capture else None)
    await srv.start()
    print(f"fake RGMP solver listening on {srv.host}:{srv.port}", flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=12277)
    ap.add_argument("--layout", choices=["transform", "split"], default="transform")
    ap.add_argument("--names", choices=["openxr", "xr_enum"], default="openxr")
    ap.add_argument("--hand-field", choices=["device_info", "static_data", "none"], default="device_info")
    ap.add_argument("--rate", type=float, default=83.33)
    ap.add_argument("--frames", type=int, default=None, help="stop after this many frames (default: forever)")
    ap.add_argument("--capture", default=None, help="also write the raw bytes sent to this file")
    logging.basicConfig(level="INFO")
    asyncio.run(_main(ap.parse_args()))
