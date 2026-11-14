"""typing: the keyboard says which key, the glove says which finger.

The viewer sends each keydown as the `keystroke` command. The core keeps a short
history of every finger's flexion on both hands and runs the piano PressDetector
on each hand. A keystroke is judged once `post_ms` has passed after it: the finger
with the sharpest flexion inside [t - pre_ms, t + post_ms] is the one that pressed.
Candidates are the fingers the PressDetector saw press in that window plus any
finger whose peak flexion speed there passes `min_peak_deg_s`.

Verdicts:
  good          the detected finger is the chart finger for that key
  wrong_finger  a clear finger pressed, but not the chart finger
  unclear       no finger moved fast enough, or two moved almost alike

The chart is the standard QWERTY touch-typing chart. Space takes either thumb.
Shift is not judged: send the base key ("A" counts as "a").

Real-glove accuracy is unmeasured; `tools/typing_accuracy.py` measures it from a
capture plus a keystroke log.
"""

from __future__ import annotations

import random
from collections import deque
from dataclasses import dataclass, field
from types import SimpleNamespace

import numpy as np

from .. import hand as H
from .piano import PressDetector

SIDES = ("left", "right")

# Standard QWERTY touch-typing chart: hand, finger -> keys.
CHART_ROWS: dict[tuple[str, str], str] = {
    ("left", "little"): "`1qaz",
    ("left", "ring"): "2wsx",
    ("left", "middle"): "3edc",
    ("left", "index"): "45rtfgvb",
    ("right", "index"): "67yuhjnm",
    ("right", "middle"): "8ik,",
    ("right", "ring"): "9ol.",
    ("right", "little"): "0-=p[]\\;'/",
}
SPACE = " "

CHART: dict[str, list[tuple[str, str]]] = {SPACE: [("left", "thumb"), ("right", "thumb")]}
for _who, _keys in CHART_ROWS.items():
    for _k in _keys:
        CHART[_k] = [_who]

SHIFTED = {
    "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6",
    "&": "7", "*": "8", "(": "9", ")": "0", "_": "-", "+": "=", "{": "[",
    "}": "]", "|": "\\", ":": ";", '"': "'", "<": ",", ">": ".", "?": "/",
}  # fmt: skip

DEFAULTS = {
    # Window around the keydown. At 60 words a minute keys come every ~200 ms, so the
    # window stays under that or the previous key's press would compete.
    "pre_ms": 150,  # look this far before the keydown
    "post_ms": 120,  # and this far after it (the flexion peak lands just after the key bottoms)
    "lag_ms": 0,  # keydown to core arrival; subtracted from the arrival time
    "min_peak_deg_s": 40.0,  # mean flexion speed of the finger's joints, without a detector press
    "clear_ratio": 1.5,  # best finger must be this many times faster than any other finger
    "history_ms": 2000,
    # --fake only: simulate a press per keystroke so the screen works without gloves
    "simulate": False,
    "sim_wrong": 0.15,
    "sim_none": 0.05,
    "sim_seed": 7,
}


def normalize_key(key: str) -> str | None:
    """Base key for the chart, or None when the chart has no such key."""
    if not isinstance(key, str) or not key:
        return None
    if key.lower() in ("space", "spacebar"):
        return SPACE
    if len(key) != 1:
        return None
    k = SHIFTED.get(key, key.lower())
    return k if k in CHART else None


def finger_label(side: str, finger: str) -> str:
    return f"{side}.{finger}"


def tally_label(key: str) -> str:
    """Which tally row a key counts under: one row per chart finger, both thumbs as one."""
    who = CHART[key]
    return "both.thumb" if len(who) > 1 else finger_label(*who[0])


TALLY_ROWS = [finger_label(*w) for w in CHART_ROWS] + ["both.thumb"]


def curl_of(angles: np.ndarray, finger: str) -> float:
    """Mean flexion of a finger's joints, degrees."""
    a = np.asarray(angles, dtype=float)
    return float(np.mean(a[H.FLEXION_SLOTS[finger]]))


@dataclass
class Keystroke:
    id: int
    key: str
    t_us: int


@dataclass
class _SimPress:
    side: str
    finger: str
    t0_us: int
    peak_deg: float = 25.0
    rise_us: int = 60_000
    hold_us: int = 90_000

    def offset(self, t_us: int) -> float:
        dt = t_us - self.t0_us
        if dt <= 0:
            return 0.0
        if dt < self.rise_us:
            return self.peak_deg * dt / self.rise_us
        dt -= self.rise_us
        if dt < self.hold_us:
            return self.peak_deg
        dt -= self.hold_us
        if dt < self.rise_us:
            return self.peak_deg * (1.0 - dt / self.rise_us)
        return 0.0

    def done(self, t_us: int) -> bool:
        return t_us - self.t0_us > 2 * self.rise_us + self.hold_us


NEIGHBOUR = {"thumb": "index", "index": "middle", "middle": "index", "ring": "middle", "little": "ring"}


DETECTOR_KEYS = ("press_velocity_deg_s", "press_min_deg", "release_deg", "rest_tau_ms")


@dataclass
class TypingTask:
    """press_cfg: the [typing] config section (or [piano] as a fallback). task_config overrides either."""

    press_cfg: object
    config: dict = field(default_factory=dict)
    fake: bool = False

    def __post_init__(self) -> None:
        base = dict(self.press_cfg) if isinstance(self.press_cfg, dict) else vars(self.press_cfg)
        merged = {**base, **self.config}
        self.p = {**DEFAULTS, **{k: v for k, v in merged.items() if k in DEFAULTS}}
        det = SimpleNamespace(**{k: merged[k] for k in DETECTOR_KEYS})
        self.p.update({k: getattr(det, k) for k in DETECTOR_KEYS})
        self.detectors = {s: PressDetector(det) for s in SIDES}
        # per side: (t_us, {finger: curl})
        self.hist: dict[str, deque] = {s: deque() for s in SIDES}
        self.presses: deque[tuple[int, str, str]] = deque()
        self.pending: list[Keystroke] = []
        self.next_id = 1
        self.last: dict | None = None
        self.tally = {r: {"good": 0, "wrong_finger": 0, "unclear": 0} for r in TALLY_ROWS}
        self.simulate = bool(self.p["simulate"]) and self.fake
        self.rng = random.Random(int(self.p["sim_seed"]))
        self.sim: list[_SimPress] = []

    # ------------------------------------------------------------ input
    def keystroke(self, key: str, t_us: int) -> Keystroke | None:
        k = normalize_key(key)
        if k is None:
            return None
        ks = Keystroke(self.next_id, k, int(t_us) - int(self.p["lag_ms"]) * 1000)
        self.next_id += 1
        self.pending.append(ks)
        if self.simulate:
            self._simulate_press(ks)
        return ks

    def _simulate_press(self, ks: Keystroke) -> None:
        r = self.rng.random()
        if r < float(self.p["sim_none"]):
            return
        side, finger = self.rng.choice(CHART[ks.key])
        if r < float(self.p["sim_none"]) + float(self.p["sim_wrong"]):
            finger = NEIGHBOUR[finger]
        # the finger starts moving a little before the key bottoms
        self.sim.append(_SimPress(side, finger, ks.t_us - 40_000))

    def feed(self, t_us: int, side: str, angles: np.ndarray | None) -> list[tuple[str, str]]:
        """One hand's angles for this tick (None when untracked). Returns detector events."""
        if self.simulate:
            # The --fake hands sway and curl through the fake lesson; that motion is not
            # typing, so simulated presses ride on a still hand.
            angles = np.zeros(18)
        elif angles is None:
            return []
        a = np.array(angles, dtype=float)
        if self.sim:
            for sp in self.sim:
                if sp.side == side:
                    off = sp.offset(t_us)
                    if off:
                        a[H.FLEXION_SLOTS[sp.finger]] += off
        h = self.hist[side]
        h.append((int(t_us), {f: curl_of(a, f) for f in H.FINGERS}))
        keep = int(self.p["history_ms"]) * 1000
        while h and h[0][0] < t_us - keep:
            h.popleft()
        events = self.detectors[side].update(t_us, a)
        for f, kind in events:
            if kind == "down":
                self.presses.append((int(t_us), side, f))
        while self.presses and self.presses[0][0] < t_us - keep:
            self.presses.popleft()
        return events

    # ------------------------------------------------------------ judging
    def peak_speeds(self, t0_us: int, t1_us: int) -> dict[tuple[str, str], float]:
        """Highest flexion speed (deg/s, closing only) of every finger inside [t0, t1]."""
        out: dict[tuple[str, str], float] = {}
        for side in SIDES:
            prev = None
            best = {f: 0.0 for f in H.FINGERS}
            for t, curls in self.hist[side]:
                if prev is not None and t >= t0_us and prev[0] <= t1_us:
                    dt = max(1e-4, (t - prev[0]) / 1e6)
                    for f in H.FINGERS:
                        v = (curls[f] - prev[1][f]) / dt
                        if v > best[f]:
                            best[f] = v
                prev = (t, curls)
            for f in H.FINGERS:
                out[(side, f)] = best[f]
        return out

    def judge(self, ks: Keystroke) -> dict:
        t0 = ks.t_us - int(self.p["pre_ms"]) * 1000
        t1 = ks.t_us + int(self.p["post_ms"]) * 1000
        peaks = self.peak_speeds(t0, t1)
        pressed = {(s, f) for t, s, f in self.presses if t0 <= t <= t1}
        fast = {k for k, v in peaks.items() if v >= float(self.p["min_peak_deg_s"])}
        cands = pressed | fast
        expected = CHART[ks.key]
        out = {
            "id": ks.id,
            "key": ks.key,
            "expected": [{"hand": s, "finger": f} for s, f in expected],
            "detected": None,
            "verdict": "unclear",
            "reason": "no_press",
            "confidence": 0.0,
            "peak_deg_s": 0.0,
            "source": None,
            "simulated": self.simulate,
        }
        if not cands:
            return out
        best = max(cands, key=lambda k: peaks.get(k, 0.0))
        bv = peaks.get(best, 0.0)
        others = [v for k, v in peaks.items() if k != best]
        second = max(others) if others else 0.0
        ratio = bv / second if second > 1e-6 else 99.0
        out.update(
            detected={"hand": best[0], "finger": best[1]},
            confidence=round(min(ratio, 99.0), 2),
            peak_deg_s=round(bv, 1),
            source="press" if best in pressed else "velocity",
        )
        if ratio < float(self.p["clear_ratio"]):
            out["reason"] = "ambiguous"
            return out
        out["reason"] = None
        out["verdict"] = "good" if best in expected else "wrong_finger"
        return out

    def due(self, now_us: int) -> list[dict]:
        """Judge every keystroke whose window has closed. Returns the verdicts in order."""
        post = int(self.p["post_ms"]) * 1000
        ready = [k for k in self.pending if now_us >= k.t_us + post]
        if not ready:
            return []
        self.pending = [k for k in self.pending if now_us < k.t_us + post]
        out = []
        for ks in ready:
            v = self.judge(ks)
            self.tally[tally_label(ks.key)][v["verdict"]] += 1
            self.last = v
            out.append(v)
        self.sim = [sp for sp in self.sim if not sp.done(now_us)]
        return out

    def reset_tally(self) -> None:
        for row in self.tally.values():
            for k in row:
                row[k] = 0
        self.last = None

    def state(self) -> dict:
        totals = {"good": 0, "wrong_finger": 0, "unclear": 0}
        for row in self.tally.values():
            for k, v in row.items():
                totals[k] += v
        return {
            "pending": len(self.pending),
            "last": self.last,
            "tally": {k: dict(v) for k, v in self.tally.items()},
            "totals": totals,
            "simulated": self.simulate,
            "down": {s: self.detectors[s].down for s in SIDES},
        }


def state(session) -> dict:
    tt = getattr(session, "typing", None)
    if tt is None:
        return {"pending": 0, "last": None, "tally": {}, "totals": {}, "simulated": False}
    return tt.state()
