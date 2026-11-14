# Geppetto

Geppetto (working name in the code: Apprentice) is a hand-skill trainer built for Junction 2026 (Rokoko Smartgloves II track). An expert records a skill with Rokoko gloves, and a learner trains against it in 3D with marionette strings, a ghost hand and a shadow as guidance. Each attempt is scored per finger with dynamic time warping (DTW), an optional AI Assistant (a language model, Gemini by default) drafts lessons and practice plans, the learner chooses a margin of error from strict to "just trying it", and a staged learning pipeline leads to a test (table tennis grip and swing, piano).

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
- It also starts by itself when `/api/health` does not answer. The left rail then shows "Sample data, offline".

## Settings and the AI Assistant

"Settings" in the left rail (the bottom bar on a phone) opens one accessible panel, remembered in the browser: the AI Assistant switch, the margin of error, how the score is shown (3D scene by default, or a flat high-contrast chart; clicking the score flips between them), "Add a prop" and reduced motion.

Every language-model feature is the AI Assistant: drafting steps from a sentence or a video, reading a movement described in words, the practice plan and written hints. "Enable AI Assistant" in Settings switches it (localStorage `apprentice.assistant`, on by default) and the rail shows "AI Assistant on" or "off". While it is off the app sends nothing to `/lessons/generate`, `/lessons/generate_from_video`, `/coach/hint`, `/coach/plan` or `/motion/from_text` (the API client refuses them before any request, mock mode included), those entry points show a one-line note instead, and everything else works: steps can be written by hand or recorded from scratch, and scoring, hints from the score and the live corrections are algorithmic and do not need the AI Assistant.

## Margin of error

The expert sets each step's room for error; the learner then chooses how strict to be: Strict (0.6 times the room), Standard (the expert's own, the default), Relaxed (1.5 times) or Just trying it (2.5 times). With table tennis, a relaxed margin lets a slightly wrong swing pass with no correction, while strict demands accuracy. The margin widens or narrows the DTW scorer's tolerance and the hint thresholds on the backend (`margin` on `POST /score` and `POST /coach/hint`), the live corrections in the browser use the same multiplier, and the score screen says which margin judged the rep. Relaxed and looser margins stay silent inside the widened band, and gold is kept for the standard or strict margin.

## Hands and props

The expert chooses one hand (left or right) or two hands for each move or step. Only those gloves are shown and captured (`POST /recordings/start` takes `hands`), and the learner trains with the same set-up; a two-handed step coaches one hand at a time on the stage and scores both, the weaker hand setting the score. Props (racket, keyboard) are off by default because the hands still clip through them; an "Add a prop" switch in the studio, in the training room's Room settings and in Settings turns them on (remembered in the browser). The Test your skills games always keep their racket and keyboard.

## Demo: two windows

Open `http://localhost:5173/expert` in one window (record or generate a lesson) and `http://localhost:5173/apprentice` in another (the skill dashboard: pick a skill, train, score, test). `/` is the role picker. `/lab` is a hand lab page.

- Dev panel: add `?dev=1` to show it (remembered for the tab only, never across sessions), `?dev=0` to hide it.
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

Set `LLM_PROVIDER`: `fake` (default, offline, deterministic), `gemini` (needs `GEMINI_API_KEY`) or `openai` (Gemma on Verda, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`). Other variables: `GEMINI_MODEL`, `GEMINI_HINT_MODEL`, `GLOVE_SOURCE`, `ROKOKO_UDP_PORT`, `DATA_DIR`. See `backend/.env.example`. Never commit `.env`.

Gemini free-tier limiter (`backend/app/services/llm/rate_limit.py`, numbers in `backend/app/constants.py`): requests are counted per model, with a sliding 60 second window and a per-day counter saved to `gemini_usage.json` (the day resets at midnight Pacific). The budget is 80 percent of the free limit, so the demo should not meet a real 429. Overrides: `GEMINI_RPM_BUDGET`, `GEMINI_RPD_BUDGET`.

| Model | Free limit (per minute, per day) |
|---|---|
| gemini-3.8-flash, gemini-3.6-flash | 5, 20 |
| gemini-3.5-flash-lite (default for `GEMINI_MODEL` and `GEMINI_HINT_MODEL`), gemini-3.1-flash-lite | 10, 500 |
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

## Core service (`core/`): gloves in, scored hands out

A second Python service, built overnight against `SPEC.md`, reads the Rokoko
hand solver directly (RGMP on 12277, RCSP on 45451), records lessons from the
gloves, scores a learner against a master at 30 Hz, and serves one WebSocket
(`/ws`) with hands, ghost, score and coach lines. It also serves this repo's
`docs/CONTRACT.md` shapes (`/api/*`, `/ws/gloves`) so the frontend can use
it, and it can feed `backend/` through `/ws/ingest`.

```
source .venv/bin/activate          # made with `uv venv --python 3.12`; deps in requirements.txt
python -m pytest -q                # core tests only (tests/)
python -m core --fake              # no hardware: http://localhost:8765/debug
python -m core --fake --port 8000  # the same, on the port the frontend proxies to
```

Read `STATUS.md` (what works, what is untested), `DECISIONS.md` (every
judgement call) and `RECONCILE.md` (how the two halves fit, and an opinion on
`SPEC.md` versus `docs/CONTRACT.md`).
