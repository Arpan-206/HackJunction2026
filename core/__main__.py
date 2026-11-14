"""python -m core [--fake | --replay FILE] [--config config.toml]"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import uvicorn

from .config import load_config
from .server import Core, create_app


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m core", description="Geppetto core service"
    )
    ap.add_argument(
        "--config", default=None, help="path to config.toml (default: repo config.toml)"
    )
    ap.add_argument(
        "--fake",
        action="store_true",
        help="synthetic gloves and a synthetic lesson; no hardware",
    )
    ap.add_argument(
        "--replay",
        metavar="FILE",
        help="replay a raw RGMP capture instead of connecting to the solver",
    )
    ap.add_argument("--replay-loop", action="store_true", help="loop the replay file")
    ap.add_argument(
        "--capture",
        metavar="FILE",
        help="write the raw RGMP bytes received to this file (for --replay later)",
    )
    ap.add_argument(
        "--no-rcsp",
        action="store_true",
        help="do not connect to the Rokoko driver for button and LED",
    )
    ap.add_argument(
        "--camera",
        action="store_true",
        help="feed both hands from the MediaPipe camera source",
    )
    ap.add_argument(
        "--video",
        metavar="FILE",
        help="camera source reads this video file instead of the webcam",
    )
    ap.add_argument(
        "--solver",
        metavar="HOST:PORT",
        help="hand solver RGMP address (default from config.toml [glove])",
    )
    ap.add_argument(
        "--rcsp",
        metavar="HOST:PORT",
        help="Rokoko driver RCSP address (default from config.toml [glove])",
    )
    ap.add_argument("--host", default=None)
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument(
        "--no-validate",
        action="store_true",
        help="skip JSON Schema checks on emitted messages",
    )
    ap.add_argument("--lesson", metavar="ID", help="load this lesson at start")
    ap.add_argument(
        "--mode",
        default=None,
        help="start in this mode (needs --lesson for learn/playback)",
    )
    ap.add_argument(
        "--wearer",
        default=None,
        help="calibrate both hands with this wearer's saved flat and fist (config.toml [calibration])",
    )
    ap.add_argument("--wearer-left", default=None, help="wearer name for the left hand")
    ap.add_argument(
        "--wearer-right", default=None, help="wearer name for the right hand"
    )
    ap.add_argument(
        "--calibration-dir",
        default=None,
        help="the backend's data dir holding calibrations/ and glove_calibrations/",
    )
    ap.add_argument(
        "--no-calibration",
        action="store_true",
        help="score on raw angles (no per-wearer calibration)",
    )
    ap.add_argument("--log-level", default="info")
    args = ap.parse_args(argv)

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log = logging.getLogger("geppetto")
    cfg = load_config(args.config)
    if args.camera:
        cfg.sources.left = "camera"
        cfg.sources.right = "camera"
    if args.video:
        cfg.camera.video = args.video
    if args.solver:
        h, p = args.solver.rsplit(":", 1)
        cfg.glove.solver_host, cfg.glove.solver_port = h, int(p)
    if args.rcsp:
        h, p = args.rcsp.rsplit(":", 1)
        cfg.glove.rcsp_host, cfg.glove.rcsp_port = h, int(p)

    if "calibration" in cfg:
        cal = cfg.calibration
        if args.wearer is not None:
            cal.wearer = args.wearer
        if args.wearer_left is not None:
            cal.left_wearer = args.wearer_left
        if args.wearer_right is not None:
            cal.right_wearer = args.wearer_right
        if args.calibration_dir:
            cal.data_dir = str(Path(args.calibration_dir).resolve())
        if args.no_calibration:
            cal.enabled = False

    core = Core(cfg, fake=args.fake, validate=not args.no_validate)

    if args.replay and args.fake:
        log.warning("--replay ignored because --fake is set")
    elif args.replay:
        from tools.replay import ReplayServer

        from .rgmp import GloveSource

        core.replay_server = ReplayServer(
            Path(args.replay), host="127.0.0.1", port=0, loop=args.replay_loop
        )
        core.glove_source = GloveSource(
            cfg, core.clock, logs_dir=core.logs_dir, replay=core.replay_server
        )
    elif not args.fake:
        from .rgmp import GloveSource

        core.glove_source = GloveSource(
            cfg,
            core.clock,
            logs_dir=core.logs_dir,
            capture_path=Path(args.capture) if args.capture else None,
        )
        if not args.no_rcsp:
            from .rcsp import GloveControl, RcspClient

            core.rcsp_client = RcspClient(
                cfg.glove.rcsp_host,
                int(cfg.glove.rcsp_port),
                reconnect_s=float(cfg.glove.reconnect_s),
            )
            core.glove_control = GloveControl(core.rcsp_client, core.session)

    if args.camera or "camera" in (cfg.sources.left, cfg.sources.right):
        try:
            from .camera import CameraSource

            core.camera_source = CameraSource(cfg, core.clock)
        except (
            Exception
        ) as e:  # mediapipe or the model file missing must not stop the server
            log.error("camera source unavailable: %s", e)

    if args.lesson:
        core.session.load_lesson(args.lesson)
    if args.mode:
        core.session.handle_command("set_mode", {"mode": args.mode})
    core.session.drain()

    app = create_app(core)
    host = args.host or cfg.server.host
    port = args.port or int(cfg.server.port)
    log.info(
        "Geppetto core on http://%s:%d  (ws://%s:%d/ws, debug view at /debug)%s",
        host,
        port,
        host,
        port,
        "  FAKE MODE" if args.fake else "",
    )
    uvicorn.run(app, host=host, port=port, log_level=args.log_level)
    return 0


if __name__ == "__main__":
    sys.exit(main())
