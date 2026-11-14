"""Owns the active glove source, smooths its frames, and fans them out to subscribers and sinks."""

import asyncio
import logging

from app import constants as c
from app.core.config import Settings
from app.schemas.common import GloveSource
from app.schemas.frames import GloveFrame
from app.schemas.motion import MotionSpec
from app.services.gloves.base import FrameSink, GloveSourceProtocol
from app.services.gloves.external import ExternalSource
from app.services.gloves.rokoko_sdk import RokokoSdkSource
from app.services.gloves.rokoko_udp import RokokoUdpSource
from app.services.gloves.simulator import SimulatorSource
from app.services.smoothing.one_euro import GloveSmoother

log = logging.getLogger(__name__)


class GloveManager:
    """Single owner of the glove pipeline: source, then smoothing, then websocket subscribers and the recorder."""

    def __init__(self, settings: Settings, smoother: GloveSmoother) -> None:
        """Create a manager; call start() to open the configured source."""
        self._settings = settings
        self.smoother = smoother
        self.simulator = SimulatorSource()
        self.external = ExternalSource()
        self._source: GloveSourceProtocol | None = None
        self._subscribers: set[asyncio.Queue[GloveFrame]] = set()
        self._sinks: list[FrameSink] = []
        self.requested: GloveSource = settings.glove_source

    @property
    def source_name(self) -> GloveSource:
        """The source currently feeding the pipeline."""
        return self._source.name if self._source else self.requested

    @property
    def simulator_motion(self) -> MotionSpec:
        """The motion the simulator plays."""
        return self.simulator.motion

    def set_simulator_motion(self, motion: MotionSpec) -> None:
        """Change the simulator motion."""
        self.simulator.set_motion(motion)

    def ingest(self, payload: dict) -> int:
        """Feed frames from an external pipeline; only valid while the external source is active."""
        return self.external.push(payload)

    async def ingest_async(self, payload: dict, activate: bool = False) -> int:
        """Like ingest(), but with activate=True first switches to the external source if it is not active."""
        if activate and not self.external.active:
            await self.switch_source("external")
        return self.external.push(payload)

    def add_sink(self, sink: FrameSink) -> None:
        """Register a callback that receives every smoothed frame (for example the recorder)."""
        self._sinks.append(sink)

    def subscribe(self) -> asyncio.Queue[GloveFrame]:
        """Return a new queue that receives smoothed frames; the oldest frame is dropped when it is full."""
        queue: asyncio.Queue[GloveFrame] = asyncio.Queue(
            maxsize=c.SUBSCRIBER_QUEUE_SIZE
        )
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[GloveFrame]) -> None:
        """Remove a subscriber queue."""
        self._subscribers.discard(queue)

    def _build(self, name: GloveSource) -> GloveSourceProtocol:
        """Create the source object for a name."""
        if name == "simulator":
            return self.simulator
        if name == "external":
            return self.external
        if name == "rokoko_udp":
            return RokokoUdpSource(self._settings.rokoko_udp_port)
        return RokokoSdkSource()

    async def start(self) -> None:
        """Open the configured source, falling back to the simulator if it cannot start."""
        try:
            await self.switch_source(self.requested)
        except Exception as exc:
            log.warning(
                "Glove source %s unavailable (%s); using simulator", self.requested, exc
            )
            await self.switch_source("simulator")

    async def switch_source(self, name: GloveSource) -> None:
        """Stop the current source and start another. On failure the previous source is restored."""
        previous = self._source
        candidate = self._build(name)
        if previous is not None:
            await previous.stop()
        self.smoother.reset()
        try:
            await candidate.start(self._on_raw)
        except Exception:
            if previous is not None:
                await previous.start(self._on_raw)
            raise
        self._source = candidate
        self.requested = name

    async def stop(self) -> None:
        """Stop the active source."""
        if self._source is not None:
            await self._source.stop()
            self._source = None

    def _on_raw(self, frame: GloveFrame) -> None:
        """Smooth a raw frame and deliver it to sinks and subscribers."""
        smoothed = self.smoother.apply(frame)
        for sink in self._sinks:
            sink(smoothed)
        for queue in self._subscribers:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(smoothed)
