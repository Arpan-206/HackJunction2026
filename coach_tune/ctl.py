"""Drive the trainer container (remote/ctl_server.py) through the Verda gateway.

    PY=/Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python
    $PY coach_tune/ctl.py status
    $PY coach_tune/ctl.py upload            # train_lora.py and out/sft/ (train.jsonl, val.jsonl)
    $PY coach_tune/ctl.py train [--args "--max-steps 20 --no-merge"]
    $PY coach_tune/ctl.py serve base|tuned
    $PY coach_tune/ctl.py fetch adapter     # to out/adapter/
    $PY coach_tune/ctl.py wait-vllm         # until /v1/models answers
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import tarfile
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
import oai  # noqa: E402
import vm  # noqa: E402

URL = "https://containers.datacrunch.io/coach-tune-trainer"


def client() -> httpx.Client:
    return httpx.Client(base_url=URL, headers=oai.headers(URL), timeout=600)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["status", "upload", "train", "exec", "serve", "fetch", "wait-vllm"])
    ap.add_argument("what", nargs="?", default="")
    ap.add_argument("--args", default="")
    a = ap.parse_args()
    with client() as c:
        if a.cmd == "status":
            print(json.dumps(c.get("/ctl/status").json(), indent=2))
        elif a.cmd == "upload":
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w:gz") as t:
                t.add(vm.LANE / "train_lora.py", arcname="train_lora.py")
                t.add(vm.OUT / "sft", arcname="sft")
            print(c.post("/ctl/upload", content=buf.getvalue()).json())
        elif a.cmd == "train":
            print(c.post("/ctl/train", params={"args": a.args}).json())
        elif a.cmd == "exec":
            print(c.post("/ctl/exec", params={"script": a.what}).json())
        elif a.cmd == "serve":
            print(c.post("/ctl/serve", params={"which": a.what or "base"}).json())
        elif a.cmd == "fetch":
            r = c.get("/ctl/fetch", params={"dir": a.what or "adapter"})
            r.raise_for_status()
            dest = vm.OUT
            with tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz") as t:
                t.extractall(dest, filter="data")
            print(f"{len(r.content) / 1e6:.1f} MB into {dest / (a.what or 'adapter')}")
        elif a.cmd == "wait-vllm":
            t0 = time.time()
            while time.time() - t0 < 1200:
                r = c.get("/v1/models")
                if r.status_code == 200 and r.json().get("data"):
                    print(f"vllm up after {time.time() - t0:.0f} s: {r.json()['data'][0]['id']}")
                    return 0
                time.sleep(10)
            print("vllm not up after 20 min", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
