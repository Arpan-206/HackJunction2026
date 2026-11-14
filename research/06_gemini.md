# Gemini for Apprentice: model, free limits, structured output, prompting (checked 13 Nov 2026)

## Model choice

- Newest Flash on the free tier: **`gemini-3.8-flash`** (Stable). Google's models page lists it above `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`; the pricing page shows free-of-charge input and output for 3.8 Flash. Sources: [models](https://aistudio.google.com/docs/models) (redirect of ai.google.dev/gemini-api/docs/models), [pricing](https://aistudio.google.com/docs/pricing).
- Already the value of `DEFAULT_GEMINI_MODEL` (`backend/app/constants.py`), `GEMINI_MODEL` in `.env.example` and `.env`; no change was needed.

## Free tier limits (the important caveat)

Google's rate-limit page does not publish per-model free figures; it says to read them in AI Studio ([rate limits](https://aistudio.google.com/docs/rate-limits)). Third-party reports of the AI Studio screen agree:

| Model | RPM | TPM | RPD |
|---|---|---|---|
| gemini-3.8-flash | 5 | 250,000 | **20** |
| gemini-3.6-flash | 5 | 250,000 | 20 |
| gemini-3.5-flash-lite | 10 | 250,000 | 500 |
| gemini-3.1-flash-lite | 10 | 250,000 | 500 |

Sources: [scriptbyai table](https://www.scriptbyai.com/gemini-api-free-tier-limits/), [forum thread "Gemini 3.8 Flash Free Tier 20 RPD"](https://discuss.ai.google.dev/t/gemini-3-8-flash-free-tier-20-rpd-is-too-limited-for-practical-evaluation/180609) (users report 20 RPD for 3.8 Flash and 500 RPD for Flash-Lite; no Google reply). Treat as unofficial: check `aistudio.google.com/rate-limit` for the project that owns the key.

Counting (official): limits apply **per project, not per API key**; exceeding any one of RPM, TPM or RPD gives a 429; daily quota resets at **midnight Pacific time**. Quotas are per model, so Flash-Lite has its own pool. A forum user reports failed requests may still count, so the limiter counts every attempt.

Consequence: 20 requests a day on 3.8 Flash is about one lesson generation with a retry or two. The backend therefore:
- keeps lesson, plan, motion and video on `gemini-3.8-flash` (budget 4 per minute, 16 per day);
- sends live coach hints to `gemini-3.5-flash-lite` (`GEMINI_HINT_MODEL`, budget 8 per minute, 400 per day), and answers most hints algorithmically anyway.

## Structured output (google-genai 3.3.0 installed)

- `GenerateContentConfig(response_mime_type="application/json", response_json_schema=<json schema dict>)`; the pydantic model's `model_json_schema()` works (the backend strips `discriminator`, `default` and `title` first, `app/services/llm/schema.py`). Source: [structured output](https://aistudio.google.com/docs/structured-output).
- Supported: types, `enum`, `minimum`/`maximum`, `minItems`/`maxItems`, `required`, `description`. **Not enforced while decoding**: `minLength`, `maxLength`, `minProperties`, `uniqueItems` and similar, so validate with pydantic (the hint word limit is a pydantic validator, not a schema constraint).
- Tips from the docs: put guidance in field `description`s, use enums for classification, keep nesting shallow, always validate semantically.
- The documented newer path is `client.interactions.create(... response_format=...)`; the backend still uses `generate_content`, which the installed SDK supports.

## Prompting and settings for Flash

- Source: [prompting strategies](https://aistudio.google.com/docs/prompting-strategies). Put role, constraints and output format in the **system instruction**; use consistent tags (XML-style sections here); state length limits explicitly; include few-shot examples with identical formatting to the real input; put the task last.
- **Temperature**: Gemini 3.6+ ignores `temperature`, `top_p`, `top_k` and will reject them in future, so the backend no longer sends them (determinism comes from the schema, the examples and the algorithmic analysis in the prompt).
- **Thinking** ([thinking](https://aistudio.google.com/docs/thinking)): use `thinking_level`, not `thinking_budget`. 3.8 Flash defaults to medium and supports `low`, `medium`, `high` (no `minimal`); 3.6 Flash and 3 Flash also have `minimal`. The backend sends `ThinkingConfig(thinking_level="low")` (`GEMINI_THINKING_LEVEL`). Do not use `max_output_tokens` to save time: thinking tokens count against it and it truncates JSON.
- Prompts rewritten on these rules: lesson, practice plan, text to motion (video to lesson shares the lesson prompt), and the live hint. The schema is no longer pasted into the prompt (the API enforces it); validation errors are still fed back on retry.

## Latency (measured 13 Nov 2026, from Windows over home internet; 3 real requests in total)

| Call | Model | Result |
|---|---|---|
| Live hint (5 few-shot examples, about 1.2k prompt tokens) | gemini-3.5-flash-lite, thinking low | **0.96 s**, valid JSON, accepted ("Straighten your index finger a little bit.") |
| Lesson generation | gemini-3.8-flash, thinking low | request 1: `503 UNAVAILABLE, model is experiencing high demand`; request 2 hung until my 40 s test timeout. No successful sample, and the 3-request cap was spent |

Takeaways: Flash-Lite is fast enough for per-second coaching (about 1 s); 3.8 Flash on the free tier can be overloaded, so every call has a timeout (20 s lesson, 4 s hint, 120 s video) and a deterministic fallback. After this finding the backend stops retrying on a 503 (retries only burn quota) and treats 429 as rate limited. Expect roughly 1 to 3 s for a short JSON on Flash when it is healthy (unverified here).

## What the backend does with this

`app/services/llm/rate_limit.py`: sliding 60 s window plus a per-day counter (Pacific date) persisted to `DATA_DIR/gemini_usage.json`, per model, at 80 percent of the limits above. Exhausted budget means the call is skipped and the fake or algorithmic answer is returned with provider `fake (rate limited)`. A 60 s TTL cache serves identical hint requests. Read-only budgets are in `GET /api/dev/state` under `gemini_budget`.
