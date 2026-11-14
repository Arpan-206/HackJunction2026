"""Modes, roles and the step state machine. Everything the viewer sees comes through here."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path

import numpy as np

from . import hand as H
from .calibration import Calibrations
from .coach import Coach, CoachLine
from .priors.facts import from_scorer as prior_facts
from .recorder import Lesson, Recorder, delete_lesson, list_lessons
from .robot import SOURCES as ROBOT_SOURCES
from .robot import Retargeter
from .scorer import FrameScore, MirrorScorer, StepScorer, Tolerances
from .tasks import TASKS, task_state
from .tasks.piano import PianoTask
from .tasks.typing import TypingTask

log = logging.getLogger("geppetto.session")

MODES = ["idle", "record", "learn", "mirror", "duel", "playback"]
ROLES = ["master", "learner", "free"]
SIDES = ["left", "right"]
SOURCES = ["glove", "camera", "none"]


class CommandError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class Session:
    def __init__(
        self,
        cfg,
        clock,
        lessons_dir: Path,
        coach: Coach,
        fake: bool = False,
        on_step: Callable[[int, int], None] | None = None,
        on_calibrate: Callable[[], None] | None = None,
    ) -> None:
        self.cfg = cfg
        self.clock = clock
        self.lessons_dir = Path(lessons_dir)
        self.coach = coach
        self.fake = fake
        self.on_step = on_step
        self.on_calibrate = on_calibrate

        self.mode = "idle"
        self.task = "general"
        self.task_config: dict = {}
        self.lesson: Lesson | None = None
        self.step_index: int | None = None
        self.roles: dict[str, str] = dict(cfg.session.default_roles)
        self.sources: dict[str, str] = {
            "left": cfg.sources.left,
            "right": cfg.sources.right,
        }
        self.tempo = float(cfg.session.tempo_default)
        self.loop = bool(cfg.session.loop_default)
        self.calibrated = False
        # Per-wearer flat and fist calibration (core/calibration.py). The fake
        # gloves are synthetic and already read 0 when flat, so they skip it.
        self.calibrations = Calibrations(cfg)
        if not fake:
            self.calibrations.reload()
        self.anchor = "rest"
        self.recorder = Recorder(cfg.record, cfg.score.hold_ms_default)
        self.hands: dict[str, H.HandState | None] = {"left": None, "right": None}
        self.outbox: list[dict] = []
        self.scorers: dict[str, StepScorer] = {}
        self.mirror: MirrorScorer | None = None
        self.step_t0_us = 0
        self.playback_t0_us = 0
        self.duel = {
            "round": 1,
            "rounds": int(cfg.session.duel_rounds),
            "wins": {"left": 0, "right": 0},
        }
        self._pinch_hold: dict[str, int | None] = {"left": None, "right": None}
        self._pinch_fired: dict[str, bool] = {"left": False, "right": False}
        self.answers: dict[str, str] = {}
        self.piano: PianoTask | None = None
        self.typing: TypingTask | None = None
        self.seq = 0
        root = Path(cfg.get_path("_root", "."))
        self.robot: Retargeter | None = None
        self.robot_error: str | None = None
        self.robot_source = "off"
        try:
            self.robot = Retargeter(cfg.robot, root)
            self.robot_source = (
                str(cfg.robot.source) if cfg.robot.source in ROBOT_SOURCES else "off"
            )
        except Exception as e:  # a missing URDF must not stop the server; the robot block is then absent
            self.robot_error = f"{type(e).__name__}: {e}"
            log.warning("robot output disabled: %s", self.robot_error)
        self.attempts_log: Path | None = root / cfg.server.logs_dir / "attempts.jsonl"
        # Depth step (core/camera/depth_live.py), attached by __main__ with --depth; None leaves
        # the frame exactly as before (no "depth" key, no yaw correction).
        self.depth = None

    def log_attempt(self, summary: dict) -> None:
        """Append a step summary to logs/attempts.jsonl (visitor attempt log, for tuning tolerances later)."""
        if self.attempts_log is None:
            return
        try:
            self.attempts_log.parent.mkdir(parents=True, exist_ok=True)
            with open(self.attempts_log, "a") as f:
                f.write(
                    json.dumps(
                        {
                            "t": self.now(),
                            "lesson_id": self.lesson.id if self.lesson else None,
                            "mode": self.mode,
                            **summary,
                        }
                    )
                    + "\n"
                )
        except OSError as e:
            log.warning("attempt log failed: %s", e)

    # ------------------------------------------------------------------ messages
    def now(self) -> int:
        return int(self.clock.now_us())

    def envelope(self, kind: str) -> dict:
        return {"v": 1, "type": kind, "t": self.now()}

    def session_state(self) -> dict:
        return {
            "mode": self.mode,
            "task": self.task,
            "lesson_id": self.lesson.id if self.lesson else None,
            "step": self.step_index if self.lesson else None,
            "steps_total": len(self.lesson.steps) if self.lesson else 0,
            "roles": dict(self.roles),
            "recording": bool(self.recorder.active),
            "calibrated": bool(self.calibrated),
            "anchor": self.anchor,
            "tempo": float(self.tempo),
            "loop": bool(self.loop),
            "gemma": "off",
            "sources": dict(self.sources),
            "robot_source": self.robot_source,
        }

    def hello(self) -> dict:
        return {
            **self.envelope("hello"),
            "joint_names": list(H.JOINT_NAMES),
            "fingers": list(H.FINGERS),
            "tasks": list(TASKS),
            "modes": list(MODES),
            "lessons": list_lessons(self.lessons_dir),
            "session": self.session_state(),
            "fake": bool(self.fake),
            "robot": self.robot.describe() if self.robot is not None else None,
        }

    def lesson_message(self) -> dict | None:
        if self.lesson is None:
            return None
        return {**self.envelope("lesson"), "lesson": self.lesson.to_json()}

    def emit_session(self) -> None:
        self.outbox.append({**self.envelope("session"), **self.session_state()})

    def emit_event(self, name: str, hand: str | None, data: dict | None = None) -> None:
        self.outbox.append(
            {
                **self.envelope("event"),
                "name": name,
                "hand": hand,
                "data": dict(data or {}),
            }
        )

    def emit_coach(self, line: CoachLine | None) -> None:
        if line is not None:
            self.outbox.append({**self.envelope("coach"), **line.to_message()})

    def emit_lesson(self) -> None:
        msg = self.lesson_message()
        if msg is not None:
            self.outbox.append(msg)

    def drain(self) -> list[dict]:
        out, self.outbox = self.outbox, []
        return out

    # ------------------------------------------------------------------ hands in
    def update_hand(
        self,
        side: str,
        hand: H.HandState | None,
        pinch_events: list[tuple[str, str]] | None = None,
    ) -> None:
        if hand is not None:
            hand.role = self.roles.get(side, "free")
            if not self.fake:
                self.calibrations.apply(hand)
        self.hands[side] = hand
        for finger, name in pinch_events or []:
            self.emit_event(name, side, {"finger": finger})
        self._control_pinch(side, hand)

    def _control_pinch(self, side: str, hand: H.HandState | None) -> None:
        finger = self.cfg.session.control_pinch
        pinched = bool(
            hand is not None and hand.tracked and hand.pinch.get(finger, False)
        )
        if pinched:
            # only the hand in use, and only with the other fingers open (a fist is not a command)
            active = (
                (self.recorder.master_hand if self.recorder.active else None)
                if self.mode == "record"
                else (
                    self.learner_sides()
                    if self.mode in ("learn", "mirror", "duel")
                    else None
                )
            )
            if active is not None and side not in (
                active if isinstance(active, list) else [active]
            ):
                pinched = False
            others = [hand.curl.get(f, 0.0) for f in ("index", "middle", "ring")]
            if max(others) > float(self.cfg.session.control_pinch_max_other_curl):
                pinched = False
        t = self.now()
        if not pinched:
            self._pinch_hold[side] = None
            self._pinch_fired[side] = False
            return
        if self._pinch_hold[side] is None:
            self._pinch_hold[side] = t
            return
        if (
            self._pinch_fired[side]
            or t - self._pinch_hold[side]
            < self.cfg.session.control_pinch_hold_ms * 1000
        ):
            return
        self._pinch_fired[side] = True
        try:
            if self.mode == "record" and self.recorder.active:
                self.handle_command("record_mark", {})
            elif self.mode in ("learn", "mirror", "duel") and self.lesson is not None:
                self.handle_command("step_restart", {})
        except CommandError as e:
            log.info("control pinch ignored: %s", e.message)

    def handle_button(self, side: str, press: str) -> None:
        """Glove button. SinglePress, DoublePress or LongPress."""
        self.emit_event("button", side, {"press": press})
        try:
            if press == "LongPress":
                self.handle_command("calibrate", {})
            elif self.mode in ("idle", "record"):
                if press == "SinglePress":
                    if self.recorder.active:
                        self.handle_command("record_stop", {"save": True})
                    else:
                        if self.mode != "record":
                            self.handle_command("set_mode", {"mode": "record"})
                        # the glove whose button was pressed is the one recorded
                        self.handle_command("record_start", {"hand": side})
                elif press == "DoublePress" and self.recorder.active:
                    self.handle_command("record_stop", {"save": False})
            elif self.mode in ("learn", "mirror", "duel"):
                if press == "SinglePress":
                    self.handle_command("step_next", {})
                elif press == "DoublePress":
                    self.handle_command("step_prev", {})
        except CommandError as e:
            log.info("button %s ignored: %s", press, e.message)

    # ------------------------------------------------------------------ helpers
    def sides_with_role(self, role: str) -> list[str]:
        return [s for s in SIDES if self.roles.get(s) == role]

    def learner_sides(self) -> list[str]:
        return self.sides_with_role("learner")

    def primary_learner(self) -> str | None:
        ls = self.learner_sides()
        return ls[0] if ls else None

    def _tol_for(self, side: str) -> Tolerances:
        camera = self.sources.get(side) == "camera" or (
            self.lesson is not None and self.lesson.source == "camera"
        )
        sc = self.cfg.score.camera if camera else self.cfg.score
        return Tolerances(float(sc.perfect_deg), float(sc.wrong_deg))

    def _cal_for(self, side: str):
        """The calibration applied to this side's hands, or None (fake, camera, none loaded)."""
        if self.fake or self.sources.get(side) != "glove":
            return None
        return self.calibrations.by_side.get(side)

    def _weights_for(
        self, side: str, weights: dict[str, float]
    ) -> tuple[dict[str, float], np.ndarray | None]:
        """Step weights times the learner calibration's finger mask, and its slot mask."""
        cal = self._cal_for(side)
        if cal is None:
            return dict(weights), None
        mask = cal.finger_weights()
        return (
            {f: float(weights.get(f, 1.0)) * mask[f] for f in H.FINGERS},
            cal.slot_weights(),
        )

    def _mirror_scorer(self, learner: str) -> MirrorScorer:
        """Mirror mode: every finger counts, minus joints either hand's calibration cannot read."""
        w, slots = self._weights_for(learner, {f: 1.0 for f in H.FINGERS})
        for m in self.sides_with_role("master"):
            mw, mslots = self._weights_for(m, w)
            w = mw
            if mslots is not None:
                slots = mslots if slots is None else slots * mslots
        return MirrorScorer(
            learner,
            self.cfg.score,
            self._tol_for(learner),
            self.cfg.session.mirror_delay_ms,
            w,
            slots,
        )

    def _rest(self, side: str) -> tuple[np.ndarray, np.ndarray]:
        rp = self.cfg.rest_pose[side]
        return np.asarray(rp.p, dtype=float), np.asarray(rp.q, dtype=float)

    def _master_hand_for_recording(self, wanted: str | None = None) -> str:
        """A master glove first; else the hand asked for (the glove whose button was
        pressed); else the first tracked hand."""
        masters = [
            s for s in self.sides_with_role("master") if self.hands.get(s) is not None
        ]
        if masters:
            return masters[0]
        if wanted in SIDES and self.hands.get(wanted) is not None:
            return wanted
        tracked = [
            s for s in SIDES if self.hands.get(s) is not None and self.hands[s].tracked
        ]
        if tracked:
            return tracked[0]
        present = [s for s in SIDES if self.hands.get(s) is not None]
        if present:
            return present[0]
        raise CommandError(
            "bad_state", "no hand to record; set a master role or put a glove on"
        )

    # ------------------------------------------------------------------ steps
    def start_step(self, index: int, restart: bool = False) -> None:
        assert self.lesson is not None
        t = self.now()
        self.step_index = int(index)
        step = self.lesson.steps[self.step_index]
        self.step_t0_us = t
        sides = (
            self.learner_sides()
            if self.mode != "duel"
            else [s for s in SIDES if self.roles.get(s) != "free"] or SIDES
        )
        self.scorers = {}
        for s in sides:
            w, slots = self._weights_for(s, step.weights)
            sc = StepScorer(
                s, self.lesson, step, self.cfg.score, self._tol_for(s), w, slots
            )
            sc.reset_attempt(t)
            self.scorers[s] = sc
        self.emit_event(
            "step_restarted" if restart else "step_started",
            self.primary_learner(),
            {"step": self.step_index, "score": 0.0, "attempts": 1, "time_ms": 0},
        )
        if self.on_step is not None:
            self.on_step(self.step_index, t)

    def ghost_t(self, t_us: int) -> int:
        assert self.lesson is not None and self.step_index is not None
        step = self.lesson.steps[self.step_index]
        if step.kind == "hold":
            return int(step.key_t_us)
        return int(step.t0_us + (t_us - self.step_t0_us) * self.tempo)

    def _advance_after_pass(self, side: str, sc: StepScorer, t_us: int) -> None:
        assert self.lesson is not None and self.step_index is not None
        fs = sc.last
        self.log_attempt(sc.summary(t_us, self.task, self.lesson.title, stuck=False))
        self.emit_event(
            "step_passed",
            side,
            {
                "step": self.step_index,
                "score": round(float(fs.overall), 3) if fs else 1.0,
                "attempts": sc.attempt,
                "time_ms": int((t_us - self.step_t0_us) / 1000),
            },
        )
        self.emit_coach(self.coach.praise(self.step_index, side))
        if self.mode == "duel":
            self.duel["wins"][side] += 1
            self.emit_event(
                "round_won", side, {"hand": side, "round": self.duel["round"]}
            )
            self.duel["round"] += 1
        nxt = self.step_index + 1
        if nxt >= len(self.lesson.steps):
            self.emit_event(
                "lesson_complete",
                side,
                {
                    "step": self.step_index,
                    "score": round(float(fs.overall), 3) if fs else 1.0,
                    "attempts": sc.attempt,
                    "time_ms": int((t_us - self.step_t0_us) / 1000),
                },
            )
            if self.mode == "duel":
                self.duel = {
                    "round": 1,
                    "rounds": self.duel["rounds"],
                    "wins": {"left": 0, "right": 0},
                }
            nxt = 0
        self.start_step(nxt)
        self.emit_session()

    def _attempt_failed(self, side: str, sc: StepScorer, t_us: int) -> None:
        assert self.lesson is not None and self.step_index is not None
        summary = sc.summary(t_us, self.task, self.lesson.title, stuck=False)
        summary = prior_facts(summary, sc)  # PRIORS_ASL / PRIORS_PIANO, off by default
        self.log_attempt(summary)
        log.info("attempt failed: %s", summary)
        self.emit_coach(self.coach.on_summary(t_us, summary))
        if self.loop:
            for (
                other
            ) in self.scorers.values():  # duel: every hand starts the step again
                other.new_attempt(t_us)
            self.step_t0_us = t_us
            self.emit_event(
                "step_restarted",
                side,
                {
                    "step": self.step_index,
                    "score": summary["overall"],
                    "attempts": sc.attempt,
                    "time_ms": 0,
                },
            )
        else:
            self.start_step((self.step_index + 1) % len(self.lesson.steps))
            self.emit_session()

    def _stuck(self, side: str, sc: StepScorer, t_us: int) -> None:
        assert self.lesson is not None
        summary = sc.summary(t_us, self.task, self.lesson.title, stuck=True)
        summary = prior_facts(summary, sc)  # PRIORS_ASL / PRIORS_PIANO, off by default
        self.log_attempt(summary)
        log.info("stuck: %s", summary)
        self.emit_event(
            "stuck",
            side,
            {
                "step": summary["step"]["index"],
                "score": summary["overall"],
                "attempts": sc.attempt,
                "time_ms": int(summary["stuck_s"] * 1000),
            },
        )
        self.emit_coach(self.coach.on_summary(t_us, summary))

    # ------------------------------------------------------------------ ghosts
    def _ghost_from_local(
        self,
        side: str,
        local: np.ndarray,
        source: str,
        lesson_t: int | None,
        placement: str = "on_learner",
        master_side: str | None = None,
    ) -> dict:
        if master_side is not None and master_side != side:
            local = H.mirror_local(local)
        h = self.hands.get(side)
        if h is not None:
            p, q = h.wrist_p, h.wrist_q
        else:
            p, q = self._rest(side)
        world = H.local_to_world(local, p, q)
        dec = int(self.cfg.hand.joint_decimals)
        return {
            "joints": np.round(world, dec).tolist(),
            "wrist": {
                "p": [float(x) for x in np.round(p, dec)],
                "q": [float(x) for x in np.round(q, 5)],
            },
            "placement": placement,
            "source": source,
            "lesson_t": None if lesson_t is None else int(lesson_t),
            "angles": [float(x) for x in np.round(H.angle_features(local), 1)],
        }

    def _lesson_ghost(self, side: str, gt: int) -> dict:
        assert self.lesson is not None and self.step_index is not None
        step = self.lesson.steps[self.step_index]
        if step.kind == "hold" or self.lesson.trace is None:
            local = step.key_joints
        else:
            local = self.lesson.joints_local_at(min(max(gt, step.t0_us), step.t1_us))
        return self._ghost_from_local(
            side, local, "lesson", gt, "on_learner", self.lesson.master_hand
        )

    def _playback_ghost(self, t_us: int) -> tuple[str, dict]:
        assert self.lesson is not None
        side = self.lesson.master_hand
        dur = max(1, int(self.lesson.duration_us))
        lt = int(((t_us - self.playback_t0_us) * self.tempo) % dur)
        if self.lesson.trace is not None:
            local = self.lesson.joints_local_at(lt)
            wp, wq = self.lesson.wrist_at(lt)
        else:
            idx = 0
            for i, s in enumerate(self.lesson.steps):
                if s.t0_us <= lt < s.t1_us:
                    idx = i
            local, wq = (
                self.lesson.steps[idx].key_joints,
                self.lesson.steps[idx].key_wrist_q,
            )
            wp = np.full(3, np.nan)
        rp, _ = self._rest(side)
        p = rp if np.any(np.isnan(wp)) else np.asarray(wp, dtype=float)
        world = H.local_to_world(local, p, wq)
        dec = int(self.cfg.hand.joint_decimals)
        ghost = {
            "joints": np.round(world, dec).tolist(),
            "wrist": {
                "p": [float(x) for x in np.round(p, dec)],
                "q": [float(x) for x in np.round(wq, 5)],
            },
            "placement": "recorded",
            "source": "lesson",
            "lesson_t": lt,
            "angles": [float(x) for x in np.round(H.angle_features(local), 1)],
        }
        # playback: show the current step for the codex
        for i, s in enumerate(self.lesson.steps):
            if s.t0_us <= lt < s.t1_us and i != self.step_index:
                self.step_index = i
                self.emit_session()
                break
        return side, ghost

    # ------------------------------------------------------------------ tick
    def tick(self, t_us: int | None = None) -> dict:
        t = int(t_us) if t_us is not None else self.now()
        self.seq += 1
        frame = {
            "v": 1,
            "type": "frame",
            "t": t,
            "seq": self.seq,
            "hands": {},
            "ghost": {},
            "score": None,
            "task": {},
        }
        if self.depth is not None:
            self.depth.apply(self.hands, t)
        dec = int(self.cfg.hand.joint_decimals)
        for side in SIDES:
            h = self.hands.get(side)
            frame["hands"][side] = (
                None if h is None else h.to_message(dec, include_rots=False)
            )

        if (
            self.mode in ("learn", "duel")
            and self.lesson is not None
            and self.step_index is not None
            and self.scorers
        ):
            gt = self.ghost_t(t)
            scores: dict[str, dict | None] = {}
            passed_side = None
            for side, sc in list(self.scorers.items()):
                h = self.hands.get(side)
                fs: FrameScore | None = None
                if h is not None and h.tracked:
                    fs = sc.update(t, h.angles, gt)
                frame["ghost"][side] = self._lesson_ghost(side, gt)
                scores[side] = (
                    fs.to_message()
                    if fs is not None
                    else (sc.last.to_message() if sc.last else None)
                )
                if fs is not None and fs.passed and passed_side is None:
                    passed_side = side
            if passed_side is not None:
                self._advance_after_pass(
                    passed_side, self.scorers.get(passed_side) or sc, t
                )
            else:
                for side, sc in list(self.scorers.items()):
                    if sc.move_step_finished(gt):
                        self._attempt_failed(side, sc, t)
                        break
                    if sc.stuck_due(t):
                        self._stuck(side, sc, t)
            primary = self.primary_learner() or next(iter(self.scorers))
            frame["score"] = scores.get(primary)
            if self.mode == "duel":
                frame["scores"] = scores
        elif self.mode == "mirror" and self.mirror is not None:
            masters, learners = self.sides_with_role("master"), self.learner_sides()
            if masters and learners:
                m, l = self.hands.get(masters[0]), self.hands.get(learners[0])
                if m is not None and m.tracked:
                    self.mirror.push_master(t, m.angles)
                    frame["ghost"][learners[0]] = self._ghost_from_local(
                        learners[0],
                        m.joints_local,
                        "live",
                        None,
                        "on_learner",
                        masters[0],
                    )
                if l is not None and l.tracked:
                    fs = self.mirror.update(t, l.angles)
                    frame["score"] = fs.to_message() if fs else None
        elif self.mode == "playback" and self.lesson is not None:
            side, ghost = self._playback_ghost(t)
            frame["ghost"][side] = ghost
        elif self.mode == "record" and self.recorder.active:
            side = self.recorder.master_hand
            h = self.hands.get(side)
            if h is not None and h.tracked:
                self.recorder.add(h)

        if self.task == "piano":
            self._piano_tick(t)
        if self.task == "typing":
            self._typing_tick(t)
        frame["task"] = task_state(self)
        frame["robot"] = self.robot_block(t)
        if self.depth is not None:
            frame["depth"] = self.depth.block()
        self.emit_coach_flush(t)
        return frame

    # ------------------------------------------------------------------ robot
    def robot_angles(self, t_us: int) -> tuple[np.ndarray, str, str] | None:
        """(angles, hand side, 'hand'|'lesson') for the robot source, or None."""
        src = self.robot_source
        if self.robot is None or src == "off":
            return None
        if src in ("master", "learner"):
            sides = self.sides_with_role(src)
            for side in sides:
                h = self.hands.get(side)
                if h is not None and h.tracked:
                    return h.angles, side, "hand"
            return None
        # lesson: the current step as the demonstrator, in learn, duel and playback modes
        if (
            self.lesson is None
            or self.step_index is None
            or self.mode not in ("learn", "duel", "playback")
        ):
            return None
        step = self.lesson.steps[self.step_index]
        if self.mode == "playback" and self.lesson.trace is not None:
            dur = max(1, int(self.lesson.duration_us))
            lt = int(((t_us - self.playback_t0_us) * self.tempo) % dur)
            return self.lesson.angles_at(lt), self.lesson.master_hand, "lesson"
        if step.kind == "hold" or self.lesson.trace is None:
            return step.key_angles, self.lesson.master_hand, "lesson"
        gt = int(np.clip(self.ghost_t(t_us), step.t0_us, step.t1_us))
        return self.lesson.angles_at(gt), self.lesson.master_hand, "lesson"

    def robot_block(self, t_us: int) -> dict | None:
        got = self.robot_angles(t_us)
        if got is None:
            return None
        angles, side, origin = got
        return self.robot.targets(angles, side).to_message(self.robot_source, origin)

    def cmd_set_robot_source(self, args: dict) -> dict:
        src = args.get("source")
        if src not in ROBOT_SOURCES:
            raise CommandError("bad_args", f"source must be one of {ROBOT_SOURCES}")
        if self.robot is None and src != "off":
            raise CommandError(
                "bad_state", f"robot output unavailable: {self.robot_error}"
            )
        self.robot_source = src
        self.emit_session()
        return {"source": src, "model": self.robot.model_name if self.robot else None}

    def emit_coach_flush(self, t_us: int) -> None:
        for line in self.coach.flush_pending(t_us):
            self.emit_coach(line)

    # ------------------------------------------------------------------ commands
    def handle_command(self, name: str, args: dict | None) -> dict:
        args = dict(args or {})
        fn = getattr(self, f"cmd_{name}", None)
        if fn is None:
            raise CommandError("bad_args", f"unknown command {name!r}")
        return fn(args)

    def _need_lesson(self) -> Lesson:
        if self.lesson is None:
            raise CommandError("bad_state", "no lesson loaded")
        return self.lesson

    def cmd_ping(self, args: dict) -> dict:
        return {"t": self.now()}

    def cmd_set_mode(self, args: dict) -> dict:
        mode = args.get("mode")
        if mode not in MODES:
            raise CommandError("bad_args", f"mode must be one of {MODES}")
        if mode in ("learn", "playback", "duel"):
            self._need_lesson()
        if mode == "mirror":
            if not self.sides_with_role("master") or not self.learner_sides():
                raise CommandError(
                    "bad_state", "mirror needs one master and one learner role"
                )
        if mode == "learn" and not self.learner_sides():
            raise CommandError("bad_state", "learn needs a learner role")
        if self.recorder.active and mode != "record":
            self.recorder.stop(self.now(), save=False)
            self.emit_event("recording_stopped", None, {"lesson_id": None})
        self.mode = mode
        self.scorers = {}
        self.mirror = None
        if mode in ("learn", "duel"):
            if mode == "duel":
                self.duel = {
                    "round": 1,
                    "rounds": self.duel["rounds"],
                    "wins": {"left": 0, "right": 0},
                }
            self.start_step(self.step_index or 0)
        elif mode == "mirror":
            l = self.learner_sides()[0]
            self.mirror = self._mirror_scorer(l)
        elif mode == "playback":
            self.playback_t0_us = self.now()
            self.step_index = 0
        self.emit_session()
        return {"mode": self.mode}

    def _reset_task(self) -> None:
        self.piano = (
            PianoTask(self.cfg.piano, self.task_config, self.now(), self.loop)
            if self.task == "piano"
            else None
        )
        self.typing = (
            TypingTask(
                self.cfg.get_path("typing", self.cfg.piano), self.task_config, self.fake
            )
            if self.task == "typing"
            else None
        )

    def _typing_tick(self, t_us: int) -> None:
        if self.typing is None:
            return
        for side in SIDES:
            h = self.hands.get(side)
            self.typing.feed(
                t_us, side, h.angles if (h is not None and h.tracked) else None
            )
        for v in self.typing.due(t_us):
            hand = v["detected"]["hand"] if v["detected"] else None
            self.emit_event("keystroke", hand, v)

    def cmd_keystroke(self, args: dict) -> dict:
        """Typing task: one keydown from the viewer. The verdict follows as a `keystroke` event."""
        if self.typing is None:
            raise CommandError("bad_state", "keystroke needs the typing task")
        key = args.get("key")
        t = args.get("t", self.now())
        if not isinstance(t, int) or isinstance(t, bool):
            raise CommandError("bad_args", "t must be an integer in core microseconds")
        ks = self.typing.keystroke(key, t)
        if ks is None:
            raise CommandError("bad_args", f"no chart key {key!r}")
        return {"id": ks.id, "key": ks.key, "due_ms": int(self.typing.p["post_ms"])}

    def cmd_typing_reset(self, args: dict) -> dict:
        """Typing task: clear the per-finger tally."""
        if self.typing is None:
            raise CommandError("bad_state", "typing_reset needs the typing task")
        self.typing.reset_tally()
        return {"ok": True}

    def _piano_tick(self, t_us: int) -> None:
        if self.piano is None:
            return
        side = self.primary_learner() or next(
            (s for s in SIDES if self.hands.get(s) is not None), None
        )
        h = self.hands.get(side) if side else None
        angles = h.angles if (h is not None and h.tracked) else None
        for name, data in self.piano.update(t_us, angles):
            self.emit_event(name, side, data)

    def cmd_set_task(self, args: dict) -> dict:
        task = args.get("task")
        if task not in TASKS:
            raise CommandError("bad_args", f"task must be one of {TASKS}")
        config = args.get("config", {})
        if not isinstance(config, dict):
            raise CommandError("bad_args", "config must be an object")
        if task == "piano":
            tempo = config.get("tempo_bpm", self.cfg.piano.default_tempo_bpm)
            if (
                not isinstance(tempo, (int, float))
                or isinstance(tempo, bool)
                or tempo <= 0
            ):
                raise CommandError("bad_args", "tempo_bpm must be a positive number")
            for n in config.get("notes", []):
                if (
                    not isinstance(n, dict)
                    or not isinstance(n.get("beat"), (int, float))
                    or n.get("finger") not in H.FINGERS
                ):
                    raise CommandError(
                        "bad_args", "each note needs a numeric beat and a finger name"
                    )
        self.task, self.task_config = task, dict(config)
        self._reset_task()
        self.emit_session()
        return {"task": task, "config": self.task_config}

    def cmd_set_roles(self, args: dict) -> dict:
        roles = {}
        for side in SIDES:
            r = args.get(side, self.roles[side])
            if r not in ROLES:
                raise CommandError("bad_args", f"{side} role must be one of {ROLES}")
            roles[side] = r
        self.roles = roles
        for side in SIDES:
            if self.hands.get(side) is not None:
                self.hands[side].role = roles[side]
        if (
            self.mode in ("learn", "duel")
            and self.lesson is not None
            and self.step_index is not None
        ):
            if self.mode == "learn" and not self.learner_sides():
                self.mode = "idle"
                self.scorers = {}
            else:
                self.start_step(self.step_index, restart=True)
        if self.mode == "mirror":
            if self.sides_with_role("master") and self.learner_sides():
                l = self.learner_sides()[0]
                self.mirror = self._mirror_scorer(l)
            else:
                self.mode, self.mirror = "idle", None
        self.emit_session()
        return {"roles": dict(self.roles)}

    def cmd_set_sources(self, args: dict) -> dict:
        for side in SIDES:
            s = args.get(side, self.sources[side])
            if s not in SOURCES:
                raise CommandError(
                    "bad_args", f"{side} source must be one of {SOURCES}"
                )
            self.sources[side] = s
        self.emit_session()
        return {"sources": dict(self.sources)}

    def cmd_calibrate(self, args: dict) -> dict:
        if self.on_calibrate is not None:
            self.on_calibrate()
        if not self.fake:
            # pick up a flat and fist calibration saved since start
            self.calibrations.reload()
        self.calibrated = True
        self.emit_event("calibrated", None, {"what": "yaw"})
        self.emit_session()
        return {"what": "yaw"}

    def cmd_calibrate_camera(self, args: dict) -> dict:
        raise CommandError(
            "device", "no camera anchor tonight; wrist position uses the rest pose"
        )

    def cmd_record_start(self, args: dict) -> dict:
        if self.mode != "record":
            raise CommandError("bad_state", "mode must be record")
        if self.recorder.active:
            raise CommandError("busy", "already recording")
        side = self._master_hand_for_recording(args.get("hand"))
        title = str(args.get("title") or f"{self.task} lesson")
        source = self.sources.get(side, "glove")
        self.recorder.start(
            self.now(),
            title,
            self.task,
            self.task_config,
            side,
            source=(
                "fake" if self.fake else ("camera" if source == "camera" else "glove")
            ),
        )
        self.emit_event("recording_started", side, {"title": title})
        self.emit_session()
        return {"title": title, "hand": side}

    def cmd_record_mark(self, args: dict) -> dict:
        if not self.recorder.active:
            raise CommandError("bad_state", "not recording")
        idx = self.recorder.mark(self.now())
        self.emit_event("step_marked", self.recorder.master_hand, {"index": idx})
        return {"index": idx}

    def cmd_record_stop(self, args: dict) -> dict:
        if not self.recorder.active:
            raise CommandError("bad_state", "not recording")
        save = bool(args.get("save", True))
        mcal = self._cal_for(self.recorder.master_hand)
        lesson = self.recorder.stop(
            self.now(),
            save=save,
            usable=None if mcal is None else mcal.finger_weights(),
        )
        if save and lesson is None:
            self.emit_event("recording_stopped", None, {"lesson_id": None})
            self.emit_session()
            raise CommandError("bad_state", "recording too short to save")
        if lesson is not None:
            lesson.save(self.lessons_dir)
            self.lesson = lesson
            self.step_index = 0
            self.emit_event(
                "recording_stopped",
                lesson.master_hand,
                {"lesson_id": lesson.id, "steps_total": len(lesson.steps)},
            )
            self.emit_lesson()
            self.emit_session()
            return {"lesson_id": lesson.id, "steps_total": len(lesson.steps)}
        self.emit_event("recording_stopped", None, {"lesson_id": None})
        self.emit_session()
        return {"lesson_id": None}

    def load_lesson(self, lesson_id: str) -> Lesson:
        d = self.lessons_dir / str(lesson_id)
        if not (d / "lesson.json").exists():
            raise CommandError("not_found", f"no lesson {lesson_id!r}")
        try:
            lesson = Lesson.load(d)
        except Exception as e:
            raise CommandError(
                "internal", f"lesson {lesson_id!r} is unreadable: {e}"
            ) from e
        self.lesson = lesson
        self.step_index = 0
        self.task = lesson.task if lesson.task in TASKS else self.task
        self.task_config = dict(lesson.task_config)
        self._reset_task()
        self.emit_lesson()
        if self.mode in ("learn", "duel"):
            self.start_step(0)
        if self.mode == "playback":
            self.playback_t0_us = self.now()
        self.emit_session()
        return lesson

    def cmd_lesson_load(self, args: dict) -> dict:
        lesson_id = args.get("lesson_id")
        if (
            not isinstance(lesson_id, str)
            or not lesson_id
            or "/" in lesson_id
            or lesson_id.startswith(".")
        ):
            raise CommandError("bad_args", "lesson_id must be a plain string")
        lesson = self.load_lesson(lesson_id)
        return {"lesson_id": lesson.id, "steps_total": len(lesson.steps)}

    def cmd_lesson_delete(self, args: dict) -> dict:
        lesson_id = args.get("lesson_id")
        if (
            not isinstance(lesson_id, str)
            or not lesson_id
            or "/" in lesson_id
            or lesson_id.startswith(".")
        ):
            raise CommandError("bad_args", "lesson_id must be a plain string")
        if not delete_lesson(self.lessons_dir, lesson_id):
            raise CommandError("not_found", f"no lesson {lesson_id!r}")
        if self.lesson is not None and self.lesson.id == lesson_id:
            self.lesson, self.step_index, self.scorers = None, None, {}
            if self.mode in ("learn", "playback", "duel"):
                self.mode = "idle"
        self.emit_session()
        return {"lesson_id": lesson_id}

    def _goto(self, index: int) -> dict:
        lesson = self._need_lesson()
        if not 0 <= index < len(lesson.steps):
            raise CommandError(
                "bad_args", f"step index out of range 0..{len(lesson.steps) - 1}"
            )
        if self.mode in ("learn", "duel"):
            self.start_step(index)
        else:
            self.step_index = index
            if self.mode == "playback":
                self.playback_t0_us = self.now() - int(
                    lesson.steps[index].t0_us / max(self.tempo, 1e-6)
                )
        self.emit_session()
        return {"step": self.step_index}

    def cmd_step_goto(self, args: dict) -> dict:
        idx = args.get("index")
        if not isinstance(idx, int) or isinstance(idx, bool):
            raise CommandError("bad_args", "index must be an integer")
        return self._goto(idx)

    def cmd_step_next(self, args: dict) -> dict:
        lesson = self._need_lesson()
        return self._goto(((self.step_index or 0) + 1) % len(lesson.steps))

    def cmd_step_prev(self, args: dict) -> dict:
        lesson = self._need_lesson()
        return self._goto(((self.step_index or 0) - 1) % len(lesson.steps))

    def cmd_step_restart(self, args: dict) -> dict:
        self._need_lesson()
        if self.mode in ("learn", "duel"):
            self.start_step(self.step_index or 0, restart=True)
        self.emit_session()
        return {"step": self.step_index}

    def cmd_set_tempo(self, args: dict) -> dict:
        f = args.get("factor")
        lo, hi = float(self.cfg.session.tempo_min), float(self.cfg.session.tempo_max)
        if (
            not isinstance(f, (int, float))
            or isinstance(f, bool)
            or not (lo <= float(f) <= hi)
        ):
            raise CommandError("bad_args", f"factor must be a number from {lo} to {hi}")
        self.tempo = float(f)
        self.emit_session()
        return {"factor": self.tempo}

    def cmd_set_loop(self, args: dict) -> dict:
        on = args.get("on")
        if not isinstance(on, bool):
            raise CommandError("bad_args", "on must be a boolean")
        self.loop = on
        if self.piano is not None:
            self.piano.loop = on
        self.emit_session()
        return {"on": self.loop}

    def cmd_describe_task(self, args: dict) -> dict:
        text = args.get("text")
        if not isinstance(text, str) or not text.strip():
            raise CommandError("bad_args", "text must be a non-empty string")
        picked = self.coach.client.configure(text, TASKS)
        if picked is None:
            raise CommandError(
                "not_found",
                "no task matched that description (rule-based tonight, no model)",
            )
        self.task, self.task_config = picked["task"], dict(picked.get("config", {}))
        self._reset_task()
        self.emit_session()
        return {"task": self.task, "config": self.task_config, "source": "rule"}

    def cmd_coach_answer(self, args: dict) -> dict:
        qid, option = args.get("id"), args.get("option")
        if not isinstance(qid, str) or not isinstance(option, str):
            raise CommandError("bad_args", "id and option must be strings")
        self.answers[qid] = option
        return {"id": qid, "option": option}

    def cmd_subscribe(self, args: dict) -> dict:
        # Per-client; the server applies it. Validate here so the ack is uniform.
        rate = args.get("rate_hz", self.cfg.server.frame_rate_hz)
        lo, hi = int(self.cfg.session.rate_hz_min), int(self.cfg.session.rate_hz_max)
        if (
            not isinstance(rate, (int, float))
            or isinstance(rate, bool)
            or not (lo <= rate <= hi)
        ):
            raise CommandError("bad_args", f"rate_hz must be from {lo} to {hi}")
        rots = args.get("rots", False)
        if not isinstance(rots, bool):
            raise CommandError("bad_args", "rots must be a boolean")
        return {"rate_hz": float(rate), "rots": rots}
