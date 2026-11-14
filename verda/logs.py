"""Replica state and container logs of the Gemma deployment, for debugging a start that does not become healthy.

    uv run python logs.py [--name geppetto-gemma] [--lines 80]
"""

from __future__ import annotations

import argparse
import json
import sys

from verda import VerdaClient

import paths
from deploy import DEFAULT_NAME, ENDPOINT_FILE, raw_status

DEPLOYMENTS = "/container-deployments"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--name", default=None)
    ap.add_argument("--lines", type=int, default=80)
    a = ap.parse_args(argv)
    info = json.loads(ENDPOINT_FILE.read_text(encoding="utf-8")) if ENDPOINT_FILE.exists() else {}
    name = a.name or info.get("name") or DEFAULT_NAME
    secrets = paths.load_secrets()
    paths.require(secrets, "VERDA_CLOUD_CLIENT_ID", "VERDA_CLOUD")
    client = VerdaClient(secrets["VERDA_CLOUD_CLIENT_ID"], secrets["VERDA_CLOUD"])
    print("status:", raw_status(client, name))
    for r in client.containers.get_deployment_replicas(name):
        print("replica:", r)
    http = client.containers.client
    for kind in ("logs", "system-logs"):
        try:
            response = http.get(f"{DEPLOYMENTS}/{name}/{kind}")
        except Exception as exc:  # noqa: BLE001 - show whatever the API says
            print(f"{kind}: {type(exc).__name__}: {str(exc)[:300]}")
            continue
        text = response.text
        try:
            data = response.json()
            if isinstance(data, list):
                # The API returns the newest entry first; show them oldest to newest, compactly.
                entries = sorted((x for x in data if isinstance(x, dict)), key=lambda x: str(x.get("timestamp", "")))
                text = "\n".join(f"{x.get('timestamp', '')[11:19]} {x.get('message') or x.get('reason', '')}" for x in entries)
            elif isinstance(data, dict):
                text = json.dumps(data, indent=1)
        except ValueError:
            pass
        lines = text.splitlines()
        print(f"== {kind} ({len(lines)} lines, last {a.lines}) ==")
        print("\n".join(lines[-a.lines :]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
