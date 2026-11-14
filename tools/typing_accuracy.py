"""Typing accuracy from a recording: glove capture plus keystroke log -> how often the detected finger matches the chart.

    python -m tools.typing_accuracy CAPTURE.rgmp[.gz] --keys KEYS.jsonl [--json out.json]
    python -m tools.typing_accuracy CAPTURE.rgmp[.gz] --synth [--synth-offset-ms 30]

KEYS.jsonl has one keydown per line: {"t_ms": 1234.5, "key": "f"}. t_ms counts from the
first glove frame of the capture. Record it alongside the capture (same machine clock),
then shift with --lag-ms if the keyboard and glove clocks disagree.

--synth builds a keystroke log from the capture itself: every press the PressDetector
finds becomes a keydown of a chart key for that finger, --synth-offset-ms before the
press. This checks the pipeline and gives an upper bound only. It is not a measure of
real typing accuracy: that needs a capture with a real keystroke log.

The capture is replayed with tools.score_capture.hands_from_capture (core.rgmp parser,
GloveSource, fake clock) and judged by core.tasks.typing.TypingTask, the same code the
live session runs.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.config import load_config
from core.tasks.typing import CHART_ROWS, SPACE, TALLY_ROWS, TypingTask, tally_label
from tools.score_capture import hands_from_capture


def load_hands(cfg, path: Path):
    """{side: [HandState]} from a .rgmp or .rgmp.gz capture."""
    if path.suffix == ".gz":
        with tempfile.NamedTemporaryFile(suffix=".rgmp", delete=False) as f:
            f.write(gzip.decompress(path.read_bytes()))
            tmp = Path(f.name)
        try:
            return hands_from_capture(cfg, tmp)
        finally:
            tmp.unlink(missing_ok=True)
    return hands_from_capture(cfg, path)


def timeline(hands) -> list[tuple[int, str, object]]:
    out = [(h.t_us, side, h) for side, hs in hands.items() for h in hs]
    out.sort(key=lambda x: x[0])
    return out


def key_for(side: str, finger: str) -> str:
    if finger == "thumb":
        return SPACE
    return CHART_ROWS[(side, finger)][-1 if side == "left" else 0]


def replay(cfg, tl, keys_abs: list[tuple[int, str]], params: dict) -> tuple[TypingTask, list[dict]]:
    """Feed the capture and the keystrokes through one TypingTask. keys_abs: [(t_us core, key)]."""
    tt = TypingTask(cfg.piano, params)
    keys = sorted(keys_abs)
    out: list[dict] = []
    for t, side, h in tl:
        while keys and keys[0][0] <= t:
            kt, k = keys.pop(0)
            if tt.keystroke(k, kt) is None:
                print(f"skipped key not on the chart: {k!r}", file=sys.stderr)
        tt.feed(t, side, h.angles if h.tracked else None)
        out += tt.due(t)
    if tl:
        out += tt.due(tl[-1][0] + 10**9)
    return tt, out


def synth_keys(cfg, tl, offset_ms: float, params: dict) -> list[tuple[int, str]]:
    """One keydown per detector press in the capture, offset_ms before it."""
    tt = TypingTask(cfg.piano, params)
    keys = []
    for t, side, h in tl:
        for f, kind in tt.feed(t, side, h.angles if h.tracked else None):
            if kind == "down":
                keys.append((t - int(offset_ms * 1000), key_for(side, f)))
    return keys


def report(verdicts: list[dict]) -> dict:
    rows = {r: {"keys": 0, "good": 0, "wrong_finger": 0, "unclear": 0} for r in TALLY_ROWS}
    confusion: dict[str, dict[str, int]] = {}
    for v in verdicts:
        r = rows[tally_label(v["key"])]
        r["keys"] += 1
        r[v["verdict"]] += 1
        if v["verdict"] == "wrong_finger":
            got = f"{v['detected']['hand']}.{v['detected']['finger']}"
            c = confusion.setdefault(tally_label(v["key"]), {})
            c[got] = c.get(got, 0) + 1
    tot = {k: sum(r[k] for r in rows.values()) for k in ("keys", "good", "wrong_finger", "unclear")}
    for r in list(rows.values()) + [tot]:
        judged = r["good"] + r["wrong_finger"]
        r["match_rate"] = round(r["good"] / judged, 3) if judged else None
        r["clear_rate"] = round(judged / r["keys"], 3) if r["keys"] else None
    return {"rows": rows, "total": tot, "confusion": confusion}


def print_table(rep: dict) -> None:
    print(f"{'finger':14s} {'keys':>5s} {'good':>5s} {'wrong':>5s} {'unclear':>7s} {'match':>6s} {'clear':>6s}")
    for name, r in list(rep["rows"].items()) + [("all", rep["total"])]:
        if not r["keys"]:
            continue
        m = "-" if r["match_rate"] is None else f"{r['match_rate'] * 100:.0f}%"
        c = "-" if r["clear_rate"] is None else f"{r['clear_rate'] * 100:.0f}%"
        print(f"{name:14s} {r['keys']:5d} {r['good']:5d} {r['wrong_finger']:5d} {r['unclear']:7d} {m:>6s} {c:>6s}")
    if rep["confusion"]:
        print("\nwrong finger, chart finger -> detected:")
        for exp, got in rep["confusion"].items():
            print(f"  {exp}: " + ", ".join(f"{g} x{n}" for g, n in sorted(got.items(), key=lambda kv: -kv[1])))
    print("\nmatch = good / (good + wrong), over keys with a clear finger. clear = share of keys with a clear finger.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("capture")
    ap.add_argument("--keys", help="keystroke log, JSON lines {t_ms, key}")
    ap.add_argument("--synth", action="store_true", help="build the keystroke log from the capture's own presses")
    ap.add_argument("--synth-offset-ms", type=float, default=30.0)
    ap.add_argument("--lag-ms", type=float, default=0.0, help="subtract from every logged t_ms")
    ap.add_argument("--pre-ms", type=int, default=None)
    ap.add_argument("--post-ms", type=int, default=None)
    ap.add_argument("--min-peak", type=float, default=None, help="min_peak_deg_s")
    ap.add_argument("--clear-ratio", type=float, default=None)
    ap.add_argument("--config", default=None)
    ap.add_argument("--json", default=None)
    a = ap.parse_args(argv)
    if not a.keys and not a.synth:
        ap.error("give --keys LOG or --synth")
    cfg = load_config(a.config)
    params = {
        k: v
        for k, v in {
            "pre_ms": a.pre_ms,
            "post_ms": a.post_ms,
            "min_peak_deg_s": a.min_peak,
            "clear_ratio": a.clear_ratio,
        }.items()
        if v is not None
    }
    hands = load_hands(cfg, Path(a.capture))
    tl = timeline(hands)
    if not tl:
        print("no tracked glove frames in the capture")
        return 1
    t0 = tl[0][0]
    print(
        f"capture: {len(hands['left'])} left, {len(hands['right'])} right frames, "
        f"{(tl[-1][0] - t0) / 1e6:.1f} s"
    )
    if a.synth:
        keys = synth_keys(cfg, tl, a.synth_offset_ms, params)
        print(f"synthetic keystroke log: {len(keys)} keys from the capture's own presses (pipeline check, not accuracy)")
    else:
        keys = []
        for ln in Path(a.keys).read_text().splitlines():
            if ln.strip():
                d = json.loads(ln)
                keys.append((t0 + int((float(d["t_ms"]) - a.lag_ms) * 1000), str(d["key"])))
        print(f"keystroke log: {len(keys)} keys")
    _, verdicts = replay(cfg, tl, keys, params)
    rep = report(verdicts)
    rep["synthetic"] = bool(a.synth)
    print()
    print_table(rep)
    if a.json:
        Path(a.json).write_text(json.dumps({**rep, "verdicts": verdicts}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
