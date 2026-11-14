# Gemma for Apprentice: local and hosted (checked 13 Nov 2026)

## Gemma versus the Gemini API

| | Gemini (`gemini-3.8-flash`) | Gemma 4 |
|---|---|---|
| Weights | closed, hosted only | **open weights**, Apache 2.0 licence ([the-decoder](https://the-decoder.com/googles-gemma-4-is-now-available-with-apache-2-0-licensing-for-the-first-time/); the Ollama page itself states no licence) |
| Where it runs | Google API | your laptop (Ollama) or hosted via the Gemini API |
| Free limits | about 5 RPM, 20 RPD (see 06_gemini.md) | local: none; hosted: separate, much higher pool (below) |
| Video input | yes (Files API) | no: images (and audio on the small models) only |
| Quality | strongest | good for short, constrained JSON |

Gemma 4 sizes and context ([Ollama library](https://ollama.com/library/gemma4)): `e2b` (4.6 to 7.5 GB, 128K), `e4b` and `latest` (6.6 to 9.5 GB, 128K), `12b` (256K), `26b` MoE with 4B active (16 to 19 GB, 256K), `31b` dense (19 to 20 GB, 256K). Text and image input; E2B and E4B also take audio per the model information. Native function calling and a configurable thinking mode are reported in [the Gemma 4 overview](https://cheatsheets.zip/gemma4); the Ollama page recommends temperature 1.0, top_p 0.95, top_k 64.

## Fastest local setup on Windows (Ollama)

1. Install Ollama for Windows (it uses the NVIDIA GPU automatically if drivers are present, else the CPU).
2. `ollama pull gemma4:e4b` (the backend default `OLLAMA_MODEL=gemma4:e4b`; use `gemma4:12b` with 12 to 16 GB of VRAM; `gemma4:e2b` on a CPU-only laptop).
3. Hardware: E4B wants about 10 GB of free VRAM or RAM for the 4-bit weights plus the cache; E2B about 6 GB. CPU-only works but expect several seconds for a short answer.
4. Context: the backend sets `options.num_ctx = 16000` (`OLLAMA_NUM_CTX`). Larger values cost VRAM and prefill time; hints need under 2k tokens, so 4096 is enough for hints and lessons fit in 16000.
5. Warm-up: the first request loads the model (seconds). Before the demo run `ollama run gemma4:e4b "hi"` or POST `/api/generate` with `{"model": "gemma4:e4b", "keep_alive": "30m"}` so it stays resident.
6. JSON: pass the JSON schema in the chat request's `format` field (done in `app/services/llm/ollama.py`) for constrained decoding; keep `stream: false`. Validate with pydantic afterwards, as with Gemini.

## Gemma through the Gemini API

The pricing page shows Gemma 4 input, output and context caching as "Free of charge" on the free tier ([pricing](https://aistudio.google.com/docs/pricing)). The hosted id is `gemma-4-31b-it` (seen in a [developer forum post](https://discuss.ai.google.dev/t/constant-500s-on-gemma-4/140940?page=3) and in catalogues). A Korean guide built from the AI Studio rate-limit screen lists Gemma 4 31B at 15 RPM and 1,500 RPD ([tilnote](https://tilnote.io/pages/6a51b3398d9a59d14c1c174c.md)); unofficial, and reports of 500 errors exist. It would be a useful third pool (75x the daily requests of 3.8 Flash) but is not wired into the backend: the existing `GeminiLLM` would only need `GEMINI_HINT_MODEL=gemma-4-31b-it`, though Gemma models may not accept `thinking_level` or `response_json_schema`, so test once before relying on it.

## Recommendation for the demo

- **Live coaching hints**: algorithmic first (instant, free, the same shape). Optional rewording by `gemini-3.5-flash-lite` (about 1 s, 400 per day budget) when online. The cue is always validated, so a bad model answer is dropped.
- **Lesson generation, practice plan, text to motion**: `gemini-3.8-flash` (16 per day budget), with the template fallback. Do one rehearsal generation only; save the lesson so the demo does not depend on a live call.
- **Video to lesson**: Gemini only (Gemma cannot read video). Use sparingly, one request per attempt.
- **Offline or Wi-Fi failure plan**: `LLM_PROVIDER=ollama` with `gemma4:e4b` warmed up (`keep_alive`), no quota at all, slower and a little less reliable on JSON.
- Do not run Gemma and Gemini at the same time for the same feature; pick one provider per run with `POST /api/dev/state {"llm_provider": ...}`.
