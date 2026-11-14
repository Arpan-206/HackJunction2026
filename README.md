# Apprentice

Apprentice is a hand-skill trainer built for Junction 2026 (Rokoko Smartgloves II track). An expert records a skill with Rokoko gloves, and a learner trains against it in 3D with marionette strings, a ghost hand and a shadow as guidance. Each attempt is scored per finger with dynamic time warping (DTW), a Gemini coach gives hints, and a staged learning pipeline leads to a test (table tennis grip and swing, piano).

The backend is FastAPI (Python 3.12, uv). The frontend is React, Vite and three.js. The frontend can run alone in mock mode, with no backend.

## Quick start

Backend (install [uv](https://docs.astral.sh/uv/) first):

```
cd backend
uv sync
cp .env.example .env        # then edit; the defaults run with no key
uv run uvicorn app.main:app --port 8000 --reload
```

Frontend (Node and npm):

```
cd frontend
npm install
npm run dev                 # http://localhost:5173, proxies /api to the backend
```

Other frontend scripts: `npm run build`, `npm run lint`, `npm run preview`.

## Mock mode (no backend)

The frontend carries a port of the backend (`frontend/src/mock/`), with data kept in the browser.

- `?mock=1` turns it on and remembers it. `?mock=0` turns it off again and beats `VITE_MOCK`.
- `VITE_MOCK=1` (environment variable at build or dev time) forces it on.
- It also starts by itself when `/api/health` does not answer. The left rail then shows "Demo data, no backend".

## Demo: two windows

Open `http://localhost:5173/expert` in one window (record or generate a lesson) and `http://localhost:5173/apprentice` in another (train, score, test). `/` is the role picker. `/lab` is a hand lab page.

- Dev panel: add `?dev=1` (remembered) to show it, `?dev=0` to hide it.
- Playground: `/playground` is a sandbox for the 3D hand and overlays.

## Glove sources

Set `GLOVE_SOURCE` in `backend/.env`:

| Value | Meaning |
|---|---|
| `simulator` (default) | Synthetic hand, no hardware |
| `rokoko_udp` | Rokoko Studio live data over UDP, port from `ROKOKO_UDP_PORT` |
| `external` | Another program sends frames: `POST /api/ingest/frames` or WebSocket `/ws/ingest` |
| `rokoko_sdk` | Stub only: the Rokoko Device SDK is licensed separately, so this source raises a clear error. Use `rokoko_udp` |

Details and wiring: `docs/HARDWARE_INTEGRATION.md`.

## LLM providers

Set `LLM_PROVIDER`: `fake` (default, offline, deterministic), `gemini` (needs `GEMINI_API_KEY`) or `ollama` (`OLLAMA_URL`, `OLLAMA_MODEL`). Other variables: `GEMINI_MODEL`, `GEMINI_HINT_MODEL`, `GLOVE_SOURCE`, `ROKOKO_UDP_PORT`, `DATA_DIR`. See `backend/.env.example`. Never commit `.env`.

Gemini free-tier limiter (`backend/app/services/llm/rate_limit.py`, numbers in `backend/app/constants.py`): requests are counted per model, with a sliding 60 second window and a per-day counter saved to `gemini_usage.json` (the day resets at midnight Pacific). The budget is 80 percent of the free limit, so the demo should not meet a real 429. Overrides: `GEMINI_RPM_BUDGET`, `GEMINI_RPD_BUDGET`.

| Model | Free limit (per minute, per day) |
|---|---|
| gemini-3.8-flash (default `GEMINI_MODEL`), gemini-3.6-flash | 5, 20 |
| gemini-3.5-flash-lite (default `GEMINI_HINT_MODEL`), gemini-3.1-flash-lite | 10, 500 |
| any other model | 5, 20 |

These limits are third-party reports, not Google documentation (see `research/06_gemini.md`).

## Tests

Backend (from `backend/`): `uv run pytest -q`. The key is blanked in tests, so no paid call is made.

Frontend (from `frontend/`):

- `npm test` runs vitest (unit tests).
- `npm run e2e` runs `e2e/smoke.mjs`; needs the backend on :8000.
- `node e2e/mock-walk.mjs` walks the whole app in mock mode; no backend needed.
- `node e2e/learner-real.mjs` needs the backend on :8000 with `GLOVE_SOURCE=simulator` and `LLM_PROVIDER=fake`.

The e2e scripts take Playwright from `genui/node_modules`, so run `npm install` in `genui/` first.

## Layout

```
backend/   FastAPI app (app/api, app/services, app/schemas), tests, scripts
frontend/  React app (src/features, src/mock, src/three, src/playground)
genui/     Gemini generated-UI experiments and the Playwright install used by e2e
docs/      API contract, hardware notes, ideas
research/  Research notes
```

## Docs map

- `docs/CONTRACT.md`: the API source of truth.
- `docs/HARDWARE_INTEGRATION.md`: gloves, Rokoko, ingest.
- `docs/ASSETS.md`: assets.
- `docs/ideas/`: `PITCH.md`, `DEMO_RUNBOOK.md`, `JUDGE_QA.md`, `VIDEO_SCRIPT.md`, `VIDEO_LESSONS.md`, `GOOGLE_TRACK.md`, `ACCOUNTS_AND_DATA.md`, `ML_PIPELINE_INTERFACE.md`, `BACKLOG.md`.
- `research/`: `00_plan.md` to `10_learning_pipeline.md` (hardware, hand training, Gemini, Gemma, Rokoko, learning pipeline).
- `frontend/README.md`, `frontend/ARCHITECTURE.md`, `backend/README.md`, `PRODUCT.md`.
