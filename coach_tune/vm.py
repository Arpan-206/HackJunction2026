"""Verda client, secrets and cost bookkeeping for the coach-tune lane. Secrets are loaded, never printed."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from dotenv import dotenv_values

LANE = Path(__file__).resolve().parent
ROOT = LANE.parent
OUT = LANE / "out"
MAIN_CHECKOUT = Path("/Users/arpanpandey/Code/Junction/repo")
COST_LOG = OUT / "cost_log.jsonl"
PROGRESS_LOG = Path.home() / "geppetto-progress" / "coach-tune.log"
BALANCE_FLOOR = 50.0
LANE_BUDGET_USD = 80.0


def secrets() -> dict[str, str]:
    path = Path(os.environ.get("GEPPETTO_ENV_FILE", MAIN_CHECKOUT / ".env"))
    values = (
        {k: v for k, v in dotenv_values(path).items() if v} if path.is_file() else {}
    )
    values.update({k: v for k, v in os.environ.items() if k.startswith("VERDA_")})
    return values


def client():
    from verda import VerdaClient

    s = secrets()
    missing = [n for n in ("VERDA_CLOUD_CLIENT_ID", "VERDA_CLOUD") if not s.get(n)]
    if missing:
        raise SystemExit(f"missing in .env: {', '.join(missing)}")
    return VerdaClient(s["VERDA_CLOUD_CLIENT_ID"], s["VERDA_CLOUD"])


def balance(c) -> dict[str, Any]:
    b = c.balance.get()
    return {
        "amount": getattr(b, "amount", None),
        "currency": getattr(b, "currency", None),
    }


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def log_cost(event: str, **fields: Any) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with COST_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"t": now_iso(), "event": event, **fields}) + "\n")
