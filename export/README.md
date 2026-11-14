# geppetto-export

Turns Geppetto lesson folders into a LeRobot dataset. One lesson folder
(SPEC.md, "Lesson files") becomes one LeRobot episode:

- **observation**: the human hand state for each sample (18 angle features
  in degrees, the 26 wrist-relative joint positions, the wrist orientation,
  and a left/right one-hot).
- **action**: the Dex3-1 robot joint targets for that same sample, computed
  with `core/robot.py`'s `Retargeter` (the same retarget table and URDF
  limits the live `/ws/robot` socket uses). `core/` is imported read-only;
  nothing here writes to it.

Each lesson step's name (`lesson.json` `steps[].name`, for example "Fist")
becomes the LeRobot `task` string for the frames inside that step.

## Run it

```bash
cd export
uv sync
uv run geppetto-export                 # exports every lessons/*/lesson.json into export/out/geppetto_robot_demos
```

Options:

```bash
uv run geppetto-export --lessons-dir ../lessons --out ./out/geppetto_robot_demos [--overwrite]
```

The defaults are `<repo root>/lessons` and `export/out/geppetto_robot_demos`,
so the no-argument form is the one that exports every lesson in the repo.

## Verify

```bash
uv run pytest -q
```

The tests find `lessons/` at `<repo root>/lessons` the same way the CLI
does. Set `GEPPETTO_LESSONS_DIR` to point them at a different lessons
folder (for example when `export/` is checked out one level deeper than
the real repo root, such as inside a `git worktree`).

The tests export the lessons in the repo's `lessons/` folder into a scratch
directory and load the result back with LeRobot's own loader
(`lerobot.datasets.lerobot_dataset.LeRobotDataset`, not a hand-rolled
parquet read): episode count, frame count, observation shapes, the task
strings, and that every retargeted action sits inside its joint's URDF
limits.

To check an export by hand:

```python
from lerobot.datasets.lerobot_dataset import LeRobotDataset

ds = LeRobotDataset("geppetto/robot-demos", root="out/geppetto_robot_demos")
print(ds.num_episodes, ds.num_frames, ds.fps)
sample = ds[0]
print(sample["observation.state.angles_deg"], sample["action"], sample["task"])
```

## Dataset layout

Built with `lerobot==0.3.3` (the version this project pins; it is the
release on PyPI and implements the dataset's `v2.1` codebase format, not
the newer file-packed `v3.0` layout described in LeRobot's current docs,
which has not reached PyPI as of this writing). `LeRobotDataset.create()`,
`add_frame()` and `save_episode()` are the real library calls, not a
reimplementation, so the on-disk layout is whatever that installed version
writes:

```
out/geppetto_robot_demos/
  meta/info.json          fps, features (dtype, shape, names), robot_type
  meta/episodes.jsonl     one record per lesson: length, task indices
  meta/episodes_stats.jsonl
  meta/tasks.jsonl        step names, as task strings, to integer ids
  data/chunk-000/episode_000000.parquet   one file per lesson
  ...
```

## Fields

| Feature | Shape | Content |
| --- | --- | --- |
| `observation.state.angles_deg` | (18,) | `core/hand.py` `ANGLE_NAMES`: per-finger MCP/PIP/DIP plus 4 inter-finger spreads, degrees |
| `observation.state.joints_xyz` | (78,) | the 26 wrist-relative joint positions (`trace.npz` `joints`), flattened |
| `observation.state.wrist_quat` | (4,) | wrist orientation, x y z w |
| `observation.state.hand_side_onehot` | (2,) | `[1,0]` left, `[0,1]` right |
| `action` | (7,) | Dex3-1 joint targets, radians, names `thumb_0 thumb_1 thumb_2 index_0 index_1 middle_0 middle_1` (ring and little are not on Dex3-1, per `core/robot.py`) |

`action`'s names are the retarget table's keys (`config.toml`
`[robot.retarget.*]`), not the side-prefixed URDF joint names
(`left_hand_thumb_0_joint` / `right_hand_thumb_0_joint`), so a dataset that
mixes left- and right-hand lessons still has one consistent action schema.
`wrist_p` (world wrist position) from `trace.npz` is left out: gloves have
no world-position fix, so it is `NaN` in every lesson recorded tonight.

## Known issue

The installed `lerobot` (0.3.3) cannot encode a custom scalar feature
(shape `()` or `(1,)`) under `numpy>=2`: `datasets.Value.encode_example`
calls `int()` on the stored value, and `int()` on a 1-element numpy array
raises under numpy 2.x ("only 0-dimensional arrays can be converted to
Python scalars"). That is why `hand_side` is a length-2 one-hot vector
instead of a scalar flag. If `lerobot` is upgraded past this bug, the
one-hot can be collapsed back to a scalar; no other field needs to change.

## What a human should check next

- Only two lessons exist right now (`fake-demo`, `fake-wave`, both
  synthetic, both the `fake` right hand). The exporter and its tests only
  prove the pipeline on those; nothing here has run on a real recorded
  lesson yet.
- `lerobot==0.3.3` writes the `v2.1` on-disk format. If a training pipeline
  expects the `v3.0` chunked-parquet layout from the current docs, either
  wait for a PyPI release that includes it, or run LeRobot's own
  `python -m lerobot.scripts.convert_dataset_v21_to_v30` on this export's
  output once that script is available in the installed version (it is not
  in 0.3.3).
- No camera frames exist in any lesson, so this dataset has no video
  features. If `frames/step_XX.jpg` keyframes should be included, that is
  a new `observation.images.*` feature, not a change to the fields above.
