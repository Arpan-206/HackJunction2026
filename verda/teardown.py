"""Delete the Gemma deployment so credits stop burning, and record what the run cost.

    uv run python teardown.py [--name geppetto-gemma] [--delete-secret]

Appends a `teardown` record (hours up, estimated USD at the list price, live balance) to out/deploy_log.jsonl and
marks out/endpoint.json as torn down. Idempotent: a missing deployment is reported, not an error.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, datetime

import paths
from deploy import (
    ENDPOINT_FILE,
    HF_SECRET_NAME,
    PRICE_USD_PER_H,
    append_log,
    balance,
    now_iso,
)
from verda.exceptions import APIException

from verda import VerdaClient

GONE_POLL_S = 5
GONE_LIMIT_S = 180


def hours_between(start_iso: str | None, end_iso: str) -> float | None:
    if not start_iso:
        return None
    start = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    end = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
    if start.tzinfo is None:
        start = start.replace(tzinfo=UTC)
    return round((end - start).total_seconds() / 3600, 3)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--name",
        default=None,
        help="default: the name in out/endpoint.json, else geppetto-gemma",
    )
    ap.add_argument(
        "--delete-secret",
        action="store_true",
        help="also remove the HF_TOKEN secret from Verda",
    )
    a = ap.parse_args(argv)

    info = (
        json.loads(ENDPOINT_FILE.read_text(encoding="utf-8"))
        if ENDPOINT_FILE.exists()
        else {}
    )
    name = a.name or info.get("name") or "geppetto-gemma"
    secrets = paths.load_secrets()
    paths.require(secrets, "VERDA_CLOUD_CLIENT_ID", "VERDA_CLOUD")
    client = VerdaClient(secrets["VERDA_CLOUD_CLIENT_ID"], secrets["VERDA_CLOUD"])

    existing = {d.name: d for d in client.containers.get_deployments()}
    ended = now_iso()
    if name not in existing:
        print(f"no deployment named {name}; nothing to delete")
    else:
        dep = existing[name]
        started = dep.created_at or info.get("created_at")
        try:
            client.containers.delete_deployment(name)
        except APIException as exc:
            # A replica that is mid-restart can take longer than the API's 60 s wait; the deletion still proceeds.
            if "timeout" not in str(exc).lower():
                raise
            print(f"delete accepted, still finishing: {exc}", file=sys.stderr)
        t0 = time.monotonic()
        while name in {d.name for d in client.containers.get_deployments()}:
            if time.monotonic() - t0 > GONE_LIMIT_S:
                print(
                    f"still listed after {GONE_LIMIT_S} s; check the Verda console",
                    file=sys.stderr,
                )
                break
            time.sleep(GONE_POLL_S)
        hours = hours_between(started, ended)
        price = PRICE_USD_PER_H.get(dep.compute.name)
        cost = round(hours * price, 2) if hours is not None and price else None
        after = balance(client)
        record = {
            "event": "teardown",
            "t": ended,
            "name": name,
            "gpu": dep.compute.name,
            "started": started,
            "hours": hours,
            "price_usd_per_h": price,
            "estimated_usd": cost,
            "balance": after,
        }
        append_log(record)
        info.update(
            {
                "torn_down_at": ended,
                "hours": hours,
                "estimated_usd": cost,
                "balance_after": after,
            }
        )
        ENDPOINT_FILE.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(record, indent=2))
    if a.delete_secret and HF_SECRET_NAME in {
        s.name for s in client.containers.get_secrets()
    }:
        client.containers.delete_secret(HF_SECRET_NAME, force=True)
        print(f"secret {HF_SECRET_NAME} deleted")
    remaining = [d.name for d in client.containers.get_deployments()]
    print(f"deployments still up: {remaining or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
