"""Run the training and the evaluation on one Verda GPU (a Serverless Container named `robot-policy`).

    PY=/Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python
    $PY robot_policy/verda_ctl.py up [--gpu H100]   # start the container, wait until healthy
    $PY robot_policy/verda_ctl.py upload            # the code and the exported takes
    $PY robot_policy/verda_ctl.py run job.sh        # run /w/job.sh in the background
    $PY robot_policy/verda_ctl.py status            # phase, GPU, last log lines
    $PY robot_policy/verda_ctl.py fetch             # /w/rp back to robot_policy/out/verda/rp
    $PY robot_policy/verda_ctl.py down              # delete the container, log minutes and cost

Verda starts no GPU instance on the coupon balance, so the job runs in a Serverless Container, as coach_tune does.
This file reuses coach_tune's deployment helpers and its control server (coach_tune/remote/ctl_server.py) read-only,
with its own deployment name. It never touches the deployments of other lanes. No secret is printed.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import tarfile
import time
from datetime import UTC, datetime
from pathlib import Path

LANE = Path(__file__).resolve().parent
REPO = LANE.parent
sys.path.insert(0, str(REPO / "coach_tune"))
import oai
import teacher_up
import trainer_up
import vm

deploy = teacher_up.deploy
NAME = "robot-policy"
URL = "https://containers.datacrunch.io/" + NAME
OUT = LANE / "out"
INFO = OUT / "verda.json"
COST_LOG = OUT / "cost_log.jsonl"
MAX_HOURS = 3.0


def log_cost(event: str, **fields) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with COST_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"t": vm.now_iso(), "event": event, **fields}) + "\n")


def http():
    import httpx

    return httpx.Client(base_url=URL, headers=oai.headers(URL), timeout=600)


def up(gpu: str) -> int:
    from verda.containers import EnvVar, EnvVarType

    c = teacher_up.client()
    bal = vm.balance(c)
    price = deploy.PRICE_USD_PER_H.get(gpu, 8.0)
    if bal["amount"] is None or bal["amount"] - price * MAX_HOURS < vm.BALANCE_FLOOR:
        raise SystemExit(
            f"refused: {MAX_HOURS} hours on {gpu} would break the 50 floor"
        )
    if NAME not in {d.name for d in c.containers.get_deployments()}:
        free = {
            r.name
            for r in c.containers.get_compute_resources()
            if r.size == 1 and r.is_available
        }
        if gpu not in free:
            raise SystemExit(f"{gpu} not free on serverless; free: {sorted(free)}")
        trainer_up.START_BASE = "0"
        env = [
            EnvVar(
                name="CTL_START_BASE",
                value_or_reference_to_secret="0",
                type=EnvVarType.PLAIN,
            )
        ] + [
            EnvVar(
                name=f"CTL_B64_{i:02d}",
                value_or_reference_to_secret=part,
                type=EnvVarType.PLAIN,
            )
            for i, part in enumerate(trainer_up.chunks())
        ]
        dep = deploy.build_deployment(NAME, "unused", gpu, env=env)
        dep.containers[0].entrypoint_overrides.entrypoint = ["bash"]
        dep.containers[0].entrypoint_overrides.cmd = trainer_up.command()
        c.containers.create_deployment(dep)
        info = {
            "name": NAME,
            "gpu": gpu,
            "price_usd_per_h": price,
            "created_at": vm.now_iso(),
            "base_url": URL,
            "image": deploy.DEFAULT_IMAGE,
        }
        OUT.mkdir(parents=True, exist_ok=True)
        INFO.write_text(json.dumps(info, indent=2) + "\n")
        log_cost("up", **info, balance=bal)
        print(f"created {NAME} on 1x {gpu} at {price} USD/h", flush=True)
    deploy.wait_healthy(c, NAME)
    print("healthy")
    return 0


def down() -> int:
    c = teacher_up.client()
    if NAME in {d.name for d in c.containers.get_deployments()}:
        try:
            c.containers.delete_deployment(NAME)
        except Exception as e:  # noqa: BLE001 - the delete call often times out while the delete goes on
            print(f"delete call returned {e!s:.120}; the delete continues on Verda")
        for _ in range(60):
            if NAME not in {d.name for d in c.containers.get_deployments()}:
                break
            time.sleep(10)
    gone = NAME not in {d.name for d in c.containers.get_deployments()}
    info = json.loads(INFO.read_text()) if INFO.exists() else {}
    minutes = None
    if info.get("created_at") and not info.get("down_at"):
        minutes = round(
            (
                datetime.now(UTC) - datetime.fromisoformat(info["created_at"])
            ).total_seconds()
            / 60,
            1,
        )
        cost = round((info.get("price_usd_per_h") or 0) * minutes / 60, 2)
        info.update(down_at=vm.now_iso(), minutes=minutes, cost_usd=cost)
        INFO.write_text(json.dumps(info, indent=2) + "\n")
        log_cost(
            "down",
            name=NAME,
            minutes=minutes,
            cost_usd=cost,
            gone=gone,
            balance=vm.balance(c),
        )
        print(f"{NAME} ran {minutes} min, about {cost} USD")
    print(
        f"{NAME} gone: {gone}; deployments now: {sorted(d.name for d in c.containers.get_deployments())}"
    )
    return 0 if gone else 1


def upload() -> int:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        for f in ("common.py", "run.py", "mujoco_check.py"):
            t.add(LANE / f, arcname=f"rp/{f}")
        urdf = "models/robots/dex3_1/dex3_1_r.urdf"  # for the MuJoCo check, which also runs on the container's CPU
        t.add(REPO / urdf, arcname=urdf)
        for f in ("takes.npz", "retarget.json"):
            t.add(OUT / "data" / f, arcname=f"rp/out/data/{f}")
        for f in (
            "policy.pt",
            "policy_laptop.pt",
        ):  # for the jobs that only evaluate (mj.sh, eval_laptop.sh)
            if (OUT / f).is_file():
                t.add(OUT / f, arcname=f"rp/out/{f}")
        for f in sorted((LANE / "remote").glob("*.sh")):
            t.add(f, arcname=f.name)
    with http() as c:
        print(
            f"{len(buf.getvalue()) / 1e6:.2f} MB",
            c.post("/ctl/upload", content=buf.getvalue()).json(),
        )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["up", "down", "upload", "run", "status", "fetch"])
    ap.add_argument("what", nargs="?", default="")
    ap.add_argument("--gpu", default="H100")
    a = ap.parse_args()
    if a.cmd == "up":
        return up(a.gpu)
    if a.cmd == "down":
        return down()
    if a.cmd == "upload":
        return upload()
    with http() as c:
        if a.cmd == "run":
            print(c.post("/ctl/exec", params={"script": a.what or "job.sh"}).json())
        elif a.cmd == "status":
            s = c.get("/ctl/status").json()
            print(json.dumps({k: s[k] for k in ("phase", "train_rc", "gpu")}))
            print("\n".join(s.get("train_log", [])))
        elif a.cmd == "fetch":
            r = c.get("/ctl/fetch", params={"dir": a.what or "rp"})
            r.raise_for_status()
            dest = OUT / "verda"
            dest.mkdir(parents=True, exist_ok=True)
            with tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz") as t:
                t.extractall(dest, filter="data")
            print(f"{len(r.content) / 1e6:.2f} MB into {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
