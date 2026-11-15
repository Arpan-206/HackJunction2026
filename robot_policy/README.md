# robot_policy: a small policy that performs a lesson on a simulated Dex3-1 hand

Standalone work. It is not part of the live app: nothing in `core/`, `backend/` or `frontend/` imports it, and it
starts no server. The write-up with the results is `docs/ROBOT_POLICY.md`.

## What is here

| File | Purpose |
| --- | --- |
| `prepare.py` | Reads the expert's real glove takes and the core's Dex3-1 retarget. Writes `out/data/`. The only file that imports `core`. |
| `common.py` | Variations of a take, the batched simulator, the policy, the rollout loop. |
| `run.py` | `train` (on generated variations only) and `eval` (on held-out real takes only). |
| `mujoco_check.py` | The same policy in MuJoCo, built from the URDF: a second evaluation and the video. |
| `verda_ctl.py`, `remote/` | Run `run.py` on one Verda GPU (Serverless Container `robot-policy`). |
| `fill_doc.py`, `report.py` | Copy the numbers from the result files into the write-up, or print them. |
| `out/results*.json`, `out/train*.json`, `out/video.json`, `out/cost_log.jsonl`, `out/policy_demo.mp4`, `out/policy.pt`, `out/policy_laptop.pt` | The results that are kept in git. The rest of `out/` is ignored. |

## Commands

All from the repo root.

```bash
# 1. Export the real takes and the retarget (core's Python: it has the core package)
.venv/bin/python robot_policy/prepare.py

# 2. The laptop run (CPU): train in under a minute, then evaluate
cd robot_policy
uv sync
uv run python run.py train --envs 256 --iters 200 --variations 8 --lr 2e-3
cp out/policy.pt out/policy_laptop.pt && cp out/train.json out/train_laptop.json
uv run python run.py eval --rollouts 500 --policy policy_laptop.pt --tag laptop
uv run python mujoco_check.py eval --rollouts 200 --policy policy_laptop.pt --tag laptop

# 3. The large run on one Verda GPU (it did not give a better policy; it gives the large evaluation)
cd ..
PY=verda/.venv/bin/python
$PY robot_policy/verda_ctl.py up --gpu H100
$PY robot_policy/verda_ctl.py upload
$PY robot_policy/verda_ctl.py run bench.sh        # a short test first
$PY robot_policy/verda_ctl.py run job.sh          # train, then evaluate
$PY robot_policy/verda_ctl.py status              # repeat until the phase is done:job.sh
$PY robot_policy/verda_ctl.py fetch               # to robot_policy/out/verda/rp/out/
cp robot_policy/out/verda/rp/out/{policy.pt,train.json,results.json} robot_policy/out/
$PY robot_policy/verda_ctl.py upload && $PY robot_policy/verda_ctl.py run mj.sh   # optional: the MuJoCo check on the container's CPU
$PY robot_policy/verda_ctl.py down                # always; it prints the minutes and the cost

# 4. The GPU-trained policy in the same laptop evaluation, the video, and the numbers of the write-up
cd robot_policy
uv run python run.py eval --rollouts 500 --policy policy.pt --tag gpu_policy_on_laptop
uv run python mujoco_check.py video
uv run python fill_doc.py                         # only on a write-up that still has its __NAME__ marks
```

Tests (no torch needed): `.venv/bin/python -m pytest -q tests/test_robot_policy_standalone.py` from the repo root.

## Rules this folder keeps

1. Real expert takes in `common.HELD_OUT` are test data only. `train` never reads them in any form.
2. Training data is generated: other timing, sensor noise and another hand size (`common.variation`).
3. Every number in the write-up comes from a run of these commands. The run sizes are in the result files.
4. The simulators have no contact. `docs/ROBOT_POLICY.md` lists what each one models.
