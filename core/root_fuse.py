"""Fuse the camera's wrist position (core/camera/hand_root.py) into the glove hands.

The glove keeps the joint angles and the wrist orientation (the depth step corrects its
yaw). Only HandState.wrist_p changes, so the joints in the world, the frame message, the
compat /ws/gloves wrist_pos, the recorder and the robot all follow without a new field.

Rules, per glove hand, each tick:
- A fresh, confident fix moves the wrist toward the tracked position, at most
  max_speed_m_s, so a wrong detection cannot throw the hand across the table. A fix more
  than jump_m from the current wrist counts only after jump_frames such fixes in a row.
- anchor becomes "camera" (live fix) or "held" (holding or decaying), so compat.py sends
  wrist_pos; it stays "rest" (wrist_pos null) when the camera has nothing.
- Tracking drops: the last good position is held for hold_s, then it moves back to the
  glove's own wrist_p over decay_s. After that the hand is exactly as the glove gave it.
- Never a fix: the hand is not touched. With the flag on and no hand in view, every
  message equals the flag off (tests/test_root_fuse.py proves it on a replay).

Both hands (MediaPipe left and right to the glove sides):
- Two fixes: the one with the smaller core x is the left hand. The camera's handedness
  label is ignored then, because a mirrored or swapped label is the usual MediaPipe error
  and the hands' order on the bench is not. A disagreement is counted as a swap.
- One fix and one glove hand: the fix goes to that hand, whatever the label says.
- One fix and two glove hands: the label decides (flipped by swap_handedness in
  hand_root.py), unless the fix is much nearer the other hand's current wrist.
Camera hands (source "camera") already carry a position and are left alone.

The original glove values are kept on the HandState object, so a tick that runs twice on
the same object (the glove sends at its own rate) applies the fusion once, not twice.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

SIDES = ("left", "right")
_BASE_P = "_root_glove_p"
_BASE_ANCHOR = "_root_glove_anchor"
_TOUCHED = "_root_touched"


@dataclass
class FuseConfig:
    min_confidence: float = 0.3      # WristFix.confidence: at least one landmark with depth
    stale_ms: float = 150.0          # a fix older than this is not live
    max_speed_m_s: float = 1.5       # rate cap on the fused wrist
    jump_m: float = 0.15             # a fix this far from the wrist needs jump_frames in a row
    jump_frames: int = 3
    hold_s: float = 2.0              # keep the last good position this long
    decay_s: float = 1.5             # then move back to the glove's wrist_p over this long
    near_m: float = 0.08             # one fix, two hands: nearer than this to the other hand wins

    @classmethod
    def from_config(cls, cfg) -> "FuseConfig":
        c = cls()
        sec = cfg.camera.get("root") if "root" in cfg.camera else None
        if sec is not None:
            for k in c.__dataclass_fields__:
                key = f"fuse_{k}"
                if key in sec:
                    setattr(c, k, type(getattr(c, k))(sec[key]))
        return c


@dataclass
class _SideState:
    target: np.ndarray | None = None     # last accepted tracked position (core world)
    pos: np.ndarray | None = None        # the fused wrist shown, rate capped toward the goal
    good_t: int = 0                      # core time of the last accepted fix
    last_t: int | None = None
    used_fid: int | None = None
    pending: int = 0
    accepted: int = 0
    rejected: int = 0


@dataclass
class RootFuser:
    cfg: FuseConfig = field(default_factory=FuseConfig)

    def __post_init__(self) -> None:
        self.state = {s: _SideState() for s in SIDES}
        self.swaps = 0
        self.applied: dict[str, str] = {s: "off" for s in SIDES}

    # -- matching --------------------------------------------------------------
    def assign(self, fixes: list, hands: dict, t_us: int) -> dict:
        c = self.cfg
        live = [f for f in fixes if f.confidence >= c.min_confidence and abs(t_us - f.t_us) <= c.stale_ms * 1000]
        if not live:
            return {}
        gloves = [s for s in SIDES if hands.get(s) is not None and hands[s].source == "glove"]
        if len(live) >= 2:
            a, b = sorted(sorted(live, key=lambda f: -f.confidence)[:2], key=lambda f: float(f.p[0]))
            if a.side != "left" or b.side != "right":
                self.swaps += 1
            return {"left": a, "right": b}
        f = live[0]
        if len(gloves) == 1:
            return {gloves[0]: f}
        side = f.side
        other = "right" if side == "left" else "left"
        po, ps = self.state[other].pos, self.state[side].pos
        if po is not None and np.linalg.norm(f.p - po) < c.near_m and (
                ps is None or np.linalg.norm(f.p - ps) > np.linalg.norm(f.p - po)):
            self.swaps += 1
            side = other
        return {side: f}

    # -- the tick --------------------------------------------------------------
    def apply(self, hands: dict, fixes: list, t_us: int) -> None:
        c = self.cfg
        assigned = self.assign(fixes, hands, t_us)
        for side in SIDES:
            h = hands.get(side)
            st = self.state[side]
            if h is None or h.source != "glove":
                self.applied[side] = "off"
                continue
            if getattr(h, _BASE_P, None) is None:
                setattr(h, _BASE_P, np.asarray(h.wrist_p, dtype=float).copy())
                setattr(h, _BASE_ANCHOR, h.anchor)
            base_p = getattr(h, _BASE_P)
            dt = 1.0 / 30.0 if st.last_t is None else min(0.2, max(0.0, (t_us - st.last_t) / 1e6))
            st.last_t = t_us

            f = assigned.get(side)
            if f is not None and f.frame_id != st.used_fid:
                st.used_fid = f.frame_id
                ref = st.pos if st.pos is not None else st.target
                if ref is not None and np.linalg.norm(f.p - ref) > c.jump_m:
                    st.pending += 1
                    accept = st.pending >= c.jump_frames
                else:
                    accept = True
                if accept:
                    st.pending = 0
                    st.target = np.asarray(f.p, dtype=float).copy()
                    st.good_t = int(f.t_us)
                    st.accepted += 1
                else:
                    st.rejected += 1

            if st.target is None:
                self._restore(h)
                self.applied[side] = "off"
                continue
            age = (t_us - st.good_t) / 1e6
            if age <= c.hold_s:
                goal = st.target
                anchor = "camera" if age <= c.stale_ms / 1000.0 else "held"
            elif age <= c.hold_s + c.decay_s:
                k = (age - c.hold_s) / c.decay_s
                k = k * k * (3 - 2 * k)
                goal = st.target * (1 - k) + base_p * k
                anchor = "held"
            else:
                st.target = st.pos = None
                st.pending = 0
                self._restore(h)
                self.applied[side] = "off"
                continue
            if st.pos is None:
                st.pos = base_p.copy()
            step = goal - st.pos
            n = float(np.linalg.norm(step))
            cap = c.max_speed_m_s * dt
            if n > cap:
                step = step * (cap / n)
            st.pos = st.pos + step
            h.wrist_p = st.pos.copy()
            h.anchor = anchor
            setattr(h, _TOUCHED, True)
            self.applied[side] = anchor

    @staticmethod
    def _restore(h) -> None:
        if getattr(h, _TOUCHED, False):
            h.wrist_p = getattr(h, _BASE_P).copy()
            h.anchor = getattr(h, _BASE_ANCHOR)
            setattr(h, _TOUCHED, False)

    def status(self) -> dict:
        return {"applied": dict(self.applied), "swaps": self.swaps,
                "accepted": {s: self.state[s].accepted for s in SIDES},
                "rejected": {s: self.state[s].rejected for s in SIDES}}
