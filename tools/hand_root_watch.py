"""Watch a running core with --root: does the wrist move in /ws frames and /ws/gloves wrist_pos?

    python -m tools.hand_root_watch --port 8765 --seconds 10

Prints, per side: frames, the share with anchor "camera" or "held", the wrist range in
x, y, z (metres), and the share of /ws/gloves hands with a non-null wrist_pos.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time

import numpy as np


async def watch(url: str, seconds: float, key: str) -> list[dict]:
    import websockets

    out = []
    t_end = time.monotonic() + seconds
    for _ in range(60):
        try:
            async with websockets.connect(url, max_size=None) as ws:
                while time.monotonic() < t_end:
                    try:
                        m = json.loads(await asyncio.wait_for(ws.recv(), 1.0))
                    except TimeoutError:
                        continue
                    if (
                        (m.get("type") == key)
                        if key
                        else isinstance(m.get("hands"), list)
                    ):
                        out.append(m)
                return out
        except OSError:
            await asyncio.sleep(0.5)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--seconds", type=float, default=10.0)
    a = ap.parse_args(argv)
    base = f"ws://127.0.0.1:{a.port}"

    async def both():
        return await asyncio.gather(
            watch(base + "/ws", a.seconds, "frame"),
            watch(base + "/ws/gloves", a.seconds, ""),
        )

    frames, gloves = asyncio.run(both())
    print(f"/ws frames: {len(frames)}  /ws/gloves messages: {len(gloves)}")
    for side in ("left", "right"):
        hs = [f["hands"].get(side) for f in frames if f["hands"].get(side)]
        if not hs:
            continue
        p = np.array([h["wrist"]["p"] for h in hs])
        moved = np.mean([h["anchor"] in ("camera", "held") for h in hs])
        rng = {
            k: [round(float(p[:, i].min()), 3), round(float(p[:, i].max()), 3)]
            for i, k in enumerate("xyz")
        }
        gp = [h for g in gloves for h in g.get("hands", []) if h.get("side") == side]
        wp = np.mean([h.get("wrist_pos") is not None for h in gp]) if gp else None
        print(
            f"{side}: frames {len(hs)}, camera or held {moved:.0%}, range {rng}, "
            f"/ws/gloves wrist_pos set {'n/a' if wp is None else f'{wp:.0%}'}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
