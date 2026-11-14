"""Lane thumb-align: the synthesiser that draws the preview and the scorer agree on every joint, the thumb included.

The scorer's target for a curl c is its nominal guide-hand range, flat + c * (fist - flat) (`scoring._standard`, the
thumb scaled by THUMB_FLEXION_SCALE). Every fingerspelling letter and every shadow puppet is rendered through the
synthesiser and each joint must sit within 5 degrees of that target while the pose is held. A pose built straight from
the targets (what a learner who copies the preview exactly would wear) must score as perfect.
"""

import math

import numpy as np
import pytest
from app import constants as c
from app.schemas.motion import HoldPose, Keyframe, Keyframes, MotionSpec
from app.services import scoring
from app.services.motion import synthesiser
from app.services.moves import load_moves
from fastapi.testclient import TestClient

MAX_JOINT_DEG = 5.0
# Where in each key's slot to sample: past the blend in from the previous key, so the key is fully held.
SETTLED = 0.5 + (1 - c.KEYFRAME_BLEND) / 2


def _moves() -> list:
    return [m for m in load_moves() if m.id.startswith(("fs_", "sp_"))]


def _sides(move) -> list[str]:
    return ["left", "right"] if move.hands == "both" else [move.hands]


def _target(curls: list[float]) -> np.ndarray:
    """The scorer's (5, 3) flexion target for a curl per finger."""
    flat, fist = scoring._standard()
    k = np.clip(np.array(curls, dtype=float), c.CURL_MIN, c.CURL_MAX)[:, None]
    return flat + k * (fist - flat)


def _held(spec: MotionSpec, side: str) -> list[tuple[float, list[float]]]:
    """(time, curls) pairs at which the motion holds a known pose, read from the spec itself."""
    if isinstance(spec, HoldPose):
        pose = (
            spec.left_pose
            if side == "left" and spec.left_pose is not None
            else spec.pose
        )
        return [(t, pose.as_list()) for t in (0.0, 0.4, 1.1, 2.3)]
    assert isinstance(spec, Keyframes)
    keys: list[Keyframe] = (
        spec.left_keys if side == "left" and spec.left_keys else spec.keys
    )
    stretch = sum(k.ms for k in spec.keys) / sum(k.ms for k in keys)
    out, start = [], 0.0
    for key in keys:
        slot = key.ms / 1000.0 * stretch
        out.append((start + slot * SETTLED, key.pose.as_list()))
        start += slot
    return out


def _flexion(spec: MotionSpec, side: str, t: float) -> np.ndarray:
    hand = synthesiser.hand_frame(spec, side, t)  # type: ignore[arg-type]
    return np.array([hand.flexion[f] for f in c.FINGERS], dtype=float)


def _cases() -> list[tuple[str, str]]:
    return [(m.id, s) for m in _moves() for s in _sides(m)]


def test_the_set_is_every_letter_and_every_puppet() -> None:
    ids = {m.id for m in _moves()}
    assert {f"fs_{x}" for x in "abcdefghijklmnopqrstuvwxyz"} <= ids
    assert {i for i in ids if i.startswith("sp_")} == {
        "sp_rabbit",
        "sp_talking_dog",
        "sp_swan",
        "sp_flapping_bird",
        "sp_snail",
    }


@pytest.mark.parametrize(("move_id", "side"), _cases())
def test_every_joint_is_within_5_degrees_of_the_scorer_target(
    move_id: str, side: str
) -> None:
    spec = next(m for m in _moves() if m.id == move_id).default_motion
    for t, curls in _held(spec, side):
        gap = np.degrees(np.abs(_flexion(spec, side, t) - _target(curls)))
        worst = np.unravel_index(int(gap.argmax()), gap.shape)
        assert gap.max() < MAX_JOINT_DEG, (
            f"{move_id} {side} t={t:.2f}: {c.FINGERS[worst[0]]}[{worst[1]}] off by {gap.max():.1f} deg"
        )
        # The thumb carries no breathing, so it must match exactly.
        assert gap[0].max() < 0.01, (
            f"{move_id} {side}: thumb off by {gap[0].max():.2f} deg"
        )


def _copied_frames(spec: MotionSpec, side: str, seconds: float) -> list[dict]:
    """Frames of a learner who wears the scorer's target exactly, key by key, at 30 Hz."""
    frames = []
    n = int(round(seconds * scoring.c.SCORE_FPS))
    for i in range(n):
        t = i / scoring.c.SCORE_FPS
        pose = synthesiser.pose_at(spec, t, side)  # type: ignore[arg-type]
        target = _target(list(pose.curls))
        frames.append(
            {
                "t": t,
                "source": "replay",
                "hands": [
                    {
                        "side": side,
                        "wrist_quat": list(
                            synthesiser.hand_frame(spec, side, t).wrist_quat
                        ),  # type: ignore[arg-type]
                        "flexion": {
                            f: [float(v) for v in target[j]]
                            for j, f in enumerate(c.FINGERS)
                        },
                    }
                ],
            }
        )
    return frames


@pytest.mark.parametrize(("move_id", "side"), _cases())
def test_a_pose_copied_from_the_target_scores_as_perfect(
    client: TestClient, move_id: str, side: str
) -> None:
    spec = next(m for m in _moves() if m.id == move_id).default_motion
    period = synthesiser.motion_period(spec) or 2.0
    seconds = max(2.0, period)
    res = client.post(
        "/api/score",
        json={
            "reference_motion": spec.model_dump(),
            "attempt_frames": _copied_frames(spec, side, seconds),
            "side": side,
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["overall"] >= 99, f"{move_id} {side}: {res.json()['overall']}"
    assert not math.isnan(res.json()["overall"])
