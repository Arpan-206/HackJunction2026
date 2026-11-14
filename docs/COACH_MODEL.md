# Geppetto coach model (model card)

Status, Sat 14 Nov 19:00 Helsinki: the data, code and backend switch are ready. Labels, training and the evaluation
have not run yet. A permission prompt refused the start of the Verda VM. The results tables below are empty until
they run. Run book: `coach_tune/RUN.md`.

## What it is

| Item | Value |
| --- | --- |
| Base model | `google/gemma-4-E2B-it`: the smallest Gemma 4 instruction model. Apache 2.0. The Hugging Face API reports `gated: false` (checked 14 Nov 2026), so no token is needed. |
| Method | LoRA (a small set of added weights trained on top of a frozen model): rank 16, alpha 32, dropout 0.05, on all attention and MLP projections of the language model, never the vision or audio towers |
| Training | 3 epochs, batch 16, learning rate 2e-4 with cosine decay and 5% warm-up, seed 0, bf16. Settings saved in `coach_tune/out/adapter/config.json` |
| Teacher | `google/gemma-4-31B-it` on the same Verda VM. Labels come only from this Gemma. |
| Job | One coaching line per scored attempt: one sentence, 14 words or fewer, the single most important finger, a physical cue, never degrees. English, German and Finnish. |
| Served as | `geppetto-coach-e2b` by vLLM, behind `COACH_MODEL=tuned` in the backend (off by default) |

## Data

The dataset comes from our own glove data, run through our own scorer (`core/scorer.py`). There are 4,187
examples. Each holds a target pose or step and a learner attempt. The attempt is either a real frame from the 61
minute capture or a synthetic push of one finger. A synthetic push is kept only when the scorer names that finger
and that direction.

| Split | Examples | From the capture | Synthetic | Units |
| --- | --- | --- | --- | --- |
| Train | 3,088 | 756 | 2,332 | 33 |
| Val | 274 | 55 | 219 | 3 |
| Test | 825 | 210 | 615 | 9 |

A unit is one lesson, or one shadow puppet, or one fingerspelling letter. The split is by unit. The test units are
never seen in training: `fake-demo`, the letters E, K, L, T and Z, the swan puppet, and the replay lessons
`replay-right-little-out-rest-half-thumb-half-2985` and `replay-right-middle-ring-little-out-rest-half-thumb-open-1244`.

Each finger and each of the four errors (too curled, too flat, too spread, too close) has about 209 examples.
Languages: 70% English, 15% German, 15% Finnish. Full tables: `coach_tune/out/dataset/report.md`.

## Label filter

A teacher line is kept only when it passes all of these checks (`coach_tune/prompt.py`, `check`):

1. It names the right finger in the right language.
2. It uses a word for the right fix and no word for the opposite fix.
3. It is one sentence of at most 14 words.
4. It has no digits and no degree words.

Each example gets up to three tries. Keep rate: not run yet.

## Evaluation (held-out units)

| System | Right finger % | Right direction % | Style % | All three % | Latency p50 s | Latency p95 s |
| --- | --- | --- | --- | --- | --- | --- |
| E2B untuned | not run | not run | not run | not run | not run | not run |
| E2B tuned | not run | not run | not run | not run | not run | not run |
| 31B teacher | not run | not run | not run | not run | not run | not run |

## Limits

- The filter checks words, not meaning. A line can pass and still be awkward.
- The backend sends only flexion errors to the tuned coach (its hint request has no spread values). Spread cues
  come from the core scorer path only.
- Timing, wrist and praise cues are not this model's job. The chain passes them to the next provider.
