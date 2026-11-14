"""Control server INSIDE the coach-tune trainer container on Verda Serverless (VMs are refused on the coupon balance).

Listens on the container's exposed port. The Verda gateway in front of it checks the inference key.
  GET  /health                      200 while this server runs
  GET  /ctl/status                  phase, vLLM state, GPU memory, last log lines
  POST /ctl/upload?name=X.tgz       body is a tar.gz, unpacked into /w
  POST /ctl/serve?which=base|tuned  (re)start vLLM on :8001 with Gemma 4 E2B, untuned or merged
  POST /ctl/train?args=...          stop vLLM, install peft, run /w/train_lora.py in the background
  POST /ctl/exec?script=X.sh        stop vLLM, run bash /w/X.sh in the background, log /w/X.log
  GET  /ctl/fetch?dir=adapter       the directory /w/<dir> as tar.gz
  *    /v1/...                      proxied to vLLM on :8001
Standard library only.
"""

from __future__ import annotations

import io
import json
import os
import shlex
import subprocess
import tarfile
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

W = "/w"
PORT = int(os.environ.get("CTL_PORT", "8000"))
BASE = "google/gemma-4-E2B-it"
STATE = {"phase": "idle", "vllm": None, "train_rc": None}
PROCS: dict[str, subprocess.Popen] = {}
LOCK = threading.Lock()


def tail(path: str, n: int = 30) -> list[str]:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read().splitlines()[-n:]
    except OSError:
        return []


def gpu() -> str:
    try:
        return subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.used", "--format=csv,noheader"],
                              capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception as e:  # noqa: BLE001
        return f"nvidia-smi failed: {e}"


def stop_vllm() -> None:
    p = PROCS.pop("vllm", None)
    if p and p.poll() is None:
        p.terminate()
        try:
            p.wait(60)
        except subprocess.TimeoutExpired:
            p.kill()
    STATE["vllm"] = None


def start_vllm(which: str) -> None:
    stop_vllm()
    model, name = (BASE, BASE) if which == "base" else (f"{W}/merged", "geppetto-coach-e2b")
    cmd = ["vllm", "serve", model, "--served-model-name", name, "--port", "8001", "--max-model-len", "2048",
           "--gpu-memory-utilization", "0.85", "--limit-mm-per-prompt", json.dumps({"image": 0, "audio": 0})]
    log = open(f"{W}/vllm_{which}.log", "w")
    PROCS["vllm"] = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
    STATE["vllm"] = which


def train(args: str) -> None:
    with LOCK:
        STATE["phase"] = "training"
        STATE["train_rc"] = None
    stop_vllm()
    script = (f"pip install -q 'peft>=0.17' 'accelerate>=1.0' && python3 {W}/train_lora.py --data {W}/sft "
              f"--out {W}/adapter --merged {W}/merged {args}")
    with open(f"{W}/train.log", "w") as log:
        rc = subprocess.run(["bash", "-c", script], stdout=log, stderr=subprocess.STDOUT).returncode
    with LOCK:
        STATE["phase"] = "trained" if rc == 0 else "train_failed"
        STATE["train_rc"] = rc


def run_script(name: str) -> None:
    with LOCK:
        STATE["phase"] = f"exec:{name}"
        STATE["train_rc"] = None
    stop_vllm()
    with open(f"{W}/{name}.log", "w") as log:
        rc = subprocess.run(["bash", f"{W}/{name}"], stdout=log, stderr=subprocess.STDOUT, cwd=W).returncode
    with LOCK:
        STATE["phase"] = f"done:{name}" if rc == 0 else f"failed:{name}"
        STATE["train_rc"] = rc


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # quiet
        pass

    def send(self, code: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def js(self, obj, code: int = 200) -> None:
        self.send(code, json.dumps(obj).encode())

    def body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def proxy(self, method: str) -> None:
        data = self.body() if method == "POST" else None
        req = urllib.request.Request("http://127.0.0.1:8001" + self.path, data=data, method=method,
                                     headers={"Content-Type": self.headers.get("Content-Type", "application/json")})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                self.send(r.status, r.read(), r.headers.get("Content-Type", "application/json"))
        except urllib.error.HTTPError as e:
            self.send(e.code, e.read())
        except Exception as e:  # noqa: BLE001
            self.js({"error": f"vllm not reachable: {e}"}, 503)

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/health":
            return self.js({"ok": True})
        if u.path == "/ctl/status":
            v = STATE["vllm"]
            ph = STATE["phase"]
            log = f"{W}/{ph.split(':', 1)[1]}.log" if ":" in ph else f"{W}/train.log"
            return self.js({**STATE, "gpu": gpu(), "train_log": tail(log),
                            "vllm_log": tail(f"{W}/vllm_{v}.log", 15) if v else []})
        if u.path == "/ctl/fetch":
            d = os.path.join(W, os.path.basename(q.get("dir", ["adapter"])[0]))
            if not os.path.isdir(d):
                return self.js({"error": f"no {d}"}, 404)
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w:gz") as t:
                t.add(d, arcname=os.path.basename(d))
            return self.send(200, buf.getvalue(), "application/gzip")
        if u.path.startswith("/v1/"):
            return self.proxy("GET")
        self.js({"error": "not found"}, 404)

    def do_POST(self):  # noqa: N802
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/ctl/upload":
            with tarfile.open(fileobj=io.BytesIO(self.body()), mode="r:gz") as t:
                t.extractall(W, filter="data")
            return self.js({"ok": True, "files": sorted(os.listdir(W))})
        if u.path == "/ctl/serve":
            self.body()
            start_vllm(q.get("which", ["base"])[0])
            return self.js({"ok": True, "vllm": STATE["vllm"]})
        if u.path == "/ctl/train":
            self.body()
            if STATE["phase"] == "training":
                return self.js({"error": "already training"}, 409)
            args = " ".join(shlex.quote(x) for x in shlex.split(q.get("args", [""])[0]))
            threading.Thread(target=train, args=(args,), daemon=True).start()
            return self.js({"ok": True, "phase": "training"})
        if u.path == "/ctl/exec":
            self.body()
            name = os.path.basename(q.get("script", [""])[0])
            if not name or not os.path.isfile(f"{W}/{name}"):
                return self.js({"error": f"no /w/{name}"}, 404)
            if STATE["phase"] == "training" or STATE["phase"].startswith("exec:"):
                return self.js({"error": "busy"}, 409)
            threading.Thread(target=run_script, args=(name,), daemon=True).start()
            return self.js({"ok": True, "phase": f"exec:{name}"})
        if u.path.startswith("/v1/"):
            return self.proxy("POST")
        self.js({"error": "not found"}, 404)


if __name__ == "__main__":
    os.makedirs(W, exist_ok=True)
    if os.environ.get("CTL_START_BASE") == "1":
        start_vllm("base")
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
