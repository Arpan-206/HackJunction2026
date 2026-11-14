"""The glove slot steps, in order. Each step prints what to do, waits for Enter, runs its check and returns a Result.

Thresholds are at the top of this file with the measurement each comes from.
"""

from __future__ import annotations

import json
import math
import shlex
import subprocess
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from slot_links import CoreLink, HttpError, Trace, http, port_open
from slot_log import Console, Result

# --- thresholds ----------------------------------------------------------------
# Flat-to-fist range in the core's own degrees (core/calibration.py summary,
# range_deg, mean of a finger's joints). STATUS.md "Calibrated angles": a good
# right glove gave thumb 14, index 57, middle 70, ring 69, little 53. The left
# glove on Sat 14 Nov gave 0.7 to 8 on every finger: that is the failure.
THUMB_MIN_RANGE_DEG = 8.0
FINGER_MIN_RANGE_DEG = 25.0
# Yaw: after `calibrate` with fingers pointing away, the palm must point away
# within this angle; after a 90 degree turn, within this angle of 90.
YAW_FORWARD_TOL_DEG = 20.0
YAW_TURN_TOL_DEG = 30.0
# Mirror: score present on most frames while the learner copies.
MIRROR_MIN_SCORED = 0.9
# Piano: cued fingers that must give a finger_down in their window.
PIANO_MIN_FINGERS = 4
PIANO_MAX_FALSE_WHEN_STILL = 2
# Depth clip: frame rate and gaps (STATUS.md: 29.8 fps over USB, no gaps).
DEPTH_MIN_FPS = 20.0
DEPTH_MAX_GAP_FRACTION = 0.05

FINGERS = ("thumb", "index", "middle", "ring", "little")
SIDES = ("left", "right")


@dataclass
class Options:
    depth_seconds: float = 40.0
    depth_check: str = "python -m tools.depth_check {file}"
    hold_seconds: float = 3.0
    mirror_seconds: float = 15.0
    duel_seconds: float = 30.0
    piano_cue_seconds: float = 4.0
    takes: int = 3
    lessons: list[str] = field(default_factory=list)
    pose_seconds: float = 3.0
    freeze_seconds: float = 2.0
    move_seconds: float = 4.0
    duel_lesson: str = ""
    pack: str = "fi"
    pack_letters: list[str] = field(default_factory=list)
    recorded_by: str = ""
    reference: str = ""


@dataclass
class Ctx:
    console: Console
    repo: Path
    py: str
    run_dir: Path
    wearer: str
    dry: bool
    opts: Options
    core_port: int
    backend_url: str
    depth_host: str
    depth_port: int
    data_dir: Path
    cfg: object
    stack: object = None  # slot_stack.DryStack in the dry run
    trace: Trace = field(default_factory=Trace)
    state: dict = field(default_factory=dict)

    @property
    def core_http(self) -> str:
        return f"http://127.0.0.1:{self.core_port}"

    def core(self, port: int | None = None, path: str = "/ws") -> CoreLink:
        return CoreLink(
            f"ws://127.0.0.1:{port or self.core_port}{path}", trace=self.trace
        )

    def health(self, port: int | None = None) -> dict:
        return http(
            "GET",
            f"http://127.0.0.1:{port or self.core_port}/health",
            timeout=5,
            trace=self.trace,
        )

    def sh(self, cmd: list[str], timeout: float = 120.0) -> subprocess.CompletedProcess:
        label = " ".join(shlex.quote(str(x)) for x in cmd)
        try:
            p = subprocess.run(
                [str(x) for x in cmd],
                cwd=self.repo,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as e:
            self.trace.add(
                "shell", label, False, f"timeout after {timeout} s: {e.stdout or ''}"
            )
            raise
        self.trace.add(
            "shell",
            label,
            p.returncode == 0,
            f"exit {p.returncode}\n{p.stdout}{p.stderr}",
        )
        return p


@contextmanager
def link(ctx: Ctx, port: int | None = None, path: str = "/ws"):
    c = ctx.core(port, path)
    try:
        yield c
    finally:
        c.close()


def _bad(ctx: Ctx) -> str:
    """Fake hands move on their own and ignore the prompts: their poses cannot fail a quality check."""
    return "look" if ctx.dry else "bad"


def _fake_note(ctx: Ctx) -> str:
    return (
        " (fake hands ignore the prompts; quality not judged in the dry run)"
        if ctx.dry
        else ""
    )


def hold(ctx: Ctx, text: str, seconds: float) -> None:
    ctx.console.say(text)
    ctx.console.enter(f"Press Enter, then hold still for {seconds:.0f} s.")


# --- hand geometry from frame messages ------------------------------------------


def palm_heading_deg(joints: list) -> float | None:
    """Heading of wrist (1) to middle proximal (12) on the table plane.

    0 means the palm points away from the person (world -Z), +90 means it points
    to the person's left (world -X). World frame: SPEC.md, Y up, X right, Z toward the person.
    """
    if not joints or len(joints) < 13:
        return None
    w, m = joints[1], joints[12]
    dx, dz = m[0] - w[0], m[2] - w[2]
    if abs(dx) + abs(dz) < 1e-6:
        return None
    return math.degrees(math.atan2(-dx, -dz))


def circ_mean_deg(xs: list[float]) -> float | None:
    if not xs:
        return None
    s = sum(math.sin(math.radians(x)) for x in xs)
    c = sum(math.cos(math.radians(x)) for x in xs)
    return math.degrees(math.atan2(s, c))


def ang_diff(a: float, b: float) -> float:
    return (a - b + 180.0) % 360.0 - 180.0


def headings(frames: list[dict]) -> dict[str, float | None]:
    out = {}
    for side in SIDES:
        hs = [
            palm_heading_deg((f.get("hands") or {}).get(side, {}).get("joints"))
            for f in frames
            if (f.get("hands") or {}).get(side)
        ]
        out[side] = circ_mean_deg([h for h in hs if h is not None])
    return out


# --- step 0: the stack ----------------------------------------------------------


def step_stack(ctx: Ctx) -> Result:
    c = ctx.console
    if ctx.dry:
        h = ctx.health()
        return Result(
            "ok",
            f"fake stack up: core on {ctx.core_port} (fake {h.get('fake')}), backend {ctx.backend_url}, "
            f"fake phone on {ctx.depth_port}",
            {"core_health": h},
        )
    from slot_stack import live_stack_up

    up = live_stack_up(ctx.core_port, ctx.backend_url)
    if up["core"] is None or up["backend"] is None:
        c.say(
            "The live stack is not up. Quit the Rokoko desktop app and Rokoko Studio. Plug in both gloves by USB."
        )
        if c.yes(f"Start it now with scripts/live.sh {ctx.wearer}?"):
            p = ctx.sh([str(ctx.repo / "scripts" / "live.sh"), ctx.wearer], timeout=240)
            c.say(p.stdout[-2500:])
            up = live_stack_up(ctx.core_port, ctx.backend_url)
    core, backend = up.get("core"), up.get("backend")
    ctx.trace.add(
        "http", "core /health and backend /api/health", bool(core and backend), up
    )
    if core is None or backend is None:
        return Result(
            "error",
            "core or backend does not answer",
            up,
            fix="Run scripts/live.sh WEARER and read logs/live/current/*.log (docs/GLOVE-SLOT.md section 4).",
        )
    gloves = core.get("gloves") or {}
    devices = (core.get("rgmp") or {}).get("devices") or {}
    rcsp = (core.get("rcsp") or {}).get("connected")
    details = {
        "gloves": gloves,
        "devices": devices,
        "rcsp": rcsp,
        "glove_source": backend.get("glove_source"),
    }
    if not all(gloves.get(s) for s in SIDES):
        return Result(
            "bad",
            f"gloves tracked: {gloves}; devices {devices}",
            details,
            fix="docs/GLOVE-SLOT.md section 4: USB cable, rokoko device list, solver.log.",
        )
    return Result(
        "ok",
        f"both gloves tracked, rcsp {rcsp}, backend source {backend.get('glove_source')}",
        details,
    )


# --- step 1: depth clip ---------------------------------------------------------


def _module_of(template: str) -> str | None:
    parts = shlex.split(template)
    if "-m" in parts and parts.index("-m") + 1 < len(parts):
        return parts[parts.index("-m") + 1]
    return None


def _module_exists(ctx: Ctx, mod: str) -> bool:
    p = subprocess.run(
        [
            ctx.py,
            "-c",
            f"import importlib.util,sys; sys.exit(0 if importlib.util.find_spec({mod!r}) else 1)",
        ],
        cwd=ctx.repo,
        capture_output=True,
        text=True,
    )
    return p.returncode == 0


def step_depth(ctx: Ctx) -> Result:
    c = ctx.console
    host, port, secs = ctx.depth_host, ctx.depth_port, ctx.opts.depth_seconds
    c.say("1. Open the GeppettoDepth app on the iPhone. Point it down at the table.")
    c.say(
        "2. For the cable: run ios/mac/forward.sh in a second terminal and leave it running."
    )
    c.say(
        "   For WiFi: start this script with --depth-host <the address the app shows>."
    )
    c.say(
        f"3. Put on the gloves. Put the gloved hand on the table in view. Move it slowly for {secs / 2:.0f} s."
    )
    c.say(
        f"4. When the script says so, take the hand away. Leave the table empty for {secs / 2:.0f} s."
    )
    c.say(f"The script reads the phone at {host}:{port}.")
    if not port_open(port, host, timeout=2):
        c.enter("Nothing answers yet. Start the app or forward.sh, then press Enter.")
    if not port_open(port, host, timeout=2):
        return Result(
            "error",
            f"nothing answers on {host}:{port}",
            {"host": host, "port": port},
            fix="Open GeppettoDepth. Cable: ios/mac/forward.sh (iproxy). WiFi: --depth-host <phone address>.",
        )
    c.enter(f"Press Enter to start the {secs:.0f} s recording.")
    out = ctx.run_dir / "depth_clip.gdrec.gz"
    note = (
        f"glove slot {ctx.run_dir.name}: gloved hand on the table, then empty table"
        + (" (FAKE sender, dry run)" if ctx.dry else "")
    )
    cmd = [
        ctx.py,
        "-m",
        "ios.mac.record",
        str(out),
        "--host",
        host,
        "--port",
        str(port),
        "--seconds",
        f"{secs:g}",
        "--note",
        note,
    ]
    label = " ".join(shlex.quote(x) for x in cmd)
    t0 = time.time()
    p = subprocess.Popen(
        cmd, cwd=ctx.repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    c.say("Recording. Hand on the table, move it slowly.")
    said_half = False
    next_tick = 10.0
    while p.poll() is None:
        el = time.time() - t0
        if not said_half and el >= secs / 2:
            c.say(">>> Take the hand away now. Leave the table empty. <<<")
            said_half = True
        if el >= next_tick and el < secs:
            c.say(f"   {secs - el:.0f} s left")
            next_tick += 10.0
        time.sleep(0.1)
    rec_out = p.stdout.read() if p.stdout else ""
    ctx.trace.add(
        "shell", label, p.returncode == 0, f"exit {p.returncode}\n{rec_out[-3000:]}"
    )
    if p.returncode != 0 or not out.exists():
        return Result(
            "error",
            f"ios.mac.record failed (exit {p.returncode})",
            {"output": rec_out[-1000:]},
            fix="Check the app is in the foreground and the address is right.",
        )
    info_p = ctx.sh([ctx.py, "-m", "ios.mac.replay", str(out), "--info"])
    try:
        info = json.loads(info_p.stdout)
    except ValueError:
        return Result(
            "error",
            "ios.mac.replay --info gave no JSON",
            {"output": info_p.stdout[-1000:]},
        )
    frames, fps, gaps = (
        int(info.get("frames", 0)),
        float(info.get("fps") or 0),
        int(info.get("gaps", 0)),
    )
    details = {"file": str(out), "bytes": out.stat().st_size, "info": info}

    # the lidar lane's check, when it exists
    tmpl = ctx.opts.depth_check
    mod = _module_of(tmpl)
    check_note = ""
    check_ok = True
    if mod and not _module_exists(ctx, mod):
        check_note = f"depth check skipped: {mod} is not on this branch yet (lidar lane). Run later: {tmpl.format(file=out)}"
        ctx.trace.add(
            "shell", tmpl.format(file=out), True, f"SKIPPED: module {mod} not found"
        )
        details["depth_check"] = "skipped"
    else:
        argv = [
            ctx.py if a == "python" else a
            for a in shlex.split(tmpl.format(file=str(out)))
        ]
        try:
            dc = ctx.sh(argv, timeout=600)
            (ctx.run_dir / "depth_check.txt").write_text(dc.stdout + dc.stderr)
            details["depth_check"] = {
                "exit": dc.returncode,
                "output_tail": (dc.stdout + dc.stderr)[-1500:],
            }
            check_ok = dc.returncode == 0
            check_note = f"depth check exit {dc.returncode}, output in depth_check.txt"
        except subprocess.TimeoutExpired:
            check_ok = False
            check_note = "depth check timed out after 600 s"
    summary = f"{frames} frames, {fps:.1f} fps, {gaps} gaps, plane in {info.get('with_plane')} frames; {check_note}"
    good = (
        fps >= DEPTH_MIN_FPS
        and gaps <= DEPTH_MAX_GAP_FRACTION * max(frames, 1)
        and frames > 0
    )
    if not good:
        return Result(
            "bad",
            summary,
            details,
            fix="Use the cable (forward.sh), close other apps on the phone, record again.",
        )
    if not check_ok:
        return Result(
            "bad", summary, details, fix="Read depth_check.txt in the run folder."
        )
    return Result(
        "look" if ctx.dry else "ok",
        summary + (" (fake phone)" if ctx.dry else ""),
        details,
    )


# --- steps 2 and 3: flat and fist calibration -------------------------------------


def _deg_ranges(cal: dict) -> dict[str, float]:
    """Backend Calibration (radians, per finger triple) to the flat-to-fist change in degrees, summed per finger."""
    out = {}
    for f in FINGERS:
        flat, fist = cal.get("flat", {}).get(f), cal.get("fist", {}).get(f)
        if flat and fist:
            out[f] = round(math.degrees(sum(fist) - sum(flat)), 1)
    return out


def _core_view(ctx: Ctx, side: str) -> dict | None:
    """What the core loads for this wearer and side: the same function the core calls on `calibrate`."""
    from core.calibration import load_hand

    hc = load_hand(ctx.data_dir, side, ctx.wearer, ctx.cfg.calibration, ctx.cfg.hand)
    return None if hc is None else hc.summary()


def calibrate_side(
    ctx: Ctx, side: str, flat_text: str, fist_text: str
) -> tuple[dict, dict | None, dict]:
    """Flat, fist, neutral, finish, core calibrate. Returns (backend calibration, core view, details)."""
    c, api, hs = ctx.console, f"{ctx.backend_url}/api", ctx.opts.hold_seconds
    hold(ctx, flat_text, hs)
    http(
        "POST",
        f"{api}/calibrations",
        {"side": side, "phase": "flat", "duration_s": hs},
        timeout=hs + 20,
        trace=ctx.trace,
    )
    hold(ctx, fist_text, hs)
    cal = http(
        "POST",
        f"{api}/calibrations",
        {"side": side, "phase": "fist", "duration_s": hs},
        timeout=hs + 20,
        trace=ctx.trace,
    )
    c.say("Good. Now the start pose that links this to your name.")
    hold(
        ctx,
        "Put both hands flat on the table, palms down, thumbs together. Keep still.",
        hs,
    )
    try:
        prev = http(
            "GET",
            f"{api}/gloves/calibrations/latest?wearer={ctx.wearer}",
            timeout=10,
            trace=ctx.trace,
        )
    except HttpError:
        prev = None
    neu = http(
        "POST",
        f"{api}/gloves/calibrations/neutral",
        {"wearer": ctx.wearer, "duration_s": hs},
        timeout=hs + 30,
        trace=ctx.trace,
    )
    ids = dict((prev or {}).get("range_calibration_ids") or {})
    ids[side] = cal["id"]
    fin = http(
        "POST",
        f"{api}/gloves/calibrations/{neu['id']}/finish",
        {"range_calibration_ids": ids},
        timeout=10,
        trace=ctx.trace,
    )
    with link(ctx) as core:
        core.cmd("calibrate")
    time.sleep(0.3)
    health = ctx.health()
    view = _core_view(ctx, side)
    details = {
        "calibration_id": cal["id"],
        "wearer_calibration_id": fin.get("id"),
        "range_calibration_ids": fin.get("range_calibration_ids"),
        "quality": fin.get("quality"),
        "backend_range_deg_sum": _deg_ranges(cal),
        "core_view": view,
        "core_health_calibration": (health.get("calibration") or {}).get(side),
    }
    return cal, view, details


def _loaded_note(ctx: Ctx, side: str, cal_id: str, details: dict) -> str:
    hc = details.get("core_health_calibration") or {}
    if ctx.dry:
        return "fake core skips calibration on purpose; checked with core.calibration.load_hand instead"
    if hc.get("range_calibration_id") == cal_id:
        return "the running core loaded it"
    return f"the running core shows {hc.get('range_calibration_id')}, not {cal_id}: was it started with --wearer {ctx.wearer}?"


def step_right_thumb(ctx: Ctx) -> Result:
    ctx.console.say(
        "Right glove only. This redoes the right range with the thumb folded, because the last fist"
    )
    ctx.console.say(
        "read the thumb less bent than flat (STATUS-weights.md, range c8713cacaff6)."
    )
    cal, view, d = calibrate_side(
        ctx,
        "right",
        "Put the RIGHT hand flat on the table, fingers together, thumb along the side of the index finger.",
        "Make a RIGHT fist. Fold the thumb across the middle of the fingers, outside the fist, not tucked in.",
    )
    loaded = _loaded_note(ctx, "right", cal["id"], d)
    if view is None:
        return Result(
            "error",
            "the core could not load a right calibration for this wearer",
            d,
            fix=f"Check {ctx.data_dir}/glove_calibrations for wearer {ctx.wearer}.",
        )
    thumb = view["range_deg"]["thumb"]
    s = f"right thumb range {thumb} deg (needs {THUMB_MIN_RANGE_DEG:g}), all {view['range_deg']}; {loaded}"
    if thumb < THUMB_MIN_RANGE_DEG:
        return Result(
            _bad(ctx),
            s + _fake_note(ctx),
            d,
            fix="Fold the thumb further across the fingers in the fist and retry. "
            "If it stays low, the thumb keeps weight 0 for this wearer.",
        )
    return Result("look" if ctx.dry else "ok", s, d)


def step_left_glove(ctx: Ctx) -> Result:
    ctx.console.say(
        "Left glove. The last left range was 0.7 to 8 deg: the glove was loose or not seated."
    )
    ctx.console.say(
        "Pull the left glove on fully: each fingertip to the end of its sleeve, strap snug."
    )
    cal, view, d = calibrate_side(
        ctx,
        "left",
        "Put the LEFT hand flat on the table, fingers together, thumb along the side of the index finger.",
        "Make a LEFT fist. Fold the thumb across the middle of the fingers, outside the fist.",
    )
    loaded = _loaded_note(ctx, "left", cal["id"], d)
    if view is None:
        return Result(
            "error", "the core could not load a left calibration for this wearer", d
        )
    rng = view["range_deg"]
    low = [
        f
        for f in FINGERS
        if rng[f] < (THUMB_MIN_RANGE_DEG if f == "thumb" else FINGER_MIN_RANGE_DEG)
    ]
    s = f"left ranges {rng}; low: {low or 'none'}; {loaded}"
    if low:
        return Result(
            _bad(ctx),
            s + _fake_note(ctx),
            d,
            fix="Reseat the left glove, check the strap, then retry. Compare with the right glove.",
        )
    return Result("look" if ctx.dry else "ok", s, d)


# --- step 4: button, LED, mirror, duel -------------------------------------------


def _press(ctx: Ctx, side: str, kind: str) -> None:
    """Dry run only: push a button event through the fake driver's control port."""
    import socket

    port = ctx.stack.ep.rcsp_control_port
    with socket.create_connection(("127.0.0.1", port), timeout=3) as s:
        s.sendall(f"{side} {kind}\n".encode())
        reply = s.makefile().readline().strip()
    ctx.trace.add(
        "fake",
        f"fake_rcsp_server control: {side} {kind}",
        reply.startswith("ok"),
        reply,
    )


def _leds(ctx: Ctx, side: str, t0: float) -> list[str]:
    log = ctx.stack.ep.led_log
    if not log or not log.exists():
        return []
    out = []
    for line in log.read_text().splitlines():
        r = json.loads(line)
        if r["side"] == side and r["t"] >= t0:
            out.append(r["colour"])
    return out


def _button_side(ctx: Ctx, core: CoreLink, side: str, timeout: float) -> dict:
    c = ctx.console
    res: dict = {}
    core.cmd("set_mode", {"mode": "idle"})
    # The recording (and its red LED) goes to the master glove. With no master
    # set, the core records the first tracked hand (left), whichever button was
    # pressed. So make the pressed glove the master first.
    core.cmd(
        "set_roles", {side: "master", ("left" if side == "right" else "right"): "free"}
    )
    t0 = time.time()
    c.say(
        f"Press the button on the {side.upper()} glove once. A recording starts and the {side} LED turns red."
    )
    if ctx.dry:
        _press(ctx, side, "SinglePress")
    ev = core.wait_event(
        t0,
        lambda m: (
            m.get("name") == "button"
            and m.get("hand") == side
            and (m.get("data") or {}).get("press") == "SinglePress"
        ),
        timeout,
    )
    res["single"] = ev is not None
    started = core.wait_event(t0, lambda m: m.get("name") == "recording_started", 3)
    res["recording_started"] = started is not None
    time.sleep(0.6)
    if ctx.dry:
        res["led_while_recording"] = _leds(ctx, side, t0)
    t1 = time.time()
    c.say(
        f"Now double press the {side.upper()} button. The recording is thrown away and the LED goes back to blue."
    )
    if ctx.dry:
        _press(ctx, side, "DoublePress")
    ev2 = core.wait_event(
        t1,
        lambda m: (
            m.get("name") == "button"
            and m.get("hand") == side
            and (m.get("data") or {}).get("press") == "DoublePress"
        ),
        timeout,
    )
    res["double"] = ev2 is not None
    stopped = core.wait_event(t1, lambda m: m.get("name") == "recording_stopped", 3)
    res["recording_discarded"] = (
        stopped is not None and (stopped.get("data") or {}).get("lesson_id") is None
    )
    time.sleep(0.6)
    if ctx.dry:
        res["led_after"] = _leds(ctx, side, t1)
        res["led_ok"] = (
            "recording" in res["led_while_recording"] and "idle" in res["led_after"]
        )
    else:
        res["led_ok"] = c.yes(
            f"Did the {side} ring LED turn red while recording, then blue?"
        )
    return res


def _mirror(ctx: Ctx, core: CoreLink) -> dict:
    c = ctx.console
    secs = ctx.opts.mirror_seconds
    core.cmd("set_roles", {"left": "master", "right": "learner"})
    core.cmd("set_mode", {"mode": "mirror"})
    c.say(
        f"Mirror: the LEFT hand leads, the RIGHT hand copies. Make slow shapes for {secs:.0f} s."
    )
    c.enter("Press Enter to start.")
    t0 = time.time()
    time.sleep(secs)
    frames = core.since(t0, "frame")
    scored = [f["score"] for f in frames if f.get("score")]
    overall = [float(s.get("overall", 0)) for s in scored]
    core.cmd("set_mode", {"mode": "idle"})
    return {
        "frames": len(frames),
        "scored_fraction": round(len(scored) / max(1, len(frames)), 3),
        "mean_overall": round(sum(overall) / len(overall), 3) if overall else None,
        "at_or_above_0_85": round(
            sum(1 for o in overall if o >= 0.85) / max(1, len(overall)), 3
        ),
    }


def _pick_duel_lesson(ctx: Ctx) -> str | None:
    if ctx.opts.duel_lesson:
        return ctx.opts.duel_lesson
    lessons = http("GET", f"{ctx.core_http}/lessons", timeout=5, trace=ctx.trace) or []
    ids = [lz.get("id") for lz in lessons if lz.get("id")]
    if ctx.dry:
        return "fake-demo" if "fake-demo" in ids else (ids[0] if ids else None)
    real = [i for i in ids if not str(i).startswith("fake-")]
    return real[-1] if real else (ids[0] if ids else None)


def _duel(ctx: Ctx, core: CoreLink) -> dict:
    c = ctx.console
    lesson = _pick_duel_lesson(ctx)
    if not lesson:
        return {
            "skipped": "no lesson on the core to duel on; record one in step 8 and rerun with --only 4"
        }
    secs = ctx.opts.duel_seconds
    core.cmd("lesson_load", {"lesson_id": lesson})
    core.cmd("set_roles", {"left": "learner", "right": "learner"})
    core.cmd("set_mode", {"mode": "duel"})
    c.say(
        f"Duel on lesson {lesson}: both hands copy the pose on screen. The first hand to hold it wins the round."
    )
    c.say(f"Play for {secs:.0f} s.")
    c.enter("Press Enter to start.")
    t0 = time.time()
    time.sleep(secs)
    wins = [e for e in core.since(t0, "event") if e.get("name") == "round_won"]
    frames = core.since(t0, "frame")
    duel_state = next(
        (
            (f.get("task") or {}).get("duel")
            for f in reversed(frames)
            if (f.get("task") or {}).get("duel")
        ),
        None,
    )
    scored = sum(1 for f in frames if f.get("score"))
    core.cmd("set_mode", {"mode": "idle"})
    core.cmd("set_roles", {"left": "free", "right": "free"})
    return {
        "lesson": lesson,
        "rounds_won": [w.get("hand") for w in wins],
        "duel": duel_state,
        "frames": len(frames),
        "scored_frames": scored,
    }


def step_button_led_mirror_duel(ctx: Ctx) -> Result:
    c = ctx.console
    details: dict = {}
    if ctx.dry:
        c.say(
            "Dry run: the button and LED run on a second, non-fake core with a fake solver and a fake RCSP driver."
        )
        ctx.stack.start_rcsp_core(ctx.trace)
        bport = ctx.stack.ep.core_b_port
    else:
        bport = ctx.core_port
    h = ctx.health(bport)
    details["rcsp_connected"] = (h.get("rcsp") or {}).get("connected")
    c.say("Part A: the glove buttons and the ring LEDs.")
    if not details["rcsp_connected"]:
        details["buttons"] = "skipped: the core has no RCSP link"
    else:
        c.enter()
        time.sleep(1.0)  # GloveControl finds the gloves and sets the first LED colour
        with link(ctx, bport) as core:
            details["buttons"] = {
                s: _button_side(ctx, core, s, timeout=6 if ctx.dry else 30)
                for s in ("right", "left")
            }
            core.cmd("set_roles", {"left": "free", "right": "free"})
    with link(ctx) as core:
        c.say("Part B: mirror mode.")
        details["mirror"] = _mirror(ctx, core)
        c.say("Part C: duel mode.")
        details["duel"] = _duel(ctx, core)

    btn = details["buttons"]
    btn_ok = isinstance(btn, dict) and all(
        v.get("single") and v.get("double") and v.get("led_ok") for v in btn.values()
    )
    m = details["mirror"]
    mirror_ok = m["scored_fraction"] >= MIRROR_MIN_SCORED
    duel = details["duel"]
    duel_ok = bool(duel.get("rounds_won")) if "skipped" not in duel else None
    parts = [
        f"buttons+LED {'ok' if btn_ok else btn if isinstance(btn, str) else 'NOT ok'}",
        f"mirror scored {m['scored_fraction']:.0%} of frames, mean {m['mean_overall']}",
        f"duel {'skipped' if duel_ok is None else ('rounds won ' + str(duel.get('rounds_won'))) if duel_ok else 'no round won'}",
    ]
    s = "; ".join(parts)
    if not btn_ok and not isinstance(btn, str):
        return Result(
            "bad",
            s,
            details,
            fix="Read core.log for RCSP lines; check rcsp.connected in /health.",
        )
    if not mirror_ok:
        return Result(
            "bad",
            s,
            details,
            fix="Mirror needs one master and one learner glove, both tracked.",
        )
    if duel_ok is False:
        return Result(
            "look",
            s,
            details,
            fix="No round won: hold the pose longer, or loosen [score] perfect_deg.",
        )
    return Result(
        "look" if (ctx.dry or isinstance(btn, str) or duel_ok is None) else "ok",
        s,
        details,
    )


# --- step 5: yaw ----------------------------------------------------------------


def step_yaw(ctx: Ctx) -> Result:
    c = ctx.console
    with link(ctx) as core:
        c.say(
            "Put both hands flat on the table, palms down, fingers pointing straight away from you."
        )
        c.enter("Press Enter, then keep still for 2 s.")
        t0 = time.time()
        core.cmd("calibrate")
        ev = core.wait_event(t0, lambda m: m.get("name") == "calibrated", 5)
        time.sleep(1.2)
        t1 = time.time()
        time.sleep(1.5)
        fwd = headings(core.since(t1, "frame"))
        c.say(
            "Now turn both hands a quarter turn to the LEFT (fingers point left), palms still down."
        )
        c.enter("Press Enter, then keep still for 2 s.")
        t2 = time.time()
        time.sleep(1.5)
        left = headings(core.since(t2, "frame"))
    d = {
        "calibrated_event": ev is not None,
        "forward_deg": fwd,
        "turned_left_deg": left,
    }
    bad = []
    for s in SIDES:
        if fwd[s] is None or abs(fwd[s]) > YAW_FORWARD_TOL_DEG:
            bad.append(f"{s} forward {fwd[s]}")
        if (
            left[s] is None
            or fwd[s] is None
            or abs(ang_diff(left[s] - fwd[s], 90.0)) > YAW_TURN_TOL_DEG
        ):
            bad.append(
                f"{s} turn {None if left[s] is None or fwd[s] is None else round(ang_diff(left[s], fwd[s]), 1)}"
            )
    fmt = {s: (None if fwd[s] is None else round(fwd[s], 1)) for s in SIDES}
    fmt2 = {s: (None if left[s] is None else round(left[s], 1)) for s in SIDES}
    summary = f"heading after calibrate {fmt} (0 is away), after left turn {fmt2} (90 expected)"
    if not ev:
        return Result("error", "no calibrated event from the core", d)
    if bad:
        return Result(
            "look" if ctx.dry else "bad",
            summary
            + f"; off: {bad}"
            + (" (fake hands do not follow the prompts)" if ctx.dry else ""),
            d,
            fix="Calibrate again away from metal. If the turn has the wrong sign, the wrist frame "
            "convention differs: see core/hand.py wrist_frame_from_joints (core owner).",
        )
    return Result("ok", summary, d)


# --- step 6: piano ----------------------------------------------------------------


def step_piano(ctx: Ctx) -> Result:
    c = ctx.console
    cue = ctx.opts.piano_cue_seconds
    with link(ctx) as core:
        core.cmd("set_task", {"task": "piano"})
        c.say("Rest the RIGHT hand on the table, fingers curved, like on a keyboard.")
        c.say(
            f"The script names one finger every {cue:.0f} s. Tap that finger on the table twice, firmly."
        )
        c.enter("Press Enter to start.")
        windows = []
        for f in FINGERS:
            c.say(f"   tap: {f.upper()}")
            t = time.time()
            time.sleep(cue)
            windows.append((f, t, time.time()))
        c.say(f"Now keep the hand still for {cue:.0f} s.")
        ts = time.time()
        time.sleep(cue)
        te = time.time()
        downs = [
            e
            for e in core.since(windows[0][1], "event")
            if e.get("name") == "finger_down" and e.get("hand") == "right"
        ]
        core.cmd("set_task", {"task": "general"})
    per = {}
    for f, a, b in windows:
        got = [(e.get("data") or {}).get("finger") for e in downs if a <= e["_rx"] < b]
        per[f] = {"cued": got.count(f), "other": len(got) - got.count(f)}
    false_still = sum(1 for e in downs if ts <= e["_rx"] < te)
    hit = [f for f in FINGERS if per[f]["cued"] >= 1]
    d = {"per_finger": per, "false_when_still": false_still, "events": len(downs)}
    s = f"cued fingers detected {len(hit)}/5 ({', '.join(hit) or 'none'}); taps while still {false_still}"
    fix = (
        "Missed taps: lower [piano] press_velocity_deg_s in config.toml. Idle triggers: raise press_min_deg. "
        "(config.toml is the core owner's file: write the change as a patch.)"
    )
    if len(hit) >= PIANO_MIN_FINGERS and false_still <= PIANO_MAX_FALSE_WHEN_STILL:
        return Result("ok", s, d)
    return Result(
        "look" if ctx.dry else "bad",
        s + (" (fake hands do not tap)" if ctx.dry else ""),
        d,
        fix=fix,
    )


# --- step 7: robot twin flex direction ---------------------------------------------


def _robot_hold(
    ctx: Ctx, core: CoreLink, robot: CoreLink, secs: float
) -> dict[str, dict[str, float]]:
    """Mean q per joint for each hand: half the hold with source master (right), half with learner (left)."""
    out: dict[str, dict[str, float]] = {}
    for src in ("master", "learner"):
        core.cmd("set_robot_source", {"source": src})
        time.sleep(0.3)
        t = time.time()
        time.sleep(max(0.6, secs / 2))
        msgs = [m for m in robot.since(t, "robot") if m.get("source") == src]
        if not msgs:
            continue
        side = msgs[-1].get("hand")
        keys = msgs[-1].get("q", {}).keys()
        out[side] = {
            k: sum(m["q"][k] for m in msgs if k in m.get("q", {})) / len(msgs)
            for k in keys
        }
    return out


def step_robot_flex(ctx: Ctx) -> Result:
    c = ctx.console
    hs = max(2.0, ctx.opts.hold_seconds)
    c.say(
        "Open the robot twin beside you: http://localhost:5173/robot (the frontend), so you can watch it."
    )
    with link(ctx) as core, link(ctx, path="/ws/robot") as robot:
        hello = robot.latest("hello")
        for _ in range(20):
            if hello:
                break
            time.sleep(0.1)
            hello = robot.latest("hello")
        limits = ((hello or {}).get("robot") or {}).get("limits") or {}
        core.cmd("set_roles", {"left": "learner", "right": "master"})
        hold(ctx, "Both hands open and flat, palms down.", hs)
        flat = _robot_hold(ctx, core, robot, hs)
        hold(
            ctx,
            "Both hands: make a slow fist, thumb folded across. Watch the twin curl.",
            hs,
        )
        fist = _robot_hold(ctx, core, robot, hs)
        core.cmd("set_robot_source", {"source": "off"})
        core.cmd("set_roles", {"left": "free", "right": "free"})
    table = []
    wrong = []
    for side in SIDES:
        for name in sorted((fist.get(side) or {}).keys()):
            q0, q1 = flat.get(side, {}).get(name), fist[side][name]
            if q0 is None:
                continue
            lim = (
                (limits.get(side) or {}).get(name)
                if isinstance(limits.get(side), dict)
                else None
            )
            lo, hi = (
                (lim or [None, None])[:2]
                if isinstance(lim, list)
                else ((lim or {}).get("lower"), (lim or {}).get("upper"))
            )
            flex_dir = None if lo is None else (1.0 if abs(hi) >= abs(lo) else -1.0)
            delta = q1 - q0
            toward = (
                None
                if flex_dir is None or abs(delta) < 0.02
                else (delta * flex_dir > 0)
            )
            table.append(
                {
                    "side": side,
                    "joint": name,
                    "flat": round(q0, 3),
                    "fist": round(q1, 3),
                    "delta": round(delta, 3),
                    "toward_flex_limit": toward,
                }
            )
            if toward is False and "thumb_0" not in name:
                wrong.append(name)
    c.say("Joint targets, radians (flat, fist, change, moves toward its flex limit):")
    for r in table:
        c.say(
            f"   {r['side']:5} {r['joint']:28} {r['flat']:7.3f} {r['fist']:7.3f} {r['delta']:7.3f}  {r['toward_flex_limit']}"
        )
    d = {"table": table, "numbers_wrong_way": wrong, "limits_seen": bool(limits)}
    seen = c.yes(
        "On the twin, did every finger curl INTO the palm when you made a fist?",
        default=True,
    )
    d["twin_curls_in"] = seen
    patch = ""
    if not seen:
        name = (
            ""
            if ctx.console.auto
            else input(
                "Which joints bent backwards? (e.g. right_hand_index_0_joint): "
            ).strip()
        )
        d["reported_backwards"] = name
        patch = (
            "Flip the sign for that joint in config.toml (core owner's file), for example:\n"
            "[robot.retarget.index_0]\nsign_right = -1.0   # was the auto sign from the URDF limits"
        )
    s = f"{len(table)} joints compared; numbers move the wrong way on {wrong or 'none'}; twin curls in: {seen}"
    if not table:
        return Result(
            "error",
            "no robot messages on /ws/robot",
            d,
            fix="Check /health robot block and the URDFs in models/robots/dex3_1/.",
        )
    if not seen or wrong:
        return Result(
            _bad(ctx),
            s + _fake_note(ctx),
            d,
            fix=patch
            or "Flip sign_left or sign_right for the listed joints in config.toml [robot.retarget.*].",
        )
    return Result("look" if ctx.dry else "ok", s, d)


# --- step 8: demo lessons -----------------------------------------------------------


def step_demo_lessons(ctx: Ctx) -> Result:
    c = ctx.console
    o = ctx.opts
    lessons, takes = o.lessons, o.takes
    c.say(
        f"Record the demo lessons: {len(lessons)} lessons, {takes} takes each, right hand."
    )
    c.say(
        "Each take is timed, so the gloved hands stay free. The script calls each phase:"
    )
    c.say(
        f"POSE ({o.pose_seconds:.0f} s), FREEZE ({o.freeze_seconds:.0f} s, the held step), "
        f"MOVE ({o.move_seconds:.0f} s, the moving step). Then it saves the take."
    )
    for i, t in enumerate(lessons, 1):
        c.say(f"   {i}. {t}")
    made: list[dict] = []
    with link(ctx) as core:
        core.cmd("set_task", {"task": "general"})
        core.cmd("set_roles", {"left": "free", "right": "master"})
        core.cmd("set_mode", {"mode": "record"})
        for title in lessons:
            for k in range(1, takes + 1):
                name = f"{title} (take {k})"
                c.say(f"--- {name} ---")
                c.enter(
                    "Press Enter (with the left hand) to start. The script then calls each phase."
                )
                core.cmd("record_start", {"title": name})
                c.say(f"   POSE: get into the pose ({o.pose_seconds:.0f} s)")
                time.sleep(o.pose_seconds)
                c.say(f"   FREEZE: keep still ({o.freeze_seconds:.0f} s)")
                time.sleep(o.freeze_seconds)
                core.cmd("record_mark")  # ends the hold step; the move is the next step
                c.say(f"   MOVE: do the move now ({o.move_seconds:.0f} s)")
                time.sleep(o.move_seconds)
                c.say("   STOP.")
                ack = core.cmd("record_stop", {"save": True}, check=False)
                if not ack.get("ok"):
                    made.append({"title": name, "error": ack.get("error")})
                    c.say(f"Not saved: {ack.get('error')}. Retry this take.")
                    continue
                lid = ack["result"]["lesson_id"]
                lesson = http(
                    "GET", f"{ctx.core_http}/lessons/{lid}", timeout=5, trace=ctx.trace
                )
                kinds = [s.get("kind") for s in lesson.get("steps", [])]
                made.append({"title": name, "lesson_id": lid, "steps": kinds})
                c.say(f"Saved {lid}: steps {kinds}")
        core.cmd("set_mode", {"mode": "idle"})
        core.cmd("set_roles", {"left": "free", "right": "free"})
    ctx.state["lessons_made"] = [m["lesson_id"] for m in made if m.get("lesson_id")]
    saved = [m for m in made if m.get("lesson_id")]
    with_hold = [m for m in saved if "hold" in m["steps"]]
    with_both = [m for m in saved if "hold" in m["steps"] and "move" in m["steps"]]
    d = {"takes": made}
    s = (
        f"{len(saved)}/{len(lessons) * takes} takes saved; {len(with_hold)} have a hold step; "
        f"{len(with_both)} have a hold and a move step"
    )
    if len(saved) < len(lessons) * takes:
        return Result(
            "bad", s, d, fix="Retry the takes that did not save (too short?)."
        )
    if len(with_both) < len(saved):
        return Result(
            _bad(ctx),
            s + _fake_note(ctx),
            d,
            fix="A take is not hold then move: keep fully still in FREEZE and move clearly in MOVE "
            "(a step is a hold when it stays still; core/recorder.py).",
        )
    return Result("ok", s, d)


# --- step 9: fingerspelling letters into a pack ----------------------------------------


def step_pack_letters(ctx: Ctx) -> Result:
    """A person holds each letter from the official chart; the core records a hold take; the pack stores it."""
    import slot_letters as L

    c = ctx.console
    o = ctx.opts
    files = L.pack_files(ctx.repo)
    data = L.load_packs(files[0])
    pack = L.find_pack(data, o.pack)
    todo = L.letters_to_record(pack, o.pack_letters or None)
    if not todo:
        return Result(
            "ok",
            f"every slot of {pack['name']} is recorded; nothing to do",
            {"pack": o.pack},
        )
    # The dry run never touches the repo's pack: fake hands are not a person holding the chart.
    target = [ctx.run_dir / "fingerspelling_packs.json"] if ctx.dry else files
    c.say(
        f"Record {pack['name']}: {', '.join(todo)}. Right hand, one hold take per letter."
    )
    c.say(
        "Hold each letter exactly as the official chart shows it. Nothing is generated or guessed."
    )
    by = o.recorded_by or c.text(
        "Your name (stored with each letter as recorded_by)", ctx.wearer
    )
    ref = o.reference or c.text(
        "The reference you hold the letters against (URL or document)",
        pack["default_reference"]["url"],
    )
    c.say(f"Open the chart now: {ref}")
    made: list[dict] = []
    with link(ctx) as core:
        core.cmd("set_task", {"task": "general"})
        core.cmd("set_roles", {"left": "free", "right": "master"})
        core.cmd("set_mode", {"mode": "record"})
        for letter in todo:
            c.say(f"--- the letter {letter} ---")
            c.enter(
                f"Find {letter} on the chart. Press Enter (with the left hand), then make it with the right hand."
            )
            t = L.record_take(
                core,
                lambda lid: http(
                    "GET", f"{ctx.core_http}/lessons/{lid}", timeout=5, trace=ctx.trace
                ),
                letter,
                L.take_title(pack, letter),
                o.pose_seconds,
                o.freeze_seconds * 1.5,
                c.say,
            )
            row = {
                "letter": letter,
                "lesson_id": t.lesson_id,
                "pose": t.pose,
                "error": t.error,
            }
            if t.error or not t.pose:
                c.say(f"Not stored: {t.error}. Retry this step for {letter}.")
            else:
                L.store_letter(data, o.pack, letter, by, ref, t.lesson_id or "", t.pose)
                L.write_packs(target, data)
                c.say(f"Stored {letter}: curls {t.pose}")
            made.append(row)
        core.cmd("set_mode", {"mode": "idle"})
        core.cmd("set_roles", {"left": "free", "right": "free"})
    stored = [m for m in made if m["pose"] and not m["error"]]
    d = {
        "pack": o.pack,
        "recorded_by": by,
        "reference": ref,
        "letters": made,
        "written": [str(p) for p in target],
    }
    where = (
        f"the dry run's copy {target[0]}"
        if ctx.dry
        else "the pack file and its frontend copy"
    )
    s = f"{len(stored)}/{len(todo)} letters stored into {where}"
    if len(stored) < len(todo):
        return Result(
            "bad",
            s,
            d,
            fix="Retry the step for the letters that did not save (hold still for the whole take).",
        )
    if ctx.dry:
        return Result(
            "look",
            s + " (fake hands do not make the letters; the repo pack is unchanged)",
            d,
        )
    return Result(
        "ok",
        s
        + ". Commit backend/app/data/fingerspelling_packs.json and its frontend copy.",
        d,
    )


STEPS = [
    (0, "stack", "Live stack up", step_stack),
    (1, "depth", "Depth clip from the phone, 40 s", step_depth),
    (2, "right_thumb", "Right thumb recalibration, thumb folded", step_right_thumb),
    (3, "left_glove", "Left glove recalibration", step_left_glove),
    (
        4,
        "button_led_mirror_duel",
        "Button, LED, mirror and duel",
        step_button_led_mirror_duel,
    ),
    (5, "yaw", "Yaw calibration", step_yaw),
    (6, "piano", "Piano press", step_piano),
    (7, "robot_flex", "Robot twin flex direction", step_robot_flex),
    (8, "demo_lessons", "Record the demo lessons", step_demo_lessons),
    (
        9,
        "pack_letters",
        "Fingerspelling letters into a pack, from the official chart",
        step_pack_letters,
    ),
]
