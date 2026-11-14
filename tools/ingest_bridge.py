"""Push this core's hands into the teammate backend's external source.

    python -m tools.ingest_bridge [--core ws://localhost:8765/ws/gloves] [--backend ws://localhost:8000/ws/ingest?activate=1]

The core serves GloveFrames on /ws/gloves (core/compat.py). Their backend
accepts {"t", "hands": [HandFrame...]} on /ws/ingest and re-emits them on its
own /ws/gloves as source "replay" (docs/HARDWARE_INTEGRATION.md section 5).
So: real gloves -> this core (RGMP) -> bridge -> their backend -> their frontend.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging

log = logging.getLogger("ingest_bridge")
HAND_KEYS = ("side", "wrist_quat", "wrist_pos", "flexion", "spread")


async def bridge(core_url: str, backend_url: str, report_every: float = 5.0) -> None:
    import websockets

    while True:
        try:
            async with (
                websockets.connect(core_url, max_size=None) as src,
                websockets.connect(backend_url, max_size=None) as dst,
            ):
                log.info("bridging %s -> %s", core_url, backend_url)
                n, errors = 0, 0
                loop = asyncio.get_running_loop()
                last_report = loop.time()

                async def read_errors():
                    nonlocal errors
                    async for raw in dst:
                        errors += 1
                        if errors <= 5:
                            log.warning("backend: %s", raw[:200])

                err_task = asyncio.create_task(read_errors())
                try:
                    async for raw in src:
                        f = json.loads(raw)
                        hands = [
                            {k: h.get(k) for k in HAND_KEYS if k in h}
                            for h in f.get("hands", [])
                            if h.get("tracked", True)
                        ]
                        await dst.send(
                            json.dumps(
                                {"t": f.get("t", 0.0), "hands": hands},
                                separators=(",", ":"),
                            )
                        )
                        n += 1
                        if loop.time() - last_report >= report_every:
                            log.info(
                                "forwarded %d frames, %d backend errors", n, errors
                            )
                            last_report = loop.time()
                finally:
                    err_task.cancel()
        except (OSError, ConnectionError) as e:
            log.warning("bridge connection failed: %s; retrying in 2 s", e)
        except Exception:
            log.exception("bridge stopped; retrying in 2 s")
        await asyncio.sleep(2.0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--core", default="ws://localhost:8765/ws/gloves")
    ap.add_argument("--backend", default="ws://localhost:8000/ws/ingest?activate=1")
    logging.basicConfig(
        level="INFO", format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    a = ap.parse_args()
    asyncio.run(bridge(a.core, a.backend))
