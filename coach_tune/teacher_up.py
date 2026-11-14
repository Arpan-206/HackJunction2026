"""Serve the label teacher, Gemma 4 31B in bf16, on a Verda serverless container (one GPU), and wait until it answers.

    /Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python coach_tune/teacher_up.py [--gpu H100] [--down]

Used when no single large GPU VM is free. Reuses the verda lane's deployment code (verda/deploy.py) read-only, with a
text-only vLLM, a short context and more concurrent requests for batched labelling. Writes coach_tune/out/teacher.json
and the cost log; never touches verda/out/. `--down` deletes the deployment and logs the minutes it ran.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import vm

VERDA_LANE = vm.MAIN_CHECKOUT / "verda"
sys.path.insert(0, str(VERDA_LANE))
import deploy

NAME = "coach-tune-teacher"
MODEL = "google/gemma-4-31B-it"
MAX_MODEL_LEN = 4096
CONCURRENT = 64
TEACHER_FILE = vm.OUT / "teacher.json"


def args_text_only() -> list[str]:
    return [
        MODEL,
        "--port",
        str(deploy.PORT),
        "--max-model-len",
        str(MAX_MODEL_LEN),
        "--gpu-memory-utilization",
        "0.92",
        "--max-num-seqs",
        str(CONCURRENT),
        "--limit-mm-per-prompt",
        json.dumps({"image": 0, "audio": 0}),
        "--model-loader-extra-config",
        json.dumps({"enable_multithread_load": True}),
    ]


def client():
    from verda import VerdaClient

    s = vm.secrets()
    return VerdaClient(
        s["VERDA_CLOUD_CLIENT_ID"],
        s["VERDA_CLOUD"],
        inference_key=s["VERDA_INFERENCE_KEY"],
    )


def up(gpu: str) -> int:
    c = client()
    bal = vm.balance(c)
    if (
        bal["amount"] is None
        or bal["amount"] - deploy.PRICE_USD_PER_H.get(gpu, 8.0) * 2 < vm.BALANCE_FLOOR
    ):
        raise SystemExit("refused: two hours of the teacher would break the 50 floor")
    existing = {d.name for d in c.containers.get_deployments()}
    if NAME not in existing:
        free = {
            r.name
            for r in c.containers.get_compute_resources()
            if r.size == 1 and r.is_available
        }
        if gpu not in free:
            raise SystemExit(f"{gpu} not free on serverless; free: {sorted(free)}")
        dep = deploy.build_deployment(
            NAME, MODEL, gpu, env=deploy.hf_env(c, vm.secrets())
        )
        dep.containers[0].entrypoint_overrides.cmd = args_text_only()
        dep.scaling.concurrent_requests_per_replica = CONCURRENT
        c.containers.create_deployment(dep)
        info = {
            "name": NAME,
            "model": MODEL,
            "precision": "bf16",
            "gpu": gpu,
            "price_usd_per_h": deploy.PRICE_USD_PER_H.get(gpu),
            "created_at": vm.now_iso(),
            "base_url": "https://containers.datacrunch.io/" + NAME,
            "balance_before": bal,
        }
        vm.OUT.mkdir(parents=True, exist_ok=True)
        TEACHER_FILE.write_text(json.dumps(info, indent=2) + "\n")
        vm.log_cost(
            "teacher_up",
            **{k: v for k, v in info.items() if k != "balance_before"},
            balance=bal,
        )
        print(f"created {NAME} on 1x {gpu} at {info['price_usd_per_h']} USD/h")
    info = json.loads(TEACHER_FILE.read_text())
    t0 = time.monotonic()
    deploy.wait_healthy(c, NAME)
    info["healthy_at"] = vm.now_iso()
    info["smoke"] = deploy.smoke(
        info["base_url"], vm.secrets()["VERDA_INFERENCE_KEY"], MODEL
    )
    info["waited_s"] = round(time.monotonic() - t0)
    TEACHER_FILE.write_text(json.dumps(info, indent=2) + "\n")
    print(
        json.dumps(
            {k: info[k] for k in ("base_url", "gpu", "healthy_at", "smoke")}, indent=2
        )
    )
    return 0


def down() -> int:
    c = client()
    if NAME in {d.name for d in c.containers.get_deployments()}:
        try:
            c.containers.delete_deployment(NAME)
        except Exception as e:  # noqa: BLE001 - the API often times out at 60 s while the delete goes on
            print(
                f"delete call returned {e!s:.120}; the delete continues on Verda, check with status"
            )
        for _ in range(60):
            if NAME not in {d.name for d in c.containers.get_deployments()}:
                break
            time.sleep(10)
        print(f"deleted {NAME}")
    else:
        print(f"no deployment {NAME}")
    info = json.loads(TEACHER_FILE.read_text()) if TEACHER_FILE.exists() else {}
    minutes = None
    if info.get("created_at"):
        start = datetime.fromisoformat(info["created_at"])
        minutes = round((datetime.now(UTC) - start).total_seconds() / 60, 1)
    cost = round((info.get("price_usd_per_h") or 0) * (minutes or 0) / 60, 2)
    vm.log_cost(
        "teacher_down", name=NAME, minutes=minutes, cost_usd=cost, balance=vm.balance(c)
    )
    print(f"teacher ran {minutes} min, about {cost} USD")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--gpu", default="H100")
    ap.add_argument("--down", action="store_true")
    a = ap.parse_args()
    sys.exit(down() if a.down else up(a.gpu))
