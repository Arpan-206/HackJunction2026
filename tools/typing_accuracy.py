"""Typing accuracy from a recording: glove capture plus keystroke log -> how often the detected finger matches the chart.

    python -m tools.typing_accuracy CAPTURE.rgmp[.gz] --keys KEYS.jsonl [--json out.json]
    python -m tools.typing_accuracy CAPTURE.rgmp[.gz] --synth [--synth-offset-ms 30]

KEYS.jsonl has one keydown per line: {"t_ms": 1234.5, "key": "f"} (tools/keylog.py also
writes "wall_us", unix microseconds). By default t_ms counts from the first glove frame of
the capture. A log started at another moment needs one of:

  --capture-start-wall-us N   unix microseconds of the capture's first frame; then each
                              key's time is wall_us - N. The capture holds device clocks,
                              not wall time, so take N from the capture's start (the
                              `started` line of run.info, or the file's birth time).
                              Expect an error of a second or more.
  --lag-ms L                  subtract L from every key time (fine shift).
  --sweep-s S                 try every lag from -S to +S seconds (20 ms steps), keep the
                              one that puts most keys within the window of a detector
                              press, and judge at that lag. The fit flatters the result;
                              use it only with a clock marker (see STATUS-typing.md).

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
from core.tasks.typing import CHART_ROWS, normalize_key, SPACE, TALLY_ROWS, TypingTask, tally_label
from core.rgmp import DATA_HDR, OUTER, PREFIX_DATA
from tools.replay import split_capture
from tools.score_capture import hands_from_capture


def trim(data: bytes, from_s: float | None, to_s: float | None) -> bytes:
    """Keep the data records whose device time lies in [from_s, to_s] after that device's first frame."""
    if from_s is None and to_s is None:
        return data
    lo = int((from_s or 0.0) * 1e6)
    hi = int(to_s * 1e6) if to_s is not None else None
    base: dict[int, int] = {}
    keep = []
    for prefix, ts, raw in split_capture(data):
        if prefix == PREFIX_DATA and ts is not None:
            dev = DATA_HDR.unpack_from(raw, OUTER.size)[0]
            el = ts - base.setdefault(dev, ts)
            if el < lo or (hi is not None and el > hi):
                continue
        keep.append(raw)
    return b"".join(keep)


def load_hands(cfg, path: Path, from_s: float | None = None, to_s: float | None = None):
    """{side: [HandState]} from a .rgmp or .rgmp.gz capture, optionally only [from_s, to_s]."""
    data = path.read_bytes()
    if path.suffix == ".gz":
        data = gzip.decompress(data)
    if from_s is None and to_s is None and path.suffix != ".gz":
        return hands_from_capture(cfg, path)
    with tempfile.NamedTemporaryFile(suffix=".rgmp", delete=False) as f:
        f.write(trim(data, from_s, to_s))
        tmp = Path(f.name)
    try:
        return hands_from_capture(cfg, tmp)
    finally:
        tmp.unlink(missing_ok=True)


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
    tt = TypingTask(cfg.typing, params)
    keys = sorted(keys_abs)
    out: list[dict] = []
    for t, side, h in tl:
        while keys and keys[0][0] <= t:
            kt, k = keys.pop(0)
            tt.keystroke(k, kt)
        tt.feed(t, side, h.angles if h.tracked else None)
        out += tt.due(t)
    if tl:
        out += tt.due(tl[-1][0] + 10**9)
    return tt, out


def synth_keys(cfg, tl, offset_ms: float, params: dict) -> list[tuple[int, str]]:
    """One keydown per detector press in the capture, offset_ms before it."""
    tt = TypingTask(cfg.typing, params)
    keys = []
    for t, side, h in tl:
        for f, kind in tt.feed(t, side, h.angles if h.tracked else None):
            if kind == "down":
                keys.append((t - int(offset_ms * 1000), key_for(side, f)))
    return keys


def detector_presses(cfg, tl, params: dict) -> list[int]:
    """Times (core us) of every detector press in the capture, any hand, any finger."""
    tt = TypingTask(cfg.typing, params)
    out = []
    for t, side, h in tl:
        for _f, kind in tt.feed(t, side, h.angles if h.tracked else None):
            if kind == "down":
                out.append(t)
    return out


def best_lag_us(press_t: list[int], key_t: list[int], sweep_s: float, window_us: int) -> tuple[int, int]:
    """(lag_us, keys matched): the shift subtracted from key times that puts most keys near a press."""
    import bisect

    press_t = sorted(press_t)
    best = (0, -1)
    span = int(sweep_s * 1e6)
    for lag in range(-span, span + 1, 20_000):
        hit = 0
        for k in key_t:
            t = k - lag
            i = bisect.bisect_left(press_t, t - window_us)
            if i < len(press_t) and press_t[i] <= t + window_us:
                hit += 1
        if hit > best[1] or (hit == best[1] and abs(lag) < abs(best[0])):
            best = (lag, hit)
    return best


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
    ap.add_argument("--capture-start-wall-us", type=int, default=None, help="align the log by its wall_us field")
    ap.add_argument("--from-s", type=float, default=None, help="judge only this part of the capture: start, seconds")
    ap.add_argument("--to-s", type=float, default=None, help="end, seconds from the capture's first frame")
    ap.add_argument("--sweep-s", type=float, default=None, help="fit the lag within +-S seconds")
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
    hands = load_hands(cfg, Path(a.capture), a.from_s, a.to_s)
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
                if a.capture_start_wall_us is not None:
                    # the first kept frame sits from_s into the capture
                    rel_ms = (int(d["wall_us"]) - a.capture_start_wall_us) / 1000 - (a.from_s or 0.0) * 1000
                else:
                    rel_ms = float(d["t_ms"])
                keys.append((t0 + int((rel_ms - a.lag_ms) * 1000), str(d["key"])))
        on_chart = [k for k in keys if normalize_key(k[1]) is not None]
        print(f"keystroke log: {len(keys)} keys, {len(on_chart)} on the chart")
        keys = on_chart
        if a.sweep_s:
            post = int(params.get("post_ms", cfg.typing.post_ms)) * 1000
            lag, hit = best_lag_us(detector_presses(cfg, tl, params), [k[0] for k in keys], a.sweep_s, post)
            print(f"fitted lag {lag / 1000:+.0f} ms: {hit} of {len(keys)} keys sit within {post // 1000} ms of a press (fitted, flatters the result)")
            keys = [(t - lag, k) for t, k in keys]
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
