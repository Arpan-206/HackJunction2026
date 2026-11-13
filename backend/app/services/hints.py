"""Algorithmic, plain-language tips derived from per-finger deviations and timing."""

from app import constants as c
from app.schemas.common import Finger


def worst_finger(deviations_deg: dict[str, float]) -> Finger:
    """Return the finger with the largest absolute deviation."""
    return max(c.FINGERS, key=lambda f: abs(deviations_deg.get(f, 0.0)))  # type: ignore[return-value]


def build_hint(deviations_deg: dict[str, float], timing_ms: float) -> str:
    """Describe the biggest problem. Deviation is signed degrees of total finger flexion, summed over its joints (positive: curled too much); timing is positive when late."""
    finger = worst_finger(deviations_deg)
    deviation = deviations_deg.get(finger, 0.0)
    if abs(deviation) >= c.HINT_MIN_DEVIATION_DEG:
        if deviation > 0:
            return f"Relax your {finger} finger, it is curled about {abs(deviation):.0f} degrees (in total) too much."
        return f"Curl your {finger} finger more, it is about {abs(deviation):.0f} degrees (in total) too straight."
    if abs(timing_ms) >= c.HINT_TIMING_MS:
        word = "late" if timing_ms > 0 else "early"
        return f"Your finger shapes are right, but you are about {abs(timing_ms):.0f} ms {word}. Match the guide hand's beat."
    return "Great match. Keep the same shape and rhythm."
