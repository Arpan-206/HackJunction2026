# Geppetto on Verda: Gemma 4 turns a glove recording into a lesson

Track submission for the Verda challenge. Written Sat 14 Nov 2026 by the `verda` lane (`verda/`) and finished
Sun 15 Nov 2026, 04:30 Helsinki. Every number below comes from a run of our own scripts. Prices are in USD
because Verda lists them that way; the account balance is in EUR because Verda bills that way.

## Final report: everything we did on Verda

Geppetto teaches hand skills. An expert records a skill with Rokoko Smartgloves, and a learner trains against the
recording. We used Verda for five pieces of work. Each one has its own section below with the full numbers.

| # | Work | What ran on Verda | Main result | GPU hours | USD at list price |
| --- | --- | --- | --- | --- | --- |
| 1 | A glove recording becomes a lesson | Gemma 4 31B (bf16) on vLLM, one Serverless Container, 1x H200 | A valid lesson on the first try in 6 of 6 calls; 10 to 19 s for each lesson with pictures | 0.65 | 3.94 |
| 2 | Our own coach model for the live hints | Teacher Gemma 4 31B wrote 3,231 labels in 35 s; LoRA training of Gemma 4 E2B; tuned serving | The tuned model matches its 31B teacher on our held-out test (89.0% vs 85.7%); untuned 55.5%; answer in 0.108 s | 0.99 | 5.72 |
| 3 | The same model tuned for feedback after a rep | The same pipeline with the same rules: 3,267 labels in 48 s, 558 training steps in 217 s | Tuned 94.8%, untuned 54.8%, teacher 85.2% on 1,150 held-out examples; 82.6% on the 333 real capture frames | 0.99 (with work 4) | 5.72 (with work 4) |
| 4 | Load test of the tuned coach | The tuned coach on one H100, 1 to 200 requests in flight | Answers stay at 0.10 to 0.14 s up to 50 requests in flight; one H100 served between about 340 and 1,740 learners across runs | in work 3 | in work 3 |
| 5 | A robot policy, evaluated at scale | A policy for the simulated Unitree Dex3-1 hand: 39.3 million training rollouts and 1.44 million evaluation rollouts | The policy halves the tracking error of plain replay and recovers from pushes. The GPU did not improve the policy; it made the evaluation 40 times larger | 1.53 | 8.83 |
| | Total | 8 container starts, all Serverless Containers | | 4.16 | 24.21 |

A rollout is one simulated run of the robot hand from start to end.

What we want a reader to take from this:

1. One recording is enough for a lesson. The large model on Verda turns a glove trace and a few pictures into a
   lesson that our backend can teach, with output held to a JSON schema.
2. We trained a small model on Verda that can replace the large one for the fast job. Labels, training, evaluation
   and serving all ran on Verda in about one GPU hour for each of the two jobs.
3. We measured how it scales, and we report a range, not the best run.
4. We used the GPU where it helps and we say where it does not. The robot policy trains in 44 s on a laptop. The
   GPU's contribution was the size of the evaluation.

Statements we hold to:

- No Gemini model was distilled. No output from Gemini was used as training data. The tuned models learnt only from
  text written by Gemma 4 31B, which we hosted ourselves on Verda (`docs/COACH_MODEL.md`).
- Training labels were filtered for correctness with the same check that scores the test. So "matches its teacher"
  is the claim, and "better than its teacher" is not.
- Real glove recordings are test data only. No real capture frame is in any training set.
- On real capture frames the tuned hint model is below its teacher (62.2% against 66.7%). We state this.
- We trained inside a Serverless Container, because GPU instances would not start on the coupon balance until a
  payment method was added. This worked, and the section "Which Verda products we used, and why" gives its limits.

State on Sun 15 Nov 2026, 04:30: nothing is deployed, so nothing bills. The balance is 185.05 EUR of 200.00. Verda's
console shows 14.95 EUR billed, which is less than our list-price estimate of 24.21 USD. We do not know the reason,
so we give both numbers.

Plan for the demo day: the tuned coach is served from 09:45 and is down by 14:15 (`scripts/coach_up.sh`,
`scripts/coach_down.sh`; section "Demo day commands"). The large model for lesson writing is tried once; if no GPU
is free within 10 minutes, lesson writing stays on the fallback.

Where the rest is written: the coach model card is `docs/COACH_MODEL.md`; the robot policy is
`docs/ROBOT_POLICY.md`; the piano data work that used no Verda GPU is `docs/PRIORS.md`.

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

## Which Verda products we used, and why

| Verda product or feature | What we ran on it | Why this one |
| --- | --- | --- |
| Serverless Containers | The 31B lesson endpoint (`geppetto-gemma`), the 31B teacher that wrote the labels (`coach-tune-teacher`), and the trainer that trained, merged and served the tuned coach (`coach-tune-trainer`) | One container on one GPU with an HTTPS endpoint, a health check and billing by the minute. It started from the coupon credit with no card on file. |
| Container gateway and inference key | Every call to those three containers: lesson requests, label requests, the training data upload, the evaluation and the live hints | One key in front of every endpoint. Our clients read only that key (`VERDA_INFERENCE_KEY`). |
| On-demand GPUs: H200 141 GB and H100 80 GB | H200 for the measured lesson run; H100 for the teacher, the training and the tuned serving | The H200 holds Gemma 4 31B at bf16 with room for long prompts. The H100 was enough for every other job. Spot pricing is wired in `deploy.py` (`--spot`) and was not used. |
| Scaling settings of a deployment | One replica, scale-down delay 600 s, queue trigger | A fixed single replica for a measured demo. `max_replica_count` is the lever for more load. |
| Container secrets | The Hugging Face token, as a Verda secret, when `.env` has one | Gemma 4 is ungated, so the token only lifts download limits. It never sits in an env value. |
| Python SDK (`verda`) and REST API | Create, status, logs, delete, the free-GPU list and the account balance | Every deploy and teardown is a script, so each cost line in this document comes from a log. The teacher and trainer scripts check the balance first and refuse a start that would break our floor of 50. |

Not used: GPU instances (VMs), clusters, volumes and batch jobs.

We trained inside a Serverless Container, and that was not the first plan. The plan was a GPU instance (a VM) for
the training job. Verda refused to start one on the coupon balance: "Compute cannot be deployed using JUNCTION-2026
coupon balance until at least one payment method is added" (`coach_tune/RUN.md`). So the trainer is the vLLM image
with a small control server on the exposed port (`coach_tune/remote/ctl_server.py`). It takes the data over HTTPS,
trains, merges and serves from the same GPU. It worked, and it has limits: nothing persists when the container
stops, each env value and command argument is capped at 253 characters, and a training job sits behind a gateway
made for requests.

In production we would split the two kinds of work. Training and batch labelling would run on a GPU instance, or a
cluster for larger runs, with a volume for the datasets and checkpoints, because a job needs a disk and a shell and
no request timeout. Inference would stay on Serverless Containers with autoscaling: the tuned coach as an
always-warm replica, because it answers during practice, and the 31B lesson writer scaled to zero between
recordings, because it runs once per recording and can accept a cold start.

## Demo day commands (Sun 15 Nov)

Three commands in `scripts/`. Each takes `--dry-run`, which prints every step and calls nothing.

| When | Command | What it does |
| --- | --- | --- |
| 09:45 | `scripts/coach_up.sh` | Starts the tuned coach container on an H100, uploads and merges the saved adapter, waits until `geppetto-coach-e2b` answers a real completion, restarts only the backend with `COACH_MODEL=tuned`, sends one live hint and prints the health table. About 6 to 8 minutes. |
| After that | `scripts/lesson_gemma_up.sh` | Tries to start Gemma 4 31B for the expert flow. No GPU granted within 10 minutes: it gives up, deletes what it made and leaves lesson writing on the fallback. GPU granted: it waits up to 20 minutes for the weights, then sends lesson writing to Verda first. |
| By 14:15 | `scripts/coach_down.sh` | Deletes both deployments, checks that Verda lists nothing, and restarts the backend on the plain chain. Safe to run twice. Exit code 1 if anything is still up. |

Peer review ends at 14:00. Everything on Verda must be down by 14:15. If `scripts/live.sh` restarts the stack after
`coach_up.sh`, run `scripts/coach_up.sh --backend-only` to point the new backend at the coach again.

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

The tuned model matches its 31B teacher on our held-out test (89.0% vs 85.7%) and is 3 times faster. The training labels were filtered for correctness (a teacher line was kept only when it named the right finger and the right fix), so the tuned model learnt from the teacher's checked lines, not from all of them. On real capture frames it is still below the
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

## The second job: feedback after a rep

On 15 Nov the same pipeline, with the same rules, tuned the small Gemma for a second job: the plain feedback the score
screen shows after a rep (backend `POST /coach/review`). The output is two short sentences, first what went well,
then the one fix. Dataset, splits, teacher, LoRA settings and seed are the same as for the hint job. Details and the
reading of the numbers: `docs/COACH_MODEL.md`, "Second job".

| System | Test examples | All three % | On real capture frames % (333) | Latency p50 s |
| --- | --- | --- | --- | --- |
| Gemma 4 E2B untuned | 1,150 | 54.8 | 34.2 | 0.131 |
| Gemma 4 E2B tuned (ours) | 1,150 | 94.8 | 82.6 | 0.129 |
| Gemma 4 31B teacher | 1,150 | 85.2 | 64.6 | 0.481 |

The training labels were filtered for correctness with the same check that scores the test, so this is not a claim
that the small model is the better teacher. The adapter is saved; it is not served in the demo.

## A robot policy, evaluated on Verda

The track is robot teleoperation, so we also asked: can a robot hand perform a lesson on its own? The work is
standalone (`robot_policy/`, `docs/ROBOT_POLICY.md`). The live app does not use it.

The expert's real glove takes are mapped to the 7 joints of the Unitree Dex3-1 hand. 19 takes are the source of
5,700 generated variations (timing, noise, hand size) for training. 8 real takes are held out. A small network of
45,703 weights reads the hand's angles and speeds and the next 160 ms of the lesson, 50 times a second.

Tracking error on the 8 held-out takes, in degrees (lower is better), 160,000 rollouts for each system and test:

| Test | Policy | Plain replay | Replay sent 100 ms early |
| --- | --- | --- | --- |
| Normal start | 2.13 | 6.12 | 2.44 |
| Random start pose | 3.73 | 6.88 | 4.02 |
| Three pushes | 3.78 | 7.25 | 4.60 |

What the GPU added, and what it did not:

| | Laptop CPU | Verda, 1x H100 |
| --- | --- | --- |
| Training rollouts | 51,200 | 39,321,600 |
| Training time | 44 s | 30.5 min |
| Evaluation rollouts | 36,000 for each policy | 1,440,000 |
| Evaluation time | 69 s | 4.6 min |
| Error of the trained policy on the same 36,000 rollouts (three tests) | 2.06, 3.72, 3.73 | 2.12, 3.76, 3.77 |

The GPU did not improve the policy. A network of this size needs no GPU. The GPU's contribution is the evaluation,
which is 40 times larger and gave the same answer. We did not time 1.44 million rollouts on the laptop, so we make
no speed claim. Limits: simulation only, no real hand, no contact; the held-out takes are other takes of lesson
steps that are also in training.

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
| 15 Nov 00:25 to 00:33 | Rep feedback job: teacher container, 3,620 label calls and the teacher evaluation | H100 | 0.137 | 0.79 | 10.45 | 195.39 |
| 15 Nov 00:25 to 01:16 | Rep feedback job: trainer container (untuned evaluation, smoke test, training, tuned evaluation), then the hint model served again and the load test | H100 | 0.855 | 4.93 | 15.38 | 189.39 |
| 15 Nov 00:36 to 01:02 | Robot policy container, first start (a run that we discarded after a data fix) | H100 | 0.44 | 2.54 | 17.92 | 192.52 |
| 15 Nov 01:02 to 02:08 | Robot policy container, second start: training, the 1.44 million rollout evaluation, the MuJoCo check | H100 | 1.09 | 6.29 | 24.21 | 185.05 |
| Total | 8 container starts | | 4.16 | 24.21 | 24.21 | 185.05 |

The balance column is what the Verda console showed at that moment. Verda posts charges in 10 minute
aggregates, so it lags the list-price estimate, and the rows of 15 Nov overlap in time, so the column does not fall
in step with the running total. On 15 Nov at 04:23 the console showed 185.05 EUR and no deployment. Every container
is deleted. A detached timer on the laptop checks this again at 06:45.

## Expert-priors lane: no GPU used

The `expert-priors` lane (branch `expert-priors`, `core/priors/`, docs/PRIORS.md) planned one small Verda VM. Its job was to pull the FurElise piano motion capture (47 GB zip) and turn it into the core's 18 joint angles. It never ran on Verda.

| When (Helsinki) | Action | Result | USD |
| --- | --- | --- | --- |
| 14 Nov 18:54 | Balance check (`core/priors/verda_vm.py balance`) | 200 EUR, no instance | 0 |
| 14 Nov 18:56 | Start CPU.4V.16G at 0.048 USD/h | Refused by a permission prompt in the agent session | 0 |
| 14 Nov 19:05 | Start again after the rules changed | CPU.4V.16G no longer free | 0 |
| 14 Nov 19:05 | Start 1V100.4V at 0.244 USD/h | Refused by the Verda API: "Compute cannot be deployed using JUNCTION-2026 coupon balance until at least one payment method is added." | 0 |

What this means for other lanes: VMs (the `instances` API) need a payment method on the account, even with coupon credit. Serverless Containers worked from the same credit earlier in the day (the Gemma runs above). The lane did the pull on the Mac instead, as HTTP range reads of only the left-hand joint arrays (335 MB, nothing raw saved). Lane spend: 0 USD. Nothing is running.

Data volume, all processed on the Mac and none of it on Verda (docs/PRIORS.md): 335 MB read from the 47 GB FurElise zip, the left-hand joints and key states of 55 pieces; 158,365 training frames from 47 pieces by 13 pianists, about 4.4 hours at 10 frames a second. Verda GPU hours: 0. Verda CPU hours: 0.

## Path to scale

Measured on Sun 15 Nov 2026, 01:07 to 01:15 Helsinki. The tuned coach (`geppetto-coach-e2b`, merged Gemma 4 E2B, bf16)
ran on one Verda Serverless Container with 1x H100 80 GB and vLLM v0.29.0. The load came from one laptop in Helsinki,
through the Verda container gateway. So every number includes the internet round trip.

A "simultaneous learner" in this test is one request in flight at all times. Each of N workers sends a hint request,
waits for the answer and sends the next one at once. Real use is lighter: the app asks for at most one hint per
learner every 5 seconds. Prompts are the held-out test examples of the hint job. Each level ran for 30 seconds.
Tool: `coach_tune/loadtest.py`. Raw results: `coach_tune/out/loadtest/result_run1.json` and `result_run2.json`.

| Simultaneous learners | Run | Hints in the run | Hints per second | Latency p50 s | Latency p95 s | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 199 | 6.4 | 0.104 | 0.194 | 0 |
| 10 | 1 | 2,191 | 72.8 | 0.109 | 0.184 | 0 |
| 50 | 1 | 10,219 | 68.2 (see the note) | 0.140 | 0.208 | 50 |
| 50 | 2 | 10,495 | 348.6 | 0.141 | 0.197 | 0 |
| 100 | 2 | 5,500 | 182.2 | 0.247 | 2.260 | 0 |
| 200 | 1 | 2,595 | 81.0 | 1.447 | 6.138 | 0 |

Note on the first run at 50: all 50 workers hung once for 120 seconds and then failed, so that run lasted 149.8
seconds. Without the stall its rate equals run 2 (10,219 hints in about 30 seconds of work). The repeat had no error.
We saw the stall once and do not know its cause.

What the numbers show:

- The runs varied. The same level, 50 requests in flight, gave 68.2 hints per second in run 1 (with the stall) and
  348.6 in run 2. One run does not fix the capacity of a GPU.
- Up to 50 simultaneous requests the answer time stayed flat in both runs: 0.10 to 0.14 s median, at most 0.21 s at
  the 95th percentile.
- Above 50 the path degraded. At 100 the rate was 182 hints per second and the 95th percentile 2.3 s. At 200 it was
  81 hints per second and 6.1 s. The backend gives the tuned link 2 seconds before it falls back, so 100 and more in
  flight on one GPU is past the useful range.
- The test measures the whole path: laptop, internet, gateway and model. It does not show which part limits the rate.
  We did not measure GPU use during the test.

Learners per GPU and cost per learner-hour, from the measured rates. One learner at the app's maximum rate asks for
0.2 hints per second. The GPU price is the 5.77 USD per hour list price for the H100.

| Level and run | Hints per second | Learners served at one hint per 5 s | USD per learner-hour |
| --- | --- | --- | --- |
| 10 in flight, run 1 | 72.8 | 363 | 0.0159 |
| 50 in flight, run 1 (stalled once) | 68.2 | 341 | 0.0169 |
| 50 in flight, run 2 | 348.6 | 1,742 | 0.0033 |
| 100 in flight, run 2 | 182.2 | 910 | 0.0063 |
| 200 in flight, run 1 | 81.0 | 405 | 0.0143 |

Across these runs one H100 served between about 340 and 1,740 learners at the app's rate, which is 0.3 to 1.7 US
cents per learner-hour. The low end includes the run that stalled. We do not quote the best run as the capacity:
it was one 30 second run. A whole class of 30 learners needs 6 hints per second, and a single request stream already
gave 6.4 hints per second at 0.10 s.

The path to more learners follows from this, and it is a plan, not a measurement: keep each GPU at or under 50
requests in flight, where the answer time stayed flat in both runs, and add a second replica of the same container
when the count passes that. Serverless Containers
scale replicas on the request queue (see "Which Verda products we used, and why"). We ran one replica only, so the
two-replica rate is not measured. The first step before any larger rollout is to repeat this test several times, also
from inside the Verda network, to get a stable range and to separate the model's limit from the gateway's.


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
