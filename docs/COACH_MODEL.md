# Geppetto coach model (model card)

No Gemini model was distilled. No output from Gemini or the Gemini Decisions API was used as training data at any point. Our tuned coach was trained only on text written by Gemma 4 31B (google/gemma-4-31B-it, bf16), an open-weights model we hosted ourselves on Verda. Gemini and the Decisions API are used only at run time, for live answers.

Status, Sat 14 Nov 2026, 20:05 Helsinki: trained, evaluated and torn down. Everything ran on Verda Serverless
Containers. The tuned model is not served now. To serve it again, follow "Serve it again" below (about 5 minutes).

## What it is

| Item | Value |
| --- | --- |
| Base model | `google/gemma-4-E2B-it`: the smallest Gemma 4 instruction model. Apache 2.0. The Hugging Face API reports `gated: false` (checked 14 Nov 2026), so no token is needed. |
| Method | LoRA (a small set of added weights trained on top of a frozen model): rank 16, alpha 32, dropout 0.05, on all attention and MLP projections of the language model, never the vision or audio towers. 24.2 M trainable weights (0.47%). |
| Training | 3 epochs, 555 steps, batch 16, learning rate 2e-4 with cosine decay and 5% warm-up, seed 0. Settings in `coach_tune/out/adapter/config.json`. |
| Teacher (wrote every label) | `google/gemma-4-31B-it` at bf16 (full precision), vLLM v0.29.0, 1x H100 80 GB, Verda Serverless Container. |
| Job | One coaching line per scored attempt: one sentence, 14 words or fewer, the single most important finger, a physical cue, never degrees. English, German and Finnish. |
| Served as | `geppetto-coach-e2b` by vLLM v0.29.0, behind `COACH_MODEL=tuned` in the backend (off by default) |

Precision and GPU for each stage:

| Stage | Precision | GPU | Where |
| --- | --- | --- | --- |
| Labels and teacher evaluation | bf16 | 1x H100 80 GB | Verda Serverless Container `coach-tune-teacher` |
| Untuned evaluation | bf16 | 1x H100 80 GB | Verda Serverless Container `coach-tune-trainer` |
| 20-step smoke test | bf16 | 1x H100 80 GB | same |
| LoRA training and merge | bf16 | 1x H100 80 GB | same |
| Tuned serving and evaluation | bf16 | 1x H100 80 GB | same |

Smoke test before the full run: loss 2.65 at step 10, 0.43 at step 20, finite. The 5 sample lines were sane.
The full run kept the loss finite. Validation loss by epoch: 0.254, 0.245, 0.221.

## Data

The dataset comes from our own glove data, run through our own scorer (`core/scorer.py`). There are 4,513
examples. Each holds a target pose or step and a learner attempt. In train and val the attempt is always a
synthetic push of one finger. Only the test split also has real frames from the 61 minute capture. A synthetic push is kept only when the scorer names that finger
and that direction.

| Split | Examples | From the capture | Synthetic | Units |
| --- | --- | --- | --- | --- |
| Train | 3,069 | 0 | 3,069 | 33 |
| Val | 294 | 0 | 294 | 3 |
| Test | 1,150 | 333 | 817 | 9 |

Real capture frames are test data only. Training uses synthetic mistakes on target poses.

A unit is one lesson, or one shadow puppet, or one fingerspelling letter. The split is by unit. The test units are
never seen in training: `fake-demo`, the letters E, K, L, T and Z, the swan puppet, and the replay lessons
`replay-right-little-out-rest-half-thumb-half-2985` and `replay-right-middle-ring-little-out-rest-half-thumb-open-1244`.

In training, each finger and each of the four errors (too curled, too flat, too spread, too close) has about 150 examples.
Languages: 70% English, 15% German, 15% Finnish. Full tables: `coach_tune/out/dataset/report.md`.

The optional `priors` fields from the expert-priors lane arrived after the dataset was built. They are not in this
training set.

## Labels

A teacher line is kept only when it passes all of these checks (`coach_tune/prompt.py`, `check`):

1. It names the right finger in the right language.
2. It uses a word for the right fix and no word for the opposite fix.
3. It is one sentence of at most 14 words.
4. It has no digits and no degree words.

Each example gets up to three tries, at temperature 0.7, 64 requests at a time.

| Measure | Value |
| --- | --- |
| Examples labelled (train and val) | 3,363 |
| Kept | 3,231 (96.1%) |
| Kept on the first try | 3,181 (94.6%) |
| Calls | 3,688 |
| Wall time | 35 s |
| 50 example spot check before the full run | 50 of 50 kept by the filter. We read 22 by hand: all named the right finger and direction. |

Every label stores its source: model, precision and host. `make_sft.py` refuses any label whose source is not our
self-hosted Gemma 4, and any row from the real capture. `tests/test_coach_tune_no_gemini.py` proves that the label
client can reach only our own vLLM, and that it reads no `GEMINI_*` or Decisions variable.

## Evaluation (held-out units)

1,150 test examples at temperature 0. "All three" means the right finger, the right direction and the style rules at
once. Latency is one request at a time from a laptop in Helsinki through the Verda container gateway, so it includes
the internet round trip.

| System | Right finger % | Right direction % | Style % | All three % | Latency p50 s | Latency p95 s |
| --- | --- | --- | --- | --- | --- | --- |
| E2B untuned | 58.7 | 87.5 | 100.0 | 55.5 | 0.118 | 0.168 |
| E2B tuned | 89.1 | 98.3 | 100.0 | 89.0 | 0.108 | 0.166 |
| Teacher, Gemma 4 31B bf16 | 88.9 | 95.0 | 100.0 | 85.7 | 0.311 | 0.517 |

The tuned model is better than the untuned one: 89.0% against 55.5% on all three.

Split by source:

| System | Source | Examples | Right finger % | Right direction % | All three % |
| --- | --- | --- | --- | --- | --- |
| E2B untuned | real capture | 333 | 45.3 | 82.3 | 43.5 |
| E2B untuned | synthetic | 817 | 64.1 | 89.6 | 60.3 |
| E2B tuned | real capture | 333 | 62.5 | 94.0 | 62.2 |
| E2B tuned | synthetic | 817 | 100.0 | 100.0 | 100.0 |
| Teacher | real capture | 333 | 74.8 | 85.6 | 66.7 |
| Teacher | synthetic | 817 | 94.6 | 98.8 | 93.5 |

Read this table with care:

- On real capture frames the tuned model is below the teacher (62.2% against 66.7%). It names the wrong finger more often.
- On synthetic attempts the tuned model is perfect. The training data has the same shape, so this number is too kind.
- The real-capture result is the honest one for live use. It is still 18.7 points above the untuned model.

Through the backend (`COACH_MODEL=tuned`, five live hint requests): the first call fell back after the 2 s cap
while a new TLS connection opened. The tuned model answered the next four in 0.36 s to 0.74 s.

20 side-by-side samples: `coach_tune/out/eval/report.md`. Five of them:

| Input | Untuned | Tuned | Teacher |
| --- | --- | --- | --- |
| fi: index too flat (letter E) | Käsi, etusormi, kierre se enemmän. (wrong) | Koukista etusormea enemmän. | Koukista etusormea enemmän. |
| en: little too flat (Pinch) | Curl your ring finger more to create a better pinch. (wrong) | Curl your pinky finger more. | Curl your pinky more to round the shape. |
| de: thumb too flat (Open hand) | Zeige deinen Daumen stärker nach oben. (wrong) | Daumen mehr beugen. | Daumen mehr beugen. |
| en: middle too flat (letter L) | Curl your middle finger more to make a better L. | Curl your ring and little fingers more. (wrong) | Curl your middle finger more toward your palm. |
| en: little too spread (Pinch) | Use your index finger to gently pull that finger closer. (wrong) | Pinky, bring it closer to your ring finger. | Bring your pinky closer to the ring finger. |

## Serve it again

The adapter (95 MB) is in `coach_tune/out/adapter/` (git-ignored). From the worktree root, with
`PY=/Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python`:

| Step | Command | Time |
| --- | --- | --- |
| 1. Container up | `$PY coach_tune/trainer_up.py --gpu H100 --no-base` | 1 min |
| 2. Adapter up | `$PY coach_tune/ctl.py upload-adapter` | 1 min |
| 3. Merge | `$PY coach_tune/ctl.py exec merge.sh` | 1 min |
| 4. Serve | `$PY coach_tune/ctl.py serve tuned`, then `$PY coach_tune/ctl.py wait-vllm` | 2 to 3 min |
| 5. Backend | in `backend/`: `COACH_MODEL=tuned TUNED_BASE_URL=https://containers.datacrunch.io/coach-tune-trainer TUNED_API_KEY=<VERDA_INFERENCE_KEY from .env> uv run uvicorn app.main:app --port 8000` | |
| 6. Tear down | `$PY coach_tune/trainer_up.py --down` | 1 to 3 min |

This path was tested on 14 Nov: the re-merged model gave the same lines as the evaluation.

## Limits

- The filter checks words, not meaning. A line can pass and still be awkward.
- The model learnt the synthetic pattern very well. Real attempts with several wrong fingers are harder for it than for the teacher.
- The backend sends only flexion errors to the tuned coach (its hint request has no spread values). Spread cues
  come from the core scorer path only.
- Timing, wrist and praise cues are not this model's job. The chain passes them to the next provider.
- The first request on a new connection can pass the backend's 2 s cap. The chain then answers from the next provider.
- Gemma 4 E2B shares keys and values between layers 15 to 34. The merged save drops their unused `k_norm`, `k_proj`
  and `v_proj` weights, and vLLM refuses the checkpoint. `train_lora.py` copies them from the base checkpoint.
