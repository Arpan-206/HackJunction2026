"""FastAPI server: /ws for the viewer, HTTP for health, lessons and schemas.

The Core owns the 30 Hz tick: poll sources, update the session, broadcast.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import fake as fake_mod
from . import hand as H
from .clock import Clock
from .coach import Coach
from .config import REPO_ROOT, Section, load_config
from .recorder import list_lessons
from .schema import SchemaRegistry
from .session import SIDES, CommandError, Session

log = logging.getLogger("geppetto.server")


@dataclass
class ClientState:
    ws: WebSocket
    rate_hz: float
    rots: bool = False
    last_frame_us: int = 0
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=64))
    dropped: int = 0


class Core:
    def __init__(self, cfg: Section, *, fake: bool = False, validate: bool = True, clock: Clock | None = None,
                 lessons_dir: Path | None = None, logs_dir: Path | None = None) -> None:
        self.cfg = cfg
        self.fake = fake
        self.validate = validate
        self.clock = clock or Clock()
        root = Path(cfg.get_path("_root", str(REPO_ROOT)))
        self.lessons_dir = Path(lessons_dir) if lessons_dir else root / cfg.server.lessons_dir
        self.logs_dir = Path(logs_dir) if logs_dir else root / cfg.server.logs_dir
        self.lessons_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.schemas = SchemaRegistry(root / cfg.server.schema_dir)
        self.coach = Coach(None, cfg.coach, cfg.score.timing_hint_ms)
        self.session = Session(cfg, self.clock, self.lessons_dir, self.coach, fake=fake,
                               on_step=self._on_step, on_calibrate=self._on_calibrate)
        self.session.attempts_log = self.logs_dir / "attempts.jsonl"
        self.clients: dict[int, ClientState] = {}
        self.started = time.time()
        self.frames = 0
        self._tick_times: deque[float] = deque(maxlen=90)
        self.validation_errors = 0
        self.last_validation_error: str | None = None
        self.fake_source: fake_mod.FakeSource | None = None
        self.glove_source: Any = None     # core.rgmp.GloveSource, attached by __main__
        self.camera_source: Any = None    # core.camera.CameraSource, attached by __main__
        self.rcsp_client: Any = None      # core.rcsp.RcspClient, attached by __main__
        self.glove_control: Any = None    # core.rcsp.GloveControl, attached by __main__
        self.replay_server: Any = None
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        if fake:
            self.setup_fake()

    # ------------------------------------------------------------------ setup
    def setup_fake(self) -> None:
        t0 = self.clock.now_us()
        self.fake_source = fake_mod.FakeSource(self.cfg, t0)
        fake_mod.build_fake_lesson(self.cfg, self.lessons_dir)
        fake_mod.build_fake_wave_lesson(self.cfg, self.lessons_dir)
        self.session.load_lesson(fake_mod.FAKE_LESSON_ID)
        self.session.roles = {"left": "free", "right": "learner"}
        self.session.handle_command("set_mode", {"mode": "learn"})
        self.session.drain()   # startup chatter is not for anyone yet

    def _on_step(self, step: int, t_us: int) -> None:
        if self.fake_source is not None:
            self.fake_source.set_target_step(step, t_us)

    def _on_calibrate(self) -> None:
        if self.glove_source is not None and hasattr(self.glove_source, "calibrate"):
            self.glove_source.calibrate()

    # ------------------------------------------------------------------ sources
    def poll_sources(self, t_us: int) -> None:
        fake_hands = self.fake_source.poll(t_us) if self.fake_source is not None else {}
        glove_hands = self.glove_source.poll(t_us) if self.glove_source is not None else {}
        cam_hands = self.camera_source.poll(t_us) if self.camera_source is not None else {}
        for side in SIDES:
            src = self.session.sources.get(side, "glove")
            hand, events = None, []
            if src == "glove":
                if self.glove_source is not None:
                    hand, events = glove_hands.get(side, (None, []))
                elif self.fake_source is not None:
                    hand = fake_hands.get(side)
            elif src == "camera":
                if self.camera_source is not None:
                    hand, events = cam_hands.get(side, (None, []))
                elif self.fake_source is not None:
                    hand = fake_hands.get(side)
                    if hand is not None:
                        hand.source = "camera"
                        hand.anchor = "camera"
            self.session.update_hand(side, hand, events)

    # ------------------------------------------------------------------ loop
    async def run(self) -> None:
        period = 1.0 / float(self.cfg.server.frame_rate_hz)
        next_t = time.monotonic()
        while not self._stop.is_set():
            t = self.clock.now_us()
            self._tick_times.append(time.monotonic())
            try:
                self.poll_sources(t)
                frame = self.session.tick(t)
                msgs = self.session.drain()
                for msg in msgs:
                    self._check(msg)
                    self.broadcast(msg)
                self._check(frame)
                self.frames += 1
                self.broadcast_frame(frame, t)
                if self.glove_control is not None:
                    self.glove_control.on_messages(msgs)
                    if self.frames % 10 == 0:
                        asyncio.create_task(self.glove_control.update_leds())
            except Exception:
                log.exception("tick failed")
            next_t += period
            delay = next_t - time.monotonic()
            if delay < 0:
                next_t = time.monotonic()
                delay = 0
            await asyncio.sleep(delay)

    def _check(self, msg: dict) -> None:
        if not self.validate:
            return
        try:
            self.schemas.validate_message(msg)
        except Exception as e:
            self.validation_errors += 1
            self.last_validation_error = f"{msg.get('type')}: {str(e)[:300]}"
            log.error("message failed schema: %s", self.last_validation_error)

    def broadcast(self, msg: dict) -> None:
        text = json.dumps(msg, separators=(",", ":"))
        for c in list(self.clients.values()):
            self._enqueue(c, text)

    def broadcast_frame(self, frame: dict, t_us: int) -> None:
        text_plain: str | None = None
        text_rots: str | None = None
        for c in list(self.clients.values()):
            if t_us - c.last_frame_us < 1e6 / c.rate_hz - 1000:
                continue
            c.last_frame_us = t_us
            if c.rots:
                if text_rots is None:
                    f2 = dict(frame)
                    f2["hands"] = {s: (None if h is None else h.to_message(int(self.cfg.hand.joint_decimals), True))
                                   for s, h in self.session.hands.items()}
                    for s, hm in f2["hands"].items():
                        if hm is not None:
                            hm["role"] = self.session.roles.get(s, "free")
                    text_rots = json.dumps(f2, separators=(",", ":"))
                self._enqueue(c, text_rots)
            else:
                if text_plain is None:
                    text_plain = json.dumps(frame, separators=(",", ":"))
                self._enqueue(c, text_plain)

    def _enqueue(self, c: ClientState, text: str) -> None:
        try:
            c.queue.put_nowait(text)
        except asyncio.QueueFull:
            c.dropped += 1
            try:
                c.queue.get_nowait()
                c.queue.put_nowait(text)
            except Exception:
                pass

    def stop(self) -> None:
        self._stop.set()

    # ------------------------------------------------------------------ websocket
    async def handle_ws(self, ws: WebSocket) -> None:
        await ws.accept()
        c = ClientState(ws=ws, rate_hz=float(self.cfg.server.frame_rate_hz))
        key = id(ws)
        self.clients[key] = c
        sender = asyncio.create_task(self._sender(c))
        try:
            hello = self.session.hello()
            self._check(hello)
            await ws.send_text(json.dumps(hello, separators=(",", ":")))
            sess = {**self.session.envelope("session"), **self.session.session_state()}
            self._check(sess)
            await ws.send_text(json.dumps(sess, separators=(",", ":")))
            lesson = self.session.lesson_message()
            if lesson is not None:
                self._check(lesson)
                await ws.send_text(json.dumps(lesson, separators=(",", ":")))
            while True:
                raw = await ws.receive_text()
                ack = self.handle_cmd(c, raw)
                self._check(ack)
                await ws.send_text(json.dumps(ack, separators=(",", ":")))
        except WebSocketDisconnect:
            pass
        except Exception:
            log.exception("websocket closed with error")
        finally:
            sender.cancel()
            self.clients.pop(key, None)

    async def _sender(self, c: ClientState) -> None:
        try:
            while True:
                text = await c.queue.get()
                await c.ws.send_text(text)
        except asyncio.CancelledError:
            return
        except Exception:
            return

    def handle_cmd(self, c: ClientState, raw: str) -> dict:
        t = self.clock.now_us()
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError as e:
            return {"v": 1, "type": "ack", "t": t, "id": "?", "ok": False,
                    "error": {"code": "bad_args", "message": f"not JSON: {e}"}}
        cid = str(msg.get("id", "?")) if isinstance(msg, dict) else "?"
        errors = self.schemas.errors("cmd", msg)
        if errors:
            return {"v": 1, "type": "ack", "t": t, "id": cid, "ok": False,
                    "error": {"code": "bad_args", "message": "; ".join(errors)[:300]}}
        name, args = msg["name"], msg.get("args", {}) or {}
        try:
            result = self.session.handle_command(name, args)
            if name == "subscribe":
                c.rate_hz, c.rots = float(result["rate_hz"]), bool(result["rots"])
            return {"v": 1, "type": "ack", "t": self.clock.now_us(), "id": cid, "ok": True, "result": result}
        except CommandError as e:
            return {"v": 1, "type": "ack", "t": self.clock.now_us(), "id": cid, "ok": False,
                    "error": {"code": e.code, "message": e.message}}
        except Exception as e:
            log.exception("command %s failed", name)
            return {"v": 1, "type": "ack", "t": self.clock.now_us(), "id": cid, "ok": False,
                    "error": {"code": "internal", "message": f"{type(e).__name__}: {e}"[:300]}}

    # ------------------------------------------------------------------ http
    def tick_hz(self) -> float | None:
        """Measured tick rate over the last ~3 s. The viewer should see about frame_rate_hz."""
        tt = list(self._tick_times)
        if len(tt) < 2 or tt[-1] <= tt[0]:
            return None
        return round((len(tt) - 1) / (tt[-1] - tt[0]), 1)

    def health(self) -> dict:
        hands = self.session.hands
        return {
            "ok": True,
            "gloves": {s: bool(hands.get(s) is not None and hands[s].tracked and hands[s].source == "glove") for s in SIDES},
            "hands": {s: None if hands.get(s) is None else {"tracked": hands[s].tracked, "source": hands[s].source} for s in SIDES},
            "anchor": self.session.anchor, "gemma": "off", "uptime_s": round(time.time() - self.started, 1),
            "fake": self.fake, "frames": self.frames, "clients": len(self.clients),
            "tick_hz": self.tick_hz(),
            "rgmp": None if self.glove_source is None else {"connected": self.glove_source.connected,
                                                            "frames": self.glove_source.frames,
                                                            "devices": dict(self.glove_source.sides)},
            "rcsp": None if self.rcsp_client is None else {"connected": self.rcsp_client.connected.is_set()},
            "camera": None if self.camera_source is None else {"frames": self.camera_source.frames,
                                                               "detections": self.camera_source.detections,
                                                               "error": self.camera_source.error},
            "validation_errors": self.validation_errors, "last_validation_error": self.last_validation_error,
            "mode": self.session.mode, "lesson_id": self.session.lesson.id if self.session.lesson else None,
        }


def create_app(core: Core) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        core._task = asyncio.create_task(core.run())
        for src in (core.glove_source, core.camera_source, core.rcsp_client):
            if src is not None and hasattr(src, "start"):
                await src.start()
        try:
            yield
        finally:
            core.stop()
            for src in (core.glove_source, core.camera_source, core.rcsp_client):
                if src is not None and hasattr(src, "stop"):
                    await src.stop()
            if core._task is not None:
                core._task.cancel()

    app = FastAPI(title="Geppetto core", lifespan=lifespan)
    # the viewer dev server (another origin, e.g. :5173) fetches /lessons and /schema
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "OPTIONS"], allow_headers=["*"])
    app.state.core = core

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await core.handle_ws(ws)

    @app.get("/health")
    def health():
        return core.health()

    @app.get("/lessons")
    def lessons():
        return list_lessons(core.lessons_dir)

    @app.get("/lessons/{lesson_id}")
    def lesson(lesson_id: str):
        p = core.lessons_dir / lesson_id / "lesson.json"
        if "/" in lesson_id or lesson_id.startswith(".") or not p.exists():
            return JSONResponse({"error": "not_found"}, status_code=404)
        return JSONResponse(json.loads(p.read_text()))

    @app.get("/lessons/{lesson_id}/frames/{name}.jpg")
    def lesson_frame(lesson_id: str, name: str):
        p = core.lessons_dir / lesson_id / "frames" / f"{name}.jpg"
        if "/" in lesson_id or "/" in name or not p.exists():
            return JSONResponse({"error": "not_found"}, status_code=404)
        return FileResponse(p, media_type="image/jpeg")

    @app.get("/schema/{name}.json")
    def schema(name: str):
        if name not in core.schemas.docs:
            return JSONResponse({"error": "not_found", "available": core.schemas.names()}, status_code=404)
        return JSONResponse(core.schemas.get(name))

    @app.get("/debug")
    def debug_view():
        p = REPO_ROOT / "tools" / "debug_view.html"
        if not p.exists():
            return JSONResponse({"error": "tools/debug_view.html missing"}, status_code=404)
        return FileResponse(p, media_type="text/html")

    return app


def build(config_path: str | None = None, **kw) -> tuple[Core, FastAPI]:
    cfg = load_config(config_path)
    core = Core(cfg, **kw)
    return core, create_app(core)
