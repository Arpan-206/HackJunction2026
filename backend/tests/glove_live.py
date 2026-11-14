"""Blocking socket helpers for talking to the real Rokoko driver. Used by the hardware tests and glove_check.py.

Ports (Rokoko Device SDK, driver rokoko-sdk.exe): RGMP 12276 (raw device streams), RCSP 45451 (commands),
rkk-hand-solver RGMP output 12277 (solved hand joints). RGMP serves many clients, so reading is safe next to
another reader.
"""

from __future__ import annotations

import json
import os
import socket
import struct
import subprocess
import threading
import time
from dataclasses import dataclass, field

from tests.rgmp_reader import TYPE_DATA, TYPE_DEFINITION, Capture, parse_capture

HOST = "127.0.0.1"
RGMP_PORT, RCSP_PORT, SOLVER_PORT = 12276, 45451, 12277


def live_enabled() -> bool:
    return os.environ.get("GLOVES_LIVE") == "1"


def port_open(port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((HOST, port), timeout=timeout):
            return True
    except OSError:
        return False


@dataclass
class StreamRecording:
    """Everything read from one RGMP port for a fixed time."""

    raw: bytes = b""
    definition_at: dict[int, float] = field(
        default_factory=dict
    )  # device id -> seconds after connect
    arrivals: list[tuple[float, int, int, int]] = field(
        default_factory=list
    )  # (t_host, device, group, ts_us)
    seconds: float = 0.0

    def capture(self) -> Capture:
        return parse_capture(self.raw)

    def frame_ages_s(self, device: int) -> list[float]:
        """How late each frame arrived compared with the fastest one: the transport delay above its own minimum.

        Device timestamps use the device's own clock, so absolute age cannot be read; lag growth and jitter can."""
        rows = [(t - ts / 1e6) for t, dev, _g, ts in self.arrivals if dev == device]
        if not rows:
            return []
        lo = min(rows)
        return [r - lo for r in rows]


def record(port: int, seconds: float) -> StreamRecording:
    """Connect to an RGMP port and keep everything it sends for `seconds`."""
    rec = StreamRecording()
    buf = bytearray()
    chunks: list[bytes] = []
    sock = socket.create_connection((HOST, port), timeout=3)
    sock.settimeout(0.5)
    t0 = time.monotonic()
    try:
        while (now := time.monotonic()) - t0 < seconds:
            try:
                data = sock.recv(1 << 20)
            except TimeoutError:
                continue
            if not data:
                break
            chunks.append(data)
            buf += data
            while len(buf) >= 8:
                typ, length = struct.unpack_from("<II", buf, 0)
                if len(buf) < 8 + length:
                    break
                payload = bytes(buf[8 : 8 + length])
                del buf[: 8 + length]
                if typ == TYPE_DEFINITION:
                    rec.definition_at.setdefault(
                        json.loads(payload)["device_id"], now - t0
                    )
                elif typ == TYPE_DATA:
                    dev, grp, ts = struct.unpack_from("<IIQ", payload, 0)
                    rec.arrivals.append((now, dev, grp, ts))
    finally:
        sock.close()
    rec.raw = b"".join(chunks)
    rec.seconds = time.monotonic() - t0
    return rec


def record_both(seconds: float) -> tuple[StreamRecording, StreamRecording]:
    """Record the driver and the solver at the same time."""
    out: dict[str, StreamRecording] = {}
    threads = [
        threading.Thread(target=lambda k=k, p=p: out.__setitem__(k, record(p, seconds)))
        for k, p in (("driver", RGMP_PORT), ("solver", SOLVER_PORT))
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out["driver"], out["solver"]


# ---------------------------------------------------------------- RCSP (JSON with an 8 byte header)

_RCSP_HEADER = struct.Struct(
    "<BBBBI"
)  # marker 0xDC, version 1, header size 8, type, body length
_T_COMMAND = 1


def rcsp_command(
    name: str, arguments: dict | None = None, timeout: float = 3.0
) -> dict:
    """Send one RCSP command and return the full reply body (Status, Response or Error)."""
    body = {"Command": name, "TrackId": "1", "Version": 1}
    if arguments:
        body["Arguments"] = arguments
    data = json.dumps(body, separators=(",", ":")).encode()
    with socket.create_connection((HOST, RCSP_PORT), timeout=timeout) as s:
        s.settimeout(timeout)
        s.sendall(_RCSP_HEADER.pack(0xDC, 1, 8, _T_COMMAND, len(data)) + data)
        buf = b""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            buf += s.recv(65536)
            while len(buf) >= 8:
                marker, _v, hsize, mtype, length = _RCSP_HEADER.unpack_from(buf, 0)
                if marker != 0xDC:
                    raise ValueError("not an RCSP header")
                if len(buf) < (hsize or 8) + length:
                    break
                msg = json.loads(buf[(hsize or 8) : (hsize or 8) + length] or b"{}")
                buf = buf[(hsize or 8) + length :]
                if msg.get("TrackId") == "1":  # skip events
                    return msg
    raise TimeoutError(f"RCSP {name} got no reply in {timeout}s")


def running_processes() -> list[str]:
    """Names of running processes (Windows tasklist, elsewhere ps)."""
    if os.name == "nt":
        out = subprocess.run(
            ["tasklist", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            timeout=20,
        ).stdout
        return [line.split('","')[0].strip('"') for line in out.splitlines() if line]
    out = subprocess.run(
        ["ps", "-A", "-o", "comm="], capture_output=True, text=True, timeout=20
    ).stdout
    return out.splitlines()


class StreamSubscription:
    """Hold an RCSP connection open with SubscribeToData for every glove.

    FINDING: the driver lists the gloves and sends RGMP definitions without any subscription, but sends NO data
    frames until some RCSP client has called SubscribeToData for the device, and stops again when that client
    disconnects (core/rcsp.py GloveControl does this with auto_stream). Leaving the context closes the socket."""

    def __init__(self) -> None:
        self.sock: socket.socket | None = None

    def __enter__(self) -> "StreamSubscription":
        self.sock = socket.create_connection((HOST, RCSP_PORT), timeout=3)
        self.sock.settimeout(3)
        ids = [d["DeviceId"] for d in self._call("ListDevices", 1)["Response"]["Devices"]]
        for n, dev in enumerate(ids, start=2):
            reply = self._call("SubscribeToData", n, {"DeviceId": dev})
            if reply.get("Status") != "Ok":
                raise RuntimeError(f"SubscribeToData({dev}) failed: {reply}")
        return self

    def __exit__(self, *exc) -> None:
        if self.sock:
            self.sock.close()

    def _call(self, name: str, track: int, arguments: dict | None = None) -> dict:
        assert self.sock
        body: dict = {"Command": name, "TrackId": str(track), "Version": 1}
        if arguments:
            body["Arguments"] = arguments
        data = json.dumps(body, separators=(",", ":")).encode()
        self.sock.sendall(_RCSP_HEADER.pack(0xDC, 1, 8, _T_COMMAND, len(data)) + data)
        buf = b""
        while True:
            buf += self.sock.recv(65536)
            while len(buf) >= 8:
                _m, _v, hsize, _t, length = _RCSP_HEADER.unpack_from(buf, 0)
                if len(buf) < (hsize or 8) + length:
                    break
                msg = json.loads(buf[(hsize or 8) : (hsize or 8) + length] or b"{}")
                buf = buf[(hsize or 8) + length :]
                if msg.get("TrackId") == str(track):
                    return msg
