"""A glove source fed by another process (for example the ML or positioning pipeline) instead of hardware."""

import time
from typing import Any

from pydantic import ValidationError

from app.core.errors import InvalidFrameError, SourceInactiveError
from app.schemas.common import GloveSource
from app.schemas.frames import GloveFrame
from app.services.gloves.base import FrameSink

MAX_BATCH = 600
IDENTITY_QUAT = [0.0, 0.0, 0.0, 1.0]


class ExternalSource:
    """Accepts GloveFrame-shaped dicts through push() and emits them into the normal pipeline (smoothing, ws, recorder).

    Accepted payloads, all in radians and metres as in docs/CONTRACT.md:
      * a GloveFrame: {"t"?: s, "hands": [HandFrame, ...]}
      * a single HandFrame: {"side": "right", "flexion": {...}}  (wrist_quat defaults to identity)
      * a batch: {"frames": [GloveFrame, ...]}, emitted back to back
    The source label on the wire is "replay", which the frontend already treats as a non-hardware source.
    """

    name: GloveSource = "external"

    def __init__(self) -> None:
        """Start idle; frames are rejected until the manager has started this source."""
        self._emit: FrameSink | None = None
        self._origin = time.perf_counter()

    @property
    def active(self) -> bool:
        """Whether the pipeline is currently reading from this source."""
        return self._emit is not None

    async def start(self, emit: FrameSink) -> None:
        """Begin accepting frames."""
        self._emit = emit
        self._origin = time.perf_counter()

    async def stop(self) -> None:
        """Stop accepting frames."""
        self._emit = None

    def push(self, payload: dict[str, Any]) -> int:
        """Validate and emit one frame, a single hand or a batch; returns the number of frames emitted."""
        if self._emit is None:
            raise SourceInactiveError("The external source is not active; POST /api/dev/state {\"glove_source\": \"external\"} or add ?activate=1")
        items = payload.get("frames") if isinstance(payload.get("frames"), list) else [payload]
        if len(items) > MAX_BATCH:
            raise InvalidFrameError(f"At most {MAX_BATCH} frames per request")
        frames = [self._to_frame(item) for item in items]
        for frame in frames:
            self._emit(frame)
        return len(frames)

    def _to_frame(self, item: Any) -> GloveFrame:
        """Turn one payload item into a validated GloveFrame."""
        if not isinstance(item, dict):
            raise InvalidFrameError("Each frame must be a JSON object")
        hands = item.get("hands")
        if hands is None and "side" in item:
            hands = [item]
        hands = [{"wrist_quat": IDENTITY_QUAT, **h} if isinstance(h, dict) else h for h in hands or []]
        t = item.get("t")
        t = float(t) if isinstance(t, (int, float)) else time.perf_counter() - self._origin
        try:
            return GloveFrame(t=t, source="replay", hands=hands)
        except ValidationError as exc:
            raise InvalidFrameError(f"Invalid frame: {exc.errors(include_url=False, include_input=False)[:3]}") from exc
