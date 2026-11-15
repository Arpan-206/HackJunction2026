# Geppetto on Verda: usage summary for Verda's Discord (draft)

**Superseded on Sun 15 Nov 2026.** This draft covers only the first job, the lesson endpoint, with 3.94 USD of the 24.21 USD total. The final summary of all five jobs is `docs/submission/VERDA-FINAL.md`. The facts below are still correct for the first job.

Draft by the `submission` lane, Sat 14 Nov 2026. Every number comes from docs/VERDA.md and verda/STATUS-verda.md. Nothing is deployed now (verda/STATUS-verda.md). The Discord channel name and the format Verda asks for are unverified: check the pinned post first.

## Message to paste

> **Geppetto (Junction 2026): Gemma 4 31B on Verda Serverless Containers**
>
> **What it does:** An expert records a hand skill with Rokoko Smartgloves II. Our core cuts the recording into steps and draws a sketch of each key pose. Gemma 4 31B on Verda reads the sketches plus a short text digest of the glove trace. It writes the lesson JSON our backend teaches from. It runs once per recording, before practice.
>
> **Stack:** Verda Serverless Containers, 1x H200 SXM5 141 GB, vLLM `vllm/vllm-openai:v0.29.0`, model `google/gemma-4-31B-it` (bf16), JSON schema constrained output. Deployed and torn down from a script with the `verda` Python SDK.
>
> **Numbers (H200 run, 14 Nov):**
> - Container started 2 s after the deploy call
> - Weights download (62 GB): 168 s
> - Container start to healthy: 458 s (7.6 min)
> - Lesson with pictures: 10.2 s and 19.1 s (about 2200 to 2500 tokens in)
> - Output: about 40 to 52 tokens/s, one request at a time
> - Valid lesson on the first try: 6 of 6
> - Total spend: 3.94 USD at list price (H100 try 2.86 + H200 run 1.08)
>
> **What we learnt:** The first try on an H100 80 GB crash-looped: a 32768 token context did not fit beside the weights. 12288 tokens on the H200 worked. With the pictures, Gemma kept the recorded step order. Text only, it merged or reordered steps.
>
> Thanks Verda!

## Facts behind the message

| Item | Value | Source |
| --- | --- | --- |
| Product | Serverless Containers, through the `verda` Python SDK (REST under the hood) | verda/STATUS-verda.md |
| Why that product | One container, one GPU, an HTTPS endpoint with a key, a health check, autoscaling down to zero | docs/VERDA.md |
| Server image | `docker.io/vllm/vllm-openai:v0.29.0`, the tag Verda's vLLM tutorial recommends | docs/VERDA.md |
| Model | `google/gemma-4-31B-it`, Apache 2.0, ungated, 62.5 GB bf16 | docs/VERDA.md |
| GPU used | 1x H200 SXM5 141 GB | docs/VERDA.md |
| GPU tried first | H100 SXM5 80 GB: vLLM crash-looped, KV cache too small for 32768 tokens | docs/VERDA.md |
| Context length that worked | 12288 tokens (prompts stay under 9k) | verda/STATUS-verda.md |
| Output format | JSON schema constrained decoding with the backend's `LessonBase` schema | docs/VERDA.md |
| Used for | A glove recording (key pose sketches plus a trace digest) to a lesson JSON | docs/VERDA.md |

Deploy timings (H200 run, created 10:23:45 UTC, healthy 10:31:23 UTC):

| Measure | Value | Source |
| --- | --- | --- |
| Deploy created to container started | 2 s | docs/VERDA.md |
| Weights download from Hugging Face (62 GB) | 168 s | docs/VERDA.md |
| Weights in GPU memory (59 GiB) | 182 s after container start | docs/VERDA.md |
| Container start to healthy | 458 s (7.6 min) | docs/VERDA.md |
| First completion after healthy | 0.07 s | docs/VERDA.md |

Latency (one request at a time):

| Call | Tokens in / out | Latency | Source |
| --- | --- | --- | --- |
| Gemma, pictures plus trace, left take (4 pictures) | 2526 / 764 | 19.1 s | docs/VERDA.md |
| Gemma, pictures plus trace, right take (3 pictures) | 2220 / 531 | 10.2 s | docs/VERDA.md |
| Gemma, text only | not given | 10.8 s and 8.2 s | docs/VERDA.md |
| Gemini 3.5 Flash-Lite, same text, for comparison | not given | 2.5 s and 1.8 s | docs/VERDA.md |
| Output speed | | about 40 to 52 tokens per second | docs/VERDA.md |

Cost (Helsinki time, list price):

| When | Event | GPU | Hours | USD | Running total USD |
| --- | --- | --- | --- | --- | --- |
| 14 Nov 11:52 to 12:22 | First deploy, crash loop, teardown | H100 | 0.50 | 2.86 | 2.86 |
| 14 Nov 12:23 to 12:32 | Second deploy, smoke test, 6-call comparison, teardown | H200 | 0.147 | 1.08 | 3.94 |

The Verda console still showed a 200.00 EUR balance at 12:32. Verda posts charges in 10 minute aggregates, so the balance lags (docs/VERDA.md).

## Expert-priors lane (no Verda spend)

| Item | Value | Source |
| --- | --- | --- |
| Planned | One small Verda VM to pull FurElise (47 GB) and convert it to joint angles | docs/PRIORS.md |
| What happened | The Verda API refused the VM: coupon balance cannot deploy compute until a payment method is added | docs/VERDA.md, "Expert-priors lane" |
| Spend | 0 USD; nothing created | ~/geppetto-progress/expert-priors.log |
| Where it ran instead | The Mac, as range reads of the left-hand joint arrays only (335 MB, nothing raw saved) | docs/PRIORS.md |

Do not claim that the piano priors or the letter recogniser ran on Verda. They did not.

## Do not claim

- That the endpoint is live. It was torn down at 12:32 Helsinki and stays down (verda/STATUS-verda.md, lane brief).
- Scale to zero or spot instances. Both are written but untested (verda/STATUS-verda.md).
- That the app's user screens call Gemma on Verda. The backend has the `openai` provider on `main` (git log, commit `4785ddd`), but no status note records a run of the app against the Verda endpoint (unverified).
- A cost per lesson as measured. "About 4 US cents each, at least 190 per GPU hour" in docs/VERDA.md is an estimate from single calls, not a batch run.
