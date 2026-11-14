"""Convert a Geppetto lesson folder into a LeRobot dataset episode.

A lesson (SPEC.md, "Lesson files") holds one take: `lesson.json` for the
steps and `trace.npz` for the per-frame arrays. This module reads one
lesson, retargets its 18 angle features to Dex3-1 joint targets with
`core.robot.Retargeter` (imported read-only; never edited here), and adds
one LeRobot frame per sample. The observation is the human hand state
(angles and joint positions); the action is the robot joint targets.

One lesson folder = one episode. A step's name becomes the LeRobot `task`
string for the frames inside that step, so an episode can carry several
task labels if the lesson has several steps.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core import hand as H  # noqa: E402
from core.config import load_config  # noqa: E402
from core.robot import Retargeter  # noqa: E402


@dataclass
class Lesson:
    path: Path
    meta: dict
    t_us: np.ndarray
    angles: np.ndarray
    joints: np.ndarray
    wrist_p: np.ndarray
    wrist_q: np.ndarray
    step: np.ndarray

    @property
    def id(self) -> str:
        return str(self.meta["id"])

    @property
    def hand_side(self) -> str:
        return str(self.meta["master"]["hand"])

    @property
    def rate_hz(self) -> float:
        return float(self.meta["rate_hz"])

    def step_name(self, step_index: int) -> str:
        for s in self.meta["steps"]:
            if s["index"] == step_index:
                return str(s["name"])
        return f"step {step_index}"


def load_lesson(lesson_dir: str | Path) -> Lesson:
    lesson_dir = Path(lesson_dir)
    with open(lesson_dir / "lesson.json") as f:
        meta = json.load(f)
    trace = np.load(lesson_dir / "trace.npz")
    return Lesson(
        path=lesson_dir,
        meta=meta,
        t_us=trace["t_us"],
        angles=trace["angles"],
        joints=trace["joints"],
        wrist_p=trace["wrist_p"],
        wrist_q=trace["wrist_q"],
        step=trace["step"],
    )


def build_retargeter(root: Path | None = None) -> Retargeter:
    root = root or REPO_ROOT
    cfg = load_config(root / "config.toml")
    return Retargeter(cfg.robot, root)


def robot_action_names(rt: Retargeter, side: str) -> list[str]:
    """Side-agnostic action names (the retarget table key, e.g. "thumb_0").

    The URDF joint names differ per side ("left_hand_thumb_0_joint" versus
    "right_hand_..."), but a dataset's `action` feature names are fixed at
    creation time. A lesson can be either hand, so the action vector is
    keyed by the retarget entry, not the side-specific URDF joint name.
    """
    return [e.key for e in rt.entries]


def lesson_to_frames(lesson: Lesson, rt: Retargeter) -> list[dict]:
    """One dict per sample: observation arrays, robot action vector, task label.

    Wrist position carries NaN when there is no world-position fix (gloves
    have none, SPEC.md trace.npz). It is dropped from the observation rather
    than fed to the dataset as NaN.
    """
    side = lesson.hand_side
    action_keys = robot_action_names(rt, side)
    urdf_names = rt.joint_names(side)
    key_to_urdf_name = dict(zip(action_keys, urdf_names))
    n = lesson.angles.shape[0]
    frames = []
    for i in range(n):
        targets = rt.targets(lesson.angles[i], side)
        action = np.array([targets.q[key_to_urdf_name[k]] for k in action_keys], dtype=np.float32)
        frame = {
            "observation.state.angles_deg": lesson.angles[i].astype(np.float32),
            "observation.state.joints_xyz": lesson.joints[i].reshape(-1).astype(np.float32),
            "observation.state.wrist_quat": lesson.wrist_q[i].astype(np.float32),
            "observation.state.hand_side_onehot": np.array(
                [1, 0] if side == "left" else [0, 1], dtype=np.int64
            ),
            "action": action,
            "_task": lesson.step_name(int(lesson.step[i])),
            "_timestamp": float(lesson.t_us[i]) / 1_000_000.0,
        }
        frames.append(frame)
    return frames


def dataset_features(angle_names: list[str], n_joints: int, action_names: list[str]) -> dict:
    return {
        "observation.state.angles_deg": {
            "dtype": "float32",
            "shape": (len(angle_names),),
            "names": list(angle_names),
        },
        "observation.state.joints_xyz": {
            "dtype": "float32",
            "shape": (n_joints * 3,),
            "names": None,
        },
        "observation.state.wrist_quat": {
            "dtype": "float32",
            "shape": (4,),
            "names": ["x", "y", "z", "w"],
        },
        # A length-2 one-hot, not a scalar: this installed lerobot (0.3.3)
        # fails to encode a shape-(1,) custom feature under numpy>=2 (int()
        # on a 1-element array raises). See export/README.md "Known issue".
        "observation.state.hand_side_onehot": {
            "dtype": "int64",
            "shape": (2,),
            "names": ["left", "right"],
        },
        "action": {
            "dtype": "float32",
            "shape": (len(action_names),),
            "names": list(action_names),
        },
    }


__all__ = [
    "Lesson",
    "load_lesson",
    "build_retargeter",
    "robot_action_names",
    "lesson_to_frames",
    "dataset_features",
    "H",
]
