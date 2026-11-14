"""piano: which finger pressed, and when, against a piece in task_config.

Without a camera this teaches fingering and rhythm on a table top. A press is a
fast knuckle flexion that ends past the finger's resting value (SPEC). Verdicts
compare the press time with the piece's beats at tempo_bpm.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .. import hand as H


@dataclass
class _FingerState:
    rest: float | None = None
    prev: float | None = None
    prev_t: int | None = None
    rising: bool = False
    pressed: bool = False


class PressDetector:
    """Per-finger key press detection from MCP flexion (slot 0 of each finger)."""

    def __init__(self, piano_cfg) -> None:
        self.cfg = piano_cfg
        self.state = {f: _FingerState() for f in H.FINGERS}

    @property
    def down(self) -> dict[str, bool]:
        return {f: s.pressed for f, s in self.state.items()}

    def update(self, t_us: int, angles: np.ndarray) -> list[tuple[str, str]]:
        """Return [(finger, 'down'|'up'), ...] for this frame."""
        events = []
        a = np.asarray(angles, dtype=float)
        for f in H.FINGERS:
            s = self.state[f]
            x = float(a[H.FLEXION_SLOTS[f][0]])
            if s.prev is None or s.prev_t is None:
                s.rest, s.prev, s.prev_t = x, x, int(t_us)
                continue
            dt = max(1e-4, (int(t_us) - s.prev_t) / 1e6)
            v = (x - s.prev) / dt
            s.prev, s.prev_t = x, int(t_us)
            rest = s.rest if s.rest is not None else x
            if not s.pressed:
                if v > float(self.cfg.press_velocity_deg_s):
                    s.rising = True
                elif s.rising and v <= 0.0:
                    s.rising = False
                    if x - rest >= float(self.cfg.press_min_deg):
                        s.pressed = True
                        events.append((f, "down"))
                if not s.rising:
                    a_ = 1.0 - float(np.exp(-dt * 1000.0 / float(self.cfg.rest_tau_ms)))
                    s.rest = rest + a_ * (x - rest)
            else:
                if x - rest <= float(self.cfg.release_deg):
                    s.pressed = False
                    events.append((f, "up"))
        return events


@dataclass
class Note:
    beat: float
    finger: str
    midi: int
    verdict: str | None = None


class PianoTask:
    """Schedules the piece and judges presses. Time 0 is when the task (re)starts."""

    def __init__(self, piano_cfg, task_config: dict, t0_us: int, loop: bool = True) -> None:
        self.cfg = piano_cfg
        self.detector = PressDetector(piano_cfg)
        self.tempo_bpm = float(task_config.get("tempo_bpm", piano_cfg.default_tempo_bpm))
        self.notes = [Note(float(n["beat"]), str(n["finger"]), int(n.get("midi", 60))) for n in task_config.get("notes", [])]
        self.t0_us = int(t0_us)
        self.loop = loop
        self.last: dict | None = None
        self.piece_beats = (max(n.beat for n in self.notes) + 1.0) if self.notes else 0.0
        self._cycle = 0

    def beat_at(self, t_us: int) -> float:
        return (int(t_us) - self.t0_us) / 60e6 * self.tempo_bpm

    def _note_t_us(self, n: Note) -> int:
        return int(self.t0_us + n.beat * 60e6 / self.tempo_bpm)

    def _restart_cycle(self, t_us: int) -> None:
        for n in self.notes:
            n.verdict = None
        self.t0_us = int(t_us)
        self._cycle += 1

    def update(self, t_us: int, angles: np.ndarray | None) -> list[tuple[str, dict]]:
        """Return events: ('finger_down', {finger}) and ('note', {finger, midi, verdict})."""
        out: list[tuple[str, dict]] = []
        t_us = int(t_us)
        near = int(self.cfg.near_ms) * 1000
        good = int(self.cfg.good_ms) * 1000
        if angles is not None:
            for f, kind in self.detector.update(t_us, angles):
                if kind != "down":
                    continue
                out.append(("finger_down", {"finger": f}))
                cands = [n for n in self.notes if n.verdict is None and abs(self._note_t_us(n) - t_us) <= near]
                if not cands:
                    continue
                n = min(cands, key=lambda n: abs(self._note_t_us(n) - t_us))
                same = [c for c in cands if c.finger == f]
                if same:
                    n = min(same, key=lambda n: abs(self._note_t_us(n) - t_us))
                    dt = t_us - self._note_t_us(n)
                    n.verdict = "good" if abs(dt) <= good else ("early" if dt < 0 else "late")
                else:
                    n.verdict = "wrong_finger"
                self.last = {"finger": f, "midi": n.midi, "verdict": n.verdict}
                out.append(("note", {"finger": f, "midi": n.midi, "verdict": n.verdict}))
        for n in self.notes:
            if n.verdict is None and t_us > self._note_t_us(n) + near:
                n.verdict = "miss"
                self.last = {"finger": n.finger, "midi": n.midi, "verdict": "miss"}
                out.append(("note", {"finger": n.finger, "midi": n.midi, "verdict": "miss"}))
        if self.notes and self.loop and self.beat_at(t_us) >= self.piece_beats and all(n.verdict for n in self.notes):
            self._restart_cycle(t_us)
        return out

    def state(self, t_us: int) -> dict:
        nxt = sorted((n for n in self.notes if n.verdict is None), key=lambda n: n.beat)[:3]
        return {
            "beat": round(self.beat_at(t_us), 2),
            "next": [{"in_ms": int((self._note_t_us(n) - t_us) / 1000), "finger": n.finger, "midi": n.midi} for n in nxt],
            "down": self.detector.down,
            "last": self.last,
            "cycle": self._cycle,
        }


def state(session) -> dict:
    pt = getattr(session, "piano", None)
    if pt is None:
        return {"beat": 0.0, "next": [], "down": {f: False for f in H.FINGERS}, "last": None}
    return pt.state(session.now())
