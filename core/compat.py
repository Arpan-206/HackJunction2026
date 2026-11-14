"""Compatibility surface for the teammate's frontend (frontend/src/api/*.ts, "docs/CONTRACT.md").

SPEC.md's `/ws` contract is unchanged and stays primary. This adds, side by
side, what the frontend committed on Fri night expects:

* `GET/POST /api/...` REST routes (health, lessons, moves, dev state,
  calibrations, recordings, coach hint, score) in its shapes, where the core
  has the data. Routes it cannot honour answer 501 with a message.
* `/ws/gloves`: a stream of `GloveFrame` objects at the core tick rate:
  `{t: seconds since stream start, source, hands: [{side, wrist_quat,
  wrist_pos, flexion: {finger: [a, b, c] radians}, spread: {finger: rad}}]}`.
  Client `set_motion` messages are accepted and ignored.

See DECISIONS D22 for the mapping choices and their limits.
"""

from __future__ import annotations

import json
import logging
import time

import numpy as np
from fastapi import APIRouter, FastAPI, WebSocket
from fastapi.responses import JSONResponse

from . import geom
from . import hand as H
from .recorder import list_lessons
from .session import CommandError

log = logging.getLogger("geppetto.compat")

SOURCE_LABEL = {"glove": "rokoko_sdk", "camera": "simulator"}
DEFAULT_TOLERANCE = {"angle_deg": 18, "timing_ms": 250}


def thumb_cmc_deg(joints_local: np.ndarray) -> float:
    """CMC flexion stand-in: angle between the thumb metacarpal and the index metacarpal bones."""
    J = joints_local
    return geom.angle_between_deg(J[3] - J[2], J[7] - J[6])


def hand_to_glove_hand(h: H.HandState) -> dict:
    a = np.radians(np.asarray(h.angles, dtype=float))
    flexion = {
        "thumb": [
            round(float(np.radians(thumb_cmc_deg(h.joints_local))), 4),
            round(float(a[0]), 4),
            round(float(a[1]), 4),
        ],
    }
    for f in ["index", "middle", "ring", "little"]:
        s = H.FLEXION_SLOTS[f]
        flexion[f] = [
            round(float(a[s[0]]), 4),
            round(float(a[s[1]]), 4),
            round(float(a[s[2]]), 4),
        ]
    spread = {
        "thumb": round(float(a[14]), 4),
        "index": round(float(a[15]), 4),
        "middle": 0.0,
        "ring": round(float(a[16]), 4),
        "little": round(float(a[17]), 4),
    }
    return {
        "side": h.side,
        "wrist_quat": [round(float(x), 5) for x in h.wrist_q],
        "wrist_pos": None
        if h.anchor == "rest"
        else [round(float(x), 4) for x in h.wrist_p],
        "flexion": flexion,
        "spread": spread,
        # extra keys, ignored by the typed client but handy in the dev panel
        "tracked": bool(h.tracked),
        "curl": {f: round(float(v), 3) for f, v in h.curl.items()},
        "pinch": dict(h.pinch),
    }


def glove_frame(core, t_us: int) -> dict:
    hands = [
        hand_to_glove_hand(h)
        for s in ("left", "right")
        if (h := core.session.hands.get(s)) is not None
    ]
    if core.fake:
        source = "simulator"
    elif getattr(core, "replay_server", None) is not None:
        source = "replay"
    else:
        srcs = {core.session.sources.get(s) for s in ("left", "right")}
        source = "rokoko_sdk" if "glove" in srcs else "simulator"
    return {
        "t": round((t_us - core.compat_t0_us) / 1e6, 4),
        "source": source,
        "hands": hands,
    }


def lesson_to_compat(d: dict) -> dict:
    """Core lesson.json (or summary) -> frontend Lesson."""
    task = d.get("task", "general")
    skill = "piano" if task == "piano" else "general"
    steps = []
    for s in d.get("steps", []):
        steps.append(
            {
                "id": f"{d['id']}/step/{s['index']}",
                "title": s.get("name", f"Step {s.get('index', 0) + 1}"),
                "instruction": s.get("note") or f"{s.get('kind', 'hold')} step",
                "move_id": None,
                "hands": (d.get("master") or {}).get("hand", "right"),
                "prop": "none",
                "motion": None,
                "reference_recording_id": d["id"],
                "repetitions": 1,
                "tolerance": dict(DEFAULT_TOLERANCE),
                "video_url": None,
            }
        )
    return {
        "id": d["id"],
        "title": d.get("title", d["id"]),
        "skill": skill,
        "summary": f"{len(steps) or d.get('steps_total', 0)} steps, {d.get('duration_us', 0) / 1e6:.1f} s, source {d.get('source', 'glove')}",
        "master_name": (d.get("master") or {}).get("name", "master"),
        "source": "scratch",
        "steps": steps,
        "test": None,
        "created_at": d.get("created", ""),
    }


def rule_hint(
    deviations: dict,
    timing_ms: float | None,
    perfect_deg: float = 8.0,
    timing_hint_ms: float = 150.0,
) -> str:
    """deviations: signed degrees per finger, positive = curled more than the reference (CONTRACT.md)."""
    if timing_ms is not None and abs(float(timing_ms)) >= timing_hint_ms:
        return (
            "Slow down, you are ahead of the hand."
            if float(timing_ms) < 0
            else "A little faster."
        )
    if not deviations:
        return "Good. Next step."
    finger, dev = max(deviations.items(), key=lambda kv: abs(float(kv[1])))
    if abs(float(dev)) < perfect_deg:
        return "Good. Next step."
    return (
        f"Straighten your {finger} finger a little."
        if float(dev) > 0
        else f"Curl your {finger} finger more."
    )


def install_compat(app: FastAPI, core) -> None:
    core.compat_clients = {}
    core.compat_t0_us = core.clock.now_us()
    core.compat_dev = {
        "glove_source": "simulator" if core.fake else "rokoko_sdk",
        "smoothing": {
            "enabled": True,
            "min_cutoff": float(core.cfg.camera.one_euro_min_cutoff),
            "beta": float(core.cfg.camera.one_euro_beta),
        },
        "llm_provider": "fake",
        "simulator_motion": {"preset": "idle"},
    }
    core.compat_recordings: dict[str, dict] = {}
    r = APIRouter(prefix="/api")

    @r.get("/health")
    def health():
        return {
            "status": "ok",
            "glove_source": core.compat_dev["glove_source"],
            "llm_provider": "fake",
            "core": core.health(),
        }

    @r.get("/moves")
    def moves(skill: str | None = None):
        return []

    @r.get("/lessons")
    def lessons():
        out = []
        for s in list_lessons(core.lessons_dir):
            try:
                out.append(
                    lesson_to_compat(
                        json.loads(
                            (core.lessons_dir / s["id"] / "lesson.json").read_text()
                        )
                    )
                )
            except Exception:
                out.append(lesson_to_compat(s))
        return out

    @r.get("/lessons/{lesson_id}")
    def lesson(lesson_id: str):
        p = core.lessons_dir / lesson_id / "lesson.json"
        if "/" in lesson_id or lesson_id.startswith(".") or not p.exists():
            return JSONResponse({"detail": "lesson not found"}, status_code=404)
        return lesson_to_compat(json.loads(p.read_text()))

    @r.post("/lessons")
    @r.put("/lessons/{lesson_id}")
    @r.post("/lessons/generate")
    @r.post("/motion/preview")
    @r.post("/score")
    def not_tonight(lesson_id: str | None = None):
        return JSONResponse(
            {
                "detail": "not implemented in the core tonight; lessons are recorded from gloves "
                "(see SPEC.md record_start/record_stop over /ws)"
            },
            status_code=501,
        )

    @r.post("/calibrations")
    def calibrate(body: dict):
        side = body.get("side", "right")
        try:
            core.session.handle_command("calibrate", {})
        except CommandError as e:
            return JSONResponse({"detail": e.message}, status_code=409)
        flat = {f: [0.0, 0.0, 0.0] for f in H.FINGERS}
        fist = {f: [1.5708, 1.5708, 1.5708] for f in H.FINGERS}
        return {
            "id": f"cal-{int(time.time())}",
            "side": side,
            "flat": flat,
            "fist": fist,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }

    @r.get("/calibrations/latest")
    def latest_calibration(side: str = "right"):
        return JSONResponse(
            {"detail": "no calibration stored; the core calibrates yaw only"},
            status_code=404,
        )

    @r.post("/recordings/start")
    def recording_start(body: dict | None = None):
        body = body or {}
        try:
            if core.session.mode != "record":
                core.session.handle_command("set_mode", {"mode": "record"})
            res = core.session.handle_command(
                "record_start",
                {
                    "title": body.get("step_id")
                    or body.get("lesson_id")
                    or "frontend take"
                },
            )
        except CommandError as e:
            return JSONResponse({"detail": f"{e.code}: {e.message}"}, status_code=409)
        rid = f"rec-{int(time.time() * 1000)}"
        core.compat_recordings[rid] = {
            "id": rid,
            "lesson_id": body.get("lesson_id"),
            "step_id": body.get("step_id"),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "hand": res["hand"],
        }
        return {"recording_id": rid}

    @r.post("/recordings/{rid}/stop")
    def recording_stop(rid: str):
        rec = core.compat_recordings.get(rid)
        if rec is None:
            return JSONResponse({"detail": "unknown recording"}, status_code=404)
        try:
            res = core.session.handle_command("record_stop", {"save": True})
        except CommandError as e:
            return JSONResponse({"detail": f"{e.code}: {e.message}"}, status_code=409)
        lesson = core.session.lesson
        dur = (lesson.duration_us / 1e6) if lesson else 0.0
        rec.update(
            {
                "duration_s": round(dur, 3),
                "fps": float(core.cfg.record.rate_hz),
                "frames": [],
                "core_lesson_id": res.get("lesson_id"),
            }
        )
        return rec

    @r.get("/recordings/{rid}")
    def recording(rid: str):
        rec = core.compat_recordings.get(rid)
        if rec is None:
            return JSONResponse({"detail": "unknown recording"}, status_code=404)
        return rec

    @r.post("/coach/hint")
    def coach_hint(body: dict):
        return {
            "hint": rule_hint(
                body.get("deviations") or {},
                body.get("timing_ms"),
                float(core.cfg.score.perfect_deg),
                float(core.cfg.score.timing_hint_ms),
            ),
            "provider": "rule",
        }

    @r.get("/dev/state")
    def dev_state():
        return core.compat_dev

    @r.post("/dev/state")
    def set_dev_state(patch: dict):
        for k, v in patch.items():
            if k == "smoothing" and isinstance(v, dict):
                core.compat_dev["smoothing"].update(v)
            elif k in core.compat_dev:
                core.compat_dev[k] = v
        return core.compat_dev

    app.include_router(r)

    @app.websocket("/ws/gloves")
    async def ws_gloves(ws: WebSocket):
        await core.handle_compat_ws(ws)
