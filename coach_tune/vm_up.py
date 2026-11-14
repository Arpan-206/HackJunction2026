"""Start one Verda GPU VM for labelling, training and evaluation, after checking the balance floor.

    /Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python coach_tune/vm_up.py [--type 1A100.22V] [--hours 3]

Refuses when balance minus the planned hours at list price would fall under the 50 floor. Registers the lane's own
SSH key (~/.ssh/geppetto_coach_tune) once. Writes coach_tune/out/instance.json.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vm  # noqa: E402

KEY = Path.home() / ".ssh" / "geppetto_coach_tune"
KEY_NAME = "geppetto-coach-tune"
PREFERRED = ("1H200.141S.44V", "1H100.80S.30V", "1H100.80S.32V", "1A100.22V")
IMAGE = "24.04.cuda12.9.docker"
DISK_GB = 300
INSTANCE_FILE = vm.OUT / "instance.json"


def ensure_key(c) -> str:
    if not KEY.exists():
        subprocess.run(["ssh-keygen", "-t", "ed25519", "-N", "", "-C", KEY_NAME, "-f", str(KEY)], check=True, capture_output=True)
    pub = KEY.with_suffix(".pub").read_text().strip()
    for k in c.ssh_keys.get():
        if k.name == KEY_NAME:
            return k.id
    return c.ssh_keys.create(KEY_NAME, pub).id


def free_types(c) -> dict[str, str]:
    """Instance type -> first location where it is free on demand."""
    out: dict[str, str] = {}
    for loc in c.instances.get_availabilities(is_spot=False):
        for t in loc["availabilities"]:
            out.setdefault(t, loc["location_code"])
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default=None, help="instance type; default: the first free of " + ", ".join(PREFERRED))
    ap.add_argument("--hours", type=float, default=3.0, help="planned hours, for the floor check")
    ap.add_argument("--hostname", default="geppetto-coach-tune")
    a = ap.parse_args(argv)

    c = vm.client()
    bal = vm.balance(c)
    free = free_types(c)
    wanted = [a.type] if a.type else list(PREFERRED)
    pick = next((t for t in wanted if t in free), None)
    if pick is None:
        raise SystemExit(f"none of {wanted} is free now; free: {sorted(free)}")
    price = next(t.price_per_hour for t in c.instance_types.get() if t.instance_type == pick)
    planned = price * a.hours
    print(f"balance {bal['amount']} {bal['currency']}; {pick} in {free[pick]} at {price} USD/h; planned {planned:.2f} USD")
    if bal["amount"] is None or bal["amount"] - planned < vm.BALANCE_FLOOR:
        vm.log_cost("refused", type=pick, balance=bal, planned_usd=planned)
        raise SystemExit("refused: the planned spend would break the 50 floor")

    key_id = ensure_key(c)
    t0 = time.time()
    inst = c.instances.create(
        instance_type=pick,
        image=IMAGE,
        hostname=a.hostname,
        description="geppetto coach-tune: label, LoRA, eval",
        ssh_key_ids=[key_id],
        location=free[pick],
        os_volume={"name": "coach-tune-os", "size": DISK_GB},
        wait_for_status=lambda s: s in ("running", "error", "no_capacity"),
        max_wait_time=900,
    )
    info = {
        "id": inst.id,
        "type": pick,
        "location": free[pick],
        "ip": inst.ip,
        "status": inst.status,
        "price_usd_per_h": price,
        "created_at": vm.now_iso(),
        "boot_s": round(time.time() - t0),
        "os_volume_id": getattr(inst, "os_volume_id", None),
        "balance_before": bal,
    }
    vm.OUT.mkdir(parents=True, exist_ok=True)
    INSTANCE_FILE.write_text(json.dumps(info, indent=2) + "\n")
    vm.log_cost("vm_up", **{k: v for k, v in info.items() if k != "balance_before"}, balance=bal)
    print(json.dumps(info, indent=2))
    return 0 if inst.status == "running" else 1


if __name__ == "__main__":
    sys.exit(main())
