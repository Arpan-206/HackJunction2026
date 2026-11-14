# Language models in the backend

The backend uses a language model for lessons, plans, motions from text and live coach hints. In the UI this is "the AI Assistant". The algorithmic scorer and the live finger corrections do not use it.

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
| `LLM_PROVIDER` | `fake` | The first provider: `gemini`, `ollama`, `openai` or `fake` |
| `LLM_FALLBACK` | `ollama` | Providers to try next, comma separated. `none` turns the chain off |

- Fake rule lines always close the chain. They never fail, so the chain always answers.
- Any failure moves to the next provider: an exception, a timeout, a spent Gemini budget, a 429 or a 503, a missing key or a server that is down.
- A fallback gets 8 s for a live hint and 60 s for other tasks (`backend/app/services/llm/chain.py`).
- A video lesson skips providers that cannot watch video. It goes from Gemini to the fake template.
- Unknown names in `LLM_FALLBACK` are ignored.
- With `LLM_PROVIDER=fake` there is no chain.

Example: `LLM_PROVIDER=gemini` and `LLM_FALLBACK=ollama` give the chain gemini, ollama, fake.

### Who answered

- `POST /coach/hint`, `/coach/plan`, `/motion/from_text` and `/lessons/generate` return `provider`. It names the provider that answered, for example `ollama` when Gemini was rate limited.
- The backend log has one line for each provider that failed, and one line when a fallback answered.
- `LLMState.chain` and `LLMState.last_answered` hold the chain and the last answer, for the dev panel. The patch that shows them in `GET /dev/state` is in `STATUS-models.md`.

## Health check

Run this in `backend/`:

```
uv run python scripts/llm_health.py
```

It sends one short request to each provider and prints one table. Use `--only ollama,openai` to skip the Gemini request.

| Column | Meaning |
| --- | --- |
| provider | `gemini`, `ollama` or `openai` |
| model | The model name it asks for |
| reachable | `yes` when the server answers; for Ollama, also its version |
| answered | `yes` when the model returned text |
| latency | Time for the answer, in seconds |
| first words or reason | The start of the answer, or why it failed and the next command |

- The exit code is 0 when at least one model answered.
- The Gemini row spends one request from the Gemini budget.
- The `openai` row uses `OPENAI_BASE_URL`. If that is not set, it uses `base_url` from `verda/out/endpoint.json`. It never deploys anything.
- The script reads the root `.env` and `backend/.env`. It removes any key from error text before it prints.

## Settings

Names only. The values are in the root `.env`.

| Name | Used by |
| --- | --- |
| `LLM_PROVIDER`, `LLM_FALLBACK` | The chain |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_HINT_MODEL`, `GEMINI_RPM_BUDGET`, `GEMINI_RPD_BUDGET` | Gemini |
| `OLLAMA_URL`, `OLLAMA_MODEL` | Ollama (default `http://localhost:11434`, `gemma4:e4b`) |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | The OpenAI-compatible endpoint |
| `VERDA_INFERENCE_KEY` | The health check uses it when `OPENAI_API_KEY` is empty |

## Ollama

- Start the server: `ollama serve`. Pull the model: `ollama pull gemma4:e4b`.
- The tag `gemma4:e4b` exists in the Ollama library (6.6 GB, 128K context, same digest as `gemma4:latest`).
- Ollama 0.17.7 refuses this pull with "requires a newer version of Ollama" (HTTP 412). Update Ollama first (0.40.16 is the current release).
- Tests never call Ollama or Gemini. They use stubs and closed ports (`backend/tests/test_llm_chain.py`, `test_llm_health.py`).
