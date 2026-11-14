# CLAUDE.md

Apprentice: experts record hand skills with Rokoko gloves, learners train against them in 3D. See README.md for the overview.

## Repo map

- `backend/app/`: `main.py`; `api/` (router under `/api`, `routes/`, `ws.py`); `core/` (config, errors); `schemas/` (pydantic wire models); `constants.py` (every tunable, incl. Gemini limits); `data/` (moves.json, seed).
- `backend/app/services/`: `scoring.py` (per-finger DTW), `hints.py`, `calibration.py`, `recorder.py`, `lessons.py`, `gloves/` (simulator, rokoko_udp, rokoko_mapper, external, manager), `llm/` (fake, gemini, ollama, coach, lesson_generator, rate_limit.py), `motion/synthesiser.py`, `smoothing/`, `storage/`, `vision/`.
- `backend/scripts/`: `probe_flexion.py`, `replay_udp.py`, `mediapipe_hands.py`. `backend/tests/`: pytest.
- `frontend/src/`: `api/` (client.ts, types.ts, schemas.ts, hooks); `app/` (routes, shell, role select, HandLab); `features/apprentice/` (`library`, `course`, `training`, `test`, `pipeline` = stages, progress, rank, coach lines, demo history); `features/master/` (expert screens: scratch, generate, lesson); `features/shared/`; `mock/` (browser port of the backend: router.ts, scoring.ts, synth.ts, glove.ts, llm.ts, store.ts, install.ts); `three/` (Stage, Hand, handRig, overlays); `playground/`; `dev/` (DevPanel); `state/`; `theme/`.
- `frontend/tests/` vitest; `frontend/e2e/` Playwright scripts (Playwright comes from `genui/node_modules`).
- `docs/`, `research/`, `PRODUCT.md`, `frontend/ARCHITECTURE.md`.

## Run

- Backend (in `backend/`): `uv sync`, then `uv run uvicorn app.main:app --port 8000 --reload`. Tests: `uv run pytest -q`.
- Frontend (in `frontend/`): `npm install`, `npm run dev` (port 5173), `npm run build`, `npm run lint`, `npm test`, `npm run e2e` (backend up), `node e2e/mock-walk.mjs` (no backend), `node e2e/learner-real.mjs` (backend with `GLOVE_SOURCE=simulator`, `LLM_PROVIDER=fake`).
- Local runs: `LLM_PROVIDER=fake`. Mock mode: `?mock=1` / `?mock=0` / `VITE_MOCK=1`, automatic when `/api/health` fails. Dev panel `?dev=1` (per tab, sessionStorage; `?dev=0` clears). Routes: `/expert`, `/apprentice`, `/playground`, `/lab`.
- Python uses uv only. Never write `pip install` or manual venvs.
- Assistant switch: the "Assistant on/off" text switch in the rail footer (localStorage `apprentice.assistant`, default on) gates every language-model feature. The flag lives in `frontend/src/features/shared/assistant.ts`; `api/client.ts` refuses `/lessons/generate`, `/lessons/generate_from_video`, `/coach/hint`, `/coach/plan` and `/motion/from_text` before any fetch while it is off (the mock router refuses them too). New LLM endpoints must be added to `ASSISTANT_PATHS`.
- Stage preferences (sessionStorage, `features/shared/sessionPrefs.ts`): props (racket, keyboard) are off by default behind an "Add a prop" switch, except in the Test your skills games; the expert's last hands choice (one hand left or right, or two) is remembered per move.

## Hard rules

1. `docs/CONTRACT.md` is the API source of truth. Any API change updates it, `frontend/src/api/types.ts` and the mock router `frontend/src/mock/router.ts` together.
2. `frontend/src/mock/scoring.ts` and `synth.ts` are ports of `backend/app/services/scoring.py` and `motion/synthesiser.py`. Change both sides together and keep `frontend/tests/mock-scoring.test.ts` (pinned values) passing.
3. Never call paid APIs in tests. `backend/tests/conftest.py` blanks the Gemini key. Never print or copy a key from `backend/.env`; name variables only (`backend/.env.example`). Never commit `.env`.
4. No em dashes anywhere (code, docs, commits). Use a hyphen, comma or colon.
5. Design: Renaissance bottega theme. Gold only for mastery. Vermilion only for corrections. Malachite for correct. No status pills, no kicker labels. Text at least 16px, readable from 3 m.
6. User-facing copy says "expert", not "master" (the top rank is "Sealed", and the seal reads "Sealed by {expert name}"). Wire fields such as `master_name` and code paths under `features/master` keep their names. Any language model in the UI is "the assistant": never "AI", "Gemini" or "coach" in user copy (provider names only in the dev panel). The algorithmic scorer and the live finger corrections are not the assistant.
7. Commit only when asked; then push to the branch remote, authored as the user only, no Claude trailers. Ask before force push or push to main.

## Unverified

- Rokoko flexion axis and sign: `ROKOKO_FLEX_AXIS` and `ROKOKO_FLEX_SIGN` in `backend/app/constants.py` (currently 0 and 1.0) are unprobed on real gloves. Probe with `backend/scripts/probe_flexion.py`.
- Gemini free-tier limits in `constants.py` (`GEMINI_FREE_LIMITS`) are third-party reports (`research/06_gemini.md`), not Google docs.

## Where things are documented

API: `docs/CONTRACT.md`. Hardware and Rokoko: `docs/HARDWARE_INTEGRATION.md`, `research/09_rokoko.md`. Learning pipeline: `research/10_learning_pipeline.md`. Gemini: `research/06_gemini.md`. Demo and pitch: `docs/ideas/DEMO_RUNBOOK.md`, `PITCH.md`, `JUDGE_QA.md`. Product intent: `PRODUCT.md`. Frontend structure: `frontend/ARCHITECTURE.md`, `frontend/README.md`. Backend: `backend/README.md`.
