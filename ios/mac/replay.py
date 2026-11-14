"""Replay a GeppettoDepth recording: serve it on a port like the phone, or read it as DepthFrames.

    python -m ios.mac.replay captures/bench.gdrec.gz                 # serve on 127.0.0.1:7700, original pace
    python -m ios.mac.replay captures/bench.gdrec.gz --loop --speed 0.5
    python -m ios.mac.replay captures/bench.gdrec.gz --info          # summary, no server
    python -m ios.mac.replay captures/bench.gdrec.gz --snapshot out/ # first frame as images (rgb, depth, confidence)

While it serves, anything that reads the phone (GeppettoDepthCamera, the core) reads the
recording instead, with no change.
"""
from __future__ import annotations

import argparse
import json
import time
from collections.abc import Iterator
from pathlib import Path

from .geppetto_depth import DEFAULT_PORT, DepthFrame, parse_packet
from .recording import read_note, read_recording
from .serve import PacketServer


def frames(path: Path, latency_us: int = 0) -> Iterator[DepthFrame]:
    """Every decodable packet in the recording as a DepthFrame, t_us from the recorded arrival."""
    for arrival_us, pkt in read_recording(path):
        f = parse_packet(pkt, arrival_us, latency_us)
        if f is not None:
            yield f


def info(path: Path) -> dict:
    n, first, last, planes, ids = 0, None, None, 0, []
    for f in frames(path):
        n += 1
        first = first if first is not None else f
        last = f
        planes += f.plane is not None
        ids.append(f.frame_id)
    out = {"file": str(path), "note": read_note(path), "frames": n}
    if n:
        dur = (last.arrival_us - first.arrival_us) / 1e6
        out.update({"seconds": round(dur, 3), "fps": round((n - 1) / dur, 1) if dur > 0 else None,
                    "frame_ids": [ids[0], ids[-1]], "gaps": sum(1 for a, b in zip(ids, ids[1:]) if b != a + 1),
                    "rgb": [first.bgr.shape[1], first.bgr.shape[0]],
                    "depth": None if first.depth is None else [first.depth.shape[1], first.depth.shape[0]],
                    "with_plane": planes})
    return out


def serve(path: Path, host: str = "127.0.0.1", port: int = DEFAULT_PORT, speed: float = 1.0, loop: bool = False,
          wait_client: bool = True, server: PacketServer | None = None) -> int:
    """Send the recording at its recorded pace (times speed). Returns the number of packets sent."""
    srv = server or PacketServer(host, port)
    print(f"replaying {path} on {host}:{srv.port}")
    try:
        while True:
            while wait_client and not srv.has_client:
                time.sleep(0.05)
            t0, a0 = time.monotonic(), None
            for arrival_us, pkt in read_recording(path):
                a0 = arrival_us if a0 is None else a0
                due = t0 + (arrival_us - a0) / 1e6 / max(speed, 1e-6)
                time.sleep(max(0.0, due - time.monotonic()))
                srv.send(pkt)
            if not loop:
                break
    except KeyboardInterrupt:
        pass
    finally:
        if server is None:
            srv.close()
    return srv.sent


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("recording", type=Path)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--loop", action="store_true")
    p.add_argument("--info", action="store_true", help="print a summary and exit")
    p.add_argument("--snapshot", type=Path, help="write the first frame's images and intrinsics to this folder")
    a = p.parse_args()
    if a.info:
        print(json.dumps(info(a.recording), indent=2))
    elif a.snapshot:
        from core.camera.record3dstream import save_frame   # same snapshot files for both phone apps
        f = next(frames(a.recording))
        print(json.dumps(save_frame(f, a.snapshot), indent=2))
    else:
        serve(a.recording, a.host, a.port, a.speed, a.loop)


if __name__ == "__main__":
    main()
