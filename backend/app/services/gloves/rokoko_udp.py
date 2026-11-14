"""Receive Rokoko Studio Custom Streaming (UDP, JSON v3 or v4, optionally LZ4) and emit GloveFrames."""

import asyncio
import json
import logging
import time

from app import constants as c
from app.core.errors import ConflictError, ServiceUnavailableError
from app.schemas.common import GloveSource
from app.schemas.frames import GloveFrame
from app.services.gloves.base import FrameSink
from app.services.gloves.rokoko_mapper import map_payload

log = logging.getLogger(__name__)


def decode_datagram(data: bytes) -> dict:
    """Decode one datagram to a JSON object, decompressing LZ4 frames when the optional extra is installed."""
    if data[:4] == c.LZ4_FRAME_MAGIC:
        try:
            import lz4.frame
        except ImportError as exc:
            raise ServiceUnavailableError(
                "LZ4 frames received but the 'rokoko' extra is not installed (uv sync --extra rokoko)"
            ) from exc
        data = lz4.frame.decompress(data)
    return json.loads(data)


class _Protocol(asyncio.DatagramProtocol):
    """Datagram protocol that decodes and forwards frames."""

    def __init__(self, emit: FrameSink) -> None:
        """Remember where to send frames and when the stream started."""
        self._emit = emit
        self._origin = time.perf_counter()
        self._failures = 0

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        """Decode one datagram and emit the resulting frame."""
        try:
            hands = map_payload(decode_datagram(data))
        except Exception:
            self._failures += 1
            if self._failures in (1, 100, 1000):
                log.exception(
                    "Dropping undecodable Rokoko datagram from %s (count %d)",
                    addr,
                    self._failures,
                )
            return
        if hands:
            self._emit(
                GloveFrame(
                    t=time.perf_counter() - self._origin,
                    source="rokoko_udp",
                    hands=hands,
                )
            )


class RokokoUdpSource:
    """Binds the configured UDP port and streams mapped frames."""

    name: GloveSource = "rokoko_udp"

    def __init__(self, port: int) -> None:
        """Remember the port to listen on."""
        self.port = port
        self._transport: asyncio.DatagramTransport | None = None

    async def start(self, emit: FrameSink) -> None:
        """Open the UDP socket."""
        loop = asyncio.get_running_loop()
        try:
            transport, _ = await loop.create_datagram_endpoint(
                lambda: _Protocol(emit), local_addr=("0.0.0.0", self.port)
            )
        except OSError as exc:
            raise ConflictError(
                f"Cannot listen on UDP port {self.port}: {exc}"
            ) from exc
        self._transport = transport  # type: ignore[assignment]

    async def stop(self) -> None:
        """Close the UDP socket."""
        if self._transport is not None:
            self._transport.close()
            self._transport = None
