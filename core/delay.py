"""Delay per stage of the hand root path, for the log line and GET /debug/delay.

Stages, in order (all in milliseconds):

- capture_to_arrival_over_fastest: the phone's capture stamp to arrival on the Mac, as the excess
  over the fastest frame in the last minute. The phone and the Mac have different clocks, so the
  absolute value is not known; [camera] latency_us is the assumed floor.
- arrival_to_done: arrival on the Mac to the tracker's fix (wait for the tracker plus its work).
- done_to_tick: the fix waits for the next core tick.
- tick_to_sent: the tick (fusion, scoring, JSON) to the /ws/gloves socket write, queue included.

The viewer measures the rest (frontend/src/api/delayProbe.ts): tick to received, received to drawn.
"""

from __future__ import annotations

import threading
from collections import deque

import numpy as np

STAGES = ("capture_to_arrival_over_fastest", "arrival_to_done", "done_to_tick", "tick_to_sent")


class DelayStats:
    def __init__(self, keep: int = 900) -> None:
        self._lock = threading.Lock()
        self._d: dict[str, deque] = {}
        self.keep = keep

    def add(self, stage: str, ms: float) -> None:
        with self._lock:
            self._d.setdefault(stage, deque(maxlen=self.keep)).append(float(ms))

    def reset(self) -> None:
        with self._lock:
            self._d.clear()

    def snapshot(self) -> dict:
        with self._lock:
            items = {k: np.array(v) for k, v in self._d.items() if len(v)}
        return {k: {"p50": round(float(np.percentile(a, 50)), 1), "p95": round(float(np.percentile(a, 95)), 1),
                    "max": round(float(a.max()), 1), "n": int(len(a))} for k, a in items.items()}

    def line(self) -> str:
        s = self.snapshot()
        return "; ".join(f"{k} p50 {s[k]['p50']:.0f} max {s[k]['max']:.0f}" for k in STAGES if k in s)


STATS = DelayStats()
