"""Small helpers shared across services."""

import uuid
from datetime import UTC, datetime

from app import constants as c


def new_id() -> str:
    """Return a short random identifier."""
    return uuid.uuid4().hex[: c.ID_LENGTH]


def utc_now_iso() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(UTC).isoformat()
