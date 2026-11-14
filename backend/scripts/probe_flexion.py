"""Find the finger flexion axis of real gloves: run it with Studio streaming to this machine and follow the prompts.

    cd backend && uv run python scripts/probe_flexion.py [--port 14043] [--side right]

It records a flat hand, then a fist, and prints for every finger joint the rotation axis (in the parent joint's frame)
that took the flat pose to the fist. If the axis is the same for all joints, put its index and sign in
app/constants.py as ROKOKO_FLEX_AXIS (0=x, 1=y, 2=z) and ROKOKO_FLEX_SIGN (+1 or -1) so curled reads positive.
"""

import argparse
import math
import socket
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import constants as c  # noqa: E402
from app.services import geometry as g  # noqa: E402
from app.services.gloves import rokoko_mapper as m  # noqa: E402
from app.services.gloves.rokoko_udp import decode_datagram  # noqa: E402

HOLD_S = 3.0


def capture(sock: socket.socket) -> tuple[m.Bones, object] | None:
    """Return the last frame received during the hold as (joint to world rotation, chain function)."""
    sock.settimeout(1.0)
    last = None
    end = time.time() + HOLD_S
    while time.time() < end:
        try:
            payload = decode_datagram(sock.recv(65535))
        except TimeoutError:
            continue
        for bones, _, _, chain in m.entities(payload):
            if bones:
                last = (bones, chain)
                break
    return last


def local_rotations(bones: m.Bones, side: str, chain, finger: int) -> list[g.Quat]:
    """Local rotation of each joint of a finger relative to its parent."""
    parents = [bones[m.hand_name(side)]]  # type: ignore[arg-type]
    out = []
    for name in chain(side, finger):
        q = bones.get(name, parents[-1])
        out.append(g.multiply(g.conjugate(parents[-1]), q))
        parents.append(q)
    return out


def main() -> int:
    """Run the two captures and print the axes."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=c.ROKOKO_DEFAULT_PORT)
    parser.add_argument("--side", choices=c.SIDES, default="right")
    args = parser.parse_args()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", args.port))
    shots = []
    for pose in ("FLAT open hand", "tight FIST"):
        input(f"Hold a {pose} on the {args.side} hand, press Enter, keep still for {HOLD_S:g} s ")
        shot = capture(sock)
        if shot is None:
            print("No frames received; check Studio streaming (see docs/HARDWARE_INTEGRATION.md)")
            return 1
        shots.append(shot)
    chain = shots[0][1]
    for fi, finger in enumerate(c.FINGERS):
        flat = local_rotations(shots[0][0], args.side, chain, fi)
        fist = local_rotations(shots[1][0], args.side, chain, fi)
        for j, (a, b) in enumerate(zip(flat, fist, strict=True)):
            delta = g.normalise(g.multiply(g.conjugate(a), b))
            if delta[3] < 0:
                delta = (-delta[0], -delta[1], -delta[2], -delta[3])
            norm = math.sqrt(sum(v * v for v in delta[:3])) or 1.0
            angle = 2 * math.atan2(norm, delta[3])
            axis = tuple(round(v / norm, 2) for v in delta[:3])
            print(f"{finger:6s} joint {j}: {math.degrees(angle):6.1f} deg about local axis (x, y, z) = {axis}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
