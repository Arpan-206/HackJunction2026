"""Record the GeppettoDepth stream to a .gdrec file (or .gdrec.gz), byte for byte (ios/PROTOCOL.md).

    ios/mac/forward.sh                                     # phone port 7700 to localhost:7700 over USB
    python -m ios.mac.record captures/bench.gdrec.gz --seconds 20 --note "bench, right hand"

The note is stored in the file. Say there if the source was the fake sender.
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from .geppetto_depth import DEFAULT_PORT, GeppettoDepthCamera
from .recording import RecordingWriter


def record(path: Path, host: str = "127.0.0.1", port: int = DEFAULT_PORT, seconds: float = 0.0,
           frames: int = 0, note: dict | None = None, clock=None, quiet: bool = False) -> dict:
    """Record until seconds pass or frames packets arrive (0 means no limit, stop with Ctrl-C)."""
    w = RecordingWriter(path, {"host": host, "port": port, **(note or {})})
    cam = GeppettoDepthCamera(host, port, clock=clock, on_packet=w.write)
    cam.start()
    t0 = time.monotonic()
    last_print = t0
    try:
        while True:
            time.sleep(0.02)
            if seconds and time.monotonic() - t0 >= seconds:
                break
            if frames and w.packets >= frames:
                break
            if not quiet and time.monotonic() - last_print >= 1.0:
                last_print = time.monotonic()
                s = cam.status()
                print(f"\rpackets {w.packets}  fps {s['fps']}  connected {s['connected']}  error {s['error']}", end="")
    except KeyboardInterrupt:
        pass
    finally:
        cam.stop()
        w.close()
    s = cam.status()
    if not quiet:
        print(f"\nwrote {w.packets} packets to {path}")
    return {"packets": w.packets, **s}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("out", type=Path, help="output file, .gdrec or .gdrec.gz")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--seconds", type=float, default=0.0)
    p.add_argument("--frames", type=int, default=0)
    p.add_argument("--note", default="", help="free text stored in the file")
    a = p.parse_args()
    record(a.out, a.host, a.port, a.seconds, a.frames, {"note": a.note} if a.note else None)


if __name__ == "__main__":
    main()
