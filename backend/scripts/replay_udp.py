"""Replay Rokoko Studio Custom Streaming frames over UDP so the whole pipeline can be tested without gloves.

    cd backend
    uv run python scripts/replay_udp.py                      # v3 sweep to 127.0.0.1:14043 at 60 Hz, looping
    uv run python scripts/replay_udp.py --format v4 --lz4    # the v4 sweep, LZ4 framed (needs: uv sync --extra rokoko)
    uv run python scripts/replay_udp.py --file my_capture.jsonl --once

Then switch the backend to rokoko_udp (frontend /?dev=1 dev panel, or POST /api/dev/state {"glove_source": "rokoko_udp"}).
The bundled fixtures are constructed from the documented schema, not captured from real gloves. One JSON frame per line.
"""

import argparse
import socket
import sys
import time
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures"


def main() -> int:
    """Send the frames and return a process exit code."""
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--file", type=Path, help="JSONL (one frame per line) or a single JSON frame"
    )
    parser.add_argument(
        "--format",
        choices=("v3", "v4"),
        default="v3",
        help="bundled sweep to use when --file is not given",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=14043)
    parser.add_argument("--hz", type=float, default=60.0)
    parser.add_argument(
        "--lz4",
        action="store_true",
        help="LZ4 frame each datagram, like the Studio JSON (LZ4) formats",
    )
    parser.add_argument(
        "--once", action="store_true", help="play the file once instead of looping"
    )
    args = parser.parse_args()

    path = args.file or FIXTURES / f"{args.format}_sweep.jsonl"
    text = path.read_text(encoding="utf8")
    lines = text.splitlines() if path.suffix == ".jsonl" else [" ".join(text.split())]
    frames = [line.encode() for line in lines if line.strip()]
    if not frames:
        print(f"No frames in {path}", file=sys.stderr)
        return 1
    if args.lz4:
        try:
            import lz4.frame
        except ImportError:
            print("--lz4 needs the extra: uv sync --extra rokoko", file=sys.stderr)
            return 1
        frames = [lz4.frame.compress(f) for f in frames]

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    period = 1.0 / args.hz
    print(
        f"Sending {len(frames)} frames from {path.name} to {args.host}:{args.port} at {args.hz:g} Hz (Ctrl+C to stop)"
    )
    sent = 0
    start = time.perf_counter()
    try:
        while True:
            for data in frames:
                sock.sendto(data, (args.host, args.port))
                sent += 1
                time.sleep(max(0.0, start + sent * period - time.perf_counter()))
            if args.once:
                break
    except KeyboardInterrupt:
        pass
    print(f"Sent {sent} datagrams")
    return 0


if __name__ == "__main__":
    sys.exit(main())
