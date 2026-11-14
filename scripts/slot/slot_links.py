"""Small clients for the slot kit: the core's /ws and HTTP, the backend's /api, /ws/robot.

Every call is recorded in a Trace so the step log holds the exact command and reply.
Only the standard library and `websockets` (already in requirements.txt).
"""

from __future__ import annotations

import json
import socket
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from websockets.sync.client import connect


def short(obj, limit: int = 1500) -> str:
    s = obj if isinstance(obj, str) else json.dumps(obj, default=str)
    return s if len(s) <= limit else s[:limit] + f"... ({len(s)} chars)"


@dataclass
class Trace:
    """What one step ran: shell commands, core commands, HTTP calls, each with its result."""

    entries: list[dict] = field(default_factory=list)

    def add(self, kind: str, command: str, ok: bool, output) -> dict:
        e = {
            "t": round(time.time(), 3),
            "kind": kind,
            "command": command,
            "ok": bool(ok),
            "output": short(output),
        }
        self.entries.append(e)
        return e


def port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class HttpError(RuntimeError):
    pass


def http(
    method: str,
    url: str,
    body: dict | None = None,
    timeout: float = 30.0,
    trace: Trace | None = None,
):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    label = f"{method} {url}" + ("" if body is None else f" {json.dumps(body)}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            out = json.loads(raw) if raw else None
            if trace is not None:
                trace.add("http", label, True, out)
            return out
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        if trace is not None:
            trace.add("http", label, False, f"HTTP {e.code}: {detail}")
        raise HttpError(f"{label} -> HTTP {e.code}: {detail[:300]}") from e
    except (urllib.error.URLError, OSError) as e:
        if trace is not None:
            trace.add("http", label, False, str(e))
        raise HttpError(f"{label} -> {e}") from e


class CommandFailed(RuntimeError):
    def __init__(self, name: str, error: dict) -> None:
        super().__init__(f"{name}: {error.get('code')}: {error.get('message')}")
        self.error = error


class CoreLink:
    """One /ws connection (or /ws/robot). A reader thread keeps every message; cmd() waits for its ack."""

    def __init__(
        self, url: str, trace: Trace | None = None, open_timeout: float = 10.0
    ) -> None:
        self.url = url
        self.trace = trace
        self.ws = connect(
            url, proxy=None, open_timeout=open_timeout, max_size=8 * 1024 * 1024
        )
        self.msgs: list[dict] = []
        self.lock = threading.Lock()
        self._n = 0
        self._closed = False
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()

    def _read(self) -> None:
        while not self._closed:
            try:
                raw = self.ws.recv(timeout=0.5)
            except TimeoutError:
                continue
            except Exception:
                break
            try:
                m = json.loads(raw)
            except ValueError:
                continue
            m["_rx"] = time.time()
            with self.lock:
                self.msgs.append(m)
                if len(self.msgs) > 40000:
                    del self.msgs[:10000]

    def close(self) -> None:
        self._closed = True
        try:
            self.ws.close()
        except Exception:
            pass

    def mark(self) -> float:
        return time.time()

    def since(self, t0: float, kind: str | None = None) -> list[dict]:
        with self.lock:
            return [
                m
                for m in self.msgs
                if m["_rx"] >= t0 and (kind is None or m.get("type") == kind)
            ]

    def latest(self, kind: str) -> dict | None:
        with self.lock:
            for m in reversed(self.msgs):
                if m.get("type") == kind:
                    return m
        return None

    def cmd(
        self,
        name: str,
        args: dict | None = None,
        timeout: float = 10.0,
        check: bool = True,
    ) -> dict:
        self._n += 1
        cid = f"slot-{self._n}"
        t0 = time.time()
        self.ws.send(
            json.dumps(
                {"v": 1, "type": "cmd", "id": cid, "name": name, "args": args or {}}
            )
        )
        label = f"ws {self.url} cmd {name} {json.dumps(args or {})}"
        while time.time() - t0 < timeout:
            with self.lock:
                ack = next(
                    (
                        m
                        for m in self.msgs
                        if m.get("type") == "ack" and m.get("id") == cid
                    ),
                    None,
                )
            if ack is not None:
                if self.trace is not None:
                    self.trace.add(
                        "core",
                        label,
                        ack.get("ok"),
                        ack.get("result") if ack.get("ok") else ack.get("error"),
                    )
                if check and not ack.get("ok"):
                    raise CommandFailed(name, ack.get("error") or {})
                return ack
            time.sleep(0.02)
        if self.trace is not None:
            self.trace.add("core", label, False, "no ack")
        raise CommandFailed(
            name, {"code": "timeout", "message": f"no ack in {timeout} s"}
        )

    def wait_event(self, t0: float, pred, timeout: float) -> dict | None:
        end = time.time() + timeout
        while time.time() < end:
            for m in self.since(t0, "event"):
                if pred(m):
                    return m
            time.sleep(0.05)
        return None
