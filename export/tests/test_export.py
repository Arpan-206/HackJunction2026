"""Export the two fake lessons under repo lessons/ and load the result back
with LeRobot's own LeRobotDataset loader (not a hand-rolled parquet read).
"""

import os
from pathlib import Path

import pytest
from geppetto_export.convert import REPO_ROOT
from geppetto_export.export import export

# REPO_ROOT is 3 levels above this package's own file, which is correct once
# export/ sits directly under the repo root. GEPPETTO_LESSONS_DIR overrides
# it for a session where export/ is nested one level deeper (e.g. a worktree
# at .claude/worktrees/<lane>/export/).
REPO_LESSONS = (
    Path(os.environ["GEPPETTO_LESSONS_DIR"])
    if "GEPPETTO_LESSONS_DIR" in os.environ
    else REPO_ROOT / "lessons"
)


@pytest.fixture
def dataset_dir(tmp_path):
    out = tmp_path / "geppetto_robot_demos"
    export(REPO_LESSONS, out, overwrite=True)
    return out


def test_episode_count_matches_lesson_count(dataset_dir):
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    ds = LeRobotDataset("geppetto/robot-demos", root=dataset_dir)
    lesson_dirs = list(REPO_LESSONS.glob("*/lesson.json"))
    assert ds.num_episodes == len(lesson_dirs)


def test_frame_count_matches_trace_length(dataset_dir):
    import numpy as np
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    ds = LeRobotDataset("geppetto/robot-demos", root=dataset_dir)
    expected = sum(
        np.load(p.parent / "trace.npz")["t_us"].shape[0]
        for p in REPO_LESSONS.glob("*/lesson.json")
    )
    assert ds.num_frames == expected


def test_action_is_within_urdf_limits(dataset_dir):
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    ds = LeRobotDataset("geppetto/robot-demos", root=dataset_dir)
    lower = {
        "thumb_0": -1.0472,
        "thumb_1": -1.0472,
        "thumb_2": -1.7453,
        "index_0": 0.0,
        "index_1": 0.0,
        "middle_0": 0.0,
        "middle_1": 0.0,
    }
    upper = {
        "thumb_0": 1.0472,
        "thumb_1": 0.6109,
        "thumb_2": 0.0,
        "index_0": 1.5708,
        "index_1": 1.7453,
        "middle_0": 1.5708,
        "middle_1": 1.7453,
    }
    names = ds.features["action"]["names"]
    for i in range(0, ds.num_frames, 37):
        action = ds[i]["action"].numpy()
        for name, value in zip(names, action):
            assert lower[name] - 1e-3 <= value <= upper[name] + 1e-3, (i, name, value)


def test_observation_shapes(dataset_dir):
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    ds = LeRobotDataset("geppetto/robot-demos", root=dataset_dir)
    sample = ds[0]
    assert sample["observation.state.angles_deg"].shape == (18,)
    assert sample["observation.state.joints_xyz"].shape == (78,)
    assert sample["observation.state.wrist_quat"].shape == (4,)
    assert sample["observation.state.hand_side_onehot"].tolist() == [0, 1]  # right hand
    assert sample["action"].shape == (7,)


def test_step_names_become_tasks(dataset_dir):
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    ds = LeRobotDataset("geppetto/robot-demos", root=dataset_dir)
    assert ds[0]["task"] == "Open hand"
