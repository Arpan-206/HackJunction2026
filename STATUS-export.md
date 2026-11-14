# STATUS-export.md

Lane `export`, directory `export/`. Written Sat 14 Nov 2026, Helsinki time.

## What it does

`export/` converts Geppetto lesson folders (SPEC.md, "Lesson files":
`lesson.json` + `trace.npz`) into a LeRobot dataset, one episode per
lesson. The observation is the human hand state per sample (18 angle
features, 26 joint positions, wrist orientation, hand side); the action is
the Dex3-1 robot joint targets for that same sample, computed with
`core/robot.py`'s `Retargeter` (read-only import, same retarget table and
URDF limits the live `/ws/robot` socket uses). A step's name becomes the
LeRobot `task` string for its frames.

## How to run it

```bash
cd export
uv sync
uv run geppetto-export              # exports every lessons/*/lesson.json into export/out/geppetto_robot_demos
uv run pytest -q                    # exports the repo's lessons into a scratch dir, loads the result with LeRobotDataset, checks it
```

Full options and the field table are in `export/README.md`.

## Works and is tested

- `uv run geppetto-export` exported both lessons that exist in this repo
  right now (`fake-demo`, 916 frames; `fake-wave`, 333 frames) into a
  LeRobot dataset.
- The dataset was loaded back with LeRobot's own loader
  (`lerobot.datasets.lerobot_dataset.LeRobotDataset`), not a hand-rolled
  parquet read: `ds.num_episodes == 2`, `ds.num_frames == 1249`, correct
  observation shapes, correct `task` strings ("Open hand", "Fist", ...),
  and every retargeted action value sits inside its joint's URDF limit (a
  fist closes near the upper limit, an open hand sits near 0, matching
  STATUS.md's own description of the retargeter's behaviour).
- 5 pytest tests cover all of the above; `uv run pytest -q` passes.
- `export/pyproject.toml` is a `uv`-managed project (`uv sync`, no manual
  venv, no `pip install`), with `lerobot` and `numpy>=2` as real
  dependencies, not vendored.

## Written but untested, and why

- **Only the two fake lessons exist.** `fake-demo` and `fake-wave` are both
  synthetic (`core/fake.py`) and both the "fake" right hand. Nothing here
  has run on a lesson recorded from a real glove. The converter reads
  `lesson.json` and `trace.npz` generically (SPEC.md's schema), so it
  should work unchanged on a real recording, but that is untested because
  no real-glove lesson exists yet in this repo.
- **Only one side (right) has been exercised.** The code path for a
  left-hand lesson (different URDF, `left_hand_*_joint` names) is the same
  code, exercised by `test_urdf_loads_joints_and_limits` style logic in
  `core`'s own tests, but no left-hand lesson exists to export here.
- **A mixed left/right dataset.** The action feature's names are fixed at
  `LeRobotDataset.create()` time from the first lesson found; a later
  lesson of the other hand side is skipped with a warning to stderr
  (`export.py`'s `skip ...: action names do not match`) rather than
  widening the schema. With two lessons in the repo, both right-handed,
  this path never ran against real divergent data, only reasoned about.
- **`wrist_p` (world wrist position) is left out of every observation.**
  `trace.npz`'s `wrist_p` is `NaN` for every sample in both lessons (gloves
  have no world-position fix), so it was dropped rather than exported as
  NaN. If a camera-anchored lesson with real `wrist_p` shows up later, this
  decision should be revisited.

## What a human must do next

1. **Record a real lesson and re-run `uv run geppetto-export`.** This is
   the one real gap: the whole pipeline is proven on synthetic data only.
   If a real-glove lesson's `trace.npz` has a different dtype, NaN pattern,
   or step cut than `fake-demo`/`fake-wave`, the exporter may need a small
   fix; nothing in its code assumes synthetic data specifically, but it has
   not been checked against real data.
2. **Decide on LeRobot's dataset format version.** The installed
   `lerobot==0.3.3` (current PyPI release, Sat 14 Nov) writes the `v2.1`
   on-disk layout (`episode_NNNNNN.parquet`, `episodes.jsonl`), not the
   newer file-packed `v3.0` layout described in LeRobot's current docs
   (`huggingface.co/docs/lerobot/en/lerobot-dataset-v3`), which has not
   reached PyPI. If a downstream trainer needs `v3.0`, either wait for a
   PyPI release that includes `lerobot.scripts.convert_dataset_v21_to_v30`
   (0.3.3 does not have it) or re-export once it ships.
3. **A known upstream bug, worked around, not fixed.** Under
   `numpy>=2`, this installed `lerobot` cannot encode any custom scalar
   feature (shape `()` or `(1,)`): `datasets.Value.encode_example` calls
   `int()` on the stored value, and `int()` on a 1-element numpy array
   raises under numpy 2.x. Worked around here by making `hand_side` a
   length-2 one-hot vector instead of a scalar flag (`export/README.md`,
   "Known issue"). No action needed unless a future feature wants to be a
   true scalar.
4. **If the robot's twin (lane for the frontend render, `arpan_info.md`
   section 4.1) or the "robot replay scored like a learner" concept (4.2)
   need a different action representation** (for example per-frame
   `q_norm` instead of `q`, or `fidelity`/`missing` in the observation
   rather than dropped), that is a one-line change in
   `export/src/geppetto_export/convert.py`'s `lesson_to_frames`, not a
   redesign.

## Decisions recorded

- Action feature names are the retarget table's keys (`thumb_0`,
  `thumb_1`, ..., `config.toml` `[robot.retarget.*]`), not the
  side-prefixed URDF joint names, so a dataset that someday mixes
  left- and right-hand lessons keeps one consistent action schema. See
  `export/README.md` "Fields".
- `repo_id` is a fixed placeholder string, `"geppetto/robot-demos"`; this
  dataset is never pushed to the Hub, so the string is only used locally
  as the dataset's self-description in `meta/info.json`.
- `use_videos=False`: no lesson in this repo has camera frames
  (`frames/step_XX.jpg` keyframes are static images, not video, and
  `video.mp4` is marked optional in SPEC.md and absent from both lessons
  here), so the dataset has no video feature.
