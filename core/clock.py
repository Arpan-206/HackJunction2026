"""Core clock: integer microseconds, monotonic, anchored to wall time at start."""
from __future__ import annotations

import time


class Clock:
    def __init__(self) -> None:
        self._wall0_us = int(time.time() * 1_000_000)
        self._mono0 = time.monotonic_ns()

    def now_us(self) -> int:
        return self._wall0_us + (time.monotonic_ns() - self._mono0) // 1000


class FakeClock(Clock):
    """A clock that only moves when told to. For tests and the fake source."""

    def __init__(self, start_us: int = 1_700_000_000_000_000) -> None:
        super().__init__()
        self._t = start_us

    def now_us(self) -> int:
        return self._t

    def advance_us(self, dt_us: int) -> int:
        self._t += int(dt_us)
        return self._t

    def set_us(self, t_us: int) -> None:
        self._t = int(t_us)
