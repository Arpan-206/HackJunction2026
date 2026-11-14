# coach_tune: how to run the Verda steps

Verda refuses VMs on the coupon balance until a card is on file ("Compute cannot be deployed using JUNCTION-2026
coupon balance until at least one payment method is added"). So every step runs on Verda Serverless Containers.
`vm_up.py`, `vm_down.py` and `remote/*.sh` are the old VM path, kept for a funded account.

All commands from the worktree root. `PY=/Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python` (it has the
`verda` SDK and httpx). `TEACHER=https://containers.datacrunch.io/coach-tune-teacher`,
`TRAINER=https://containers.datacrunch.io/coach-tune-trainer`. The key is `VERDA_INFERENCE_KEY` in `.env`; the
client reads only that line.

| Step | Command | Time on 14 Nov |
| --- | --- | --- |
| 0. Dataset (local) | `/Users/arpanpandey/Code/Junction/repo/.venv/bin/python coach_tune/build_dataset.py` | 20 s |
| 1. Teacher up (31B bf16, checks the 50 floor) | `$PY coach_tune/teacher_up.py --gpu H100` | 6 min |
| 2. Spot check, 50 labels | `COACH_TUNE_BASE_URL=$TEACHER $PY coach_tune/label.py --limit 25 --concurrency 50` | 2 s |
| 3. Labels | `COACH_TUNE_BASE_URL=$TEACHER $PY coach_tune/label.py --concurrency 64` | 35 s |
| 4. Teacher evaluation | `COACH_TUNE_BASE_URL=$TEACHER $PY coach_tune/evaluate.py --system teacher` | 1 min |
| 5. Teacher down | `$PY coach_tune/teacher_up.py --down` | 1 min |
| 6. Trainer up, serving untuned E2B | `$PY coach_tune/trainer_up.py --gpu H100` (`--no-base` skips the untuned server) | 1 min, vLLM 4 min more |
| 7. Untuned evaluation | `$PY coach_tune/ctl.py wait-vllm`, then `COACH_TUNE_BASE_URL=$TRAINER $PY coach_tune/evaluate.py --system untuned` | 1 min |
| 8. Training data up | `$PY coach_tune/make_sft.py`, then `$PY coach_tune/ctl.py upload` | seconds |
| 9. Smoke test | `$PY coach_tune/ctl.py train --args "--max-steps 20 --no-merge"`; check `ctl.py status` and `ctl.py fetch adapter` (samples.json) | 1 min |
| 10. LoRA and merge | `$PY coach_tune/ctl.py train --args "--seed 0"`; watch `ctl.py status` | 3 min, plus merge |
| 11. Adapter home | `$PY coach_tune/ctl.py fetch adapter` (to `coach_tune/out/adapter/`) | 30 s |
| 12. Tuned evaluation | `$PY coach_tune/ctl.py serve tuned`, `ctl.py wait-vllm`, then `COACH_TUNE_BASE_URL=$TRAINER $PY coach_tune/evaluate.py --system tuned`, then `--report` | 4 min |
| 13. Tear down | `$PY coach_tune/trainer_up.py --down` (the API delete call often times out at 60 s; the script waits until the deployment is gone) | 1 to 3 min |

Serve the saved adapter again: `docs/COACH_MODEL.md`, "Serve it again".

Backend with the tuned coach while the trainer serves it:
`COACH_MODEL=tuned TUNED_BASE_URL=$TRAINER TUNED_API_KEY=<VERDA_INFERENCE_KEY> uv run uvicorn app.main:app --port 8000`
in `backend/`.

Limits learnt on 14 Nov:

- Verda caps every env value and every command argument at 253 characters. `trainer_up.py` sends the control server
  gzipped in 14 numbered env variables.
- The vLLM image has `python3` and no `python`.
- The merged Gemma 4 E2B needs the shared-KV weights copied back from the base model (`train_lora.py`, `fill_shared_kv`).
