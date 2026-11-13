"""One Euro filtering of glove frames: a filter per joint angle, nlerp on the wrist quaternion, and a deadband."""

import math
from dataclasses import dataclass, field

from app import constants as c
from app.schemas.common import Side
from app.schemas.frames import GloveFrame, HandFrame
from app.services import geometry


def _alpha(dt: float, cutoff: float) -> float:
    """Return the exponential smoothing factor for a cutoff frequency."""
    tau = 1.0 / (2.0 * math.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)


class OneEuroFilter:
    """Casiez et al. (2012) adaptive low-pass filter for one scalar signal, with a deadband."""

    def __init__(self, min_cutoff: float, beta: float, d_cutoff: float = c.SMOOTHING_D_CUTOFF,
                 deadband: float = c.SMOOTHING_DEADBAND_RAD) -> None:
        """Create a filter with the given tuning."""
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.deadband = deadband
        self._x: float | None = None
        self._dx = 0.0
        self._out: float | None = None

    def __call__(self, x: float, dt: float) -> float:
        """Filter one sample taken dt seconds after the previous one."""
        if self._x is None or self._out is None:
            self._x = x
            self._out = x
            return x
        dt = dt if dt > 0 else c.SMOOTHING_FALLBACK_DT
        dx = (x - self._x) / dt
        self._dx += _alpha(dt, self.d_cutoff) * (dx - self._dx)
        cutoff = self.min_cutoff + self.beta * abs(self._dx)
        self._x += _alpha(dt, cutoff) * (x - self._x)
        if abs(self._x - self._out) >= self.deadband:
            self._out = self._x
        return self._out


@dataclass
class SmoothingParams:
    """Live-tunable smoothing parameters."""

    enabled: bool = c.SMOOTHING_ENABLED
    min_cutoff: float = c.SMOOTHING_MIN_CUTOFF
    beta: float = c.SMOOTHING_BETA


@dataclass
class _HandState:
    """Filter state for one hand."""

    joints: list[OneEuroFilter]
    quat: geometry.Quat | None = None
    last_t: float | None = None


@dataclass
class GloveSmoother:
    """Applies the smoothing stage to frames, keeping separate state per hand."""

    params: SmoothingParams = field(default_factory=SmoothingParams)
    _hands: dict[Side, _HandState] = field(default_factory=dict)

    def configure(self, enabled: bool | None = None, min_cutoff: float | None = None, beta: float | None = None) -> None:
        """Update parameters live; existing filters pick them up on the next sample."""
        if enabled is not None:
            self.params.enabled = enabled
        if min_cutoff is not None:
            self.params.min_cutoff = min_cutoff
        if beta is not None:
            self.params.beta = beta
        for state in self._hands.values():
            for f in state.joints:
                f.min_cutoff = self.params.min_cutoff
                f.beta = self.params.beta

    def reset(self) -> None:
        """Forget all filter state, for example after switching source."""
        self._hands.clear()

    def _state(self, side: Side) -> _HandState:
        """Return (creating if needed) the filter state for a side."""
        if side not in self._hands:
            n = len(c.FINGERS) * c.JOINTS_PER_FINGER
            self._hands[side] = _HandState(
                [OneEuroFilter(self.params.min_cutoff, self.params.beta) for _ in range(n)]
            )
        return self._hands[side]

    def _smooth_hand(self, hand: HandFrame, t: float) -> HandFrame:
        """Smooth one hand's joints and wrist orientation."""
        state = self._state(hand.side)
        if state.last_t is not None and t < state.last_t:
            self._hands.pop(hand.side)
            state = self._state(hand.side)
        dt = c.SMOOTHING_FALLBACK_DT if state.last_t is None else t - state.last_t
        state.last_t = t
        flexion: dict[str, tuple[float, float, float]] = {}
        k = 0
        for name in c.FINGERS:
            vals = []
            for v in hand.flexion[name]:
                vals.append(round(state.joints[k](v, dt), c.FRAME_DECIMALS))
                k += 1
            flexion[name] = (vals[0], vals[1], vals[2])
        raw = geometry.normalise(hand.wrist_quat)
        state.quat = raw if state.quat is None else geometry.nlerp(
            state.quat, raw, _alpha(dt if dt > 0 else c.SMOOTHING_FALLBACK_DT, self.params.min_cutoff)
        )
        quat = tuple(round(v, c.FRAME_DECIMALS) for v in state.quat)
        return hand.model_copy(update={"flexion": flexion, "wrist_quat": quat})

    def apply(self, frame: GloveFrame) -> GloveFrame:
        """Return the smoothed frame, or the input untouched when smoothing is disabled."""
        if not self.params.enabled:
            return frame
        return frame.model_copy(update={"hands": [self._smooth_hand(h, frame.t) for h in frame.hands]})
