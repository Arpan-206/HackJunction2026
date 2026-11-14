"""Replay a raw RGMP byte capture on a TCP port, paced by the frame timestamps.

    python -m tools.replay capture.rgmp [--port 12277] [--loop] [--speed 1.0]
        [--start S] [--seconds D] [--stream] [--continuous]

The capture is the bytes exactly as the solver sent them (definitions, data
frames, disconnects). Definitions are sent at once on connect; data frames
are paced by their timestamp_us differences.

Additive options (replay-demo lane):
  --start S, --seconds D  play only this window, in capture seconds (the first
                          device's own clock from its first frame; see
                          tools/capture_inventory.py). The file is streamed to
                          find the window, so a 1.2 GB hour is never loaded whole;
                          every definition before the window end is still sent.
  --stream                no window: read the file from disk on every pass
                          instead of loading it into memory (for the long hour).
  --continuous            with --loop: shift each pass's timestamps forward so
                          the stream looks like one unbroken take to the core
                          (no clock jump back at the loop seam).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import struct
import sys
import time
from collections.abc import Iterable, Iterator
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.rgmp import DATA_HDR, OUTER, PREFIX_DATA, PREFIX_DEFINITION

log = logging.getLogger("replay")

FRAME_GAP_US = 12_000  # one solver frame at 83 Hz, between the last frame of a pass and the first of the next
_TS = struct.Struct("<Q")


def split_capture(data: bytes) -> list[tuple[int, int | None, bytes]]:
    """-> [(prefix, timestamp_us or None, raw message bytes incl. outer header)]"""
    out = []
    i, n = 0, len(data)
    while i + OUTER.size <= n:
        prefix, length = OUTER.unpack_from(data, i)
        end = i + OUTER.size + length
        if end > n:
            break
        ts = None
        if prefix == PREFIX_DATA and length >= DATA_HDR.size:
            _, _, ts = DATA_HDR.unpack_from(data, i + OUTER.size)
        out.append((prefix, ts, data[i:end]))
        i = end
    return out


def iter_messages(
    path: Path, chunk: int = 8 << 20
) -> Iterator[tuple[int, int | None, int | None, bytes]]:
    """(prefix, device_id, timestamp_us, raw message) for every complete message, read in chunks."""
    buf = bytearray()
    with open(path, "rb") as f:
        while True:
            data = f.read(chunk)
            if not data:
                break
            buf += data
            i, n = 0, len(buf)
            while i + OUTER.size <= n:
                prefix, length = OUTER.unpack_from(buf, i)
                end = i + OUTER.size + length
                if end > n:
                    break
                dev = ts = None
                if prefix == PREFIX_DATA and length >= DATA_HDR.size:
                    dev, _, ts = DATA_HDR.unpack_from(buf, i + OUTER.size)
                yield prefix, dev, ts, bytes(buf[i:end])
                i = end
            del buf[:i]


class CaptureClock:
    """Capture time for every device: the first device's own clock from its first frame; a later device is
    offset to the first device's time when it first appears. The same pacer tools/replay.py uses.

    A device whose timestamp jumps back, or forward by JUMP_US or more (a glove that reconnected with a
    fresh boot clock, or a gap), is re-based to continue from the current time. ReplayServer restarts its
    pacing on the same jumps, so capture time here is playback time there (gaps are not waited out)."""

    JUMP_US = 1_000_000

    def __init__(self) -> None:
        self.base: dict[int, int] = {}
        self.offset: dict[int, int] = {}
        self.last: dict[int, int] = {}
        self.pacer: int | None = None
        self.now_us = 0
        self.rebased = 0

    def t_us(self, dev: int, ts: int) -> int:
        if self.pacer is None:
            self.pacer = dev
        if dev not in self.base:
            self.base[dev] = ts
            self.offset[dev] = 0 if dev == self.pacer else self.now_us
        elif not 0 <= ts - self.last[dev] < self.JUMP_US:
            self.base[dev] = ts
            self.offset[dev] = self.now_us + FRAME_GAP_US
            self.rebased += 1
        self.last[dev] = ts
        t = ts - self.base[dev] + self.offset[dev]
        self.now_us = max(self.now_us, t)
        return t


def cut_window(
    path: Path, start_s: float = 0.0, seconds: float | None = None
) -> tuple[list[bytes], list[tuple[int, int | None, bytes]]]:
    """Stream the file once -> (every definition before the window end, [(prefix, ts, raw)] inside the window).

    Disconnect messages inside the window are kept; data frames are kept when their capture time is in
    [start_s, start_s + seconds). Raises ValueError when the window holds no data frame.
    """
    lo = int(start_s * 1e6)
    hi = None if seconds is None else lo + int(seconds * 1e6)
    cc = CaptureClock()
    defs: list[bytes] = []
    window: list[tuple[int, int | None, bytes]] = []
    for prefix, dev, ts, raw in iter_messages(path):
        if prefix == PREFIX_DEFINITION:
            defs.append(raw)
            continue
        if prefix != PREFIX_DATA or dev is None or ts is None:
            if cc.now_us >= lo:
                window.append((prefix, ts, raw))
            continue
        t = cc.t_us(dev, ts)
        if hi is not None and t >= hi:
            break
        if t >= lo:
            window.append((prefix, ts, raw))
    if not any(p == PREFIX_DATA for p, _, _ in window):
        raise ValueError(
            f"{path}: no data frames between {start_s} s and "
            f"{'the end' if seconds is None else f'{start_s + seconds} s'}"
        )
    return defs, window


def restamp(raw: bytes, shift_us: int) -> bytes:
    """The same data message with timestamp_us moved by shift_us."""
    if not shift_us:
        return raw
    b = bytearray(raw)
    off = OUTER.size + 8  # device_id, group_id, then timestamp_us
    (ts,) = _TS.unpack_from(b, off)
    _TS.pack_into(b, off, ts + shift_us)
    return bytes(b)


class ReplayServer:
    def __init__(
        self,
        path: Path,
        host: str = "127.0.0.1",
        port: int = 0,
        loop: bool = False,
        speed: float = 1.0,
        start_s: float | None = None,
        seconds: float | None = None,
        stream: bool = False,
        continuous: bool = False,
    ) -> None:
        self.path = Path(path)
        self.host, self.port, self.loop, self.speed = host, port, loop, float(speed)
        self.continuous = bool(continuous)
        self.stream = False
        if start_s is not None or seconds is not None:
            self.definitions, self.messages = cut_window(
                self.path, start_s or 0.0, seconds
            )
        elif stream:
            self.stream = True
            self.messages = []
            self.definitions = []
            for prefix, _, _, raw in iter_messages(self.path):
                if prefix == PREFIX_DEFINITION:
                    self.definitions.append(raw)
        else:
            self.messages = split_capture(self.path.read_bytes())
            self.definitions = [
                m for p, _, m in self.messages if p == PREFIX_DEFINITION
            ]
        self.server = None
        self.finished = False
        self.frames_sent = 0
        self.passes = 0
        if not self.definitions:
            raise ValueError(
                f"{self.path}: no RGMP definition found; is this a raw capture?"
            )

    def _one_pass(self) -> Iterable[tuple[int, int | None, bytes]]:
        if self.stream:
            return ((p, ts, raw) for p, _, ts, raw in iter_messages(self.path))
        return self.messages

    async def start(self) -> None:
        self.server = await asyncio.start_server(self.handle, self.host, self.port)
        self.port = self.server.sockets[0].getsockname()[1]
        log.info(
            "replaying %s on %s:%d (%s, loop=%s)",
            self.path.name,
            self.host,
            self.port,
            "streamed from disk" if self.stream else f"{len(self.messages)} messages",
            self.loop,
        )

    async def stop(self) -> None:
        if self.server:
            self.server.close()
            try:  # Python 3.12 wait_closed() can block while a handler lingers
                await asyncio.wait_for(self.server.wait_closed(), 1.0)
            except TimeoutError:
                pass

    async def handle(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        shift: dict[
            int, int
        ] = {}  # per device: added to timestamp_us on this pass (--continuous)
        try:
            while True:
                for m in self.definitions:
                    writer.write(m)
                await writer.drain()
                # Each glove has its own boot clock, so pace on the first device seen and
                # send the other devices' frames as they come in stream order.
                pacer: int | None = None
                prev_ts = None
                wall = time.monotonic()
                last_ts: dict[int, int] = {}
                first_ts: dict[int, int] = {}
                for prefix, ts, raw in self._one_pass():
                    if prefix == PREFIX_DEFINITION:
                        continue
                    dev = (
                        DATA_HDR.unpack_from(raw, OUTER.size)[0]
                        if prefix == PREFIX_DATA
                        else None
                    )
                    if dev is not None and pacer is None:
                        pacer = dev
                    if ts is not None and dev is not None:
                        first_ts.setdefault(dev, ts)
                        last_ts[dev] = ts
                    if ts is not None and dev == pacer:
                        if prev_ts is not None:
                            dt = (ts - prev_ts) / 1e6 / self.speed
                            if 0 < dt < 1.0:
                                wall += dt
                                delay = wall - time.monotonic()
                                if delay > 0:
                                    await asyncio.sleep(delay)
                            else:  # a gap or a jump in the capture: restart pacing from now
                                wall = time.monotonic()
                        prev_ts = ts
                    if self.continuous and dev is not None and shift.get(dev):
                        raw = restamp(raw, shift[dev])
                    writer.write(raw)
                    if prefix == PREFIX_DATA:
                        self.frames_sent += 1
                    if self.frames_sent % 50 == 0:
                        await writer.drain()
                await writer.drain()
                self.passes += 1
                if not self.loop:
                    break
                if self.continuous:
                    # next pass starts one frame after this pass ended, per device
                    for dev, t_last in last_ts.items():
                        shift[dev] = (
                            shift.get(dev, 0) + (t_last - first_ts[dev]) + FRAME_GAP_US
                        )
            self.finished = True
        except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
            pass
        finally:
            writer.close()


async def _main(args) -> None:
    srv = ReplayServer(
        Path(args.capture),
        args.host,
        args.port,
        args.loop,
        args.speed,
        start_s=args.start,
        seconds=args.seconds,
        stream=args.stream,
        continuous=args.continuous,
    )
    await srv.start()
    print(f"replaying {args.capture} on {srv.host}:{srv.port}", flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=12277)
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument(
        "--start", type=float, default=None, help="window start, capture seconds"
    )
    ap.add_argument("--seconds", type=float, default=None, help="window length")
    ap.add_argument(
        "--stream", action="store_true", help="read from disk each pass (no window)"
    )
    ap.add_argument(
        "--continuous",
        action="store_true",
        help="with --loop: no timestamp jump at the seam",
    )
    logging.basicConfig(level="INFO")
    asyncio.run(_main(ap.parse_args()))
