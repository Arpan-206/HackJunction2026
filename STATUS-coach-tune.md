# STATUS-coach-tune.md

Lane "coach-tune", branch `coach-tune`, worktree `.claude/worktrees/coach-tune`. Sat 14 Nov 2026.

## Resume point (19:10 Helsinki)

The VM start was refused by a permission prompt twice, at 18:47 and 18:57. Since then I followed Arpan's UPDATE (19:05):

- Dataset rebuilt with real captures as test data only. Train (3,069) and val (294) are all synthetic. Test (1,150) holds 817 synthetic and 333 capture examples. `build_dataset.py` stops if a capture row lands outside test.
- Label source guard: `oai.py` talks only to localhost, which is the SSH tunnel to the VM. `label.py` refuses any teacher whose id does not start with `google/gemma-4-`. Every label stores `label_source`: model, precision and self-hosted. `make_sft.py` fails on any other source and on any capture row. Proof: `tests/test_coach_tune_no_gemini.py` records every host touched and every variable read, and scans the lane code.
- Audit, PARTIAL: no training code exists in `decisions/`, `verda/`, `core/`, `tools/` or `backend/app`. `coach_tune/` reads no model logs (`logs/decisions.jsonl`, `logs/attempts.jsonl`, backend sweep fixtures). `core/priors/` does not exist. The other lanes' worktrees are not checked yet. The no-Gemini statement is NOT written: no teacher has run, so it cannot name one.
- Not done: the expert-priors FIELDS (no message arrived). The GPU memory check and the 50 example teacher spot check need the VM. Pass `--precision` to `label.py` with what actually ran.

Resume: Arpan runs `cd /Users/arpanpandey/Code/Junction/repo/.claude/worktrees/coach-tune && /Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python coach_tune/vm_up.py --hours 3`. Then continue from step 2 of `coach_tune/RUN.md`. Before step 4, run `nvidia-smi` and choose the teacher as the UPDATE says.

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
| 18:57 | VM start refused again | none | 0 | 0.00 | 0.00 |

Final Verda state: no instances and no containers from this lane. The balance was 200 EUR at 18:45.

## What works and how to run it

| Piece | File | Tested |
| --- | --- | --- |
| Dataset, 4,513 examples split by lesson, captures in test only | `coach_tune/build_dataset.py` | Yes, real capture and lessons (`tests/test_coach_tune_dataset.py`) |
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
