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

## Cost so far

| When (Helsinki) | Event | GPU | Hours | USD at list price | Running total USD | Balance (EUR) |
| --- | --- | --- | --- | --- | --- | --- |
| 14 Nov 11:52 | First deploy, context 32768 | H100 | 0 | 0 | 0 | 200.00 |
| 14 Nov 12:22 | Teardown: vLLM crash-looped, KV cache too small for 32768 tokens on 80 GB | H100 | 0.50 | 2.86 | 2.86 | 200.00 |
| 14 Nov 12:23 | Second deploy, context 12288 (an H200 was free this time) | H200 | 0 | 0 | 2.86 | 200.00 |
| 14 Nov 12:32 | Teardown after the smoke test and the 6-call comparison | H200 | 0.147 | 1.08 | 3.94 | 200.00 |

The balance column is what the Verda console showed at that moment. Verda posts charges in 10 minute
aggregates, so it lags the list-price estimate. Nothing is deployed now, so nothing bills.

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
