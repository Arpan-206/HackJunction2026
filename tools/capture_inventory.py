"""Survey a raw RGMP solver capture: duration, hands, activity and still stretches.

    python -m tools.capture_inventory CAPTURE [--rate 20] [--cache out.npz] [--json out.json]
    python -m tools.capture_inventory CAPTURE --cache out.npz --reuse   (skip the parse, read the cache)

The capture is streamed in chunks (the hour on this Mac is 1.2 GB) and never
loaded whole. Hands are built with GloveSource.poll on a fake clock, as
tools/score_capture.py does, sampled at --rate Hz per hand.

Time base: "capture seconds" from the first data frame of the first device in
the file, the same clock tools/replay.py paces on (other devices are offset to
it when they first appear). So `--start S` in tools/replay.py and
scripts/replay_demo.sh means the same moment as `start_s` here.

A still stretch: every finger flexion angle (14 slots) moves slower than
STILL_DEG_S over a 0.5 s smoothing, for at least MIN_STILL_S, and the hand is
tracked. The wrist is not part of the test (lessons score fingers only).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core import hand as H
from core.clock import FakeClock
from core.compat import thumb_cmc_deg
from core.config import load_config
from core.rgmp import PREFIX_DATA, GloveSource
from tools.replay import CaptureClock, iter_messages

STILL_DEG_S = 20.0  # the recorder's own still threshold ([record] still_deg_s)
MIN_STILL_S = 2.0
SMOOTH_S = 0.5
FLEX = [s for f in H.FINGERS for s in H.FLEXION_SLOTS[f]]
T0_US = 1_700_000_000_000_000


def walk(
    path: Path,
    rate_hz: float = 20.0,
    start_s: float = 0.0,
    seconds: float = float("inf"),
    cfg=None,
) -> dict:
    """Hands sampled at rate_hz per side -> {side: {t_s, angles, cmc_deg, curl, wrist_q, tracked}} plus totals."""
    cfg = cfg or load_config(None)
    clock = FakeClock()
    src = GloveSource(cfg, clock, host="x", port=1)
    cc = CaptureClock()
    step_us = int(1e6 / rate_hz)
    next_due: dict[str, int] = {}
    rows: dict[str, dict[str, list]] = {}
    dev_frames: dict[int, int] = {}
    dev_first: dict[int, int] = {}
    dev_last: dict[int, int] = {}
    n_msgs = 0
    lo, hi = int(start_s * 1e6), start_s * 1e6 + seconds * 1e6
    for prefix, dev, ts, raw in iter_messages(path):
        n_msgs += 1
        if prefix != PREFIX_DATA or dev is None:
            src.feed(raw)
            continue
        t = cc.t_us(dev, ts)
        dev_frames[dev] = dev_frames.get(dev, 0) + 1
        dev_first.setdefault(dev, t)
        dev_last[dev] = t
        if t > hi:
            break
        clock.set_us(T0_US + t)
        src.feed(raw)
        side = src.sides.get(dev)
        if side is None or t < lo or t < next_due.get(side, 0):
            continue
        if side not in src.latest:
            continue
        h = src.poll(clock.now_us())[side][0]
        if h is None:
            continue
        nd = next_due.get(side, t) + step_us
        next_due[side] = nd if nd > t else t + step_us
        r = rows.setdefault(
            side,
            {
                k: []
                for k in ("t_s", "angles", "cmc_deg", "wrist_q", "tracked", "device")
            },
        )
        r["t_s"].append(t / 1e6)
        r["angles"].append(np.asarray(h.angles, dtype=float))
        r["cmc_deg"].append(float(thumb_cmc_deg(h.joints_local)))
        r["wrist_q"].append(np.asarray(h.wrist_q, dtype=float))
        r["tracked"].append(bool(h.tracked))
        r["device"].append(int(dev))
    out: dict = {"messages": n_msgs, "devices": {}}
    for dev in dev_frames:
        out["devices"][dev] = {
            "side": src.sides.get(dev),
            "messages": dev_frames[dev],
            "first_s": dev_first[dev] / 1e6,
            "last_s": dev_last[dev] / 1e6,
        }
    for side, r in rows.items():
        out[side] = {
            "t_s": np.asarray(r["t_s"]),
            "angles": np.asarray(r["angles"]),
            "cmc_deg": np.asarray(r["cmc_deg"]),
            "wrist_q": np.asarray(r["wrist_q"]),
            "tracked": np.asarray(r["tracked"], dtype=bool),
        }
    return out


def flex_speed(
    t_s: np.ndarray, angles: np.ndarray, smooth_s: float = SMOOTH_S
) -> np.ndarray:
    """Per sample: the fastest finger flexion slot's speed in deg/s, over a smooth_s window (forward difference)."""
    n = len(t_s)
    if n < 2:
        return np.zeros(n)
    sp = np.zeros(n)
    j = 0
    a = angles[:, FLEX]
    for i in range(n):
        while j < n - 1 and t_s[j] - t_s[i] < smooth_s:
            j += 1
        k = j if j > i else min(i + 1, n - 1)
        dt = max(t_s[k] - t_s[i], 1e-3)
        sp[i] = float(np.max(np.abs(a[k] - a[i]))) / dt
    return sp


def curl_of(angles: np.ndarray, cfg=None) -> dict[str, float]:
    full = 90.0 if cfg is None else float(cfg.hand.curl_full_deg)
    full_t = 60.0 if cfg is None else float(cfg.hand.curl_full_thumb_deg)
    return H.curl_from_angles(angles, full, full_t)


def describe_pose(curl: dict[str, float]) -> str:
    """A short pose name from the curls (0 flat .. 1 closed). Raw angles: a flat hand reads 0.3 to 0.4 on these gloves."""
    word = {
        f: ("open" if c < 0.45 else "half" if c < 0.75 else "closed")
        for f, c in curl.items()
    }
    fingers = ["index", "middle", "ring", "little"]
    closed = [f for f in fingers if word[f] == "closed"]
    open_ = [f for f in fingers if word[f] == "open"]
    thumb = word["thumb"]
    if len(closed) == 4:
        base = "fist"
    elif len(open_) == 4:
        base = "flat hand"
    elif open_ and closed:
        base = f"{'+'.join(open_)} out, {'+'.join(closed)} in"
    else:
        base = "half curl" if not open_ else f"{'+'.join(open_)} out, rest half"
    return f"{base}, thumb {thumb}"


def still_stretches(
    t_s: np.ndarray,
    angles: np.ndarray,
    tracked: np.ndarray,
    still_deg_s: float = STILL_DEG_S,
    min_s: float = MIN_STILL_S,
) -> list[tuple[int, int]]:
    """[(i0, i1)] index ranges (inclusive) where the fingers stay still for min_s or more."""
    sp = flex_speed(t_s, angles)
    still = (sp < still_deg_s) & tracked
    out: list[tuple[int, int]] = []
    i, n = 0, len(t_s)
    while i < n:
        if not still[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and still[j + 1] and t_s[j + 1] - t_s[j] < 0.5:
            j += 1
        if t_s[j] - t_s[i] >= min_s:
            out.append((i, j))
        i = j + 1
    return out


def activity(
    t_s: np.ndarray, angles: np.ndarray, tracked: np.ndarray, bucket_s: float = 60.0
) -> list[dict]:
    """Per bucket: tracked share, still share, median flexion speed, mean curl and pose spread."""
    sp = flex_speed(t_s, angles)
    rows = []
    if not len(t_s):
        return rows
    for b0 in np.arange(np.floor(t_s[0] / bucket_s) * bucket_s, t_s[-1], bucket_s):
        m = (t_s >= b0) & (t_s < b0 + bucket_s)
        if m.sum() < 5:
            continue
        a = angles[m][:, FLEX]
        rows.append(
            {
                "start_s": float(b0),
                "samples": int(m.sum()),
                "tracked": float(tracked[m].mean()),
                "still": float(np.mean(sp[m] < STILL_DEG_S)),
                "speed_med": float(np.median(sp[m])),
                "speed_p90": float(np.percentile(sp[m], 90)),
                "flex_mean": float(a.mean()),
                "flex_range": float(
                    np.percentile(a.mean(axis=1), 95) - np.percentile(a.mean(axis=1), 5)
                ),
            }
        )
    return rows


def save_cache(path: Path, w: dict) -> None:
    flat = {
        "messages": w["messages"],
        "devices": json.dumps({str(k): v for k, v in w["devices"].items()}),
    }
    for side in ("left", "right"):
        if side in w:
            for k, v in w[side].items():
                flat[f"{side}_{k}"] = v
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **flat)


def load_cache(path: Path) -> dict:
    z = np.load(path, allow_pickle=False)
    w: dict = {"messages": int(z["messages"]), "devices": json.loads(str(z["devices"]))}
    for side in ("left", "right"):
        if f"{side}_t_s" in z:
            w[side] = {
                k: z[f"{side}_{k}"]
                for k in ("t_s", "angles", "cmc_deg", "wrist_q", "tracked")
            }
    return w


def stretch_rows(w: dict, cfg=None) -> list[dict]:
    rows = []
    for side in ("left", "right"):
        if side not in w:
            continue
        d = w[side]
        for i0, i1 in still_stretches(d["t_s"], d["angles"], d["tracked"]):
            a = np.median(d["angles"][i0 : i1 + 1], axis=0)
            c = curl_of(a, cfg)
            rows.append(
                {
                    "side": side,
                    "start_s": round(float(d["t_s"][i0]), 1),
                    "length_s": round(float(d["t_s"][i1] - d["t_s"][i0]), 1),
                    "pose": describe_pose(c),
                    "curl": {f: round(float(v), 2) for f, v in c.items()},
                    "flex_deg": {
                        f: round(float(np.mean(a[H.FLEXION_SLOTS[f]])), 0)
                        for f in H.FINGERS
                    },
                    "cmc_deg": round(float(np.median(d["cmc_deg"][i0 : i1 + 1])), 0),
                }
            )
    rows.sort(key=lambda r: (r["start_s"], r["side"]))
    return rows


def clock_label(t_s: float, wall_start: str | None) -> str:
    """Capture seconds as a wall clock, given the wall time of capture second 0 (HH:MM:SS); '' without one."""
    if not wall_start:
        return ""
    h, m, s = (int(x) for x in wall_start.split(":"))
    x = h * 3600 + m * 60 + s + int(round(t_s))
    return f"{x // 3600 % 24:02d}:{x % 3600 // 60:02d}:{x % 60:02d}"


def markdown(report: dict, wall_start: str | None = None) -> str:
    """The stretch table as Markdown, one row per stretch, in capture order."""
    lines = [
        "| # | Hand | Start (s) | Clock, about | Length (s) | Pose (raw curls) | Thumb | Index | Middle | Ring | Little |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for k, r in enumerate(report["stretches"], 1):
        f = r["flex_deg"]
        lines.append(
            f"| {k} | {r['side']} | {r['start_s']:.1f} | {clock_label(r['start_s'], wall_start)} | {r['length_s']:.1f} | {r['pose']} | "
            f"{f['thumb']:.0f} | {f['index']:.0f} | {f['middle']:.0f} | {f['ring']:.0f} | {f['little']:.0f} |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("capture", type=Path)
    ap.add_argument(
        "--rate", type=float, default=20.0, help="samples per second per hand"
    )
    ap.add_argument(
        "--cache",
        type=Path,
        help="write (or with --reuse, read) the sampled hands here",
    )
    ap.add_argument("--reuse", action="store_true")
    ap.add_argument(
        "--json", type=Path, help="write the summary, activity and stretches here"
    )
    ap.add_argument("--md", type=Path, help="write the stretch table here as Markdown")
    ap.add_argument(
        "--wall-start",
        default=None,
        help="wall clock of capture second 0, HH:MM:SS, for the md table",
    )
    a = ap.parse_args()
    cfg = load_config(None)
    if a.reuse and a.cache and a.cache.exists():
        w = load_cache(a.cache)
    else:
        w = walk(a.capture, a.rate, cfg=cfg)
        if a.cache:
            save_cache(a.cache, w)
    summary = {
        "capture": str(a.capture),
        "bytes": a.capture.stat().st_size,
        "messages": w["messages"],
        "devices": w["devices"],
        "hands": {},
    }
    for side in ("left", "right"):
        if side in w:
            d = w[side]
            summary["hands"][side] = {
                "samples": len(d["t_s"]),
                "first_s": float(d["t_s"][0]),
                "last_s": float(d["t_s"][-1]),
                "tracked": float(d["tracked"].mean()),
            }
    report = {
        "summary": summary,
        "activity": {
            s: activity(w[s]["t_s"], w[s]["angles"], w[s]["tracked"])
            for s in ("left", "right")
            if s in w
        },
        "stretches": stretch_rows(w, cfg),
    }
    print(json.dumps(summary, indent=1, default=str))
    print(f"{len(report['stretches'])} still stretches of {MIN_STILL_S:.0f} s or more")
    if a.json:
        a.json.write_text(json.dumps(report, indent=1, default=str))
    if a.md:
        a.md.write_text(markdown(report, a.wall_start))
    return 0


if __name__ == "__main__":
    sys.exit(main())
