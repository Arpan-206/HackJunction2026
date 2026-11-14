# Geppetto on Verda: Gemma 4 turns a glove recording into a lesson

Track submission for the Verda challenge. Written Sat 14 Nov 2026 and kept current by the `verda` lane
(`verda/`, branch `verda`). Every number below comes from a run of the scripts in that folder. Prices are
in USD because Verda lists them that way; the account balance is in EUR because Verda bills that way.

## What runs on Verda

An expert records a hand skill with Rokoko Smartgloves. The core cuts the glove trace into steps and draws
a sketch of the key pose of each step. Gemma 4 31B, served on a Verda GPU container, reads those sketches and
a short text digest of the trace, and writes the lesson JSON the Geppetto backend already stores and teaches:
a title, a skill, and two to four steps with plain instructions and a move from the catalogue. This is the slow,
expensive step of the pipeline. It runs once per recording, before practice, so it belongs on a big model in the
cloud. The fast judgements during practice stay on small, quick models.

## Product and why

| Item | Choice | Why |
| --- | --- | --- |
| Verda product | Serverless Containers | One container, one GPU, an HTTPS endpoint with a key, a health check, autoscaling down to zero. No instance to keep alive by hand. The REST API and the `verda` Python SDK create and delete it from a script. |
| Server | vLLM, image `docker.io/vllm/vllm-openai:v0.29.0` | The tag Verda's own vLLM tutorial recommends. It serves the OpenAI chat API, accepts images in the prompt, and constrains output to a JSON schema. |
| Model | `google/gemma-4-31B-it` | The largest multimodal Gemma. Apache 2.0 and ungated on Hugging Face, so no token is needed to pull it. 62.5 GB of bf16 weights fit one 80 GB GPU. Image and video input. |
| GPU | 1x H200 SXM5 141 GB (H100 80 GB as fallback) | Holds the 59 GiB of bf16 weights with room for the KV cache (the memory for the prompt). The first try on an H100 failed: a 32768 token context did not fit. The measured run below used the H200. |
| Output format | JSON Schema constrained decoding | The backend's `LessonBase` pydantic schema is sent as `response_format`, so the answer validates on the first try. |
| Secrets | `.env` in the main checkout, never in the repo | Verda cloud credentials, the inference key, the Gemini key and an optional HF token. |

Prices read from https://verda.com/pricing on 14 Nov 2026, Serverless Containers, on demand, per hour:

| GPU | VRAM | USD per hour | Fits Gemma 4 31B bf16 |
| --- | --- | --- | --- |
| H200 SXM5 | 141 GB | 7.37 | Yes, with room for long prompts |
| H100 SXM5 | 80 GB | 5.77 | Yes, tight |
| RTX PRO 6000 | 96 GB | 3.12 | Yes, Blackwell; not tried |
| L40S | 48 GB | 2.22 | No |

One hour of leaving the H100 endpoint up for a demo costs 5.77 USD. On the H200 it costs 7.37 USD.
Billing counts every minute a replica runs, start-up included.

## How to run it

```bash
cd verda
uv sync                                    # Python 3.12, the verda SDK, httpx, numpy, opencv
uv run pytest -q                           # offline tests, no network

./warm_up.sh                               # deploy on Verda and wait until it answers (same as deploy.py)
uv run python logs.py                      # replica state and vLLM logs while it starts
uv run python gemma_client.py out/recordings/worn-solver-right --out lesson.json
uv run python compare.py                   # Gemma (pictures), Gemma (text), Gemini (text) on every recording
uv run python status.py                    # one timestamped cost line
uv run python teardown.py                  # delete the deployment: stop paying
```

`gemma_client.lesson_from_recording(folder)` is the library call. It returns a `Lesson` exactly as
`POST /lessons/generate` does (docs/CONTRACT.md).

## Measurements

All values come from the H200 run on 14 Nov 2026 (created 10:23:45 UTC, healthy 10:31:23 UTC). Sources:
`verda/out/deploy_log.jsonl`, the Verda system log, the vLLM log and `verda/out/compare/`.

| Measure | Value | Source |
| --- | --- | --- |
| Deploy created to container started | 2 s | Verda system log |
| Weights download from Hugging Face (62 GB) | 168 s | vLLM log |
| Weights loaded into GPU memory (59 GiB) | 182 s after container start | vLLM log |
| Container start to healthy (cold start) | 458 s (7.6 min) | deploy_log.jsonl |
| First completion after healthy (smoke test) | 0.07 s | deploy.py |
| Lesson call, pictures plus trace, left take (4 pictures, 2526 in, 764 out tokens) | 19.1 s | compare.py |
| Lesson call, pictures plus trace, right take (3 pictures, 2220 in, 531 out tokens) | 10.2 s | compare.py |
| Lesson call, text only, through the backend's LessonGenerator | 10.8 s and 8.2 s | compare.py |
| Same text on the existing Gemini path (gemini-3.5-flash-lite) | 2.5 s and 1.8 s | compare.py |
| Output speed, one request at a time | about 40 to 52 tokens per second | usage / latency |
| Attempts until a valid lesson (JSON schema constrained) | 1 of 1 on every call | compare.py |

The cold start has three parts: about 3 min to download the weights, about 15 s to load them, and about
4 min for vLLM to compile and warm the model. A volume that keeps the weights would cut the first part.

## Warm-up procedure

A cold endpoint needs about 8 minutes before it answers. Follow these steps before a demo:

1. Start the warm-up 15 minutes before you need the endpoint: `cd verda && ./warm_up.sh`.
2. Watch the start with `uv run python logs.py`. "Startup probe failed: connection refused" is normal while vLLM loads.
3. Wait for the script to print "healthy" and the smoke test reply "OK".
4. Run the demo: `uv run python gemma_client.py out/recordings/worn-solver-right`.
5. Stop the billing at once: `uv run python teardown.py`. It must print "deployments still up: none".

## Gemma against Gemini on the real captures

`compare.py` sent the real glove capture in the repo (`backend/tests/fixtures/rgmp/worn_solver.rgmp.gz`, worn
Smartgloves II) through three paths. Each hand of that capture is one recording: the left take and the right take. The full report is `verda/out/compare/summary.md`.

| Recording | Path | Latency s | Steps | Step order follows the trace | Hand field | Move ids from the catalogue |
| --- | --- | --- | --- | --- | --- | --- |
| left take | Gemma 4, pictures plus trace | 19.1 | 4 | Yes, all 4 steps | right (wrong) | 3 of 4 |
| left take | Gemma 4, text only | 10.8 | 3 | No, it merged steps 1 and 3 | right (wrong) | 2 of 3 |
| left take | Gemini, text only | 2.5 | 4 | Yes, all 4 steps | left | 4 of 4, but shadow puppet moves for plain hand shapes |
| right take | Gemma 4, pictures plus trace | 10.2 | 3 | Yes | right | 1 of 3 |
| right take | Gemma 4, text only | 8.2 | 3 | No, it put the open hand first | right | 2 of 3 |
| right take | Gemini, text only | 1.8 | 3 | Yes | right | 2 of 3 |

Findings:

- The pictures help. With the step sketches, Gemma kept the recorded step order on both takes. Without them, it reordered or merged steps.
- Gemma ignored "Demonstrating hand: left" in the prompt. The client now takes the hand from the recording itself (`gemma_client.recorded_hand`), with a test. The stored outputs predate this fix.
- Gemini is 4 to 8 times faster on this short prompt. Gemini has no picture input on this path, so it cannot check the sketches.
- Gemini picked shadow puppet moves for an open hand and a fist. Gemma picked the plain `general_spread` and `general_fist` moves, which match the trace.
- Every call on every path gave a valid lesson on the first attempt.

## Our own coach model, trained and served on Verda

No Gemini model was distilled. No output from Gemini or the Gemini Decisions API was used as training data at any point. Our tuned coach was trained only on text written by Gemma 4 31B (google/gemma-4-31B-it, bf16), an open-weights model we hosted ourselves on Verda. Gemini and the Decisions API are used only at run time, for live answers.

This is a job an API cannot do. We fine-tuned a small Gemma 4 on our own glove data, so we have our own fast
coach. The `coach-tune` lane (`coach_tune/`, branch `coach-tune`) ran it on Sat 14 Nov 2026, 19:05 to 20:02
Helsinki. Model card: `docs/COACH_MODEL.md`.

What ran, all on Verda Serverless Containers (Verda refuses VMs on the coupon balance until a card is on file):

| Step | What | GPU | Result |
| --- | --- | --- | --- |
| Teacher | `google/gemma-4-31B-it`, bf16, vLLM v0.29.0 | 1x H100 80 GB | 3,231 of 3,363 lines kept (96.1%) in 35 s, 64 requests at a time |
| Training | LoRA on `google/gemma-4-E2B-it`, bf16, 3 epochs, seed 0 | 1x H100 80 GB | 555 steps in 167 s, validation loss 0.254 to 0.221 |
| Serving | merged model as `geppetto-coach-e2b` on vLLM, behind `COACH_MODEL=tuned` | 1x H100 80 GB | p50 0.108 s, p95 0.166 s from Helsinki |

Held-out evaluation, 1,150 examples from lessons never seen in training ("all three" is the right finger, the right
direction and the style rules at once):

| System | All three % | On real capture frames % | Latency p50 s |
| --- | --- | --- | --- |
| Gemma 4 E2B untuned | 55.5 | 43.5 | 0.118 |
| Gemma 4 E2B tuned (ours) | 89.0 | 62.2 | 0.108 |
| Gemma 4 31B teacher | 85.7 | 66.7 | 0.311 |

The tuned model is 3 times faster than its teacher and better overall. On real capture frames it is still below the
teacher. The training inputs were synthetic mistakes on target poses; real captures were test data only.

The trainer is one container: the vLLM image runs a small control server on the exposed port
(`coach_tune/remote/ctl_server.py`). It takes the data over HTTPS, trains, merges and serves from the same GPU.

| Container | Minutes | USD at list price (5.77 per hour) |
| --- | --- | --- |
| Teacher (labels, teacher evaluation) | 8.0 | 0.77 |
| Trainer, first start (untuned evaluation) | 9.5 | 0.91 |
| Trainer, second start (smoke test, training, tuned evaluation, re-serve test) | 42 | 4.04 |
| Total | 59.5 (about 1 GPU hour) | 5.72 |

Why Verda: an expert's hand movements are their know-how. A school that records its experts should not send that
data to a closed API. On Verda, the glove data, the labels and the model stay on European compute, and every model in
the pipeline has open weights. We own the coach that comes out: a 95 MB adapter that any Verda GPU can serve again in
about 5 minutes.

## Cost so far

| When (Helsinki) | Event | GPU | Hours | USD at list price | Running total USD | Balance (EUR) |
| --- | --- | --- | --- | --- | --- | --- |
| 14 Nov 11:52 | First deploy, context 32768 | H100 | 0 | 0 | 0 | 200.00 |
| 14 Nov 12:22 | Teardown: vLLM crash-looped, KV cache too small for 32768 tokens on 80 GB | H100 | 0.50 | 2.86 | 2.86 | 200.00 |
| 14 Nov 12:23 | Second deploy, context 12288 (an H200 was free this time) | H200 | 0 | 0 | 2.86 | 200.00 |
| 14 Nov 12:32 | Teardown after the smoke test and the 6-call comparison | H200 | 0.147 | 1.08 | 3.94 | 200.00 |
| 14 Nov 19:13 | coach-tune teacher container, labels and teacher evaluation | H100 | 0.133 | 0.77 | 4.71 | |
| 14 Nov 19:17 | coach-tune trainer, first start | H100 | 0.158 | 0.91 | 5.62 | |
| 14 Nov 20:02 | coach-tune trainer, second start; all torn down | H100 | 0.70 | 4.04 | 9.66 | 196.70 |

The balance column is what the Verda console showed at that moment. Verda posts charges in 10 minute
aggregates, so it lags the list-price estimate. Nothing is deployed now, so nothing bills.

## Expert-priors lane: no GPU used

The `expert-priors` lane (branch `expert-priors`, `core/priors/`, docs/PRIORS.md) planned one small Verda VM. Its job was to pull the FurElise piano motion capture (47 GB zip) and turn it into the core's 18 joint angles. It never ran on Verda.

| When (Helsinki) | Action | Result | USD |
| --- | --- | --- | --- |
| 14 Nov 18:54 | Balance check (`core/priors/verda_vm.py balance`) | 200 EUR, no instance | 0 |
| 14 Nov 18:56 | Start CPU.4V.16G at 0.048 USD/h | Refused by a permission prompt in the agent session | 0 |
| 14 Nov 19:05 | Start again after the rules changed | CPU.4V.16G no longer free | 0 |
| 14 Nov 19:05 | Start 1V100.4V at 0.244 USD/h | Refused by the Verda API: "Compute cannot be deployed using JUNCTION-2026 coupon balance until at least one payment method is added." | 0 |

What this means for other lanes: VMs (the `instances` API) need a payment method on the account, even with coupon credit. Serverless Containers worked from the same credit earlier in the day (the Gemma runs above). The lane did the pull on the Mac instead, as HTTP range reads of only the left-hand joint arrays (335 MB, nothing raw saved). Lane spend: 0 USD. Nothing is running.

## How this scales to many skills

Every recorded demonstration becomes one call. A handful of pictures and about 2500 tokens go in, and one
lesson comes out. On one H200 a call took 10 to 19 seconds when sent alone. So one GPU hour turns at least
190 recordings into lessons, at about 4 US cents each, and vLLM can run many calls at the same time. The
container can scale to zero when nobody records. Verda bills by the minute, so a school pays only for the
minutes a GPU was busy. Scale to zero adds the 8 minute cold start to the first call, which suits a job that runs
after a recording, not during practice. When many experts record at once, the deployment's `max_replica_count`
lets Verda start more identical containers behind the same endpoint and key. The client code does not change.
The same endpoint can take the next slow jobs: naming steps from camera video (Gemma 4 reads video), writing
the end-of-lesson plan, and writing the dataset cards for the robot demonstrations. A fine-tuned Gemma that
knows the glove digest format is a drop-in change: same image, same flags, a different model id.
