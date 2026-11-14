"""Record a live RGMP socket to a raw capture file, and optionally re-serve it.

    python -m tools.rgmp_tee --from 192.168.1.10:12277 --out logs/capture_$(date +%H%M).rgmp [--serve 12278]

Run this on Saturday morning for the 2-minute capture SPEC.md asks for. The
file it writes is what tools/replay.py and `python -m core --replay` read.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

log = logging.getLogger("rgmp_tee")


async def tee(
    src_host: str,
    src_port: int,
    out: Path,
    serve_port: int | None,
    seconds: float | None,
) -> None:
    clients: set[asyncio.StreamWriter] = set()
    buffered_definitions: list[bytes] = []

    async def on_client(reader, writer):
        for d in buffered_definitions:
            writer.write(d)
        clients.add(writer)
        try:
            await reader.read()
        finally:
            clients.discard(writer)

    server = None
    if serve_port:
        server = await asyncio.start_server(on_client, "0.0.0.0", serve_port)
        log.info("re-serving on 0.0.0.0:%d", serve_port)
    reader, writer = await asyncio.open_connection(src_host, src_port)
    log.info("connected to %s:%d, writing %s", src_host, src_port, out)
    out.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    n = 0
    with open(out, "wb") as f:
        from core.rgmp import OUTER, PREFIX_DEFINITION

        pending = bytearray()
        while True:
            data = await reader.read(65536)
            if not data:
                break
            f.write(data)
            n += len(data)
            pending += data
            # keep definitions so late clients get them
            while len(pending) >= OUTER.size:
                prefix, length = OUTER.unpack_from(pending, 0)
                if len(pending) < OUTER.size + length:
                    break
                msg = bytes(pending[: OUTER.size + length])
                del pending[: OUTER.size + length]
                if prefix == PREFIX_DEFINITION:
                    buffered_definitions.append(msg)
            for c in list(clients):
                try:
                    c.write(data)
                except Exception:
                    clients.discard(c)
            if seconds and time.monotonic() - t0 > seconds:
                break
    log.info("done: %d bytes in %.1fs", n, time.monotonic() - t0)
    writer.close()
    if server:
        server.close()


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--from", dest="src", default="127.0.0.1:12277", help="host:port of the solver"
    )
    ap.add_argument("--out", required=True)
    ap.add_argument(
        "--serve", type=int, default=None, help="also re-serve the stream on this port"
    )
    ap.add_argument(
        "--seconds", type=float, default=None, help="stop after this many seconds"
    )
    logging.basicConfig(level="INFO")
    a = ap.parse_args()
    host, port = a.src.rsplit(":", 1)
    asyncio.run(tee(host, int(port), Path(a.out), a.serve, a.seconds))
