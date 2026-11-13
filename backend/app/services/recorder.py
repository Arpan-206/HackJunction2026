"""Captures smoothed glove frames into stored recordings."""

from app import constants as c
from app.core.errors import NotFoundError
from app.core.utils import new_id, utc_now_iso
from app.schemas.frames import GloveFrame
from app.schemas.records import Recording
from app.services.storage.json_store import JsonStore


class _Take:
    """A recording in progress."""

    def __init__(self, lesson_id: str | None, step_id: str | None) -> None:
        """Start an empty take."""
        self.lesson_id = lesson_id
        self.step_id = step_id
        self.started_at = utc_now_iso()
        self.frames: list[GloveFrame] = []


class Recorder:
    """Collects frames pushed by the glove manager and persists them on stop."""

    def __init__(self, store: JsonStore[Recording]) -> None:
        """Use the given store for finished takes."""
        self._store = store
        self._active: dict[str, _Take] = {}

    def start(self, lesson_id: str | None, step_id: str | None) -> str:
        """Begin a new take and return its id."""
        recording_id = new_id()
        self._active[recording_id] = _Take(lesson_id, step_id)
        return recording_id

    def push(self, frame: GloveFrame) -> None:
        """Append a frame to every active take."""
        for take in self._active.values():
            if len(take.frames) < c.MAX_RECORDING_FRAMES:
                take.frames.append(frame)

    def stop(self, recording_id: str) -> Recording:
        """Finish a take, rebase its timestamps to zero, persist and return it."""
        take = self._active.pop(recording_id, None)
        if take is None:
            raise NotFoundError(f"no active recording {recording_id}")
        origin = take.frames[0].t if take.frames else 0.0
        frames = [f.model_copy(update={"t": round(f.t - origin, c.FRAME_DECIMALS)}) for f in take.frames]
        duration = frames[-1].t if frames else 0.0
        fps = (len(frames) - 1) / duration if duration > 0 else c.STREAM_HZ
        recording = Recording(
            id=recording_id, lesson_id=take.lesson_id, step_id=take.step_id, started_at=take.started_at,
            duration_s=duration, fps=round(fps, 2), frames=frames,
        )
        return self._store.save(recording)

    def get(self, recording_id: str) -> Recording:
        """Return a stored recording or raise NotFoundError."""
        recording = self._store.get(recording_id)
        if recording is None:
            raise NotFoundError(f"recording {recording_id} not found")
        return recording
