"""Read-only look at Verda: balance, running instances and containers, instance types with prices and availability.

    /Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python coach_tune/probe.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vm  # noqa: E402


def main() -> int:
    c = vm.client()
    print("balance", vm.balance(c))
    for i in c.instances.get():
        print("instance", i.id, i.hostname, i.instance_type, i.status, i.location)
    for d in c.containers.get_deployments():
        print("container", d.name, d.compute.name)
    avail = {}
    for loc in ("FIN-01", "FIN-02", "FIN-03", "ICE-01"):
        try:
            avail[loc] = set(c.instances.get_availabilities(is_spot=False, location_code=loc) or [])
        except Exception as e:  # noqa: BLE001
            print("availability", loc, type(e).__name__)
    if not avail:
        try:
            for a in c.instances.get_availabilities(is_spot=False):
                print("avail", a)
        except Exception as e:  # noqa: BLE001
            print("availability failed", e)
    for t in c.instance_types.get():
        name = t.instance_type
        if not any(k in name for k in ("H200", "H100", "L40S", "RTX", "A100", "B200", "6000")):
            continue
        where = [loc for loc, s in avail.items() if name in s]
        print(f"type {name:24s} {t.price_per_hour:>7} USD/h spot {getattr(t, 'spot_price_per_hour', None)} gpu_mem {getattr(t, 'gpu_memory', '')} free_in {where}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
