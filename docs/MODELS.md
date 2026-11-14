# Language models in the backend

The backend uses a language model for four roles: live coach hints, practice plans, lesson generation and motion from text. In the UI this is "the AI Assistant". The algorithmic scorer and the live finger corrections do not use it.

Two models are in use:

- **Gemini**: the Gemini API (`gemini` provider).
- **Gemma on Verda**: Gemma 4 behind an OpenAI-compatible endpoint (`openai` provider). It is used only when `OPENAI_BASE_URL` (or `VERDA_GEMMA_URL`) is set. Verda hosts the model for inference only: nothing trains there and nothing is stored there.

## Which .env file the backend reads

- `backend/app/core/config.py` sets `env_file=".env"`.
- pydantic-settings reads that path from the working directory of the process.
- Uvicorn runs in `backend/`, so the backend reads `backend/.env` only. It does not read the repo-root `.env`.
- On Arpan's machine, `backend/.env` is a symbolic link to the root `.env`. So both names hold the same file, and the key exists in one place.
- Both files are git-ignored. Never print, copy or commit them.

To make the link on a new checkout, run this in `backend/`:

```
ln -s ../.env .env
```

## The fallback chain

A chain is a list of providers. The backend tries them in order and uses the first answer.

| Setting | Default | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `fake` | The first provider for every role: `gemini`, `openai` or `fake` |
| `LLM_FALLBACK` | `gemini,openai` | Providers to try after the first one. The first one is skipped. `none` keeps one provider |
| `LLM_ROUTES` | empty | A different first provider for some roles, for example `lesson=openai,plan=openai` |
| `OPENAI_BASE_URL` | empty | The Verda endpoint. Empty keeps Verda out of every chain |

Examples:

| Settings | Role | Chain |
| --- | --- | --- |
| `LLM_PROVIDER=gemini` | all | gemini |
| `LLM_PROVIDER=gemini`, `OPENAI_BASE_URL` set | all | gemini, then openai |
| same, plus `LLM_ROUTES=lesson=openai` | lesson generation | openai, then gemini |
| `LLM_PROVIDER=fake` | all | fake (no model) |

Rules:

- Every model call has a time cap (`backend/app/services/llm/chain.py`): 5 s for a live hint, 20 s for Gemma on Verda, 30 s for Gemini on other roles. A video lesson keeps Gemini's own longer limit.
- Any failure moves to the next provider: an exception, a timeout, a spent Gemini budget, a 429 or a 503, a missing key or a server that is down.
- When Verda fails and Gemini answers the same request, the backend logs one line. It names the role, the reason and both latencies, for example:
  `LLM fallback: role=lesson from=openai to=gemini reason=timeout after 20 s failed_after=20.00s answered_in=1.40s`
- A video lesson skips Verda, which cannot watch video.
- The dev panel's `fake` choice wins over every route.

### When no model answers

- **Coach hint**: one sentence, "The AI Assistant is offline, so follow the finger corrections for now." The `provider` is `offline`. The finger, cue and severity still come from the measurements.
- **Plan, lesson, motion**: the template, with `provider: "fake"`. There is no retry, so the answer comes at once.

### Who answered

- `POST /coach/hint`, `/coach/plan`, `/motion/from_text` and `/lessons/generate` return `provider`: `gemini`, `openai`, `offline`, `fake` or `algorithmic`.
- The UI shows it with `ModelLabel` (`frontend/src/features/shared/ModelLabel.tsx`), under the generated lesson and the practice plan:

| Provider | Label (learner, expert) | Label with `?dev=1` |
| --- | --- | --- |
| `gemini` | AI Assistant | answered by Gemini |
| `openai` | AI Assistant | answered by Gemma on Verda |
| `offline`, `fake` | AI Assistant offline | AI Assistant offline (provider) |
| `algorithmic` | no label | answered by the rule-based cue |

- `GET /dev/state` returns `llm_chain` and `llm_answered_by`. The dev panel shows them under "LLM provider".

## Health check

Run this in `backend/`:

```
uv run python scripts/llm_health.py
```

It prints two tables.

The first table sends one short request to each model:

| Column | Meaning |
| --- | --- |
| provider | `gemini` or `openai` (Gemma on Verda) |
| model | The model name it asks for |
| reachable | `yes` when the server answers; `no (HTTP 404)` and similar when it does not |
| answered | `yes` when the model returned text |
| latency | Time for the answer, in seconds |
| first words or reason | The start of the answer, or why it failed |

The second table shows each role after the fallback rules:

| Column | Meaning |
| --- | --- |
| role | coach hint, plan, lesson generation, motion from text |
| chain | The providers the backend tries, then the offline note or the template |
| answers now | The first provider in the chain that answered in the first table, else offline |

- The exit code is 0 when at least one model answered.
- The Gemini row spends one request from the Gemini budget. Use `--only openai` to skip it.
- The `openai` row uses `OPENAI_BASE_URL`. If that is not set, it probes `base_url` from `verda/out/endpoint.json`. It never deploys anything.
- The script reads the root `.env` and `backend/.env`. It removes any key from error text before it prints.

## Settings

Names only. The values are in the root `.env`.

| Name | Used by |
| --- | --- |
| `LLM_PROVIDER`, `LLM_FALLBACK`, `LLM_ROUTES` | The chain |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_HINT_MODEL`, `GEMINI_RPM_BUDGET`, `GEMINI_RPD_BUDGET` | Gemini |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | Gemma on Verda |
| `VERDA_GEMMA_URL`, `VERDA_INFERENCE_KEY`, `VERDA_GEMMA_MODEL` | The Verda lane's names for the same three. The backend uses each one when its `OPENAI_` name is absent or empty |

## All inference on Verda

Verda hosts the model only (inference). Training and tuning run locally. To send every role to Gemma on Verda first, with Gemini behind it, put this in `backend/.env` (names only here):

```
LLM_PROVIDER=openai
LLM_FALLBACK=gemini
VERDA_GEMMA_URL=<base_url from verda/out/endpoint.json>
VERDA_INFERENCE_KEY=<already in backend/.env>
```

The deployment must be up (`cd verda && uv run python deploy.py`, about 8 minutes of start-up, billed per hour; `uv run python teardown.py` after). While it is down every call falls through to Gemini, then to the offline note.

### Recordings as request context

The model on Verda keeps no files, so a recording travels in the request. `backend/scripts/verda_lesson.py <take or lesson id>` hands the take's local core lesson folder (below) to `verda/gemma_client.py`, which sends the key pose sketches as pictures and a glove trace summary as text in one chat request, and validates the answer as a backend `Lesson`. That request is the only thing that leaves the machine. `--dry-run` prints it and sends nothing.

`verda/gemma_client.py` run on its own reads the key from the repo-root `.env` (or the file named by `GEPPETTO_ENV_FILE`), not `backend/.env`; `verda_lesson.py` uses the backend's settings instead.

## Recordings for local training

Training and tuning run on this machine only. Every take and lesson the expert records in the app is also written locally as a core lesson folder, the format of `SPEC.md` "Lesson files" that Arpan's tools read:

- `backend/data/core_lessons/takes/<take id>-<side>/`: one folder per hand of a take.
- `backend/data/core_lessons/lessons/<lesson id>/`: a lesson's recorded steps joined, one core step each.
- `backend/data/core_lessons/manifest.json`: what came from which file, the calibration used, and why anything was skipped.

The backend keeps them in step on its own (start-up, every take stop or delete, every lesson save, every 30 s); `uv run python scripts/core_export_sync.py` in `backend/` syncs by hand. Real glove takes carry the same flat and fist calibration the live core applies; simulator takes are marked `"source": "fake"` in `lesson.json` so nobody trains on them as an expert. Readers and commands: `backend/README.md`, "Core lesson export".

## Tests

Tests never call Gemini or Verda. They use stubs and closed ports: `backend/tests/test_llm_chain.py`, `backend/tests/test_llm_health.py`, `frontend/tests/providerLabel.test.ts`.
