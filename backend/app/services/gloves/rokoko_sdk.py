"""Stub for the Rokoko Device SDK (RCSP/RGMP over TCP) glove source."""

from app.core.errors import NotImplementedFeatureError
from app.schemas.common import GloveSource
from app.services.gloves.base import FrameSink

SDK_MESSAGE = (
    "The rokoko_sdk source is not implemented. The Rokoko Device SDK driver is distributed under a separate "
    "licence that must be accepted by the user, so it is not bundled or called from this repository. "
    "Use rokoko_udp (Studio Custom Streaming) instead, or implement RGMP decoding here once the licence is accepted."
)


class RokokoSdkSource:
    """Placeholder source that explains why the SDK path is unavailable."""

    name: GloveSource = "rokoko_sdk"

    async def start(self, emit: FrameSink) -> None:
        """Always raise, explaining the SDK licence."""
        raise NotImplementedFeatureError(SDK_MESSAGE)

    async def stop(self) -> None:
        """Nothing to release."""
