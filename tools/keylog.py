"""Guided keystroke log for the typing study: type what it shows, one phase at a time.

    python -m tools.keylog --out logs/live/current/keys.jsonl

Phases, each started by pressing Enter when you are ready:
  1. marker      rest both hands still for 3 s, then press Space three times, one
                 second apart, with the RIGHT THUMB only, then rest 3 s. This aligns
                 the keyboard clock with the glove capture (Space is a thumb key).
  2. home row    type the line shown, with touch-typing fingers.
  3. words       type the sentence shown.
  4. free        type anything for ten seconds, then Enter.

Every key you press is one line in the output, JSON:
  {"t_ms": ms since the log started, "wall_us": unix microseconds, "key": "f",
   "phase": "home", "expected": "f", "ok": true}
`expected` is the character the drill wanted at that position (null in the free
phase), so finger accuracy can be measured against both the chart and the text.
A sidecar <out>.header.json holds the start time and the drill text, so the
key file stays one key per line for tools/typing_accuracy.py.
tools/typing_accuracy.py reads t_ms; wall_us lets the log be shifted onto the
capture's clock (capture start time is in the run folder's run.info).

Keys: Backspace steps back one character. Esc at any time ends the log early.
Raw terminal mode, so no accessibility permission is needed; only keys typed
into this terminal are recorded.
"""
from __future__ import annotations

import argparse
import json
import sys
import termios
import time
import tty
from pathlib import Path

HOME_ROW = "asdf jkl; asdf jkl; fdsa ;lkj"
WORDS = "the quick brown fox jumps over the lazy dog"
NAMES = {"\r": "Enter", "\n": "Enter", " ": "Space", "\x7f": "Backspace", "\t": "Tab"}
ESC = "\x1b"


def say(text: str = "") -> None:
    sys.stdout.write(text.replace("\n", "\r\n") + "\r\n")
    sys.stdout.flush()


class Log:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.f = open(path, "a")
        self.t0 = time.monotonic()
        self.count = 0

    def write(self, rec: dict) -> None:
        self.f.write(json.dumps(rec) + "\n")
        self.f.flush()

    def key(self, ch: str, phase: str, expected: str | None) -> None:
        name = NAMES.get(ch, ch)
        self.write({"t_ms": round((time.monotonic() - self.t0) * 1000, 1), "wall_us": int(time.time() * 1e6),
                    "key": name, "phase": phase, "expected": expected,
                    "ok": None if expected is None else (name == expected or (expected == " " and name == "Space"))})
        self.count += 1


def read_key() -> str:
    return sys.stdin.read(1)


def wait_enter(prompt: str) -> bool:
    """Show the prompt, wait for Enter. Returns False on Esc."""
    say(prompt)
    while True:
        ch = read_key()
        if ch == ESC:
            return False
        if ch in ("\r", "\n"):
            return True


def phase_text(log: Log, name: str, text: str, seconds: float | None = None) -> bool:
    """Type `text` (or anything for `seconds`). Returns False on Esc."""
    say(f"\n--- {name} ---  type this, Enter when done, Backspace fixes a slip:")
    say(f"    {text}" if text else "    (anything, for about ten seconds)")
    say("    ")
    pos = 0
    start = time.monotonic()
    typed = []
    while True:
        ch = read_key()
        if ch == ESC:
            return False
        if ch in ("\r", "\n"):
            log.key(ch, name, None)
            break
        if ch == "\x7f":
            log.key(ch, name, None)
            if typed:
                typed.pop()
                pos = max(0, pos - 1)
                sys.stdout.write("\b \b")
                sys.stdout.flush()
            continue
        expected = text[pos] if text and pos < len(text) else None
        log.key(ch, name, expected)
        typed.append(ch)
        pos += 1
        sys.stdout.write(ch if ch.isprintable() else "?")
        sys.stdout.flush()
        if seconds and time.monotonic() - start > seconds:
            break
    done = "".join(typed)
    if text:
        slips = sum(1 for i, c in enumerate(done) if i >= len(text) or c != text[i])
        say(f"\n    {len(done)} keys, {slips} slips against the drill text")
    else:
        say(f"\n    {len(done)} keys")
    return True


def phase_marker(log: Log) -> bool:
    say("\n--- marker ---  rest 3 s, then Space THREE times one second apart with the RIGHT THUMB only, rest 3 s, then Enter:")
    say("    ")
    n = 0
    while True:
        ch = read_key()
        if ch == ESC:
            return False
        if ch in ("\r", "\n"):
            log.key(ch, "marker", None)
            break
        log.key(ch, "marker", " ")
        n += 1
        sys.stdout.write("*")
        sys.stdout.flush()
    say(f"\n    {n} marker presses")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--home", default=HOME_ROW)
    ap.add_argument("--words", default=WORDS)
    ap.add_argument("--free-seconds", type=float, default=10.0)
    a = ap.parse_args()
    out = Path(a.out)
    log = Log(out)
    out.with_suffix(".header.json").write_text(json.dumps({
        "started_wall_us": int(time.time() * 1e6), "started_local": time.strftime("%Y-%m-%d %H:%M:%S"),
        "home": a.home, "words": a.words,
        "note": "t_ms counts from started_wall_us; tools/typing_accuracy.py --capture-start-wall-us shifts wall_us onto the capture clock"}, indent=2))
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        say(f"Keystroke log -> {out}")
        say("Gloves on, hands on the home row. Esc ends early at any point.")
        ok = wait_enter("\nPress Enter to start the marker phase.")
        ok = ok and phase_marker(log)
        ok = ok and wait_enter("\nPress Enter when ready for the home-row drill.")
        ok = ok and phase_text(log, "home", a.home)
        ok = ok and wait_enter("\nPress Enter when ready for the words.")
        ok = ok and phase_text(log, "words", a.words)
        ok = ok and wait_enter("\nPress Enter for ten seconds of free typing (anything).")
        ok = ok and phase_text(log, "free", "", seconds=a.free_seconds)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        log.f.close()
    print(f"\n{'Done' if ok else 'Stopped early'}: {log.count} keys in {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
