"""A glove source that plays a parametric motion at the stream rate, for development without hardware."""

import asyncio
import contextlib
import time

from app import constants as c
from app.schemas.common import GloveSource
from app.schemas.motion import Idle, MotionSpec
from app.services.gloves.base import FrameSink
from app.services.motion import synthesiser


class SimulatorSource:
    """Emits synthesised frames for both hands from the current MotionSpec."""

    name: GloveSource = "simulator"

    def __init__(self, motion: MotionSpec | None = None) -> None:
        """Start with the given motion, or an idle hand."""
        self.motion: MotionSpec = motion or Idle()
        self._task: asyncio.Task[None] | None = None

    def set_motion(self, motion: MotionSpec) -> None:
        """Change the motion being played."""
        self.motion = motion

    async def start(self, emit: FrameSink) -> None:
        """Begin the emit loop."""
        await self.stop()
        self._task = asyncio.create_task(self._run(emit))

    async def stop(self) -> None:
        """Cancel the emit loop."""
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _run(self, emit: FrameSink) -> None:
        """Emit frames at STREAM_HZ using a drift-free schedule."""
        period = 1.0 / c.STREAM_HZ
        origin = time.perf_counter()
        index = 0
        while True:
            t = time.perf_counter() - origin
            emit(synthesiser.frame_at(self.motion, t))
            index += 1
            await asyncio.sleep(max(0.0, origin + index * period - time.perf_counter()))
