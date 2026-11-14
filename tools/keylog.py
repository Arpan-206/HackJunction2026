"""Keystroke log for the typing study: type into this terminal, every keydown is written with its time.

    python -m tools.keylog --out logs/live/current/keys.jsonl

One line per key: {"t_ms": <ms since this log started>, "wall_us": <unix microseconds>, "key": "f"}.
t_ms is what tools/typing_accuracy.py reads; wall_us lets the log be aligned to a
glove capture whose first frame time is known. Press Esc to stop. Runs in raw
terminal mode, so it needs no accessibility permission; only keys typed into
this terminal are logged.
"""
from __future__ import annotations

import argparse
import json
import sys
import termios
import time
import tty
from pathlib import Path

NAMES = {"\r": "Enter", "\n": "Enter", " ": "Space", "\x7f": "Backspace", "\t": "Tab"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--text", default="asdf jkl; asdf jkl; the quick brown fox jumps over the lazy dog",
                    help="drill text shown before logging starts")
    a = ap.parse_args()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    print(f"Logging keys to {out}. Type the drill, Esc to stop.\n\n    {a.text}\n", flush=True)
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    t0 = time.monotonic()
    n = 0
    try:
        tty.setraw(fd)
        with open(out, "a") as f:
            while True:
                ch = sys.stdin.read(1)
                if ch == "\x1b":          # Esc
                    break
                now = time.monotonic()
                rec = {"t_ms": round((now - t0) * 1000, 1), "wall_us": int(time.time() * 1e6), "key": NAMES.get(ch, ch)}
                f.write(json.dumps(rec) + "\n")
                f.flush()
                n += 1
                sys.stdout.write(ch if ch.isprintable() else " ")
                sys.stdout.flush()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    print(f"\n{n} keys written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
