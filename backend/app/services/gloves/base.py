"""The contract every glove frame source implements."""

from collections.abc import Callable
from typing import Protocol

from app.schemas.common import GloveSource
from app.schemas.frames import GloveFrame

FrameSink = Callable[[GloveFrame], None]


class GloveSourceProtocol(Protocol):
    """A producer of raw (unsmoothed) glove frames."""

    name: GloveSource

    async def start(self, emit: FrameSink) -> None:
        """Begin producing frames, calling emit for each one."""
        ...

    async def stop(self) -> None:
        """Stop producing frames and release resources."""
        ...
