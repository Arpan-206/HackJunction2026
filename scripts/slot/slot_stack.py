"""Processes for the slot kit.

Real slot: the stack is scripts/live.sh (driver, solver, captures, core,
bridge, backend, frontend). This file only checks that it is up and offers to
start it.

Dry run: no gloves and no phone. It starts, on free ports, with logs in the run
folder:

  core     python -m core --fake (synthetic gloves), calibration dir in the run folder
  backend  uvicorn, GLOVE_SOURCE=external, DATA_DIR in the run folder, LLM fake
  bridge   python -m tools.ingest_bridge, core to backend (route B)
  depth    python -m ios.mac.fake_sender (fake phone)

and, only for step 4, a second core that is not fake, so the RCSP button and
LED path runs for real against fakes:

  solver   python -m tools.fake_rgmp_server
  driver   python -m tools.fake_rcsp_server (LED log, button control port)
  core-b   python -m core --solver ... --rcsp ...
"""

from __future__ import annotations

import os
import signal
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from slot_links import Trace, free_port, http, port_open


@dataclass
class Proc:
    name: str
    cmd: list[str]
    popen: subprocess.Popen
    log: Path

    def alive(self) -> bool:
        return self.popen.poll() is None

    def tail(self, n: int = 15) -> str:
        try:
            return "\n".join(self.log.read_text(errors="replace").splitlines()[-n:])
        except OSError:
            return ""


@dataclass
class Procs:
    run_dir: Path
    procs: list[Proc] = field(default_factory=list)

    def start(
        self,
        name: str,
        cmd: list[str],
        cwd: Path,
        env: dict | None = None,
        trace: Trace | None = None,
    ) -> Proc:
        log = self.run_dir / f"{name}.log"
        full_env = {**os.environ, **(env or {})}
        f = log.open("w")
        p = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            env=full_env,
            stdout=f,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        f.close()
        proc = Proc(name, cmd, p, log)
        self.procs.append(proc)
        envs = " ".join(f"{k}={v}" for k, v in (env or {}).items())
        if trace is not None:
            trace.add(
                "process",
                f"(cd {cwd} && {envs + ' ' if envs else ''}{' '.join(cmd)})",
                True,
                f"pid {p.pid}, log {log}",
            )
        return proc

    def wait_port(self, proc: Proc, port: int, seconds: float) -> None:
        end = time.time() + seconds
        while time.time() < end:
            if port_open(port):
                return
            if not proc.alive():
                raise RuntimeError(
                    f"{proc.name} exited early (code {proc.popen.returncode}); log tail:\n{proc.tail()}"
                )
            time.sleep(0.2)
        raise RuntimeError(
            f"{proc.name} did not open port {port} within {seconds:.0f} s; log tail:\n{proc.tail()}"
        )

    def stop(self, proc: Proc) -> None:
        if not proc.alive():
            return
        for sig, wait in (
            (signal.SIGINT, 5.0),
            (signal.SIGTERM, 3.0),
            (signal.SIGKILL, 1.0),
        ):
            try:
                os.killpg(proc.popen.pid, sig)
            except (ProcessLookupError, PermissionError):
                pass
            try:
                proc.popen.wait(timeout=wait)
                return
            except subprocess.TimeoutExpired:
                continue

    def stop_all(self) -> None:
        for p in reversed(self.procs):
            self.stop(p)
        self.procs.clear()


@dataclass
class Endpoints:
    core_port: int
    backend_url: str
    depth_host: str
    depth_port: int
    data_dir: Path
    core_b_port: int | None = None
    rcsp_control_port: int | None = None
    led_log: Path | None = None

    @property
    def core_http(self) -> str:
        return f"http://127.0.0.1:{self.core_port}"

    @property
    def core_ws(self) -> str:
        return f"ws://127.0.0.1:{self.core_port}/ws"

    @property
    def robot_ws(self) -> str:
        return f"ws://127.0.0.1:{self.core_port}/ws/robot"


class DryStack:
    def __init__(
        self,
        repo: Path,
        py: str,
        run_dir: Path,
        wearer: str,
        backend_dir: Path | None = None,
    ) -> None:
        self.repo = Path(repo)
        self.py = py
        self.run_dir = Path(run_dir)
        self.wearer = wearer
        self.backend_dir = Path(backend_dir) if backend_dir else self.repo / "backend"
        self.procs = Procs(self.run_dir)
        self.ep: Endpoints | None = None
        self._b_started = False

    def start(self, trace: Trace) -> Endpoints:
        data = self.run_dir / "backend-data"
        data.mkdir(parents=True, exist_ok=True)
        core_port, backend_port, depth_port = free_port(), free_port(), free_port()
        py = self.py
        core = self.procs.start(
            "core",
            [
                py,
                "-m",
                "core",
                "--fake",
                "--host",
                "127.0.0.1",
                "--port",
                str(core_port),
                "--wearer",
                self.wearer,
                "--calibration-dir",
                str(data),
            ],
            self.repo,
            trace=trace,
        )
        depth = self.procs.start(
            "depth-fake",
            [
                py,
                "-m",
                "ios.mac.fake_sender",
                "--host",
                "127.0.0.1",
                "--port",
                str(depth_port),
            ],
            self.repo,
            trace=trace,
        )
        backend = self.procs.start(
            "backend",
            [
                "uv",
                "run",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(backend_port),
            ],
            self.backend_dir,
            env={
                "GLOVE_SOURCE": "external",
                "GLOVE_AUTOSTART": "off",
                "GLOVE_MONITOR": "false",
                "GLOVE_DRIVER_TAP": "false",
                "LLM_PROVIDER": "fake",
                "DATA_DIR": str(data),
            },
            trace=trace,
        )
        self.procs.wait_port(core, core_port, 60)
        self.procs.wait_port(depth, depth_port, 30)
        self.procs.wait_port(backend, backend_port, 240)
        self.procs.start(
            "bridge",
            [
                py,
                "-m",
                "tools.ingest_bridge",
                "--core",
                f"ws://127.0.0.1:{core_port}/ws/gloves",
                "--backend",
                f"ws://127.0.0.1:{backend_port}/ws/ingest?activate=1",
            ],
            self.repo,
            trace=trace,
        )
        backend_url = f"http://127.0.0.1:{backend_port}"
        # the bridge switches the backend to the external source; wait until it reports it
        end = time.time() + 30
        health = None
        while time.time() < end:
            try:
                health = http("GET", f"{backend_url}/api/health", timeout=3)
                if health and health.get("glove_source") == "external":
                    break
            except Exception:
                pass
            time.sleep(0.5)
        trace.add("http", f"GET {backend_url}/api/health", bool(health), health)
        self.ep = Endpoints(core_port, backend_url, "127.0.0.1", depth_port, data)
        return self.ep

    def start_rcsp_core(self, trace: Trace) -> Endpoints:
        """Second, non-fake core for the button and LED: fake solver plus fake RCSP driver."""
        assert self.ep is not None
        if self._b_started:
            return self.ep
        solver_port, rcsp_port, control_port, core_b = (
            free_port(),
            free_port(),
            free_port(),
            free_port(),
        )
        led_log = self.run_dir / "leds.jsonl"
        py = self.py
        solver = self.procs.start(
            "solver-fake",
            [
                py,
                "-m",
                "tools.fake_rgmp_server",
                "--host",
                "127.0.0.1",
                "--port",
                str(solver_port),
            ],
            self.repo,
            trace=trace,
        )
        driver = self.procs.start(
            "driver-fake",
            [
                py,
                "-m",
                "tools.fake_rcsp_server",
                "--port",
                str(rcsp_port),
                "--control-port",
                str(control_port),
                "--led-log",
                str(led_log),
            ],
            self.repo,
            trace=trace,
        )
        self.procs.wait_port(solver, solver_port, 30)
        self.procs.wait_port(driver, control_port, 30)
        core = self.procs.start(
            "core-b",
            [
                py,
                "-m",
                "core",
                "--solver",
                f"127.0.0.1:{solver_port}",
                "--rcsp",
                f"127.0.0.1:{rcsp_port}",
                "--host",
                "127.0.0.1",
                "--port",
                str(core_b),
                "--no-calibration",
            ],
            self.repo,
            trace=trace,
        )
        self.procs.wait_port(core, core_b, 60)
        self.ep.core_b_port = core_b
        self.ep.rcsp_control_port = control_port
        self.ep.led_log = led_log
        self._b_started = True
        return self.ep

    def stop(self) -> None:
        self.procs.stop_all()


def live_stack_up(core_port: int, backend_url: str) -> dict:
    """What of the live stack answers: core /health and backend /api/health."""
    out: dict = {"core": None, "backend": None}
    try:
        out["core"] = http("GET", f"http://127.0.0.1:{core_port}/health", timeout=3)
    except Exception as e:
        out["core_error"] = str(e)
    try:
        out["backend"] = http("GET", f"{backend_url}/api/health", timeout=3)
    except Exception as e:
        out["backend_error"] = str(e)
    return out
