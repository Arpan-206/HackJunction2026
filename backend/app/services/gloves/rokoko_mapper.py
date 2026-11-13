"""Map a Rokoko Studio Custom Streaming JSON payload to HandFrames.

The field names below follow the public documentation (v3 names such as leftIndexProximal, v4 names such as
LeftFinger2Proximal) but have NOT been verified against a live stream. Everything that depends on the payload
shape lives in this module so it is quick to correct on site: adjust BONE_NAME_CANDIDATES, find_bone_table,
or the flexion sign and axis in app.constants.
"""

import logging
from typing import Any

from app import constants as c
from app.schemas.common import FingerValues, Side
from app.schemas.frames import HandFrame
from app.services import geometry

log = logging.getLogger(__name__)

_FINGER_V3 = ("Thumb", "Index", "Middle", "Ring", "Little")
_SEGMENTS_V3 = ("Proximal", "Medial", "Distal")
_SEGMENTS_V4 = ("Proximal", "Intermediate", "Distal")
_warned_shapes: set[str] = set()


def bone_name_candidates(side: Side, finger_index: int, segment: int) -> list[str]:
    """Return lower-cased bone names to try for a finger segment, v3 first then v4."""
    s = side.capitalize()
    return [
        f"{s}{_FINGER_V3[finger_index]}{_SEGMENTS_V3[segment]}".lower(),
        f"{s}Finger{finger_index + 1}{_SEGMENTS_V4[segment]}".lower(),
    ]


def hand_name_candidates(side: Side) -> list[str]:
    """Return lower-cased bone names to try for the hand joint."""
    s = side.capitalize()
    return [f"{s}Hand".lower()]


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


def _is_bone_table(candidate: Any) -> bool:
    """Return whether a dict looks like a name to bone-with-rotation table."""
    return isinstance(candidate, dict) and any(isinstance(v, dict) and "rotation" in v for v in candidate.values())


def find_bone_table(actor: dict[str, Any]) -> dict[str, geometry.Quat]:
    """Return lower-cased bone name to world rotation for one actor, trying the likely containers."""
    for candidate in (actor.get("body"), actor.get("gloves"), actor.get("joints"), actor):
        if _is_bone_table(candidate):
            return {k.lower(): q for k, v in candidate.items()
                    if isinstance(v, dict) and (q := _quat(v.get("rotation"))) is not None}
    return {}


def find_actors(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the actor dicts in a payload, logging the first shape that has none."""
    scene = payload.get("scene", payload)
    actors = scene.get("actors") if isinstance(scene, dict) else None
    if isinstance(actors, list):
        return [a for a in actors if isinstance(a, dict)]
    shape = ",".join(sorted(payload)) if isinstance(payload, dict) else type(payload).__name__
    if shape not in _warned_shapes:
        _warned_shapes.add(shape)
        log.warning("Unrecognised Rokoko frame shape (top-level keys: %s); fix app/services/gloves/rokoko_mapper.py", shape)
    return []


def _lookup(bones: dict[str, geometry.Quat], names: list[str]) -> geometry.Quat | None:
    """Return the first bone rotation found among the candidate names."""
    return next((bones[n] for n in names if n in bones), None)


def _flexion_between(parent: geometry.Quat, child: geometry.Quat) -> float:
    """Return the bend of child relative to parent in radians, clamped to a plausible range."""
    relative = geometry.multiply(geometry.conjugate(parent), child)
    angle = geometry.signed_angle(relative, c.ROKOKO_FLEX_AXIS, c.ROKOKO_FLEX_SIGN)
    return max(c.FLEXION_MIN_RAD, min(c.FLEXION_MAX_RAD, angle))


def map_hand(bones: dict[str, geometry.Quat], side: Side) -> HandFrame | None:
    """Convert one side's bone rotations to a HandFrame, or None when the hand joint is missing."""
    wrist = _lookup(bones, hand_name_candidates(side))
    if wrist is None:
        return None
    flexion: dict[str, tuple[float, float, float]] = {}
    for fi, finger in enumerate(c.FINGERS):
        chain = [wrist]
        for seg in range(c.JOINTS_PER_FINGER):
            rot = _lookup(bones, bone_name_candidates(side, fi, seg))
            chain.append(rot if rot is not None else chain[-1])
        angles = [round(_flexion_between(chain[i], chain[i + 1]), c.FRAME_DECIMALS) for i in range(c.JOINTS_PER_FINGER)]
        flexion[finger] = (angles[0], angles[1], angles[2])
    return HandFrame(side=side, wrist_quat=wrist, wrist_pos=None, flexion=flexion, spread=FingerValues())


def map_payload(payload: dict[str, Any]) -> list[HandFrame]:
    """Convert a decoded Studio payload to the hands it contains."""
    hands: list[HandFrame] = []
    for actor in find_actors(payload):
        bones = find_bone_table(actor)
        if not bones:
            shape = "actor:" + ",".join(sorted(actor))
            if shape not in _warned_shapes:
                _warned_shapes.add(shape)
                log.warning("Rokoko actor has no bone table (keys: %s); fix rokoko_mapper.find_bone_table", shape)
            continue
        for side in c.SIDES:
            hand = map_hand(bones, side)  # type: ignore[arg-type]
            if hand is not None:
                hands.append(hand)
    return hands


def angle_to_quat(angle: float) -> geometry.Quat:
    """Return a rotation of angle radians about the flexion axis, handy for tests and tooling."""
    return geometry.from_axis_angle(c.ROKOKO_FLEX_AXIS, angle * c.ROKOKO_FLEX_SIGN)
