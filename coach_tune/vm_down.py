"""Delete every coach-tune VM and its OS volume, record hours and cost, and show what is left on Verda.

    /Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python coach_tune/vm_down.py
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vm  # noqa: E402
from vm_up import INSTANCE_FILE  # noqa: E402

PREFIX = "geppetto-coach"


def main() -> int:
    c = vm.client()
    info = json.loads(INSTANCE_FILE.read_text()) if INSTANCE_FILE.exists() else {}
    gone = []
    for inst in c.instances.get():
        if not (inst.hostname or "").startswith(PREFIX) or inst.status in ("deleted", "discontinued"):
            continue
        vols = [v for v in [getattr(inst, "os_volume_id", None)] if v]
        c.instances.action(inst.id, "delete", volume_ids=vols or None, delete_permanently=bool(vols))
        gone.append(inst.id)
        print("deleted", inst.hostname, inst.instance_type)
    hours = None
    if info.get("created_at"):
        start = datetime.fromisoformat(info["created_at"])
        hours = round((datetime.now(UTC) - start).total_seconds() / 3600, 3)
    est = round(hours * info["price_usd_per_h"], 2) if hours is not None and info.get("price_usd_per_h") else None
    bal = vm.balance(c)
    vm.log_cost("vm_down", deleted=gone, hours=hours, estimated_usd=est, balance=bal)
    left = [(i.hostname, i.status) for i in c.instances.get() if i.status not in ("deleted", "discontinued")]
    print(json.dumps({"deleted": gone, "hours": hours, "estimated_usd": est, "balance": bal, "instances_left": left}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
