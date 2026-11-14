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
| GPU | 1x H100 SXM5 80 GB (H200 141 GB first choice, none free at deploy time) | The smallest single GPU that holds the bf16 weights. |
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

Filled in from `verda/out/endpoint.json` and `verda/out/deploy_log.jsonl` after each run.

| Measure | Value | Source |
| --- | --- | --- |
| Deploy created to container started | 2 s | Verda system log |
| Container start to weights loaded (59 GiB) | 170 s | vLLM log |
| Container start to healthy | to be filled | deploy.py |
| Cold start to first completion | to be filled | deploy.py |
| Lesson call latency, pictures plus trace | to be filled | compare.py |
| Lesson call latency, text only | to be filled | compare.py |

## Cost so far

| When (Helsinki) | Event | GPU | Hours | USD at list price | Balance (EUR) |
| --- | --- | --- | --- | --- | --- |
| 14 Nov 11:52 | First deploy | H100 | 0 | 0 | 200.00 |

## How this scales to many skills

Every recorded demonstration becomes one call: a handful of pictures and about two thousand characters of
text in, one lesson out. On one H100 a call takes well under a minute, so one GPU hour turns at least sixty
recordings into lessons, for less than ten cents each. The container scales to zero when nobody records, and
Verda bills by the minute, so a school with ten experts and a school with a thousand pay for the same thing:
the minutes a GPU was busy. When many experts record at once, the deployment's `max_replica_count` lets Verda
start more identical containers behind the same endpoint and key; the client code does not change. The same
endpoint can also take the next slow jobs: naming steps from camera video (Gemma 4 reads video), writing the
coach's end-of-lesson plan, and drafting the dataset cards for the robot demonstrations the export lane
produces. A fine-tuned Gemma that knows the glove digest format would be a drop-in: same image, same flags,
a different model id.
