"""The Rokoko processes on this machine: which run, which ports answer, and the solver this backend may own."""

import contextlib
import logging
import os
import signal
import socket
import subprocess
import sys
from pathlib import Path

from app import constants as c
from app.services.rig.diagnosis import parse_tasklist_csv

log = logging.getLogger(__name__)
WINDOWS = sys.platform == "win32"


def port_open(
    host: str, port: int, timeout: float = c.ROKOKO_PORT_PROBE_TIMEOUT_S
) -> bool:
    """True when something accepts a TCP connection on host:port. The probe connects and closes at once."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def process_names() -> set[str]:
    """Lowercased image names of every running process; empty when they cannot be listed."""
    try:
        if WINDOWS:
            out = subprocess.run(
                ["tasklist", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                check=False,
            ).stdout
            return parse_tasklist_csv(out)
        out = subprocess.run(
            ["ps", "-A", "-o", "comm="],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        ).stdout
        return {
            Path(line.strip()).name.lower() for line in out.splitlines() if line.strip()
        }
    except (OSError, subprocess.SubprocessError) as exc:
        log.debug("cannot list processes: %s", exc)
        return set()


def sdk_bin(configured: Path | None) -> Path | None:
    """The SDK's bin folder (setting ROKOKO_SDK_DIR, else %LOCALAPPDATA%), or None when the solver is not there."""
    base = configured
    if base is None:
        local = os.environ.get("LOCALAPPDATA")
        base = Path(local) / c.ROKOKO_SDK_DIRNAME if local else None
    if base is None:
        return None
    candidates = (base / c.ROKOKO_SDK_BIN, base)
    return next((p for p in candidates if (p / c.ROKOKO_SOLVER_EXE).exists()), None)


def solver_command(bin_dir: Path, with_driver: bool) -> list[str]:
    """rkk-hand-solver with the OpenXR group; it starts the driver itself (USB auto-stream) unless one already runs."""
    cmd = [str(bin_dir / c.ROKOKO_SOLVER_EXE), *c.ROKOKO_SOLVER_ARGS]
    if not with_driver:
        return [*cmd, "--no-driver"]
    cmd += ["--driver-path", str(bin_dir / c.ROKOKO_DRIVER_EXE)]
    for arg in c.ROKOKO_DRIVER_ARGS:
        cmd += ["--driver-arg", arg]
    return cmd


class SolverSupervisor:
    """Starts rkk-hand-solver when the app needs it and stops only the one it started."""

    def __init__(self, log_path: Path) -> None:
        """Nothing runs until start()."""
        self.log_path = log_path
        self.process: subprocess.Popen[bytes] | None = None
        self.last_error: str | None = None

    @property
    def running(self) -> bool:
        """True while the solver this supervisor started is alive."""
        return self.process is not None and self.process.poll() is None

    def start(self, bin_dir: Path, with_driver: bool) -> None:
        """Spawn the solver with its output in the log file. Raises OSError when it cannot start."""
        if self.running:
            return
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = solver_command(bin_dir, with_driver)
        log.info("starting %s", " ".join(cmd))
        # Its own process group, sharing our console, so Ctrl+Break reaches the solver and not this backend. The log
        # starts empty each run so an old "Access is denied" never reads as current.
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if WINDOWS else 0
        with open(self.log_path, "wb") as out:
            try:
                self.process = subprocess.Popen(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=out,
                    stderr=subprocess.STDOUT,
                    creationflags=flags,
                )
                self.last_error = None
            except OSError as exc:
                self.last_error = f"cannot start the hand solver: {exc}"
                raise

    def stop(self) -> None:
        """Ask the solver to exit (Ctrl+Break on Windows, SIGTERM elsewhere) so the driver releases USB; then force it.

        A device left claimed by a killed driver needs a replug (Rokoko's hand_solver/driver.py), hence the polite
        signal first. The force step takes the whole process tree, so the driver child goes too.
        """
        proc = self.process
        self.process = None
        if proc is None or proc.poll() is not None:
            return
        with contextlib.suppress(OSError, ValueError):
            if WINDOWS:
                proc.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                proc.terminate()
        try:
            proc.wait(timeout=c.ROKOKO_STOP_TIMEOUT_S)
            return
        except subprocess.TimeoutExpired:
            pass
        if WINDOWS:
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                capture_output=True,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        else:
            proc.kill()
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=c.ROKOKO_STOP_TIMEOUT_S)

    def log_tail(self) -> list[str]:
        """The last lines the solver and its driver printed, for the busy and no-device fix steps."""
        try:
            with open(self.log_path, "rb") as handle:
                handle.seek(0, os.SEEK_END)
                size = handle.tell()
                handle.seek(max(0, size - c.ROKOKO_LOG_TAIL_BYTES))
                return (
                    handle.read()
                    .decode("utf-8", "replace")
                    .splitlines()[-c.ROKOKO_LOG_KEEP :]
                )
        except OSError:
            return []
