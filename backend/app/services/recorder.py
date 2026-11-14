"""Captures smoothed glove frames into stored recordings."""

from collections.abc import Callable

from app import constants as c
from app.core.errors import NotFoundError
from app.core.utils import new_id, utc_now_iso
from app.schemas.common import Hands
from app.schemas.frames import GloveFrame
from app.schemas.media import MediaRef
from app.schemas.records import Recording, RecordingSummary
from app.services.storage.json_store import JsonStore


class _Take:
    """A recording in progress."""

    def __init__(
        self, lesson_id: str | None, step_id: str | None, hands: Hands
    ) -> None:
        """Start an empty take that keeps only the given hands ("both" keeps every hand)."""
        self.lesson_id = lesson_id
        self.step_id = step_id
        self.hands = hands
        self.started_at = utc_now_iso()
        self.frames: list[GloveFrame] = []


class Recorder:
    """Collects frames pushed by the glove manager and persists them on stop."""

    def __init__(self, store: JsonStore[Recording]) -> None:
        """Use the given store for finished takes."""
        self._store = store
        self._active: dict[str, _Take] = {}
        # Called after a stored take is saved or deleted (the Verda export listens here).
        self.on_change: list[Callable[[], None]] = []

    def _changed(self) -> None:
        """Tell the listeners that a stored take changed."""
        for listener in self.on_change:
            listener()

    def start(
        self, lesson_id: str | None, step_id: str | None, hands: Hands = "both"
    ) -> str:
        """Begin a new take and return its id. A one-handed take ("left" or "right") stores only that hand."""
        recording_id = new_id()
        self._active[recording_id] = _Take(lesson_id, step_id, hands)
        return recording_id

    def push(self, frame: GloveFrame) -> None:
        """Append a frame to every active take, dropping the hands a one-handed take does not capture."""
        for take in self._active.values():
            if len(take.frames) >= c.MAX_RECORDING_FRAMES:
                continue
            if take.hands == "both":
                take.frames.append(frame)
            else:
                take.frames.append(
                    frame.model_copy(
                        update={
                            "hands": [h for h in frame.hands if h.side == take.hands]
                        }
                    )
                )

    def stop(self, recording_id: str) -> Recording:
        """Finish a take, rebase its timestamps to zero, persist and return it."""
        take = self._active.pop(recording_id, None)
        if take is None:
            raise NotFoundError(f"no active recording {recording_id}")
        origin = take.frames[0].t if take.frames else 0.0
        frames = [
            f.model_copy(update={"t": round(f.t - origin, c.FRAME_DECIMALS)})
            for f in take.frames
        ]
        duration = frames[-1].t if frames else 0.0
        fps = (len(frames) - 1) / duration if duration > 0 else c.STREAM_HZ
        recording = Recording(
            id=recording_id,
            lesson_id=take.lesson_id,
            step_id=take.step_id,
            started_at=take.started_at,
            duration_s=duration,
            fps=round(fps, 2),
            hands=take.hands,
            frames=frames,
        )
        saved = self._store.save(recording)
        self._changed()
        return saved

    def get(self, recording_id: str) -> Recording:
        """Return a stored recording or raise NotFoundError."""
        recording = self._store.get(recording_id)
        if recording is None:
            raise NotFoundError(f"recording {recording_id} not found")
        return recording

    def summaries(
        self, step_id: str | None = None, lesson_id: str | None = None
    ) -> list[RecordingSummary]:
        """Return stored takes without frames, oldest first, optionally only those of one step or lesson."""
        found = [
            r
            for r in self._store.list()
            if (step_id is None or r.step_id == step_id)
            and (lesson_id is None or r.lesson_id == lesson_id)
        ]
        found.sort(key=lambda r: r.started_at)
        return [RecordingSummary.of(r) for r in found]

    def set_video(self, recording_id: str, video: MediaRef | None) -> RecordingSummary:
        """Attach the webcam video filmed during a stored take (None detaches it) and return the take's summary."""
        recording = self.get(recording_id).model_copy(update={"video": video})
        return RecordingSummary.of(self._store.save(recording))

    def delete(self, recording_id: str) -> None:
        """Delete a stored take, or discard one still recording; raise NotFoundError when neither exists."""
        if self._active.pop(recording_id, None) is not None:
            return
        if not self._store.delete(recording_id):
            raise NotFoundError(f"recording {recording_id} not found")
        self._changed()
