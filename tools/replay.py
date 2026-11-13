"""Replay a raw RGMP byte capture on a TCP port, paced by the frame timestamps.

    python -m tools.replay capture.rgmp [--port 12277] [--loop] [--speed 1.0]

The capture is the bytes exactly as the solver sent them (definitions, data
frames, disconnects). Definitions are sent at once on connect; data frames
are paced by their timestamp_us differences.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import struct
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.rgmp import DATA_HDR, OUTER, PREFIX_DATA, PREFIX_DEFINITION  # noqa: E402

log = logging.getLogger("replay")


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


class ReplayServer:
    def __init__(self, path: Path, host: str = "127.0.0.1", port: int = 0, loop: bool = False, speed: float = 1.0) -> None:
        self.path = Path(path)
        self.host, self.port, self.loop, self.speed = host, port, loop, float(speed)
        self.messages = split_capture(self.path.read_bytes())
        self.definitions = [m for p, _, m in self.messages if p == PREFIX_DEFINITION]
        self.server = None
        self.finished = False
        self.frames_sent = 0
        if not self.definitions:
            raise ValueError(f"{self.path}: no RGMP definition found; is this a raw capture?")

    async def start(self) -> None:
        self.server = await asyncio.start_server(self.handle, self.host, self.port)
        self.port = self.server.sockets[0].getsockname()[1]
        log.info("replaying %s on %s:%d (%d messages, loop=%s)", self.path.name, self.host, self.port, len(self.messages), self.loop)

    async def stop(self) -> None:
        if self.server:
            self.server.close()
            try:   # Python 3.12 wait_closed() can block while a handler lingers
                await asyncio.wait_for(self.server.wait_closed(), 1.0)
            except asyncio.TimeoutError:
                pass

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while True:
                for m in self.definitions:
                    writer.write(m)
                await writer.drain()
                prev_ts = None
                wall = time.monotonic()
                for prefix, ts, raw in self.messages:
                    if prefix == PREFIX_DEFINITION:
                        continue
                    if ts is not None and prev_ts is not None:
                        dt = (ts - prev_ts) / 1e6 / self.speed
                        if 0 < dt < 1.0:
                            wall += dt
                            delay = wall - time.monotonic()
                            if delay > 0:
                                await asyncio.sleep(delay)
                        else:
                            wall = time.monotonic()
                    if ts is not None:
                        prev_ts = ts
                    writer.write(raw)
                    if prefix == PREFIX_DATA:
                        self.frames_sent += 1
                    if self.frames_sent % 50 == 0:
                        await writer.drain()
                await writer.drain()
                if not self.loop:
                    break
            self.finished = True
        except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
            pass
        finally:
            writer.close()


async def _main(args) -> None:
    srv = ReplayServer(Path(args.capture), args.host, args.port, args.loop, args.speed)
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
    logging.basicConfig(level="INFO")
    asyncio.run(_main(ap.parse_args()))
