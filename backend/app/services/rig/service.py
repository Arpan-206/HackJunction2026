"""The glove status the app shows on start: processes, ports, the driver's devices, frame rates and fix steps."""

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

from app import constants as c
from app.core.config import Settings
from app.core.errors import ConflictError, ServiceUnavailableError
from app.core.utils import utc_now_iso
from app.schemas.common import Side
from app.schemas.rig import DriverState, GloveDeviceStatus, GloveRigStatus
from app.services.gloves.manager import GloveManager
from app.services.rig import processes
from app.services.rig.diagnosis import (
    RigSnapshot,
    connection_name,
    diagnose,
    is_ready,
    sensor_statuses,
)
from app.services.rig.monitor import DriverMonitor, DriverTap, FrameStats

log = logging.getLogger(__name__)


@dataclass
class _Probe:
    """One cached look at processes and ports."""

    at: float
    names: set[str]
    driver_port: bool
    solver_port: bool


def heading_share(samples: list[bool]) -> float | None:
    """Share of the samples with a reliable heading, or None without samples."""
    return sum(samples) / len(samples) if samples else None


class GloveRigService:
    """Answers GET /gloves/status and starts or stops the solver this backend owns."""

    def __init__(self, settings: Settings, gloves: GloveManager) -> None:
        """Wire the watchers; nothing connects until start()."""
        self.settings = settings
        self.gloves = gloves
        self.stats = FrameStats()
        gloves.add_sink(self.stats.push)
        # Swappable in tests, so nothing probes real ports or processes there.
        self.port_open: Callable[[str, int], bool] = processes.port_open
        self.process_names: Callable[[], set[str]] = processes.process_names
        self.monitor = DriverMonitor()
        self.tap = DriverTap(lambda h, p: self.port_open(h, p))
        self.supervisor = processes.SolverSupervisor(
            settings.data_dir / "logs" / c.ROKOKO_SOLVER_LOG
        )
        self._probe: _Probe | None = None
        self._started = False

    @property
    def autostart(self) -> bool:
        """Whether the app starts the solver itself (GLOVE_AUTOSTART; 'auto' means only on the real-glove source)."""
        mode = self.settings.glove_autostart
        return mode == "on" or (
            mode == "auto" and self.settings.glove_source == "external"
        )

    async def start(self) -> None:
        """Start the watchers, then the solver when autostart asks for it and nothing serves the solver port."""
        if not self.settings.glove_monitor:
            return
        self._started = True
        await self.monitor.start()
        if self.settings.glove_driver_tap:
            await self.tap.start()
        if self.autostart:
            try:
                await self.ensure_running()
            except Exception as exc:
                log.warning("could not start the gloves: %s", exc)

    async def stop(self) -> None:
        """Stop the watchers and the solver if this backend started it."""
        if self._started:
            await self.tap.stop()
            await self.monitor.stop()
        await asyncio.to_thread(self.supervisor.stop)

    def _look(self, fresh: bool = False) -> _Probe:
        """Processes and ports, cached for a moment so a polling screen stays cheap."""
        now = time.monotonic()
        if (
            fresh
            or self._probe is None
            or now - self._probe.at > c.ROKOKO_PROCESS_CACHE_S
        ):
            self._probe = _Probe(
                at=now,
                names=self.process_names(),
                driver_port=self.port_open(
                    c.ROKOKO_DRIVER_HOST, c.ROKOKO_DRIVER_RGMP_PORT
                ),
                solver_port=self.port_open(
                    c.ROKOKO_DRIVER_HOST, c.ROKOKO_SOLVER_RGMP_PORT
                ),
            )
        return self._probe

    async def ensure_running(self) -> None:
        """Reuse a running driver and solver; start the solver (with its own driver only if none runs) otherwise."""
        probe = await asyncio.to_thread(self._look, True)
        if c.ROKOKO_STUDIO_PROCESS.lower() in probe.names:
            raise ConflictError(
                "Rokoko Studio is open and holds the gloves. Close Studio first."
            )
        if probe.solver_port:
            return
        bin_dir = processes.sdk_bin(self.settings.rokoko_sdk_dir)
        if bin_dir is None:
            raise ServiceUnavailableError(
                "The Rokoko Device SDK was not found. Set ROKOKO_SDK_DIR to its folder."
            )
        driver_up = probe.driver_port or c.ROKOKO_DRIVER_EXE.lower() in probe.names
        await asyncio.to_thread(self.supervisor.start, bin_dir, not driver_up)
        self._probe = None

    async def stop_managed(self) -> None:
        """Stop the solver (and the driver it started) if this backend started them."""
        await asyncio.to_thread(self.supervisor.stop)
        self._probe = None

    async def reinit(self) -> int:
        """RCSP ReinitAlgo on every glove the driver lists."""
        return await self.monitor.reinit()

    def heading_reliable(self, side: Side) -> bool | None:
        """The newest is_heading_reliable for a hand from the tap, or None when unknown."""
        dev = self.tap.by_side(side)
        return dev.heading if dev else None

    def _glove(self, side: Side, now: float) -> GloveDeviceStatus:
        """Merge the RCSP device, the tap and the app's own frame meter for one hand."""
        rcsp = next((d for d in self.monitor.gloves() if d.side == side), None)
        tap = self.tap.by_side(side)
        meter = self.stats.meters[side]
        # Simulator frames say nothing about the gloves, so they never count as glove frames.
        hardware = self.gloves.source_name != "simulator"
        fps = meter.fps(now) if hardware else None
        age = meter.age_s(now) if hardware else None
        streaming = tap.streaming() if tap else None
        driver_fps = tap.meter.fps() if tap and streaming else None
        share = (
            heading_share(list(tap.heading_samples)[-c.GLOVE_HEADING_WINDOW_FRAMES :])
            if tap
            else None
        )
        battery = (
            rcsp.battery_pct
            if rcsp and rcsp.battery_pct is not None
            else (tap.battery_pct if tap else None)
        )
        return GloveDeviceStatus(
            side=side,
            connected=rcsp is not None or tap is not None,
            device_id=rcsp.device_id if rcsp else (tap.device_id if tap else None),
            connection=connection_name(rcsp.connection) if rcsp else None,
            fps=fps,
            driver_fps=driver_fps,
            streaming=streaming,
            last_frame_age_ms=round(age * 1000, 1) if age is not None else None,
            battery_pct=battery,
            heading_reliable=None if share is None else share >= c.QUALITY_HEADING_FAIR,
            sensors=sensor_statuses(
                tap.saturation() if tap else {},
                self.monitor.recent_saturation(rcsp.device_id) if rcsp else [],
            ),
        )

    async def status(self) -> GloveRigStatus:
        """The full status with its fix steps."""
        probe = await asyncio.to_thread(self._look)
        now = time.monotonic()
        gloves = [self._glove(side, now) for side in ("left", "right")]
        studio = c.ROKOKO_STUDIO_PROCESS.lower() in probe.names
        driver_process = c.ROKOKO_DRIVER_EXE.lower() in probe.names
        sdk_found = processes.sdk_bin(self.settings.rokoko_sdk_dir) is not None
        driver = DriverState(
            driver_running=probe.driver_port or driver_process,
            driver_port_open=probe.driver_port,
            solver_running=probe.solver_port
            or c.ROKOKO_SOLVER_EXE.lower() in probe.names,
            solver_port_open=probe.solver_port,
            rcsp_connected=self.monitor.connected,
            studio_running=studio,
            managed=self.supervisor.running,
            autostart=self.autostart,
            sdk_found=sdk_found,
            last_error=self.supervisor.last_error,
        )
        snapshot = RigSnapshot(
            source=self.gloves.source_name,
            studio_running=studio,
            driver_port_open=probe.driver_port,
            driver_process=driver_process,
            solver_port_open=probe.solver_port,
            rcsp_connected=self.monitor.connected,
            can_start=sdk_found and not studio,
            gloves=gloves,
            driver_lines=[*self.supervisor.log_tail(), *self.monitor.log_lines],
        )
        issues = diagnose(snapshot)
        return GloveRigStatus(
            checked_at=utc_now_iso(),
            source=self.gloves.source_name,
            ready=is_ready(gloves, issues),
            driver=driver,
            gloves=gloves,
            issues=issues,
        )
