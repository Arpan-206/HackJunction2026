"""Record the viewer WebSocket to a JSONL file, or replay one so the viewer runs with no core.

    python -m tools.ws_log record --url ws://localhost:8765/ws --out logs/ws_$(date +%H%M).jsonl [--seconds 60]
    python -m tools.ws_log replay logs/ws_0112.jsonl [--port 8765] [--loop]

Each line is {"dt_ms": <ms since the previous message>, "msg": {...}}. The
replayer serves /ws, sends the recorded messages paced by dt_ms, and answers
every cmd with a plausible ok ack (so viewer buttons do not error).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from pathlib import Path

log = logging.getLogger("ws_log")


async def record(url: str, out: Path, seconds: float | None) -> None:
    import websockets

    out.parent.mkdir(parents=True, exist_ok=True)
    n, t0, last = 0, time.monotonic(), None
    async with websockets.connect(url, max_size=None) as ws:
        with open(out, "w") as f:
            log.info("recording %s -> %s", url, out)
            while seconds is None or time.monotonic() - t0 < seconds:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                except TimeoutError:
                    continue
                now = time.monotonic()
                dt_ms = 0 if last is None else int((now - last) * 1000)
                last = now
                f.write(
                    json.dumps(
                        {"dt_ms": dt_ms, "msg": json.loads(raw)}, separators=(",", ":")
                    )
                    + "\n"
                )
                n += 1
    log.info("wrote %d messages", n)


async def replay(path: Path, host: str, port: int, loop: bool) -> None:
    import websockets

    lines = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    hello = next((l["msg"] for l in lines if l["msg"].get("type") == "hello"), None)

    async def handler(ws):
        log.info("viewer connected")

        async def acks():
            async for raw in ws:
                try:
                    cmd = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if cmd.get("type") == "cmd":
                    await ws.send(
                        json.dumps(
                            {
                                "v": 1,
                                "type": "ack",
                                "t": int(time.time() * 1e6),
                                "id": str(cmd.get("id", "?")),
                                "ok": True,
                                "result": {"replay": True},
                            }
                        )
                    )

        task = asyncio.create_task(acks())
        try:
            while True:
                if (
                    hello is not None
                    and lines
                    and lines[0]["msg"].get("type") != "hello"
                ):
                    await ws.send(json.dumps(hello))
                for l in lines:
                    if l["dt_ms"] > 0:
                        await asyncio.sleep(min(l["dt_ms"], 2000) / 1000)
                    await ws.send(json.dumps(l["msg"], separators=(",", ":")))
                if not loop:
                    break
        except websockets.ConnectionClosed:
            pass
        finally:
            task.cancel()

    async with websockets.serve(handler, host, port, max_size=None):
        log.info(
            "replaying %s (%d messages) on ws://%s:%d/ws",
            path.name,
            len(lines),
            host,
            port,
        )
        await asyncio.Event().wait()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    r.add_argument("--url", default="ws://localhost:8765/ws")
    r.add_argument("--out", required=True)
    r.add_argument("--seconds", type=float, default=None)
    p = sub.add_parser("replay")
    p.add_argument("path")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--loop", action="store_true")
    logging.basicConfig(level="INFO")
    a = ap.parse_args()
    if a.cmd == "record":
        asyncio.run(record(a.url, Path(a.out), a.seconds))
    else:
        asyncio.run(replay(Path(a.path), a.host, a.port, a.loop))
