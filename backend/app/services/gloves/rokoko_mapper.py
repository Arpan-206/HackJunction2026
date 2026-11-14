"""Map a Rokoko Studio Custom Streaming JSON payload (v3 or v4) to HandFrames.

Verified against the published specs and the Rokoko Unity and Blender plugin sources (see research/09_rokoko.md):

* JSON v3: scene.actors[].body is an object keyed by joint, for example "leftIndexProximal": {position, rotation}.
* JSON v4: scene.newtons[].joints is a flat list of {name, parent, position, rotation} with names such as
  "LeftFinger2Proximal". The version field reads "3,0" for both formats, so the format is detected from the payload.
* Every rotation is a WORLD space quaternion (x, y, z, w) in a left-handed, Y-up, Z-forward system.

Because rotations are world space, the local bend of a joint is conj(parent_world) * child_world. Which local axis is
the flexion axis is NOT documented by Rokoko; it is set in app.constants (ROKOKO_FLEX_AXIS, ROKOKO_FLEX_SIGN) and
can be measured on site with scripts/probe_flexion.py.
"""

import logging
from typing import Any

from app import constants as c
from app.schemas.common import FingerValues, Side
from app.schemas.frames import HandFrame
from app.services import geometry

log = logging.getLogger(__name__)

Bones = dict[str, geometry.Quat]
_warned_shapes: set[str] = set()


def v3_chain(side: Side, finger_index: int) -> list[str]:
    """Return the lower-cased v3 joint names of a finger, base to tip, for example leftindexproximal."""
    name = c.ROKOKO_V3_FINGER_NAMES[finger_index]
    return [f"{side}{name}{seg}".lower() for seg in c.ROKOKO_V3_SEGMENTS]


def v4_chain(side: Side, finger_index: int) -> list[str]:
    """Return the lower-cased v4 joint names of a finger, base to tip. The thumb is Finger1 and has no Medial."""
    segments = c.ROKOKO_V4_THUMB_SEGMENTS if finger_index == 0 else c.ROKOKO_V4_SEGMENTS
    return [f"{side}Finger{finger_index + 1}{seg}".lower() for seg in segments]


def hand_name(side: Side) -> str:
    """Return the lower-cased hand joint name, identical in v3 and v4 once lower-cased."""
    return f"{side}hand"


def _quat(value: Any) -> geometry.Quat | None:
    """Parse a quaternion given as {x,y,z,w} or [x,y,z,w]."""
    try:
        if isinstance(value, dict):
            return geometry.normalise((float(value["x"]), float(value["y"]), float(value["z"]), float(value["w"])))
        if isinstance(value, (list, tuple)) and len(value) == 4:
            return geometry.normalise(tuple(float(v) for v in value))  # type: ignore[arg-type]
    except (KeyError, TypeError, ValueError):
        return None
    return None


def _warn_once(shape: str, message: str) -> None:
    """Log a warning the first time a given shape is seen."""
    if shape not in _warned_shapes:
        _warned_shapes.add(shape)
        log.warning(message, shape)


def bones_v3(actor: dict[str, Any]) -> Bones:
    """Return lower-cased joint name to world rotation for a v3 actor (body object keyed by joint)."""
    for candidate in (actor.get("body"), actor.get("gloves"), actor):
        if isinstance(candidate, dict) and any(isinstance(v, dict) and "rotation" in v for v in candidate.values()):
            return {k.lower(): q for k, v in candidate.items()
                    if isinstance(v, dict) and (q := _quat(v.get("rotation"))) is not None}
    return {}


def bones_v4(newton: dict[str, Any]) -> Bones:
    """Return lower-cased joint name to world rotation for a v4 newton (flat joints list)."""
    joints = newton.get("joints")
    if not isinstance(joints, list):
        return {}
    return {str(j["name"]).lower(): q for j in joints
            if isinstance(j, dict) and "name" in j and (q := _quat(j.get("rotation"))) is not None}


def _has_side(meta: Any, keys: dict[str, str], side: Side) -> bool:
    """Return False only when the actor meta explicitly says this hand is not controlled."""
    return not (isinstance(meta, dict) and meta.get(keys[side]) is False)


def _flexion_between(parent: geometry.Quat, child: geometry.Quat) -> float:
    """Return the bend of child relative to parent in radians, clamped to a plausible range."""
    relative = geometry.multiply(geometry.conjugate(parent), child)
    angle = geometry.signed_angle(relative, c.ROKOKO_FLEX_AXIS, c.ROKOKO_FLEX_SIGN)
    return max(c.FLEXION_MIN_RAD, min(c.FLEXION_MAX_RAD, angle))


def map_hand(bones: Bones, side: Side, chain_for: Any = v3_chain) -> HandFrame | None:
    """Convert one side's world rotations to a HandFrame, or None when the hand joint is missing.

    chain_for(side, finger_index) gives the three joint names per finger; a missing joint contributes zero bend.
    """
    wrist = bones.get(hand_name(side))
    if wrist is None:
        return None
    flexion: dict[str, tuple[float, float, float]] = {}
    for fi, finger in enumerate(c.FINGERS):
        parents = [wrist]
        for name in chain_for(side, fi):
            parents.append(bones.get(name, parents[-1]))
        angles = [round(_flexion_between(parents[i], parents[i + 1]), c.FRAME_DECIMALS) for i in range(c.JOINTS_PER_FINGER)]
        flexion[finger] = (angles[0], angles[1], angles[2])
    return HandFrame(side=side, wrist_quat=wrist, wrist_pos=None, flexion=flexion, spread=FingerValues())


def _scene(payload: dict[str, Any]) -> dict[str, Any]:
    """Return the scene object of a payload (tolerating a payload that is the scene itself)."""
    scene = payload.get("scene", payload)
    return scene if isinstance(scene, dict) else {}


def entities(payload: dict[str, Any]) -> list[tuple[Bones, dict[str, str], Any, Any]]:
    """Return (bones, meta keys, meta, chain function) per streamed actor, v4 newtons first, then v3 actors."""
    scene = _scene(payload)
    found: list[tuple[Bones, dict[str, str], Any, Any]] = []
    for newton in scene.get("newtons") or []:
        if isinstance(newton, dict):
            found.append((bones_v4(newton), c.ROKOKO_V4_META_HAND_KEYS, newton.get("meta"), v4_chain))
    for actor in scene.get("actors") or []:
        if isinstance(actor, dict):
            found.append((bones_v3(actor), c.ROKOKO_V3_META_GLOVE_KEYS, actor.get("meta"), v3_chain))
    if not found:
        _warn_once(",".join(sorted(payload)), "Unrecognised Rokoko frame (top-level keys: %s); expected scene.actors or scene.newtons")
    return found


def map_payload(payload: dict[str, Any]) -> list[HandFrame]:
    """Convert a decoded Studio payload to the hands it contains, at most one per side (first actor wins)."""
    hands: dict[str, HandFrame] = {}
    for bones, meta_keys, meta, chain_for in entities(payload):
        if not bones:
            _warn_once("empty-actor", "Rokoko actor with no joints (%s); is the glove paired to an actor in Studio?")
            continue
        for side in c.SIDES:
            if side in hands or not _has_side(meta, meta_keys, side):  # type: ignore[arg-type]
                continue
            hand = map_hand(bones, side, chain_for)  # type: ignore[arg-type]
            if hand is not None:
                hands[side] = hand
    return list(hands.values())


def angle_to_quat(angle: float) -> geometry.Quat:
    """Return a rotation of angle radians about the flexion axis, handy for tests and tooling."""
    return geometry.from_axis_angle(c.ROKOKO_FLEX_AXIS, angle * c.ROKOKO_FLEX_SIGN)
