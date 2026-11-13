"""Synthetic hands and a synthetic lesson, so the whole pipeline runs with no hardware."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from . import geom
from . import hand as H
from .recorder import Lesson, Recorder

FAKE_LESSON_ID = "fake-demo"
FAKE_WAVE_ID = "fake-wave"

# Poses the fake master teaches and the fake learner reaches, as per-finger curl.
POSES: list[tuple[str, dict[str, float]]] = [
    ("Open hand", {"thumb": 0.05, "index": 0.05, "middle": 0.05, "ring": 0.05, "little": 0.05}),
    ("Fist", {"thumb": 0.95, "index": 0.95, "middle": 0.95, "ring": 0.95, "little": 0.95}),
    ("Point", {"thumb": 0.50, "index": 0.05, "middle": 0.90, "ring": 0.90, "little": 0.90}),
    ("Pinch", {"thumb": 0.65, "index": 0.80, "middle": 0.15, "ring": 0.15, "little": 0.15}),
]


def _ease(x: float) -> float:
    x = float(np.clip(x, 0.0, 1.0))
    return 0.5 - 0.5 * np.cos(np.pi * x)


def blend(a: dict[str, float], b: dict[str, float], u: float) -> dict[str, float]:
    return {f: a[f] + (b[f] - a[f]) * u for f in H.FINGERS}


def sway(t_s: float, side: str, rest_p: np.ndarray, amp: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    s = 1.0 if side == "right" else -1.0
    p = rest_p + amp * np.array([0.02 * np.sin(0.7 * t_s + s), 0.012 * np.sin(1.1 * t_s), 0.01 * np.sin(0.4 * t_s)])
    q = geom.quat_mul(geom.yaw_quat(0.18 * np.sin(0.5 * t_s + s)),
                      geom.quat_from_axis_angle([1.0, 0.0, 0.0], 0.10 * np.sin(0.9 * t_s)))
    return p, q


class FakeSource:
    """Two synthetic gloves.

    The right hand plays a learner: it eases to the pose of the step the session
    is on, with a deliberate error on one finger that fades over a few seconds,
    so the score climbs and the step passes roughly every `step_period_s`.
    The left hand is free and waves its fingers sinusoidally.
    """

    def __init__(self, cfg, t0_us: int, sides=("left", "right")) -> None:
        self.cfg = cfg
        self.t0_us = int(t0_us)
        self.sides = tuple(sides)
        self.hand_cfg = cfg.hand
        self.rest = {s: np.asarray(cfg.rest_pose[s].p, dtype=float) for s in ("left", "right")}
        self.pinch = {s: H.PinchTracker(cfg.hand.pinch_on_m, cfg.hand.pinch_off_m) for s in ("left", "right")}
        self.device_ids = {"left": 1, "right": 2}
        self.target_step = 0
        self._target_since_us = self.t0_us
        self._from_pose = dict(POSES[0][1])
        self.transition_s = 1.0
        self.error_decay_s = max(0.5, float(cfg.fake.step_period_s) - 2.0)
        self.error_curl = 0.45
        self._last_pose = dict(POSES[0][1])

    def set_target_step(self, step: int, t_us: int) -> None:
        if step != self.target_step:
            self._from_pose = dict(self._last_pose)
            self.target_step = int(step)
            self._target_since_us = int(t_us)

    def learner_curl(self, t_us: int) -> dict[str, float]:
        name, target = POSES[self.target_step % len(POSES)]
        el = (t_us - self._target_since_us) / 1e6
        u = _ease(el / self.transition_s)
        pose = blend(self._from_pose, target, u)
        # fading deliberate error on one finger
        err = self.error_curl * max(0.0, 1.0 - el / self.error_decay_s)
        f = H.FINGERS[self.target_step % len(H.FINGERS)]
        sign = -1.0 if target[f] > 0.5 else 1.0
        pose[f] = float(np.clip(pose[f] + sign * err, 0.0, 1.0))
        self._last_pose = pose
        return pose

    def free_curl(self, t_s: float) -> dict[str, float]:
        return {f: float(0.5 + 0.45 * np.sin(2 * np.pi * t_s / 5.0 + 0.6 * i)) for i, f in enumerate(H.FINGERS)}

    def poll(self, t_us: int) -> dict[str, H.HandState | None]:
        t_s = (t_us - self.t0_us) / 1e6
        out: dict[str, H.HandState | None] = {"left": None, "right": None}
        for side in self.sides:
            curl = self.learner_curl(t_us) if side == "right" else self.free_curl(t_s)
            p, q = sway(t_s, side, self.rest[side])
            h = H.synth_hand(side=side, curl=curl, wrist_p=p, wrist_q=q, t_us=t_us,
                             device_id=self.device_ids[side], source="glove")
            h.anchor = "rest"
            h.tracked = True
            H.finish_hand(h, self.hand_cfg, self.pinch[side])
            out[side] = h
        return out


def fake_master_curl(t_s: float, hold_s: float = 2.0, move_s: float = 1.0) -> tuple[dict[str, float], int]:
    """Curl of the fake master at time t: pose k held, then a move to pose k+1."""
    seg = hold_s + move_s
    k = int(t_s // seg)
    k = min(k, len(POSES) - 1)
    within = t_s - k * seg
    cur = POSES[k][1]
    if within <= hold_s or k == len(POSES) - 1:
        return dict(cur), k
    nxt = POSES[k + 1][1]
    return blend(cur, nxt, _ease((within - hold_s) / move_s)), k


def build_fake_lesson(cfg, lessons_dir: Path, hold_s: float = 2.0, move_s: float = 1.0,
                      master_hand: str = "right") -> Lesson:
    """Record the fake master once and save it as lessons/fake-demo."""
    rec = Recorder(cfg.record, cfg.score.hold_ms_default)
    rate = float(cfg.fake.rate_hz)
    t0 = 0
    rec.start(t0, "Fake demo: four hand shapes", "general", {}, master_hand, source="fake", master_name="fake")
    total_s = len(POSES) * (hold_s + move_s) - move_s
    n = int(total_s * rate)
    rest_p = np.asarray(cfg.rest_pose[master_hand].p, dtype=float)
    for i in range(n):
        t_s = i / rate
        curl, k = fake_master_curl(t_s, hold_s, move_s)
        p, q = sway(t_s, master_hand, rest_p, amp=0.3)
        h = H.synth_hand(side=master_hand, curl=curl, wrist_p=p, wrist_q=q, t_us=int(t_s * 1e6), device_id=2)
        H.finish_hand(h, cfg.hand)
        rec.add(h)
    for k in range(1, len(POSES)):
        rec.mark(int((k * (hold_s + move_s) - move_s / 2) * 1e6))
    lesson = rec.stop(int(total_s * 1e6), save=True, lesson_id=FAKE_LESSON_ID)
    assert lesson is not None
    for s, (name, _) in zip(lesson.steps, POSES):
        s.name = name
        s.named_by = "manual"
        s.note = f"Reach the {name.lower()} shape and hold it."
    lesson.save(Path(lessons_dir))
    return lesson


def wave_curl(t_s: float, period_s: float = 2.0) -> dict[str, float]:
    return {f: float(0.5 + 0.45 * np.sin(2 * np.pi * t_s / period_s + 0.7 * i)) for i, f in enumerate(H.FINGERS)}


def build_fake_wave_lesson(cfg, lessons_dir: Path, seconds: float = 4.0, master_hand: str = "right") -> Lesson:
    """A one-step `move` lesson: a finger wave, so the viewer can see a moving ghost and timing_ms."""
    rec = Recorder(cfg.record, cfg.score.hold_ms_default)
    rate = float(cfg.fake.rate_hz)
    rec.start(0, "Fake wave: follow the fingers", "general", {}, master_hand, source="fake", master_name="fake")
    rest_p = np.asarray(cfg.rest_pose[master_hand].p, dtype=float)
    for i in range(int(seconds * rate)):
        t_s = i / rate
        p, q = sway(t_s, master_hand, rest_p, amp=0.3)
        h = H.synth_hand(side=master_hand, curl=wave_curl(t_s), wrist_p=p, wrist_q=q, t_us=int(t_s * 1e6), device_id=2)
        H.finish_hand(h, cfg.hand)
        rec.add(h)
    lesson = rec.stop(int(seconds * 1e6), save=True, lesson_id=FAKE_WAVE_ID)
    assert lesson is not None and lesson.steps[0].kind == "move"
    lesson.steps[0].name = "Finger wave"
    lesson.steps[0].named_by = "manual"
    lesson.steps[0].note = "Ripple the fingers in time with the ghost."
    lesson.save(Path(lessons_dir))
    return lesson
