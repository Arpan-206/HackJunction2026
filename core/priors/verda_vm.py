"""Verda VM control for the expert-priors lane: balance, free types, up, down.

Run with the verda lane's venv (it has the verda SDK and python-dotenv):

    /Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python core/priors/verda_vm.py balance
    ... verda_vm.py types            # free CPU and small GPU types with prices
    ... verda_vm.py up --type CPU.4V.16G --hours 1
    ... verda_vm.py down             # delete every expert-priors VM and its OS volume

Secrets come from the main checkout's .env. They are loaded, never printed.
`up` refuses when the balance minus the planned spend would fall under the
50 floor, or when this lane's tally would pass its 40 USD cap.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

LANE_DIR = Path(__file__).resolve().parent
OUT = LANE_DIR / "out"
MAIN_CHECKOUT = Path("/Users/arpanpandey/Code/Junction/repo")
COST_LOG = OUT / "cost_log.jsonl"
INSTANCE_FILE = OUT / "instance.json"
BALANCE_FLOOR = 50.0
LANE_CAP_USD = 40.0
PREFIX = "geppetto-priors"
KEY = Path.home() / ".ssh" / "geppetto_priors"
KEY_NAME = "geppetto-priors"
IMAGE = "ubuntu-24.04"
DISK_GB = 120


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def secrets() -> dict[str, str]:
    from dotenv import dotenv_values

    path = Path(os.environ.get("GEPPETTO_ENV_FILE", MAIN_CHECKOUT / ".env"))
    return {k: v for k, v in dotenv_values(path).items() if v} if path.is_file() else {}


def client():
    from verda import VerdaClient

    s = secrets()
    if not s.get("VERDA_CLOUD_CLIENT_ID") or not s.get("VERDA_CLOUD"):
        raise SystemExit("missing VERDA_CLOUD_CLIENT_ID or VERDA_CLOUD in .env")
    return VerdaClient(s["VERDA_CLOUD_CLIENT_ID"], s["VERDA_CLOUD"])


def balance(c) -> dict[str, Any]:
    b = c.balance.get()
    return {"amount": getattr(b, "amount", None), "currency": getattr(b, "currency", None)}


def log_cost(event: str, **fields: Any) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with COST_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"t": now_iso(), "event": event, **fields}) + "\n")


def lane_spent() -> float:
    if not COST_LOG.exists():
        return 0.0
    rows = [json.loads(x) for x in COST_LOG.read_text().splitlines() if x.strip()]
    return round(sum(r.get("estimated_usd") or 0 for r in rows if r["event"] == "vm_down"), 2)


def free_types(c) -> dict[str, str]:
    out: dict[str, str] = {}
    for loc in c.instances.get_availabilities(is_spot=False):
        for t in loc["availabilities"]:
            out.setdefault(t, loc["location_code"])
    return out


def ensure_key(c) -> str:
    if not KEY.exists():
        subprocess.run(
            ["ssh-keygen", "-t", "ed25519", "-N", "", "-C", KEY_NAME, "-f", str(KEY)],
            check=True,
            capture_output=True,
        )
    pub = KEY.with_suffix(".pub").read_text().strip()
    for k in c.ssh_keys.get():
        if k.name == KEY_NAME:
            return k.id
    return c.ssh_keys.create(KEY_NAME, pub).id


def cmd_balance(c, a) -> int:
    bal = balance(c)
    running = [
        (i.hostname, i.instance_type, i.status)
        for i in c.instances.get()
        if i.status not in ("deleted", "discontinued")
    ]
    print(json.dumps({"balance": bal, "lane_spent_usd": lane_spent(), "instances": running}))
    return 0


def cmd_types(c, a) -> int:
    free = free_types(c)
    for t in c.instance_types.get():
        if t.instance_type in free:
            print(t.instance_type, t.price_per_hour, free[t.instance_type])
    return 0


def cmd_up(c, a) -> int:
    bal = balance(c)
    free = free_types(c)
    if a.type not in free:
        raise SystemExit(f"{a.type} is not free now; free: {sorted(free)}")
    price = next(t.price_per_hour for t in c.instance_types.get() if t.instance_type == a.type)
    planned = price * a.hours
    print(f"balance {bal['amount']} {bal['currency']}; {a.type} at {price} USD/h; planned {planned:.2f} USD")
    if bal["amount"] is None or bal["amount"] - planned < BALANCE_FLOOR:
        log_cost("refused", type=a.type, balance=bal, planned_usd=planned)
        raise SystemExit("refused: the planned spend would break the 50 floor")
    if lane_spent() + planned > LANE_CAP_USD:
        raise SystemExit("refused: the lane cap of 40 USD")
    key_id = ensure_key(c)
    t0 = time.time()
    inst = c.instances.create(
        instance_type=a.type,
        image=a.image,
        hostname=PREFIX,
        description="geppetto expert-priors: FurElise feature extraction",
        ssh_key_ids=[key_id],
        location=free[a.type],
        os_volume={"name": "priors-os", "size": a.disk},
        wait_for_status=lambda s: s in ("running", "error", "no_capacity"),
        max_wait_time=900,
    )
    info = {
        "id": inst.id,
        "type": a.type,
        "location": free[a.type],
        "ip": inst.ip,
        "status": inst.status,
        "price_usd_per_h": price,
        "created_at": now_iso(),
        "boot_s": round(time.time() - t0),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    INSTANCE_FILE.write_text(json.dumps(info, indent=2) + "\n")
    log_cost("vm_up", **info, balance=bal)
    print(json.dumps(info, indent=2))
    return 0 if inst.status == "running" else 1


def cmd_down(c, a) -> int:
    info = json.loads(INSTANCE_FILE.read_text()) if INSTANCE_FILE.exists() else {}
    gone = []
    for inst in c.instances.get():
        if not (inst.hostname or "").startswith(PREFIX):
            continue
        if inst.status in ("deleted", "discontinued"):
            continue
        vols = [v for v in [getattr(inst, "os_volume_id", None)] if v]
        c.instances.action(inst.id, "delete", volume_ids=vols or None, delete_permanently=bool(vols))
        gone.append(inst.id)
    hours = None
    if info.get("created_at"):
        start = datetime.fromisoformat(info["created_at"])
        hours = round((datetime.now(UTC) - start).total_seconds() / 3600, 3)
    est = round(hours * info["price_usd_per_h"], 2) if hours is not None and info.get("price_usd_per_h") else None
    bal = balance(c)
    if gone:
        log_cost("vm_down", deleted=gone, hours=hours, estimated_usd=est, balance=bal)
        if INSTANCE_FILE.exists():
            INSTANCE_FILE.unlink()
    left = [(i.hostname, i.status) for i in c.instances.get() if i.status not in ("deleted", "discontinued")]
    print(json.dumps({"deleted": gone, "hours": hours, "estimated_usd": est, "balance": bal, "instances_left": left}))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("balance")
    sub.add_parser("types")
    up = sub.add_parser("up")
    up.add_argument("--type", required=True)
    up.add_argument("--hours", type=float, default=1.0)
    up.add_argument("--image", default=IMAGE)
    up.add_argument("--disk", type=int, default=DISK_GB)
    sub.add_parser("down")
    a = ap.parse_args(argv)
    c = client()
    return {"balance": cmd_balance, "types": cmd_types, "up": cmd_up, "down": cmd_down}[a.cmd](c, a)


if __name__ == "__main__":
    sys.exit(main())
