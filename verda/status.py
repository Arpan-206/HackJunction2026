"""One timestamped line on what is up and what it has cost: for docs/VERDA.md and the progress log.

    uv run python status.py            # prints the line
    uv run python status.py --json     # the numbers

Spend = the starting balance recorded by the first deploy minus the live balance (EUR, what Verda bills), plus the
estimate at list price in USD for anything still running.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime

from verda import VerdaClient

import paths
from deploy import LOG_FILE, PRICE_USD_PER_H, balance, now_iso, raw_status
from teardown import hours_between


def read_log() -> list[dict]:
    if not LOG_FILE.exists():
        return []
    return [json.loads(line) for line in LOG_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    secrets = paths.load_secrets()
    paths.require(secrets, "VERDA_CLOUD_CLIENT_ID", "VERDA_CLOUD")
    client = VerdaClient(secrets["VERDA_CLOUD_CLIENT_ID"], secrets["VERDA_CLOUD"])
    now = now_iso()
    live = balance(client)
    log = read_log()
    first = next((r["balance"] for r in log if r.get("event") == "deploy" and r.get("balance", {}).get("amount") is not None), None)
    spent = round(first["amount"] - live["amount"], 2) if first and live.get("amount") is not None else None
    up = []
    for d in client.containers.get_deployments():
        status = raw_status(client, d.name)
        hours = hours_between(d.created_at, now)
        price = PRICE_USD_PER_H.get(d.compute.name)
        up.append({
            "name": d.name,
            "gpu": d.compute.name,
            "status": status,
            "hours_up": hours,
            "price_usd_per_h": price,
            "running_estimate_usd": round(hours * price, 2) if hours is not None and price else None,
        })
    closed = round(sum(r.get("estimated_usd") or 0 for r in log if r.get("event") == "teardown"), 2)
    out = {"t": now, "balance": live, "spent_since_first_deploy": spent, "closed_runs_estimate_usd": closed, "up": up}
    if a.json:
        print(json.dumps(out, indent=2))
        return 0
    local = datetime.now(UTC).astimezone().strftime("%Y-%m-%d %H:%M %Z")
    up_text = ", ".join(f"{u['name']} on {u['gpu']} {u['status']} for {u['hours_up']} h (about {u['running_estimate_usd']} USD)" for u in up) or "nothing up"
    spent_text = f"{spent} {live['currency']} billed since the first deploy" if spent is not None else "no deploy recorded yet"
    print(f"{local}: balance {live['amount']} {live['currency']}; {spent_text}; closed runs about {closed} USD at list price; {up_text}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
