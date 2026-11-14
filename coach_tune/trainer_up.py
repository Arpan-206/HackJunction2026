"""Start the trainer container on Verda Serverless: the vLLM image running remote/ctl_server.py on the exposed port.

    /Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python coach_tune/trainer_up.py [--gpu H100] [--down]

The container serves untuned Gemma 4 E2B at boot (for the untuned evaluation), then takes the SFT data and
train_lora.py over HTTP, trains, merges, and serves the tuned model from the same GPU. `ctl.py` drives it.
Writes coach_tune/out/trainer.json and the cost log. `--down` deletes it and logs the minutes it ran.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import teacher_up
import vm

deploy = teacher_up.deploy
NAME = "coach-tune-trainer"
TRAINER_FILE = vm.OUT / "trainer.json"
START_BASE = "1"
SERVER = Path(__file__).resolve().parent / "remote" / "ctl_server.py"


def server_b64() -> str:
    """The control server, gzipped and base64 coded, for an env variable (each command argument is capped at 253)."""
    return base64.b64encode(gzip.compress(SERVER.read_bytes(), 9)).decode()


CHUNK = 250


def chunks() -> list[str]:
    """Verda caps every env value and command argument at 253 characters, so the payload travels in numbered parts."""
    b = server_b64()
    return [b[i : i + CHUNK] for i in range(0, len(b), CHUNK)]


def command() -> list[str]:
    n = len(chunks())
    return [
        "-c",
        f'mkdir -p /w && for i in $(seq -w 0 {n - 1:02d}); do v=CTL_B64_$i; printf %s "${{!v}}"; done '
        "| base64 -d | gunzip > /w/ctl_server.py && exec python3 /w/ctl_server.py",
    ]


def up(gpu: str) -> int:
    from verda.containers import EnvVar, EnvVarType

    c = teacher_up.client()
    bal = vm.balance(c)
    if (
        bal["amount"] is None
        or bal["amount"] - deploy.PRICE_USD_PER_H.get(gpu, 8.0) * 3 < vm.BALANCE_FLOOR
    ):
        raise SystemExit("refused: three hours of the trainer would break the 50 floor")
    if NAME not in {d.name for d in c.containers.get_deployments()}:
        free = {
            r.name
            for r in c.containers.get_compute_resources()
            if r.size == 1 and r.is_available
        }
        if gpu not in free:
            raise SystemExit(f"{gpu} not free on serverless; free: {sorted(free)}")
        env = (
            deploy.hf_env(c, vm.secrets())
            + [
                EnvVar(
                    name="CTL_START_BASE",
                    value_or_reference_to_secret=START_BASE,
                    type=EnvVarType.PLAIN,
                ),
            ]
            + [
                EnvVar(
                    name=f"CTL_B64_{i:02d}",
                    value_or_reference_to_secret=part,
                    type=EnvVarType.PLAIN,
                )
                for i, part in enumerate(chunks())
            ]
        )
        dep = deploy.build_deployment(NAME, "unused", gpu, env=env)
        dep.containers[0].entrypoint_overrides.entrypoint = ["bash"]
        dep.containers[0].entrypoint_overrides.cmd = command()
        dep.scaling.concurrent_requests_per_replica = 64
        c.containers.create_deployment(dep)
        info = {
            "name": NAME,
            "gpu": gpu,
            "price_usd_per_h": deploy.PRICE_USD_PER_H.get(gpu),
            "created_at": vm.now_iso(),
            "base_url": "https://containers.datacrunch.io/" + NAME,
            "image": deploy.DEFAULT_IMAGE,
            "balance_before": bal,
        }
        vm.OUT.mkdir(parents=True, exist_ok=True)
        TRAINER_FILE.write_text(json.dumps(info, indent=2) + "\n")
        vm.log_cost(
            "trainer_up",
            **{k: v for k, v in info.items() if k != "balance_before"},
            balance=bal,
        )
        print(f"created {NAME} on 1x {gpu} at {info['price_usd_per_h']} USD/h")
    deploy.wait_healthy(c, NAME)
    print("healthy")
    return 0


def down() -> int:
    c = teacher_up.client()
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
    info = json.loads(TRAINER_FILE.read_text()) if TRAINER_FILE.exists() else {}
    minutes = None
    if info.get("created_at"):
        minutes = round(
            (
                datetime.now(UTC) - datetime.fromisoformat(info["created_at"])
            ).total_seconds()
            / 60,
            1,
        )
    cost = round((info.get("price_usd_per_h") or 0) * (minutes or 0) / 60, 2)
    vm.log_cost(
        "trainer_down", name=NAME, minutes=minutes, cost_usd=cost, balance=vm.balance(c)
    )
    print(f"trainer ran {minutes} min, about {cost} USD")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--gpu", default="H100")
    ap.add_argument("--down", action="store_true")
    ap.add_argument(
        "--no-base", action="store_true", help="do not start the untuned server at boot"
    )
    a = ap.parse_args()
    if a.no_base:
        START_BASE = "0"
    sys.exit(down() if a.down else up(a.gpu))
