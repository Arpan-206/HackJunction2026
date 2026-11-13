"""Turn a MotionSpec into glove frames. Ported from the prototype renderer's pose maths."""

import math
from dataclasses import dataclass

from app import constants as c
from app.schemas.common import FingerValues, Side
from app.schemas.frames import GloveFrame, HandFrame
from app.schemas.motion import FingerSequence, GripAndSwing, HoldPose, Idle, MotionSpec, Pinch
from app.services import geometry


@dataclass(frozen=True)
class Pose:
    """Per-finger curl (0 open .. 1 curled) plus the wrist yaw and pitch offsets in radians."""

    curls: tuple[float, ...]
    yaw: float = 0.0
    pitch: float = 0.0


def _sequence_pose(spec: FingerSequence, t: float) -> Pose:
    """Press the active finger of the sequence on each beat, lifting the next one."""
    beat = spec.beat_ms / 1000.0
    seq = spec.sequence
    idx = int(t // beat) % len(seq)
    active = seq[idx] - 1
    nxt = seq[(idx + 1) % len(seq)] - 1
    phase = (t % beat) / beat
    press = math.sin(phase / c.SEQ_PRESS_WINDOW * math.pi) if phase < c.SEQ_PRESS_WINDOW else 0.0
    lift = 0.0
    if phase > c.SEQ_LIFT_START:
        lift = math.sin((phase - c.SEQ_LIFT_START) / (1 - c.SEQ_LIFT_START) * math.pi) * c.SEQ_LIFT_AMOUNT
    curls = []
    for i in range(5):
        v = 0.0
        if i == active:
            v = press * c.SEQ_PRESS_CURL
        elif abs(i - active) == 1:
            v = press * c.SEQ_NEIGHBOUR_CURL
        if i == nxt and i != active:
            v -= lift
        curls.append(v)
    return Pose(tuple(curls))


def _swing_pose(spec: GripAndSwing, t: float) -> Pose:
    """Backswing, a fast wrist snap through contact, then follow-through."""
    beat = spec.beat_ms / 1000.0
    phase = (t % beat) / beat
    contact = 0.0
    if phase < c.SWING_BACKSWING_END:
        yaw = c.SWING_BACKSWING_YAW * math.sin(phase / c.SWING_BACKSWING_END * math.pi / 2)
    elif phase < c.SWING_CONTACT_END:
        k = (phase - c.SWING_BACKSWING_END) / (c.SWING_CONTACT_END - c.SWING_BACKSWING_END)
        yaw = c.SWING_BACKSWING_YAW - c.SWING_CONTACT_SWEEP * k
        contact = math.sin(k * math.pi)
    else:
        yaw = c.SWING_FOLLOW_YAW * (1 - (phase - c.SWING_CONTACT_END) / (1 - c.SWING_CONTACT_END))
    if spec.swing == "backhand":
        yaw = -yaw
    squeeze = c.SWING_SQUEEZE * contact
    curls = tuple(v + squeeze for v in c.GRIP_CURLS[spec.grip])
    return Pose(curls, yaw=yaw, pitch=c.SWING_PITCH)


def _pinch_pose(spec: Pinch, t: float) -> Pose:
    """Close the thumb against the chosen fingers once per beat."""
    beat = spec.beat_ms / 1000.0
    press = 0.5 - 0.5 * math.cos(2 * math.pi * (t % beat) / beat)
    curls = [c.PINCH_THUMB_CURL * press, 0.0, 0.0, 0.0, 0.0]
    for f in spec.fingers:
        curls[f - 1] = c.PINCH_FINGER_CURL * press
    return Pose(tuple(curls))


def pose_at(spec: MotionSpec, t: float) -> Pose:
    """Return the pose the motion is in at time t seconds."""
    if isinstance(spec, FingerSequence):
        return _sequence_pose(spec, t)
    if isinstance(spec, GripAndSwing):
        return _swing_pose(spec, t)
    if isinstance(spec, Pinch):
        return _pinch_pose(spec, t)
    if isinstance(spec, HoldPose):
        return Pose(tuple(spec.pose.as_list()))
    assert isinstance(spec, Idle)
    return Pose((c.IDLE_CURL,) * 5)


def _flexion(curls: tuple[float, ...], t: float) -> dict[str, tuple[float, float, float]]:
    """Convert curls to per-joint flexion in radians, with a slight breathing motion."""
    breathe = math.sin(t * c.BREATHE_RATE) * c.BREATHE_AMPLITUDE
    out: dict[str, tuple[float, float, float]] = {}
    for i, name in enumerate(c.FINGERS):
        curl = max(c.CURL_MIN, min(c.CURL_MAX, curls[i]))
        scale = c.THUMB_FLEXION_SCALE if i == 0 else 1.0
        extra = breathe if i else 0.0
        joints = tuple(
            round((c.RELAXED_FLEXION[i][s] + c.FULL_FLEXION[i][s] * curl + extra) * scale, c.FRAME_DECIMALS)
            for s in range(c.JOINTS_PER_FINGER)
        )
        out[name] = joints  # type: ignore[assignment]
    return out


def hand_frame(spec: MotionSpec, side: Side, t: float) -> HandFrame:
    """Synthesise one hand at time t."""
    pose = pose_at(spec, t)
    mirror = -1.0 if side == "left" else 1.0
    quat = geometry.from_yaw_pitch_roll(pose.yaw * mirror, pose.pitch, pose.yaw * c.SWING_ROLL_FACTOR * mirror)
    return HandFrame(
        side=side,
        wrist_quat=tuple(round(v, c.FRAME_DECIMALS) for v in quat),  # type: ignore[arg-type]
        wrist_pos=None,
        flexion=_flexion(pose.curls, t),
        spread=FingerValues(),
    )


def frame_at(spec: MotionSpec, t: float, sides: tuple[Side, ...] = ("left", "right")) -> GloveFrame:
    """Synthesise a simulator frame for the given sides at time t."""
    return GloveFrame(t=t, source="simulator", hands=[hand_frame(spec, s, t) for s in sides])


def synthesise(spec: MotionSpec, side: Side, duration_s: float, fps: float = c.STREAM_HZ) -> list[GloveFrame]:
    """Return a duration_s long list of single-hand frames at fps."""
    count = max(1, int(round(duration_s * fps)))
    return [frame_at(spec, i / fps, (side,)) for i in range(count)]
