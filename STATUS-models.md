# STATUS: models lane

Branch `models`, worktree `.claude/worktrees/models`. Full guide: `docs/MODELS.md`.

The lane changed twice on Sat 14 Nov: no Ollama (CHANGE, 17:12), then Verda falls back to Gemini and the UI shows who answered (ADDITION, 17:16). This note describes the current state.

## What works and how to run it

| Item | State | How to check |
| --- | --- | --- |
| `LLM_PROVIDER=gemini` | Set in the root `.env` | The backend reads `backend/.env`, which links to the root `.env` |
| `LLM_FALLBACK` in `.env` | Removed | The default `gemini,openai` applies |
| Chain | Gemini and Gemma on Verda back each other up, then offline | `uv run pytest -q tests/test_llm_chain.py` in `backend/` |
| Time caps | Hint 5 s, Verda 20 s, other Gemini calls 30 s | `backend/app/services/llm/chain.py` |
| Verda to Gemini fallback log | One line: role, reason, both latencies | Test `test_slow_verda_falls_back_to_gemini_and_logs_it` |
| Per-role routing | `LLM_ROUTES`, for example `lesson=openai` | Test `test_routes_send_a_role_to_verda_first` |
| Coach offline note | Provider `offline`, one sentence naming the AI Assistant | Test `test_coach_shows_the_offline_note` |
| UI label | Under the generated lesson and the practice plan | `frontend/src/features/shared/ModelLabel.tsx` |
| Dev panel | Accepts `openai` and shows the chain and the last answer | `GET /dev/state` returns `llm_chain`, `llm_answered_by` |
| Health check | Gemini and Verda rows, plus a role table | `uv run python scripts/llm_health.py` in `backend/` |
| Backend tests | 286 passed, 13 skipped | `uv run pytest -q` in `backend/` |
| Frontend | Lint clean, 300 tests pass, build passes | `npm run lint`, `npx vitest run`, `npm run build` in `frontend/` |

### Health check result (14 Nov, this machine)

| Provider | Model | Reachable | Answered | Latency |
| --- | --- | --- | --- | --- |
| gemini | gemini-3.5-flash-lite | yes | yes | 1.48 s |
| openai | google/gemma-4-31B-it | no (HTTP 404): Verda endpoint is torn down | no | - |

| Role | Chain | Answers now |
| --- | --- | --- |
| coach hint | gemini, then offline note | gemini |
| plan | gemini, then template | gemini |
| lesson generation | gemini, then template | gemini |
| motion from text | gemini, then template | gemini |

Verda is in no chain, because `OPENAI_BASE_URL` is not set.

## Ollama cleanup

- I stopped the `ollama serve` I started (pid 92031). Ollama is not running. I will not start it or pull any model again.
- The `gemma4:e4b` pull failed at once with HTTP 412, so it wrote no model data.

| Path | Date | Action |
| --- | --- | --- |
| `~/.ollama/models/blobs/` (6 files, llama3.2) | 27 Mar 2025 | Kept: older than my pull |
| `~/.ollama/models/manifests/.../llama3.2/latest` | 27 Mar 2025 | Kept |
| Files from my pull | none exist | Nothing removed |

- The app `/Applications/Ollama.app` is unchanged.

## Choices

1. **The .env file.** Uvicorn runs in `backend/`, so the backend reads only `backend/.env`. I linked it to `../.env` (git-ignored), so the key exists in one file.
2. **No fake link in the chain.** When every model fails the chain raises `LLMOfflineError`, a subclass of `LLMTimeoutError`. So plan, lesson and motion stop at once and use their templates, without the old 3 retries.
3. **Offline note keeps the measurements.** The hint text is the note. The finger, cue and severity still come from the algorithmic draft.
4. **Verda only when configured.** `openai` joins a chain only when `OPENAI_BASE_URL` is set and is not `http://localhost:8000` (the backend itself). `.env.example` now leaves it empty.
5. **Who answered.** A context variable per request, so parallel requests never mix their providers. The coach cache keeps the provider with the hint.
6. **Label wording.** Learners and experts see "AI Assistant" or "AI Assistant offline". Model names appear only with `?dev=1` (CLAUDE.md rule 6).
7. **Where the label is.** The backend coach hint has no consumer in the UI: `useAiHint` is not used by any screen. So the label is under the generated lesson (`GenerateSteps.tsx`) and the practice plan (`PlanCard.tsx`). A future coach line shows `<ModelLabel provider={hint.provider} />`.
8. **Dev panel.** The `ollama` option is now `openai (Gemma on Verda)`. The backend still accepts `ollama` if someone sets it by hand, but no chain contains it.
9. **Time caps** are module constants in `chain.py`, not in `constants.py`.

## Files changed outside the lane directories

The ADDITION asked for a small additive frontend change, together with types.ts, the mock router and CONTRACT.md (rule 1).

| File | Change |
| --- | --- |
| `backend/app/core/config.py` | `llm_fallback` and `llm_routes` settings |
| `backend/app/schemas/api.py` | `DevState` gets `llm_chain`, `llm_answered_by`; `llm_provider` accepts `openai` |
| `backend/app/services/dev.py` | Fills the two new fields |
| `backend/.env.example` | `LLM_FALLBACK`, `LLM_ROUTES`; Ollama lines removed; `OPENAI_BASE_URL` empty |
| `docs/CONTRACT.md` | `/dev/state` fields; fallback chain paragraph |
| `frontend/src/api/types.ts` | `ModelProvider` type; `LlmProvider` adds `openai`; optional dev state fields |
| `frontend/src/mock/router.ts` | Dev state accepts `openai` |
| `frontend/src/dev/DevPanel.tsx` | `openai` option; chain and last answer line |
| `frontend/src/features/shared/ModelLabel.tsx`, `ModelLabel.css`, `providerLabel.ts` | New label |
| `frontend/src/features/master/generate/GenerateSteps.tsx`, `features/apprentice/course/PlanCard.tsx` | Show the label |

## Written but untested

- The chain against a live Verda endpoint: the endpoint is torn down. The Verda to Gemini fallback is tested with stubs only.
- A real Gemini 429 or 503: tested only with stub errors of the same classes.
- The label in a browser: covered by unit tests and the build, not by a Playwright walk.

## What a human must do next

1. Restart the backend so it reads `LLM_PROVIDER=gemini`.
2. To use Gemma on Verda, deploy it (not this lane), then set `OPENAI_BASE_URL` and, if wanted, `LLM_ROUTES=lesson=openai`. Run the health check.
3. Optional: wire `useAiHint` into the training room, with `<ModelLabel provider={hint.provider} />` under the line.
4. Optional: update the CLAUDE.md repo map, which still lists `ollama` under `llm/`.

## core/coach.py

I did not edit it (rule 9). The core's coach writes rule lines only and calls no model. The backend owns coach text (rule 1), so it needs no fallback.
