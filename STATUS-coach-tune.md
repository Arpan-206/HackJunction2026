# STATUS-coach-tune.md

Lane "coach-tune", branch `coach-tune`, worktree `.claude/worktrees/coach-tune`. Sat 14 Nov 2026.

## State: PARKED at the Verda step

A permission prompt refused the VM start at 18:47 Helsinki:
`/Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python coach_tune/vm_up.py --hours 3`
(one `1A100.22V` VM, 2.386 USD per hour). Nothing runs on Verda. The steps that need a GPU (labels, training,
evaluation, serving) are written and tested on stubs only.

## Cost table

| Time (Helsinki) | Step | Rate | Minutes | Cost USD | Running total USD |
| --- | --- | --- | --- | --- | --- |
| 18:45 | Balance check: 200 EUR | none | 0 | 0.00 | 0.00 |
| 18:47 | VM start refused by a permission prompt | none | 0 | 0.00 | 0.00 |

Final Verda state: no instances and no containers from this lane. The balance was 200 EUR at 18:45.

## What works and how to run it

| Piece | File | Tested |
| --- | --- | --- |
| Dataset, 4,187 examples split by lesson | `coach_tune/build_dataset.py` | Yes, real capture and lessons (`tests/test_coach_tune_dataset.py`) |
| Shared prompt and label filter | `coach_tune/prompt.py` | Yes, English, German, Finnish lines |
| Label batch, SFT files, evaluation report | `coach_tune/label.py`, `make_sft.py`, `evaluate.py` | Stub model only (`tests/test_coach_tune_pipeline.py`) |
| LoRA and merge | `coach_tune/train_lora.py`, `remote/train.sh` | Not run (needs a GPU) |
| vLLM on the VM | `coach_tune/remote/setup.sh`, `serve.sh` | Not run |
| VM up and down with the 50 floor check | `coach_tune/vm_up.py`, `vm_down.py` | Read-only calls ran (balance, prices, availability) |
| Tuned coach in the backend, `COACH_MODEL=tuned`, off by default | `backend/app/services/llm/tuned.py`, `registry.py`, `config.py` | Stubs only (`backend/tests/test_tuned_coach.py`), all 384 backend tests pass |

Run book with every command: `coach_tune/RUN.md`.

Choices made without asking:

- Base model `google/gemma-4-E2B-it`: the smallest Gemma 4 instruction model, Apache 2.0, `gated: false`.
- GPU: at 18:45 no H100 or H200 VM was free on demand on Verda. Only `1A100.22V` (80 GB) was free. It fits the
  31B teacher in bf16 for short prompts and trains E2B in minutes.
- One VM for labels, teacher evaluation, untuned evaluation, training and tuned serving. vLLM in Docker, one
  server at a time, reached only through an SSH tunnel.
- Serving: the cheapest free GPU VM is the same A100. The backend provider has a 2 s cap, then the chain goes on.
- The tuned provider takes finger cues only. Timing, wrist and praise go to the next provider.

## What a human must do next

1. Allow the VM start, or run it yourself: `! /Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python coach_tune/vm_up.py --hours 3`
   from the worktree. Then follow `coach_tune/RUN.md` steps 2 to 12. The time box: training must start by 21:30.
2. After the run, fill the tables in `docs/COACH_MODEL.md` from `coach_tune/out/eval/report.md` and
   `coach_tune/out/labels/report.md`. Then add the Verda section and the Discord note.
3. Tear down with `coach_tune/vm_down.py`, and check that it lists no instances.

## Patches outside the lane

None. The frontend already shows the `provider` field, so "tuned" appears as is in the dev panel.
