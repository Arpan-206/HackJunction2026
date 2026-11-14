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

One glove active (the session's hands: only one glove HandState present): see
_one_glove. The hand that carries this glove's ring LED wins; else the darker blob (a
glove beats skin); else the one nearest the last wrist; else hold, never switch.

Both hands (left and right to the glove sides):
- A ring LED with a marker colour names its hand (both seen: done; one seen: the other
  blob is the other hand).
- Two fixes, both hands already placed: each hand keeps the blob nearer its last good
  position (so crossing or touching hands do not swap).
- Two fixes, first time: the one with the smaller core x is the left hand. The camera's handedness
  label is ignored then, because a mirrored or swapped label is the usual MediaPipe error
  and the hands' order on the bench is not. A disagreement is counted as a swap.
- One fix and one glove hand: the fix goes to that hand, whatever the label says.
- One blob fix (no ring) and two glove hands: the hand whose wrist is nearer.
- One MediaPipe fix and two glove hands: the label decides (flipped by swap_handedness in
  hand_root.py), unless the fix is much nearer the other hand's current wrist.
Camera hands (source "camera") already carry a position and are left alone.

The original glove values are kept on the HandState object, so a tick that runs twice on
the same object (the glove sends at its own rate) applies the fusion once, not twice.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import geom

SIDES = ("left", "right")
_BASE_P = "_root_glove_p"
_BASE_ANCHOR = "_root_glove_anchor"
_TOUCHED = "_root_touched"


@dataclass
class FuseConfig:
    min_confidence: float = 0.3      # WristFix.confidence: at least one landmark with depth
    stale_ms: float = 150.0          # a fix older than this is not live
    max_speed_m_s: float = 1.5       # speed ceiling on the fused wrist (0 = off); stops the step on an accepted jump
    jump_m: float = 0.08             # a fix this far from the last good one is a wrong blob ...
    jump_frames: int = 5             # ... until this many such fixes in a row, each near the last
    one_euro: bool = True            # One Euro filter on the fused wrist: steady when slow, no lag when fast
    one_euro_min_cutoff: float = 1.0
    one_euro_beta: float = 2.0
    one_euro_d_cutoff: float = 1.0
    # The work box (core world, metres): the wrist is clamped inside, so the hand never leaves the
    # stage. 45 cm wide (x), 25 cm high (y), 30 cm deep (z). Half sizes; centre between the rest poses.
    box: bool = True
    box_centre: tuple = (0.0, 0.175, -0.2)
    box_half: tuple = (0.225, 0.125, 0.15)
    hold_s: float = 2.0              # keep the last good position this long
    decay_s: float = 1.5             # then move back to the glove's wrist_p over this long
    near_m: float = 0.08             # one fix, two hands: nearer than this to the other hand wins
    dark_margin: float = 0.12        # one glove: blobs this much lighter than the darkest are not the glove
    reacquire_m: float = 0.25        # one glove: a blob further than this from the last wrist is not taken
    glove_min_darkness: float = 0.55 # one glove: a lone blob this dark is the glove (glove blobs: 5th percentile 0.63 to 0.71)

    @classmethod
    def from_config(cls, cfg) -> "FuseConfig":
        c = cls()
        sec = cfg.camera.get("root") if "root" in cfg.camera else None
        if sec is not None:
            for k in c.__dataclass_fields__:
                key = f"fuse_{k}"
                if key in sec:
                    v = sec[key]
                    setattr(c, k, tuple(float(x) for x in v) if isinstance(getattr(c, k), tuple)
                            else type(getattr(c, k))(v))
        return c


@dataclass
class _SideState:
    target: np.ndarray | None = None     # last accepted tracked position (core world)
    pos: np.ndarray | None = None        # the fused wrist shown, rate capped toward the goal
    good_t: int = 0                      # core time of the last accepted fix
    last_t: int | None = None
    used_fid: int | None = None
    pending: int = 0
    pend_p: np.ndarray | None = None     # the last rejected far fix, for the persistence count
    filt: object = None
    accepted: int = 0
    rejected: int = 0


@dataclass
class RootFuser:
    cfg: FuseConfig = field(default_factory=FuseConfig)

    def __post_init__(self) -> None:
        c = self.cfg
        self.state = {s: _SideState(filt=geom.OneEuroFilter(c.one_euro_min_cutoff, c.one_euro_beta,
                                                            c.one_euro_d_cutoff)) for s in SIDES}
        self.swaps = 0
        self.held_ambiguous = 0
        self.last_assigned: dict = {}
        self.applied: dict[str, str] = {s: "off" for s in SIDES}

    # -- matching --------------------------------------------------------------
    def assign(self, fixes: list, hands: dict, t_us: int) -> dict:
        c = self.cfg
        live = [f for f in fixes if f.confidence >= c.min_confidence and abs(t_us - f.t_us) <= c.stale_ms * 1000]
        if not live:
            return {}
        gloves = [s for s in SIDES if hands.get(s) is not None and hands[s].source == "glove"]
        if len(gloves) == 1:
            return self._one_glove(gloves[0], live)
        led = {f.side: f for f in live if getattr(f, "led", False) and f.side in SIDES}
        if len(led) == 2:
            return dict(led)
        live = [f for f in live if f.side in SIDES or getattr(f, "source", "") == "blob"]
        if not live:
            return {}
        if len(live) >= 2:
            if len(led) == 1:          # one ring seen: it names its hand, the other blob is the other hand
                (ls, lf), = led.items()
                rest = [f for f in live if f is not lf]
                return {ls: lf, ("right" if ls == "left" else "left"): rest[0]}
            a, b = sorted(sorted(live, key=lambda f: -f.confidence)[:2], key=lambda f: float(f.p[0]))
            tl, tr = self.state["left"].target, self.state["right"].target
            if tl is not None and tr is not None:   # both known: keep each hand on its nearer blob
                keep = np.linalg.norm(a.p - tl) + np.linalg.norm(b.p - tr)
                swap = np.linalg.norm(b.p - tl) + np.linalg.norm(a.p - tr)
                if swap < keep:
                    a, b = b, a
            if (a.side in SIDES and a.side != "left") or (b.side in SIDES and b.side != "right"):
                self.swaps += 1
            return {"left": a, "right": b}
        f = live[0]
        side = f.side
        if side not in SIDES:          # a blob without a ring: the nearer hand's current wrist, else x
            ds = {s: np.linalg.norm(f.p - self.state[s].pos) for s in SIDES if self.state[s].pos is not None}
            side = min(ds, key=ds.get) if ds else ("right" if f.p[0] >= 0 else "left")
            return {side: f}
        other = "right" if side == "left" else "left"
        po, ps = self.state[other].pos, self.state[side].pos
        if po is not None and np.linalg.norm(f.p - po) < c.near_m and (
                ps is None or np.linalg.norm(f.p - ps) > np.linalg.norm(f.p - po)):
            self.swaps += 1
            side = other
        return {side: f}

    def _one_glove(self, side: str, live: list) -> dict:
        """One glove active: follow that glove's blob only; never jump to a bare hand or an arm.

        1. A fix whose ring LED says this side wins; fixes whose LED says the other side are out.
        2. Darker blobs beat lighter ones (a glove beats skin) by more than dark_margin.
        3. Among what is left, the one nearest the last known wrist (within reacquire_m).
        4. Still more than one, or nothing near: hold (no fix this tick, the hold rule applies).
        A lone candidate is taken if it is glove-dark (or has no darkness, a MediaPipe fix);
        a lone light blob far from the wrist (a bare hand while the glove is hidden) is not.
        """
        c = self.cfg
        mine = [f for f in live if getattr(f, "led", False) and f.side == side]
        if mine:
            return {side: mine[0]}
        cands = [f for f in live if not (getattr(f, "led", False) and f.side in SIDES and f.side != side)]
        if not cands:
            return {}
        dk = [getattr(f, "darkness", None) for f in cands]
        if any(d is not None for d in dk):
            top = max(d for d in dk if d is not None)
            cands = [f for f, d in zip(cands, dk) if d is not None and d >= top - c.dark_margin]
        if len(cands) == 1:
            dk1 = getattr(cands[0], "darkness", None)
            if self.state[side].pos is None or dk1 is None or dk1 >= c.glove_min_darkness:
                return {side: cands[0]}   # a lone glove-dark blob: the jump gate in apply still guards it
        ref = self.state[side].pos if self.state[side].pos is not None else self.state[side].target
        if ref is not None:
            d = [float(np.linalg.norm(f.p - ref)) for f in cands]
            i = int(np.argmin(d))
            if d[i] <= c.reacquire_m and (len(d) == 1 or sorted(d)[1] - d[i] > 0.03):
                return {side: cands[i]}
            if len(cands) == 1 and self.state[side].target is None:
                return {side: cands[0]}
            self.held_ambiguous += 1
            return {}
        if len(cands) == 1:
            return {side: cands[0]}
        self.held_ambiguous += 1
        return {}

    # -- the tick --------------------------------------------------------------
    def apply(self, hands: dict, fixes: list, t_us: int) -> None:
        c = self.cfg
        assigned = self.assign(fixes, hands, t_us)
        self.last_assigned = assigned
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
                fp = np.asarray(f.p, dtype=float)
                if st.target is not None and np.linalg.norm(fp - st.target) > c.jump_m:
                    # a wrong blob until it persists: jump_frames fixes in a row, each near the last
                    if st.pend_p is not None and np.linalg.norm(fp - st.pend_p) <= c.jump_m:
                        st.pending += 1
                    else:
                        st.pending = 1
                    st.pend_p = fp
                    accept = st.pending >= c.jump_frames
                else:
                    accept = True
                if accept:
                    st.pending = 0
                    st.pend_p = None
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
                st.target = st.pos = st.pend_p = None
                st.pending = 0
                st.filt.reset()
                self._restore(h)
                self.applied[side] = "off"
                continue
            if c.max_speed_m_s > 0:      # optional rate cap (off by default: the One Euro filter does it)
                if st.pos is None:
                    st.pos = base_p.copy()
                step = goal - st.pos
                n = float(np.linalg.norm(step))
                cap = c.max_speed_m_s * dt
                if n > cap:
                    step = step * (cap / n)
                goal = st.pos + step
            st.pos = st.filt(goal, t_us) if c.one_euro else np.asarray(goal, dtype=float).copy()
            h.wrist_p = self.clamp(st.pos)
            h.anchor = anchor
            setattr(h, _TOUCHED, True)
            self.applied[side] = anchor

    def clamp(self, p: np.ndarray) -> np.ndarray:
        if not self.cfg.box:
            return np.asarray(p, dtype=float).copy()
        cc, hh = np.asarray(self.cfg.box_centre), np.asarray(self.cfg.box_half)
        return np.clip(p, cc - hh, cc + hh)

    @staticmethod
    def _restore(h) -> None:
        if getattr(h, _TOUCHED, False):
            h.wrist_p = getattr(h, _BASE_P).copy()
            h.anchor = getattr(h, _BASE_ANCHOR)
            setattr(h, _TOUCHED, False)

    def status(self) -> dict:
        return {"applied": dict(self.applied), "swaps": self.swaps, "held_ambiguous": self.held_ambiguous,
                "accepted": {s: self.state[s].accepted for s in SIDES},
                "rejected": {s: self.state[s].rejected for s in SIDES}}
