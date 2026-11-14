"""Request budget for the Gemini free tier (sliding minute window plus a persisted per-day counter) and a TTL cache."""

import json
import logging
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Generic, TypeVar

from app import constants as c

log = logging.getLogger(__name__)
T = TypeVar("T")

Clock = Callable[[], float]


def pacific_day(now: float) -> str:
    """Return the Pacific-time calendar date of a Unix timestamp, the boundary at which Google resets daily quotas."""
    try:
        from zoneinfo import ZoneInfo  # noqa: PLC0415

        tz: Any = ZoneInfo(c.GEMINI_PACIFIC_TZ)
    except Exception:  # noqa: BLE001 - no tz database on Windows without tzdata
        tz = timezone(timedelta(hours=c.GEMINI_PACIFIC_FALLBACK_OFFSET_H))
    return datetime.fromtimestamp(now, UTC).astimezone(tz).date().isoformat()


def free_limits(model: str) -> tuple[int, int]:
    """Return the free-tier (requests per minute, requests per day) for a model."""
    return c.GEMINI_FREE_LIMITS.get(model, c.GEMINI_DEFAULT_LIMITS)


class RateLimiter:
    """Counts Gemini requests per model. Minute timestamps live in memory; the day count is saved to disk."""

    def __init__(
        self, path: Path, clock: Clock = time.time, rpm_override: int | None = None, rpd_override: int | None = None,
    ) -> None:
        """Load today's counters from path (missing or corrupt files start empty)."""
        self._path = path
        self._clock = clock
        self._rpm_override = rpm_override
        self._rpd_override = rpd_override
        self._lock = threading.Lock()
        self._minute: dict[str, list[float]] = {}
        self._days: dict[str, dict[str, Any]] = self._load()

    def _load(self) -> dict[str, dict[str, Any]]:
        """Read the saved day counters."""
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self) -> None:
        """Write the day counters atomically; failure is logged, not fatal."""
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._days), encoding="utf-8")
            tmp.replace(self._path)
        except OSError as exc:
            log.warning("could not save Gemini usage: %s", exc)

    def budgets(self, model: str) -> tuple[int, int]:
        """Return the (per minute, per day) request budgets: a fraction of the free limits, at least one."""
        rpm, rpd = free_limits(model)
        rpm = self._rpm_override or max(1, int(rpm * c.GEMINI_BUDGET_FRACTION))
        rpd = self._rpd_override or max(1, int(rpd * c.GEMINI_BUDGET_FRACTION))
        return rpm, rpd

    def _counts(self, model: str, now: float) -> tuple[int, int]:
        """Return (requests in the last minute, requests today), pruning stale state."""
        stamps = [t for t in self._minute.get(model, []) if now - t < c.GEMINI_MINUTE_WINDOW_S]
        self._minute[model] = stamps
        entry = self._days.get(model)
        today = pacific_day(now)
        if not entry or entry.get("day") != today:
            entry = {"day": today, "count": 0}
            self._days[model] = entry
        return len(stamps), int(entry["count"])

    def try_acquire(self, model: str) -> bool:
        """Reserve one request for model; False (and nothing counted) when either budget is spent."""
        with self._lock:
            now = self._clock()
            per_minute, per_day = self._counts(model, now)
            rpm, rpd = self.budgets(model)
            if per_minute >= rpm or per_day >= rpd:
                return False
            self._minute[model].append(now)
            self._days[model]["count"] = per_day + 1
            self._save()
            return True

    def penalise(self, model: str) -> None:
        """Google answered 429: treat the minute budget as spent until the window passes."""
        with self._lock:
            now = self._clock()
            self._counts(model, now)
            rpm, _ = self.budgets(model)
            stamps = self._minute[model]
            stamps.extend([now] * max(0, rpm - len(stamps)))

    def remaining(self, model: str) -> dict[str, Any]:
        """Return the budgets and what is left, for GET /dev/state."""
        with self._lock:
            per_minute, per_day = self._counts(model, self._clock())
            rpm, rpd = self.budgets(model)
            free_rpm, free_rpd = free_limits(model)
            return {
                "model": model, "rpm_budget": rpm, "rpm_remaining": max(0, rpm - per_minute),
                "rpd_budget": rpd, "rpd_remaining": max(0, rpd - per_day),
                "free_rpm": free_rpm, "free_rpd": free_rpd,
            }


class TTLCache(Generic[T]):
    """A small in-memory cache whose entries expire after ttl seconds; the oldest entry is dropped when full."""

    def __init__(self, ttl_s: float, max_entries: int, clock: Clock = time.monotonic) -> None:
        """Set the lifetime, capacity and time source."""
        self._ttl = ttl_s
        self._max = max_entries
        self._clock = clock
        self._items: OrderedDict[str, tuple[float, T]] = OrderedDict()

    def get(self, key: str) -> T | None:
        """Return the live value for key, or None."""
        item = self._items.get(key)
        if item is None:
            return None
        if self._clock() - item[0] >= self._ttl:
            del self._items[key]
            return None
        return item[1]

    def put(self, key: str, value: T) -> None:
        """Store value, evicting the oldest entries beyond capacity."""
        self._items[key] = (self._clock(), value)
        self._items.move_to_end(key)
        while len(self._items) > self._max:
            self._items.popitem(last=False)
