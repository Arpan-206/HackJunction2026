# STATUS-coach-tune.md

Lane "coach-tune", branch `coach-tune`, worktree `.claude/worktrees/coach-tune`. Sat 14 Nov 2026, 20:10 Helsinki.

## State: DONE, everything torn down

Labels, training, evaluation and serving all ran on Verda Serverless Containers between 19:05 and 20:02.
Training started at 19:27, before the 21:30 limit. Final Verda state at 20:02: no deployments, no instances.
The balance read 196.70 EUR (Verda posts charges with a lag).

Verda refused every VM: "Compute cannot be deployed using JUNCTION-2026 coupon balance until at least one payment
method is added." Containers work on the coupon, so the whole pipeline moved to containers.

## Results

| Item | Value |
| --- | --- |
| Teacher that wrote every label | `google/gemma-4-31B-it`, bf16, vLLM v0.29.0, 1x H100 80 GB container |
| Why that teacher | It fits the H100 at full precision, so no quantised or smaller teacher was needed. The 50 example spot check kept 50 of 50. |
| Labels | 3,231 of 3,363 kept (96.1%) in 35 s, 64 requests at a time |
| Student | `google/gemma-4-E2B-it` with LoRA r16, bf16, 3 epochs, seed 0, 555 steps in 167 s on 1x H100 |
| Smoke test | 20 steps, loss 2.65 then 0.43, finite; 5 sane lines |

| System | Right finger % | Right direction % | Style % | All three % | Real capture all three % | p50 s | p95 s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2B untuned | 58.7 | 87.5 | 100.0 | 55.5 | 43.5 | 0.118 | 0.168 |
| E2B tuned | 89.1 | 98.3 | 100.0 | 89.0 | 62.2 | 0.108 | 0.166 |
| 31B teacher | 88.9 | 95.0 | 100.0 | 85.7 | 66.7 | 0.311 | 0.517 |

The tuned model beats the untuned one clearly. On real capture frames it is below the teacher. Full report and 20
side-by-side samples: `coach_tune/out/eval/report.md` (git-ignored). Model card: `docs/COACH_MODEL.md`.

Live backend check (`COACH_MODEL=tuned`, five hint requests to the running container): the first fell back after
the 2 s cap while a new TLS connection opened; the tuned model answered the other four in 0.36 to 0.74 s.

## Cost table

| Time (Helsinki) | Step | Rate USD per hour | Minutes | Cost USD | Running total USD |
| --- | --- | --- | --- | --- | --- |
| 18:45 | Balance check: 200 EUR | none | 0 | 0.00 | 0.00 |
| 18:47, 18:57 | VM start refused by permission prompts | none | 0 | 0.00 | 0.00 |
| 19:04 | VM start refused by Verda (coupon balance) | none | 0 | 0.00 | 0.00 |
| 19:05 to 19:13 | Teacher container: spot check, labels, teacher evaluation | 5.77 | 8.0 | 0.77 | 0.77 |
| 19:07 to 19:17 | Trainer container, first start: untuned evaluation (redeployed to fix `python`) | 5.77 | 9.5 | 0.91 | 1.68 |
| 19:18 to 20:00 | Trainer, second start: smoke test, training, tuned evaluation, re-serve test | 5.77 | 42 | 4.04 | 5.72 |
| 20:02 | All torn down | none | 0 | 0.00 | 5.72 |

Lane budget 80 USD: 5.72 used. The 50 floor was never at risk.

## No-Gemini audit: clean

- Labels came only from our self-hosted Gemma 4. `oai.py` talks only to our own vLLM (the Verda container gateway
  or localhost) and reads only `VERDA_INFERENCE_KEY`. Every label stores its source. `make_sft.py` fails on any
  other source and on any capture row. Proof: `tests/test_coach_tune_no_gemini.py`.
- No training code exists in `decisions/`, `verda/`, `core/`, `tools/` or `backend/app`. `coach_tune/` reads no
  model logs (`logs/decisions.jsonl`, `logs/attempts.jsonl`, backend sweep fixtures).
- Other lanes' worktrees (checked by diff against main and a grep for training code): the only other trainer is
  `core/priors/train_asl.py` on branch `expert-priors`. Its provenance lists generated poses from `moves.json` and
  calibration records, no model text. `verda/out/compare` and `gemini_state` are comparison logs that no training
  code reads.
- So the no-Gemini statement is in `docs/COACH_MODEL.md`, `docs/VERDA.md`, `docs/submission/PROJECT.md` and
  `docs/submission/DECK.md` (slide 12b), naming the teacher that ran.

## What works and how to run it

| Piece | File | Tested |
| --- | --- | --- |
| Dataset, 4,513 examples split by lesson, captures in test only | `coach_tune/build_dataset.py` | Yes |
| Teacher container up and down | `coach_tune/teacher_up.py` | Yes, on Verda |
| Trainer container with an in-container control server | `coach_tune/trainer_up.py`, `remote/ctl_server.py`, `ctl.py` | Yes, on Verda |
| Labels, SFT files, evaluation | `label.py`, `make_sft.py`, `evaluate.py` | Yes, on Verda |
| LoRA, merge, shared-KV fill | `train_lora.py` | Yes, on Verda (the fill ran as `remote/fix_merged.py` on this run, and as part of `merge_adapter.py` in the re-serve test) |
| Serve the saved adapter again | `ctl.py upload-adapter`, `remote/merge_adapter.py`, `merge.sh` | Yes, same lines as the evaluation |
| Tuned coach in the backend, `COACH_MODEL=tuned`, off by default | `backend/app/services/llm/tuned.py` | Stub tests, plus five live calls |

Run book: `coach_tune/RUN.md`. Re-serve steps: `docs/COACH_MODEL.md`, "Serve it again".

Written but untested: `train_lora.py` with `fill_shared_kv` built in, end to end (the same code ran in the merge-only
path). The old VM scripts (`vm_up.py`, `remote/setup.sh`, `serve.sh`, `train.sh`) need a funded account.

Not done: the expert-priors `priors` fields arrived after the dataset was built; they are not in training.

## What a human must do next

1. To show the tuned coach in filming, follow "Serve it again" in `docs/COACH_MODEL.md` (about 5 minutes, 5.77 USD
   per hour on an H100). Tear it down after.
2. Merge branch `coach-tune`. It adds `docs/submission/VERDA-COACH-TUNE.md` and edits `docs/submission/PROJECT.md`
   and `DECK.md` (owned by the submission lane): check that those additions fit their drafts.
3. The adapter (95 MB) is only in `coach_tune/out/adapter/` in this worktree. Copy it somewhere safe before the
   worktree is removed.

## Patches outside the lane

None needed. The frontend already shows the `provider` field, so "tuned" appears in the dev panel.
