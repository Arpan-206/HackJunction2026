# Making Gemini and Gemma central

Today: `backend/app/services/llm/` has providers `fake`, `gemini`, `ollama` (registry in `registry.py`, contract in `base.py`: `LLMRequest`, `generate_json`, `generate_text`). It is used for lesson generation (`lesson_generator.py`) and hint rephrasing (`coach.py`). That reads as bolted on, because the demo works identically without it. Goal: at least one beat where the demo is impossible without Gemini, and one where it is impossible without Gemma offline.

Facts to rely on (research/05): current models `gemini-3.8-flash` (code default), Gemma 4 (E2B, E4B, 26B, 31B, 12B) with function calling and JSON output, Apache 2.0. Free tier rate limits are per project and unpublished; cache results. No public DeepMind brief or Gemma rule was found: ask at the workshop. Claims about Gemini Live below are unverified: check docs before committing.

## Ranked features (one day left)

| # | Feature | Impact | Build | Hours |
|---|---|---|---|---|
| 1 | Gemma offline toggle (ops only, `ollama.py` and the provider switch exist) | 4 | trivial | 1 to 1.5 |
| 2 | Standalone Gemini video to lesson (upload, then the existing validate loop) | 5 | medium | 4 to 5 |
| 3 | `POST /api/coach/plan` Gemini practice plan from attempt scores (built, fake provider tested; add the frontend card) | 4 | easy | 2 |
| 4 | `POST /api/motion/from_text` text to `MotionSpec` (built, fake provider tested; add the input) | 3 | easy | 1.5 |
| 5 | Gemini Live spoken coach (stretch, API unverified) | 4 | hard | 5+ |
| 6 | A2UI generative UI | 3 | hard | 6+ |

Browser `speechSynthesis` is NOT Gemini evidence; it is optional polish only. Provider badges already exist (`TrainingRoom.tsx`, `GenerateSteps.tsx`).

Video to lesson implementation notes: use `client.aio.files.upload(file=path)` to match the async `gemini.py`; poll `client.aio.files.get(name=...)` until the file state is `ACTIVE` before calling `generate_content`; model id `gemini-3.8-flash` is unverified, test it in AI Studio first. Reuse the validate and retry loop in `lesson_generator.py`; new route `POST /lessons/generate_from_video`.

The sections below are the original detail; where they conflict with this table, the table wins.

## 1. Spoken coach (impact 5)

Behaviour: after each attempt, the coach says one sentence aloud, using the `ScoreResult` and deviations. A talking coach makes Gemini visibly central.

Simplest, reliable path (build this): reuse `POST /coach/hint` and add speech in the browser with `window.speechSynthesis` (no new dependency), or Gemini TTS. Plug-in point:
- Backend: `backend/app/services/llm/coach.py` (`CoachService.hint`). Keep it. Make the system prompt produce a spoken style, max 20 words.
- Frontend: in the training room, after the attempt ends, call `api.coach.hint(...)`, then `speechSynthesis.speak(new SpeechSynthesisUtterance(hint))`.

Stretch path (Gemini Live, bidirectional audio): the learner asks "why is my ring finger wrong?" while playing. Unverified API shape: a WebSocket session via the `google-genai` SDK `client.aio.live.connect(model=..., config={"response_modalities": ["AUDIO"]})`; send text context (current deviations) as turns and receive audio. Check the model id and quotas in Google AI Studio before starting; keep the browser-TTS path as the fallback.
New endpoint (stretch): `WS /ws/coach` that proxies the Live session so the API key stays on the backend.

## 2. Lesson from video (impact 5)

Behaviour: the master uploads or records a video; Gemini (Flash is multimodal) watches it and returns a validated `Lesson` JSON: steps, instructions, `MotionSpec`, tolerance. Combine with glove takes for the real data.

API shape (google-genai Python): upload with the Files API (`client.files.upload(file=path)`) then
```
client.models.generate_content(
  model="gemini-3.8-flash",
  contents=[uploaded_file, "Break this into steps ..."],
  config={"response_mime_type": "application/json",
          "response_json_schema": LessonDraft.model_json_schema()})
```
Plug-in point: new method `generate_from_video` next to `lesson_generator.py`, new route `POST /lessons/generate_from_video` in `backend/app/api/routes/lessons.py`, request multipart `video`, response same as `/lessons/generate`. Frontend button on `/master/generate`: "Or upload a video". Reuse the existing validate-and-retry loop; fallback to fake. Video upload limits and duration are unverified; keep clips under 60 s.

## 3. Gemma offline coach (impact 4, cheapest)

Behaviour: a toggle "Offline mode (Gemma on this laptop)" in the dev panel, next to the existing provider switch. Pull the plug on Wi-Fi on stage and the coach still talks. That is a memorable beat for a DeepMind judge.

Plug-in point: nothing new in code. `ollama.py` and the `/dev/state` provider switch exist. Work is operational: `ollama pull gemma4:e4b`, warm it up (first call is slow), set `OLLAMA_NUM_CTX` low enough for speed. Add the toggle label to the dev panel and a small badge "Gemma, offline" in the coach hint card showing `provider` from the response (already returned by `/coach/hint`).

Risk: E4B latency on a laptop without a GPU. Measure; if over 5 s, ask for a 15-word hint.

## 4. Attempt analysis and practice plan (impact 4)

Behaviour: after a session, Gemini receives a compact summary (per-finger errors per attempt, timing, steps) and writes "what to practise tomorrow" for the learner and "where learners fail" for the master. Not a score: a story.

Plug-in point: `POST /coach/plan` (new) in `routes/coach.py`, a new `PlanService` beside `coach.py`; input is the list of `ScoreResult` objects plus step titles. Structured output `{summary, drills: [{step_id, focus_finger, exercise}]}`. Frontend: a card on the score screen, plus a heat summary on `/master`.

## 5. A2UI or generative UI (impact 3, hard)

Behaviour: the LLM returns a UI spec that our frontend renders. See research/05 for the flat schema (one `Block` with a `type` enum and generic `props`, validated client side; deep `anyOf` unions hit "too many states" 400s). Plug-in: an optional "AI-composed course page" using a whitelist of UI-kit components in `frontend/src/components/ui`. Skip unless everything else is done; it is flashy but does not strengthen the teaching story.

## 6. Function calling for the simulator (impact 3)

Behaviour: "show me a penhold grip, slowly" produces a `MotionSpec` via Gemini function calling or Gemma 4 function calling, then `set_motion` over `/ws/gloves`. `MotionSpec` is already a discriminated union, ideal for structured output. Plug-in: `POST /motion/from_text`, beside `routes/motion.py`.

## Messaging for the pitch

- "The LLM never judges, it explains and authors" (deterministic scoring, deliberate).
- "Gemini builds the curriculum, Gemma coaches offline."
- Show the `provider` badge on screen so judges see which model answered.

## Do first (30 minutes)

1. Confirm `GEMINI_API_KEY` works and `provider: gemini` returns on `/lessons/generate`.
2. Time one Gemma E4B hint on the demo laptop.
3. Ask DeepMind staff whether Gemma counts and if credits exist.
