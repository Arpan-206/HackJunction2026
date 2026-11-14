"""One JSON line per call, appended to logs/decisions.jsonl. Logging never raises into the caller."""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import log_path


class JsonlLog:
    def __init__(self, path: Path | str | None = None, enabled: bool = True) -> None:
        self.path = Path(path) if path is not None else log_path()
        self.enabled = enabled
        self.lines = 0
        self._lock = threading.Lock()

    def write(self, record: dict[str, Any]) -> None:
        if not self.enabled:
            return
        rec = {
            "t": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "t_us": int(time.time() * 1e6),
            **record,
        }
        try:
            line = json.dumps(rec, default=_json_default)
        except (TypeError, ValueError):
            line = json.dumps({"t": rec["t"], "fn": record.get("fn"), "error": "unserialisable record"})
        with self._lock:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with open(self.path, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
                self.lines += 1
            except OSError:
                pass


def _json_default(o: Any) -> Any:
    if hasattr(o, "tolist"):
        return o.tolist()
    if hasattr(o, "__dict__"):
        return o.__dict__
    return str(o)
