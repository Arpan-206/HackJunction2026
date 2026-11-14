"""Read single members of a large remote zip over HTTP range requests.

Used to pull only the FurElise motion files and MIDI out of the 47 GB
dataset.zip, without the full download. Standard library only.
"""

from __future__ import annotations

import io
import sys
import urllib.request
import zipfile


class HttpRangeFile(io.RawIOBase):
    """A seekable, read-only file over HTTP byte ranges."""

    def __init__(self, url: str, chunk: int = 1 << 20) -> None:
        self.url = url
        self.pos = 0
        self.chunk = chunk
        self._cache: tuple[int, bytes] = (-1, b"")
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=60) as r:
            self.url = r.geturl()
            self.size = int(r.headers["Content-Length"])

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, off: int, whence: int = 0) -> int:
        if whence == 0:
            self.pos = off
        elif whence == 1:
            self.pos += off
        else:
            self.pos = self.size + off
        return self.pos

    def _get(self, start: int, end: int) -> bytes:
        req = urllib.request.Request(
            self.url, headers={"Range": f"bytes={start}-{end - 1}"}
        )
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    return r.read()
            except Exception:  # noqa: BLE001 - retry any network fault
                if attempt == 4:
                    raise
        return b""

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b""
        c_start, c_data = self._cache
        if c_start <= self.pos and self.pos + n <= c_start + len(c_data):
            off = self.pos - c_start
            out = c_data[off : off + n]
        elif n < self.chunk:
            end = min(self.size, self.pos + self.chunk)
            data = self._get(self.pos, end)
            self._cache = (self.pos, data)
            out = data[:n]
        else:
            out = self._get(self.pos, self.pos + n)
        self.pos += len(out)
        return out

    def readinto(self, b) -> int:  # type: ignore[override]
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


def open_remote_zip(url: str) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BufferedReader(HttpRangeFile(url), 1 << 20))


if __name__ == "__main__":
    zf = open_remote_zip(sys.argv[1])
    for info in zf.infolist():
        print(info.filename, info.file_size, info.compress_size)
