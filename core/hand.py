"""The one hand model: 26 OpenXR joints, 18 angle features, curl and pinch.

Frames
------
* ``joints_local``: wrist at the origin, canonical orientation: fingers point
  along -Z, back of the hand toward +Y, thumb side toward -X for a right hand
  and +X for a left hand. This is the frame a ghost is mirrored in.
* ``xr_base`` (what the glove solver emits): wrist at the origin, axes aligned
  with the world. ``xr_base = R(wrist_q) @ local``.
* world: ``wrist_p + xr_base``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from . import geom

JOINT_NAMES: list[str] = [
    "palm", "wrist",
    "thumb_metacarpal", "thumb_proximal", "thumb_distal", "thumb_tip",
    "index_metacarpal", "index_proximal", "index_intermediate", "index_distal", "index_tip",
    "middle_metacarpal", "middle_proximal", "middle_intermediate", "middle_distal", "middle_tip",
    "ring_metacarpal", "ring_proximal", "ring_intermediate", "ring_distal", "ring_tip",
    "little_metacarpal", "little_proximal", "little_intermediate", "little_distal", "little_tip",
]
JOINT_INDEX = {n: i for i, n in enumerate(JOINT_NAMES)}
FINGERS = ["thumb", "index", "middle", "ring", "little"]
PINCH_FINGERS = ["index", "middle", "ring", "little"]
# First joint index of each finger chain. Thumb has 4 joints, the others 5.
FINGER_BASE = {"thumb": 2, "index": 6, "middle": 11, "ring": 16, "little": 21}
TIP = {"thumb": 5, "index": 10, "middle": 15, "ring": 20, "little": 25}

# Angle feature slots. 0-1 thumb, 2-13 four fingers x (MCP, PIP, DIP), 14-17 spreads.
FLEXION_SLOTS = {"thumb": [0, 1], "index": [2, 3, 4], "middle": [5, 6, 7], "ring": [8, 9, 10], "little": [11, 12, 13]}
SPREAD_SLOTS = {14: ("thumb", "index"), 15: ("index", "middle"), 16: ("middle", "ring"), 17: ("ring", "little")}
FINGER_SPREAD_SLOTS = {f: [s for s, pair in SPREAD_SLOTS.items() if f in pair] for f in FINGERS}
N_ANGLES = 18
ANGLE_NAMES = [
    "thumb_mcp", "thumb_ip",
    "index_mcp", "index_pip", "index_dip",
    "middle_mcp", "middle_pip", "middle_dip",
    "ring_mcp", "ring_pip", "ring_dip",
    "little_mcp", "little_pip", "little_dip",
    "spread_thumb_index", "spread_index_middle", "spread_middle_ring", "spread_ring_little",
]

Side = Literal["left", "right"]


def angle_features(joints: np.ndarray) -> np.ndarray:
    """18 joint angles in degrees from 26 joint positions (any frame, any scale)."""
    J = np.asarray(joints, dtype=float)
    a = np.zeros(N_ANGLES)
    # Thumb: metacarpal(2) -> proximal(3) -> distal(4) -> tip(5)
    b0, b1, b2 = J[3] - J[2], J[4] - J[3], J[5] - J[4]
    a[0] = geom.angle_between_deg(b0, b1)
    a[1] = geom.angle_between_deg(b1, b2)
    proximal_bone = {"thumb": b1}
    for k, f in enumerate(["index", "middle", "ring", "little"]):
        b = FINGER_BASE[f]
        m, p, i, d = J[b + 1] - J[b], J[b + 2] - J[b + 1], J[b + 3] - J[b + 2], J[b + 4] - J[b + 3]
        a[2 + 3 * k] = geom.angle_between_deg(m, p)
        a[3 + 3 * k] = geom.angle_between_deg(p, i)
        a[4 + 3 * k] = geom.angle_between_deg(i, d)
        proximal_bone[f] = p
    for slot, (f1, f2) in SPREAD_SLOTS.items():
        a[slot] = geom.angle_between_deg(proximal_bone[f1], proximal_bone[f2])
    return a


def curl_from_angles(angles: np.ndarray, full_deg: float, full_thumb_deg: float) -> dict[str, float]:
    out = {}
    for f in FINGERS:
        full = full_thumb_deg if f == "thumb" else full_deg
        mean = float(np.mean(angles[FLEXION_SLOTS[f]]))
        out[f] = float(np.clip(mean / full, 0.0, 1.0))
    return out


def pinch_distances(joints: np.ndarray) -> dict[str, float]:
    J = np.asarray(joints, dtype=float)
    thumb = J[TIP["thumb"]]
    return {f: float(np.linalg.norm(J[TIP[f]] - thumb)) for f in PINCH_FINGERS}


class PinchTracker:
    """Hysteresis on thumb-tip to fingertip distance. on below on_m, off above off_m."""

    def __init__(self, on_m: float, off_m: float) -> None:
        self.on_m = float(on_m)
        self.off_m = float(off_m)
        self.state = {f: False for f in PINCH_FINGERS}

    def update(self, joints: np.ndarray) -> tuple[dict[str, bool], list[tuple[str, str]]]:
        """Return (state, events). events are (finger, 'pinch_down'|'pinch_up')."""
        d = pinch_distances(joints)
        events = []
        for f in PINCH_FINGERS:
            if not self.state[f] and d[f] < self.on_m:
                self.state[f] = True
                events.append((f, "pinch_down"))
            elif self.state[f] and d[f] > self.off_m:
                self.state[f] = False
                events.append((f, "pinch_up"))
        return dict(self.state), events


def mirror_local(joints_local: np.ndarray) -> np.ndarray:
    """Mirror a hand in its wrist frame: negate x. Turns a right hand into a left."""
    out = np.asarray(joints_local, dtype=float).copy()
    out[..., 0] *= -1
    return out


def local_to_world(joints_local: np.ndarray, wrist_p: np.ndarray, wrist_q: np.ndarray) -> np.ndarray:
    return np.asarray(wrist_p, dtype=float) + geom.rotate(wrist_q, joints_local)


def xr_base_to_local(joints_xr: np.ndarray, wrist_q: np.ndarray) -> np.ndarray:
    return geom.rotate_inv(wrist_q, joints_xr)


@dataclass
class HandState:
    """Everything the core knows about one physical hand at one instant."""

    side: Side
    device_id: int
    source: Literal["glove", "camera"]
    t_us: int
    joints_local: np.ndarray                 # (26, 3) wrist frame
    wrist_p: np.ndarray                      # (3,) world
    wrist_q: np.ndarray                      # (4,) world, x y z w
    rots_local: np.ndarray | None = None     # (26, 4) wrist frame, optional
    tracked: bool = True
    anchor: Literal["camera", "held", "rest"] = "rest"
    heading_reliable: bool = True
    role: Literal["master", "learner", "free"] = "free"
    angles: np.ndarray = field(default_factory=lambda: np.zeros(N_ANGLES))
    curl: dict[str, float] = field(default_factory=dict)
    pinch: dict[str, bool] = field(default_factory=lambda: {f: False for f in PINCH_FINGERS})

    def joints_world(self) -> np.ndarray:
        return local_to_world(self.joints_local, self.wrist_p, self.wrist_q)

    def joints_xr_base(self) -> np.ndarray:
        return geom.rotate(self.wrist_q, self.joints_local)

    def rots_world(self) -> np.ndarray | None:
        if self.rots_local is None:
            return None
        return np.array([geom.quat_mul(self.wrist_q, r) for r in self.rots_local])

    def to_message(self, decimals: int = 4, include_rots: bool = False) -> dict:
        jw = np.round(self.joints_world(), decimals)
        msg = {
            "device_id": int(self.device_id),
            "hand": self.side,
            "role": self.role,
            "tracked": bool(self.tracked),
            "anchor": self.anchor,
            "source": self.source,
            "wrist": {"p": [float(x) for x in np.round(self.wrist_p, decimals)],
                      "q": [float(x) for x in np.round(self.wrist_q, 5)]},
            "joints": jw.tolist(),
            "angles": [float(x) for x in np.round(self.angles, 1)],
            "curl": {f: round(float(v), 3) for f, v in self.curl.items()},
            "pinch": {f: bool(v) for f, v in self.pinch.items()},
            "heading_reliable": bool(self.heading_reliable),
        }
        if include_rots:
            rw = self.rots_world()
            if rw is not None:
                msg["rots"] = np.round(rw, 5).tolist()
        return msg


def joint_rotations(joints_local: np.ndarray) -> np.ndarray:
    """Per-joint orientations (26, 4) from positions, OpenXR style: -Z along the
    bone toward the fingertip, +Y toward the back of the hand. Palm and wrist
    get the identity (they define the wrist frame)."""
    J = np.asarray(joints_local, dtype=float)
    rots = np.tile(geom.IDENTITY_Q, (26, 1))
    up = np.array([0.0, 1.0, 0.0])
    for f, base in FINGER_BASE.items():
        n = 4 if f == "thumb" else 5
        idx = list(range(base, base + n))
        for k, j in enumerate(idx):
            d = (J[idx[k + 1]] - J[j]) if k < n - 1 else (J[j] - J[idx[k - 1]])
            if np.linalg.norm(d) < 1e-9:
                continue
            z = -geom.normalize(d)
            y = up - np.dot(up, z) * z
            if np.linalg.norm(y) < 1e-6:
                y = np.cross(z, np.array([1.0, 0.0, 0.0]))
            y = geom.normalize(y)
            x = np.cross(y, z)
            rots[j] = geom.quat_from_matrix(np.stack([x, y, z], axis=1))
    return rots


def finish_hand(h: HandState, hand_cfg, pinch_tracker: PinchTracker | None = None) -> list[tuple[str, str]]:
    """Fill angles, curl, pinch and (if missing) joint rotations on a HandState. Returns pinch events."""
    h.angles = angle_features(h.joints_local)
    if h.rots_local is None:
        h.rots_local = joint_rotations(h.joints_local)
    h.curl = curl_from_angles(h.angles, hand_cfg.curl_full_deg, hand_cfg.curl_full_thumb_deg)
    if pinch_tracker is None:
        pinch_tracker = PinchTracker(hand_cfg.pinch_on_m, hand_cfg.pinch_off_m)
    h.pinch, events = pinch_tracker.update(h.joints_local)
    return events


# ---------------------------------------------------------------------------
# Synthetic hands, used by the fake source and by tests.
# ---------------------------------------------------------------------------

# Bone lengths in metres: metacarpal, proximal, intermediate, distal.
_LENGTHS = {
    "index": (0.065, 0.040, 0.025, 0.020),
    "middle": (0.065, 0.045, 0.028, 0.020),
    "ring": (0.060, 0.040, 0.026, 0.020),
    "little": (0.055, 0.032, 0.020, 0.018),
}
_THUMB_LENGTHS = (0.045, 0.035, 0.028)
# Metacarpal base x offsets for a RIGHT hand (thumb side is -X). z is forward (-Z).
_BASE_X = {"index": -0.025, "middle": -0.008, "ring": 0.010, "little": 0.028}
_FAN_DEG = {"index": 6.0, "middle": 1.0, "ring": -4.0, "little": -10.0}
_DOWN = np.array([0.0, -1.0, 0.0])


def _flex(direction: np.ndarray, down: np.ndarray, deg: float) -> np.ndarray:
    """Rotate `direction` toward `down` by deg. down must be orthogonal to direction."""
    r = np.radians(deg)
    return direction * np.cos(r) + down * np.sin(r)


def synth_joints(
    curl: dict[str, float] | None = None,
    side: Side = "right",
    spread_deg: float = 0.0,
    joint_angles: dict[str, tuple[float, ...]] | None = None,
) -> np.ndarray:
    """Build 26 wrist-frame joints for a synthetic hand.

    curl: per finger 0..1 (0 flat, 1 fully closed); per-joint angle = curl * 90
    (thumb 60). joint_angles overrides curl with explicit degrees per joint.
    spread_deg adds extra abduction fan (positive = fingers apart).
    """
    curl = dict(curl or {})
    sx = -1.0 if side == "right" else 1.0   # thumb side
    J = np.zeros((26, 3))
    J[1] = 0.0                              # wrist at origin
    for f in ["index", "middle", "ring", "little"]:
        base = FINGER_BASE[f]
        c = float(curl.get(f, 0.0))
        angs = joint_angles.get(f) if joint_angles and f in joint_angles else (c * 90.0,) * 3
        fan = np.radians(_FAN_DEG[f] * (1.0 + spread_deg / 10.0)) * (-sx)
        d0 = np.array([-np.sin(fan), 0.0, -np.cos(fan)])
        start = np.array([_BASE_X[f] * (-sx), 0.0, -0.012])
        J[base] = start
        lm, lp, li, ld = _LENGTHS[f]
        J[base + 1] = J[base] + d0 * lm
        cum = 0.0
        pos = J[base + 1]
        for k, length in enumerate((lp, li, ld)):
            cum += angs[k]
            d = _flex(d0, _DOWN, cum)
            pos = pos + d * length
            J[base + 2 + k] = pos
    # Thumb
    c = float(curl.get("thumb", 0.0))
    tang = joint_angles.get("thumb") if joint_angles and "thumb" in joint_angles else (c * 60.0,) * 2
    J[2] = np.array([sx * 0.018, -0.008, -0.015])
    d0 = geom.normalize(np.array([sx * 0.70, -0.20, -0.65]))
    tdown = np.array([-sx * 0.6, -0.6, -0.1])
    tdown = geom.normalize(tdown - np.dot(tdown, d0) * d0)
    J[3] = J[2] + d0 * _THUMB_LENGTHS[0]
    cum = 0.0
    pos = J[3]
    for k, length in enumerate(_THUMB_LENGTHS[1:]):
        cum += tang[k]
        d = _flex(d0, tdown, cum)
        pos = pos + d * length
        J[4 + k] = pos
    # Palm: center of the middle metacarpal
    J[0] = 0.5 * (J[FINGER_BASE["middle"]] + J[FINGER_BASE["middle"] + 1])
    return J


def synth_hand(
    side: Side = "right",
    curl: dict[str, float] | None = None,
    wrist_p=(0.0, 0.0, 0.0),
    wrist_q=None,
    t_us: int = 0,
    device_id: int = 0,
    source: str = "glove",
    hand_cfg=None,
    **kw,
) -> HandState:
    h = HandState(
        side=side, device_id=device_id, source=source, t_us=t_us,
        joints_local=synth_joints(curl, side=side, **kw),
        wrist_p=np.asarray(wrist_p, dtype=float),
        wrist_q=np.asarray(wrist_q if wrist_q is not None else geom.IDENTITY_Q, dtype=float),
    )
    if hand_cfg is not None:
        finish_hand(h, hand_cfg)
    else:
        h.angles = angle_features(h.joints_local)
        h.curl = curl_from_angles(h.angles, 90.0, 60.0)
        h.pinch = {f: False for f in PINCH_FINGERS}
    return h


# ---------------------------------------------------------------------------
# MediaPipe 21 landmarks -> 26 OpenXR joints
# ---------------------------------------------------------------------------

# MediaPipe hand landmark indices.
MP_WRIST = 0
MP_THUMB = (1, 2, 3, 4)                 # CMC, MCP, IP, TIP
MP_FINGER = {"index": (5, 6, 7, 8), "middle": (9, 10, 11, 12), "ring": (13, 14, 15, 16), "little": (17, 18, 19, 20)}


def joints_from_mediapipe(lm: np.ndarray, metacarpal_fraction: float = 0.25) -> np.ndarray:
    """21 MediaPipe landmarks (any frame) -> 26 OpenXR joints in the same frame.

    MediaPipe has no carpometacarpal joints for the four fingers; they are
    placed a fraction of the way from the wrist to each knuckle.
    """
    L = np.asarray(lm, dtype=float)
    J = np.zeros((26, 3))
    w = L[MP_WRIST]
    J[1] = w
    J[2], J[3], J[4], J[5] = L[MP_THUMB[0]], L[MP_THUMB[1]], L[MP_THUMB[2]], L[MP_THUMB[3]]
    for f, (mcp, pip, dip, tip) in MP_FINGER.items():
        b = FINGER_BASE[f]
        J[b] = w + metacarpal_fraction * (L[mcp] - w)
        J[b + 1], J[b + 2], J[b + 3], J[b + 4] = L[mcp], L[pip], L[dip], L[tip]
    J[0] = 0.5 * (J[FINGER_BASE["middle"]] + J[FINGER_BASE["middle"] + 1])
    return J


def mediapipe_from_joints(joints: np.ndarray) -> np.ndarray:
    """Inverse of joints_from_mediapipe for tests: 26 joints -> 21 landmarks."""
    J = np.asarray(joints, dtype=float)
    L = np.zeros((21, 3))
    L[0] = J[1]
    L[1], L[2], L[3], L[4] = J[2], J[3], J[4], J[5]
    for f, (mcp, pip, dip, tip) in MP_FINGER.items():
        b = FINGER_BASE[f]
        L[mcp], L[pip], L[dip], L[tip] = J[b + 1], J[b + 2], J[b + 3], J[b + 4]
    return L


def wrist_frame_from_joints(joints: np.ndarray, side: Side) -> tuple[np.ndarray, np.ndarray]:
    """Return (wrist_p, wrist_q) so that joints_local = R(q)^T (joints - p) has
    fingers along -Z, dorsum +Y and the thumb side at -X (right) or +X (left)."""
    J = np.asarray(joints, dtype=float)
    p = J[1].copy()
    forward = geom.normalize(J[FINGER_BASE["middle"] + 1] - J[1])
    across = J[FINGER_BASE["index"] + 1] - J[FINGER_BASE["little"] + 1]   # toward thumb side
    zc = -forward
    xc = -across if side == "right" else across
    xc = xc - np.dot(xc, zc) * zc
    xc = geom.normalize(xc)
    yc = np.cross(zc, xc)
    R = np.stack([xc, yc, zc], axis=1)
    return p, geom.quat_from_matrix(R)


def hand_from_joints_world(
    joints_world: np.ndarray, side: Side, device_id: int, source: str, t_us: int,
    anchor: str = "camera",
) -> HandState:
    """Build a HandState from 26 joints already in world coordinates."""
    p, q = wrist_frame_from_joints(joints_world, side)
    local = geom.rotate_inv(q, np.asarray(joints_world) - p)
    return HandState(side=side, device_id=device_id, source=source, t_us=t_us,
                     joints_local=local, wrist_p=p, wrist_q=q, anchor=anchor)
