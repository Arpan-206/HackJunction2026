"""A tiny TCP server that plays the phone's part: one client at a time, drops frames it cannot send.

The fake senders and the replay tool use it, so the reader on the other end sees the
same behaviour as with the real app (ios/PROTOCOL.md, "Transport"). ios/mac/serve.py
re-exports it.
"""

from __future__ import annotations

import logging
import socket
import threading

log = logging.getLogger("geppetto.camera.geppetto_depth.serve")


class PacketServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 7700) -> None:
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((host, port))
        self._sock.listen(1)
        self._sock.settimeout(0.2)
        self.port = self._sock.getsockname()[1]
        self._client: socket.socket | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self.sent = 0
        self.dropped = 0
        self._thread = threading.Thread(
            target=self._accept, name="gdp-accept", daemon=True
        )
        self._thread.start()

    def _accept(self) -> None:
        while not self._stop.is_set():
            try:
                c, addr = self._sock.accept()
            except (TimeoutError, OSError):
                continue
            c.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            with self._lock:
                if self._client is not None:
                    self._client.close()
                self._client = c
            log.info("client %s:%d connected", *addr)

    @property
    def has_client(self) -> bool:
        return self._client is not None

    def send(self, packet: bytes) -> bool:
        with self._lock:
            c = self._client
            if c is None:
                self.dropped += 1
                return False
            try:
                c.sendall(packet)
            except OSError:
                c.close()
                self._client = None
                self.dropped += 1
                return False
        self.sent += 1
        return True

    def close(self) -> None:
        self._stop.set()
        with self._lock:
            if self._client is not None:
                self._client.close()
                self._client = None
        self._sock.close()
        self._thread.join(timeout=1.0)
