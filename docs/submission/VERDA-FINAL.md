# Geppetto on Verda: final summary for the submission (Sun 15 Nov 2026)

This page is the short form of `docs/VERDA.md`. Every number comes from that document, from `docs/COACH_MODEL.md`
or from `docs/ROBOT_POLICY.md`. Nothing is deployed now. The Discord channel name and the format that Verda asks for
are unverified: check the pinned post first.

## The message to paste

> **Geppetto (Junction 2026): one expert recording becomes a lesson, a coach and a robot policy, on Verda**
>
> Geppetto teaches hand skills. An expert records a skill with Rokoko Smartgloves II, and a learner trains against it.
> We used Verda Serverless Containers for five jobs, about 4 GPU hours in total, 24.21 USD at list price.
>
> **1. A recording becomes a lesson.** Gemma 4 31B (bf16, vLLM, 1x H200) reads sketches of the key poses and a digest of
> the glove trace. It writes the lesson JSON that our backend teaches from. A valid lesson on the first try in 6 of 6
> calls, 10 to 19 s each.
>
> **2. Our own coach model.** The same 31B wrote 3,231 coaching lines from our glove data in 35 s. A LoRA on Gemma 4 E2B
> trained in 167 s on one H100. It matches its 31B teacher on our held-out test (89.0% vs 85.7%); untuned it scores
> 55.5%. Training labels were filtered for correctness. Every coaching hint can come from this model: 0.108 s from
> Helsinki. No Gemini output was used for training.
>
> **3. The same pipeline, a second job.** Feedback after a repetition in plain words: tuned 94.8%, untuned 54.8%,
> teacher 85.2% on 1,150 held-out examples; 82.6% on the 333 real capture frames.
>
> **4. Load test.** One H100 kept answers at 0.10 to 0.14 s up to 50 requests in flight. Across our runs it served
> between about 340 and 1,740 learners at the app's real rate. The runs varied and one stalled, so we give the range.
>
> **5. A robot policy.** A small policy performs held-out expert takes on a simulated Unitree Dex3-1 hand and recovers
> from pushes: 2.13 degrees of error against 6.12 for plain replay. On Verda we ran 1.44 million evaluation rollouts.
> The GPU did not improve the policy, which trains in 44 s on a laptop. It made the evaluation 40 times larger.
>
> **What we learnt:** a 32768 token context did not fit beside the 31B weights on an H100 80 GB; 12288 tokens on an
> H200 worked. GPU instances did not start on the coupon balance, so we trained inside a Serverless Container, which
> worked. Thanks Verda!

## The five jobs in one table

| # | Job | GPU | GPU hours | USD at list price | Main result |
| --- | --- | --- | --- | --- | --- |
| 1 | A glove recording becomes a lesson (Gemma 4 31B) | H100 try, then H200 | 0.65 | 3.94 | 6 of 6 valid lessons on the first try |
| 2 | Coach model for live hints: labels, LoRA, serving | H100 | 0.99 | 5.72 | Matches its teacher: 89.0% vs 85.7%; untuned 55.5% |
| 3 and 4 | Feedback after a rep, tuned the same way; then the load test | H100 | 0.99 | 5.72 | 94.8% vs 54.8% untuned; 340 to 1,740 learners for each GPU across runs |
| 5 | Robot policy: training and a 1.44 million rollout evaluation | H100 | 1.53 | 8.83 | Error 2.13 degrees against 6.12 for plain replay |
| | Total: 8 container starts | | 4.16 | 24.21 | Balance 185.05 EUR of 200.00 |

## What we say plainly

| Point | Statement |
| --- | --- |
| Teacher comparison | "Matches its 31B teacher on our held-out test." Training labels were filtered for correctness, so we do not say it is better |
| Real data | Real glove recordings are test data only. On real frames the tuned hint model is below its teacher: 62.2% against 66.7% |
| Training data | No Gemini model was distilled, and no Gemini output was used as training data |
| Scale | Learners for each GPU are a range across runs. One run stalled once; the cause is unknown |
| The robot policy | Simulation only. No real hand, no contact. The GPU did not improve the policy |
| Billing | The console shows 14.95 EUR billed; our list-price estimate is 24.21 USD. We do not know the reason for the difference |
| Products | Serverless Containers only. GPU instances did not start on the coupon balance |

## Demo day

The tuned coach is served from 09:45 and is down by 14:15: `scripts/coach_up.sh` and `scripts/coach_down.sh`. The
31B model for lesson writing is tried once with `scripts/lesson_gemma_up.sh`. If no GPU is free within 10 minutes,
lesson writing stays on the fallback.
