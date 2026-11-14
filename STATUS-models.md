# STATUS: models lane

Branch `models`, worktree `.claude/worktrees/models`. Commits: `e7acdab` (chain), `72ade01` (health check and docs). Full guide: `docs/MODELS.md`.

## What works and how to run it

| Item | State | How to check |
| --- | --- | --- |
| `LLM_PROVIDER=gemini` | Set | Root `.env` holds `LLM_PROVIDER=gemini` and `LLM_FALLBACK=ollama` |
| `.env` the backend reads | Found | Only `backend/.env` (working directory of uvicorn). It is now a link to the root `.env` |
| Fallback chain | Done, tested on stubs | `uv run pytest -q tests/test_llm_chain.py` in `backend/` |
| Provider in the responses | Done | Hint, plan, motion and lesson `provider` name the provider that answered |
| Health check | Done, run live | `uv run python scripts/llm_health.py` in `backend/` |
| Ollama server | Running, v0.17.7 | `curl -s localhost:11434/api/version` |
| `gemma4:e4b` | NOT pulled | See "What a human must do next" |
| Backend tests | 280 passed, 13 skipped | `uv run pytest -q` in `backend/` |

### Health check result (14 Nov, this machine)

| Provider | Model | Reachable | Answered | Latency |
| --- | --- | --- | --- | --- |
| gemini | gemini-3.5-flash-lite | yes | yes | 0.82 s |
| ollama | gemma4:e4b | yes (v0.17.7) | no: model not pulled | - |
| openai | google/gemma-4-31B-it | no (HTTP 404): Verda endpoint is torn down | no | - |

## Choices

1. **The .env file.** pydantic-settings reads `.env` from the working directory. Uvicorn runs in `backend/`, so it read only `backend/.env`, which did not exist. I linked `backend/.env` to `../.env` (git-ignored). So the key stays in one file and is not copied. The worktree's `backend/.env` links to the main checkout's root `.env` the same way.
2. **Chain shape.** `ChainLLM` in `backend/app/services/llm/chain.py`. Its `name` is the first provider's name, so existing checks (praise skip, video support, the Gemini hint model) behave as before. Later links get no model override, so Ollama never gets a Gemini model name.
3. **Who answered.** A context variable holds the answering provider for each request. So two parallel requests never mix their providers. Coach hint cache keeps the provider with the hint.
4. **Fallback time caps.** 8 s for a live hint, 60 s for other tasks. They are module constants in `chain.py`, not in `constants.py`, to stay inside the lane. Move them if you want every tunable in `constants.py`.
5. **Video.** A video lesson skips Ollama (text only) and goes to the fake template.
6. **`LLM_FALLBACK`.** Needed a new `Settings` field (`llm_fallback: str = "ollama"`) in `backend/app/core/config.py`. This is the only edit outside the lane directories. It is two lines and is in commit `e7acdab`.
7. **Health check.** It reads the root `.env` and `backend/.env` and removes keys from error text. The Gemini row spends one request. `--only ollama,openai` skips it.
8. **Ollama version.** I did not touch `/Applications/Ollama.app`.

## Written but untested

- The chain against a real Ollama answer: Gemma 4 is not pulled, so Ollama has never answered through the chain. All chain tests use stubs or closed ports.
- The chain under a real Gemini 429 or 503: tested only with stub errors of the same classes.

## What a human must do next

1. **Update Ollama, then pull the model.** Ollama 0.17.7 refuses Gemma 4 with HTTP 412 ("requires a newer version"). The tag `gemma4:e4b` exists (6.6 GB). My download of the new release was refused by a permission prompt (PARKED). Either update the app from ollama.com, or run:
   ```
   gh release download v0.40.16 --repo ollama/ollama -p ollama-darwin.tgz
   ```
   Then stop the old server (`pkill -f "ollama serve"`), start the new one, and run `ollama pull gemma4:e4b`.
2. Run `uv run python scripts/llm_health.py` in `backend/`. The ollama row must say `answered yes`.
3. Restart the backend so it reads `LLM_PROVIDER=gemini`.
4. Decide if `core/coach.py` needs the same fallback (see below).

## core/coach.py

I did not edit it (rule 9). The core's coach writes rule lines only. If it ever calls a model, it should use the same order: gemini, ollama, rule lines. The backend owns coach text (rule 1), so the simplest path is that the core keeps its rule lines and the backend coach is the only model path.

## Patches for files outside the lane

### Show the chain in the dev panel (additive, needs the CONTRACT owner)

`backend/app/schemas/api.py`, class `DevState`, after `gemini_budget`:

```python
    llm_chain: list[str] = Field(default_factory=list)
    llm_answered_by: str | None = None
```

Also widen `llm_provider` in `DevState` and `DevStatePatch` to `Literal["fake", "gemini", "ollama", "openai"]`, to match `Settings`.

`backend/app/services/dev.py`, in `DevService.state()`, inside `DevState(...)`:

```python
            llm_chain=self._llm.chain,
            llm_answered_by=self._llm.last_answered,
```

`frontend/src/api/types.ts`, interface `DevState`:

```ts
  llm_chain?: string[];
  llm_answered_by?: string | null;
```

`frontend/src/dev/DevPanel.tsx`, after the "LLM provider" label:

```tsx
      {state?.llm_chain && state.llm_chain.length > 1 && (
        <p>
          Chain: {state.llm_chain.join(' then ')}. Last answer: {state.llm_answered_by ?? 'none yet'}.
        </p>
      )}
```

`docs/CONTRACT.md` line 183, `GET /dev/state` response: add `llm_chain: string[], llm_answered_by: string | null` (read-only, ignored on POST). The mock router may leave both fields out, since they are optional.

### Optional: move the time caps

`backend/app/constants.py`:

```python
LLM_FALLBACK_HINT_TIMEOUT_S = 8.0
LLM_FALLBACK_TIMEOUT_S = 60.0
```

Then use `c.LLM_FALLBACK_HINT_TIMEOUT_S` and `c.LLM_FALLBACK_TIMEOUT_S` in `chain.py`.

## Tested on fakes only

Every chain and health test runs offline. `conftest.py` blanks the Gemini key, and no test calls a paid API. The only live calls were the manual health check runs listed above.
