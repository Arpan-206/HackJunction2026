"""Regenerate the Rokoko fixtures: PYTHONPATH=. python tests/fixtures/make_fixtures.py (from backend/).

The frames follow the documented Studio schema (research/09_rokoko.md) but are CONSTRUCTED, not captured from real
gloves. Flexion is a rotation about the hand's local X axis, matching app.constants.ROKOKO_FLEX_AXIS (an assumption
until probed on real gloves). The hand has a non-trivial world orientation so world-space maths is exercised.
"""

import json
import math
from pathlib import Path

from app.services import geometry as g

OUT = Path(__file__).parent
FINGER_V3 = ("Thumb", "Index", "Middle", "Ring", "Little")
SWEEP_FRAMES = 40
HAND_YAW = {"Left": math.radians(30), "Right": math.radians(-30)}
# Resting hand-relative offsets of each finger root along the hand (metres), enough for plausible positions.
SPREAD_X = (-0.03, -0.015, 0.0, 0.015, 0.03)


def rot(q: g.Quat) -> dict:
    """Quaternion as the Studio {x, y, z, w} object."""
    return {k: round(v, 6) for k, v in zip("xyzw", q, strict=True)}


def finger_angles(curl: float, finger: int) -> list[float]:
    """Per-joint bend in radians for a curl of 0..1 (thumb: CMC, MCP, IP; fingers: MCP, PIP, DIP)."""
    if finger == 0:
        return [0.5 * curl, 0.6 * curl, 0.7 * curl]
    return [0.9 * curl, 1.45 * curl, 0.9 * curl]


def hand_joints(side: str, curl: tuple[float, ...], v4: bool) -> dict[str, dict]:
    """World-space joints of one hand, keyed by v3 name or v4 name."""
    hand_q = g.from_yaw_pitch_roll(HAND_YAW[side], 0.1, 0.0)
    out: dict[str, dict] = {f"{side.lower()}Hand" if not v4 else f"{side}Hand": {"q": hand_q, "pos": (0.3 if side == "Right" else -0.3, 1.1, 0.25)}}
    for fi in range(5):
        angles = finger_angles(curl[fi], fi)
        names = ([f"{side}Finger{fi + 1}{s}" for s in ("Metacarpal", "Proximal", "Distal", "Tip")] if fi == 0
                 else [f"{side}Finger{fi + 1}{s}" for s in ("Metacarpal", "Proximal", "Medial", "Distal", "Tip")]) if v4 else \
            [f"{side.lower()}{FINGER_V3[fi]}{s}" for s in ("Proximal", "Medial", "Distal", "Tip")]
        # v4 has a fixed Metacarpal that does not bend; v3 has none. Bend joints then a tip that copies the distal.
        bend_names = names[1:4] if v4 else names[:3]
        total = 0.0
        if v4:
            out[names[0]] = {"q": hand_q, "pos": (0.0, 1.1, 0.27)}
        if v4 and fi == 0:
            bend_names = [names[0], names[1], names[2]]  # thumb: Metacarpal, Proximal, Distal bend
        for i, name in enumerate(bend_names):
            total += angles[i]
            out[name] = {"q": g.normalise(g.multiply(hand_q, g.from_axis_angle(0, total))),
                         "pos": (SPREAD_X[fi], 1.1, 0.27 + 0.03 * (i + 1) * math.cos(total))}
        out[names[-1]] = {"q": out[bend_names[-1]]["q"], "pos": (SPREAD_X[fi], 1.1, 0.36)}
    return out


def body_extras(v4: bool) -> dict[str, dict]:
    """Non-hand joints so the frame looks like a real one (arms, spine)."""
    ident = (0.0, 0.0, 0.0, 1.0)
    names = ("Hips", "Spine1", "Spine4", "Neck", "Head", "LeftArm", "LeftForeArm", "RightArm", "RightForeArm") if v4 else \
        ("hip", "spine", "chest", "neck", "head", "leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm")
    return {n: {"q": ident, "pos": (0.0, 0.9 + 0.1 * i, 0.0)} for i, n in enumerate(names)}


def frame(index: int, v4: bool, curls: dict[str, tuple[float, ...]]) -> dict:
    """One Studio frame at 60 fps."""
    joints = body_extras(v4)
    for side in ("Left", "Right"):
        joints |= hand_joints(side, curls[side], v4)
    meta = {"hasGloves": True, "hasLeftGlove": True, "hasRightGlove": True, "hasBody": True, "hasFace": False}
    if v4:
        names = list(joints)
        flat = [{"name": n, "parent": -1 if i == 0 else 0, "position": {k: round(v, 5) for k, v in zip("xyz", joints[n]["pos"], strict=True)},
                 "rotation": rot(joints[n]["q"])} for i, n in enumerate(names)]
        actor = {"newtons": [{"name": "Newton 01", "color": [255, 128, 0], "meta": {"hasHands": True, "hasLeftHand": True,
                 "hasRightHand": True, "hasBody": True, "hasFace": False}, "dimensions": {"totalHeight": 1.75, "hipHeight": 0.94},
                 "joints": flat}], "actors": []}
    else:
        body = {n: {"position": {k: round(v, 5) for k, v in zip("xyz", d["pos"], strict=True)}, "rotation": rot(d["q"])} for n, d in joints.items()}
        actor = {"actors": [{"name": "Actor 01", "color": {"r": 255, "g": 128, "b": 0}, "meta": meta,
                 "dimensions": {"totalHeight": 1.75, "hipHeight": 0.94}, "body": body}], "newtons": []}
    return {"version": 3 if not v4 else "3,0", "fps": 60, "scene": {"timestamp": round(index / 60, 5), **actor, "props": []}}


def main() -> None:
    """Write single poses and a looping sweep for both formats."""
    poses = {"open": (0.0,) * 5, "fist": (1.0,) * 5, "index_half": (0.0, 0.5, 0.0, 0.0, 0.0)}
    for v4 in (False, True):
        tag = "v4" if v4 else "v3"
        for name, curl in poses.items():
            (OUT / f"{tag}_{name}.json").write_text(json.dumps(frame(0, v4, {"Left": curl, "Right": curl})), encoding="utf8")
        lines = []
        for i in range(SWEEP_FRAMES):
            wave = 0.5 - 0.5 * math.cos(2 * math.pi * i / SWEEP_FRAMES)
            curls = tuple(min(1.0, max(0.0, wave * (1.0 + 0.1 * k) - 0.05 * k)) for k in range(5))
            lines.append(json.dumps(frame(i, v4, {"Left": curls, "Right": curls[::-1]}), separators=(",", ":")))
        (OUT / f"{tag}_sweep.jsonl").write_text("\n".join(lines) + "\n", encoding="utf8")


if __name__ == "__main__":
    main()
