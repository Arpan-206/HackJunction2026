# STATUS: demo-mode lane

Branch `demo-mode`, worktree `.claude/worktrees/demo-mode`. Written Sat 14 Nov 2026.

Words used here:

- Kiosk: a locked screen for the demo table. A visitor can reach only `/demo`.
- Fake core: `python -m core --fake`, the glove engine with synthetic gloves.
- Mock mode: the backend port that runs in the browser (`?mock=1`).
- Walk: a Playwright script that clicks through the app and fails on any console error.

## What works

The `/demo` route is a visitor flow in three steps. Each step is one big button or automatic.

| Step | What the visitor sees | What the app does |
| --- | --- | --- |
| Welcome | "Your hand drives a robot hand", one Start button | Makes a guest wearer name, for example `Guest 17:11:02` |
| 1. Calibrate | Flat hand, fist, thumb folded. Each pose: 2 s to get ready, 3 s hold, with a countdown and a progress bar | `POST /api/calibrations` per hand and pose, `POST /api/gloves/calibrations/neutral` on flat, the core's `calibrate` on flat and again on thumb, then `/finish` links the ranges |
| 2. Pick a lesson | Up to six lessons as big buttons | Core lessons when the core is up (`lesson_load`, `set_mode learn`, `step_goto 0`); the seeded lessons otherwise |
| 3. Play | The live score (0 to 100, large), the robot twin beside the learner's hand, one correction line, the target hand | The core's live score; a browser score from the same per-frame rule when no core is up |
| Next visitor | One button | Core to `idle`, robot source `off`, guest calibration, session and score reset, back to Welcome |

Kiosk lock:

- `?kiosk=1` turns the kiosk on for the tab (sessionStorage). `?kiosk=0` turns it off. A build with `VITE_KIOSK=1` is always a kiosk.
- In a kiosk every path goes to `/demo`. The rail, Settings, the expert screens and the dev panel are not reachable. `?dev=1` does nothing in a kiosk.

Other work on this branch:

- Geppetto rename: the CLAUDE.md checklist is done in one pass, and that section is deleted (commit `a2bc560`).
- Thumb-folded calibration: an additive `thumb` phase on `POST /calibrations`, stored as `thumb` (null until captured). Backend, `docs/CONTRACT.md`, `frontend/src/api/types.ts` and the mock router change together (commit `6b0ad80`). Nothing scores with it yet.
- `PreviewHost` fix (`frontend/src/three/Preview.tsx`): a disposed canvas fired a late context-loss event. That event rebuilt the next preview canvas, which then drew nothing. The target hand on `/demo` was empty against the core. Now only the canvas on screen can start a rebuild. This fix helps every small hand preview in the app.
- `frontend/vite.config.ts`: `resolve.preserveSymlinks: true`. A worktree with a symlinked `node_modules` got 403 errors on the font files. The main checkout does not change.

## Results

All results are from fakes. Nobody had gloves.

| Check | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm test` | 305 passed, 23 files |
| `npm run build` | pass |
| `node e2e/mock-walk.mjs` | no console or page errors |
| `node e2e/demo-walk.mjs` (mock mode) | no errors; calibration 15.6 s; lesson mastered |
| `DEMO_CORE=1 DEMO_CORE_PORT=8775 node e2e/demo-walk.mjs` (fake core, backend, ingest bridge) | no errors; calibration 15.6 s; live score 82; backend stored 5 calibrations and the finish link |
| `uv run pytest -q` in `backend/` | 256 passed, 13 skipped |

Screenshots: `frontend/docs/screens/demo-mock-*.png` and `demo-core-*.png`.

## How to run

Mock mode, no Python:

```
cd frontend
npm run dev
# open http://localhost:5173/demo?kiosk=1&mock=1&nocore=1
```

The full stack on fakes (each line in its own terminal, from the repo root unless stated):

```
source .venv/bin/activate && python -m core --fake
cd backend && LLM_PROVIDER=fake GLOVE_SOURCE=external uv run uvicorn app.main:app --port 8000
source .venv/bin/activate && python -m tools.ingest_bridge
cd frontend && npm run dev
# open http://localhost:5173/demo?kiosk=1
```

For the demo table, build a locked kiosk with `VITE_KIOSK=1 npm run build`.

Walks: `node e2e/demo-walk.mjs` (mock), or `DEMO_CORE=1 node e2e/demo-walk.mjs` with a core on port 8765. `DEMO_CORE_PORT` picks another core port. `E2E_PORT` picks the Vite port.

## Choices

| Choice | Why |
| --- | --- |
| 2 s ready plus 3 s hold per pose, 15 s of countdown | About 20 s with the saves, as the brief asks. The walks measured 15.6 s with fast fakes. |
| Thumb-folded pose stored additively in the backend | The backend allowed it. The core does not read it yet (see below). |
| The core's `calibrate` is sent on flat and again on thumb | The second one makes the core reload the newest flat and fist, which are now this guest's. |
| A failed save never stops the visitor | The flow goes on. The operator sees the notes on the lesson screen, under a closed "Calibration notes" section. |
| Browser score when no core is up | The demo must not freeze. It uses the core's per-frame rule (under 8 degrees perfect, over 45 wrong). The core's score always wins when the core is up. |
| `?nocore=1` | Keeps the screen off the core, for the offline walk or a table with no engine. |
| Guest calibration files stay on disk after "Next visitor" | The core always loads the newest. The next guest's files replace them in effect. |

## Written but not tested

- Real gloves. Every result above is from the fake core or mock mode.
- The `VITE_KIOSK=1` build was not loaded in a browser. The walk tests the `?kiosk=1` flag, which takes the same code path.
- A touch screen. The buttons are large, but nobody tapped them.

## What a human must do next

1. Try `/demo?kiosk=1` with real gloves. Check that the thumb-folded hold feels natural and that the countdown is long enough.
2. Merge branch `demo-mode`. The rename touches many docs, so expect small conflicts in `docs/ideas/*` and `PRODUCT.md`.
3. Decide if the core should use the `thumb` capture. This is the core owner's choice (CLAUDE.md rule 9). This lane did not touch `core/`.

## Patches for files outside this lane

The core (owner decision, not applied). The core reads only flat and fist from `backend` calibrations. The thumb-folded capture gives the thumb its real range: the thumb moves only about 14 degrees from flat to a loose fist. Proposal: in `core/calibration.py`, when a record has a non-null `thumb`, use its thumb triple instead of the fist's thumb triple as the "closed" end of the thumb range. This lane did not write the exact code, because rule 9 says to stop and ask first.

`CLAUDE.md`, "Run" section, the "Local runs" line. Add the demo route and the kiosk flag. Replace:

```
Routes: `/expert`, `/apprentice`, `/playground`, `/lab`.
```

with:

```
Routes: `/expert`, `/apprentice`, `/playground`, `/lab`, `/demo` (visitor flow for the demo table). Kiosk: `?kiosk=1` (sessionStorage, `?kiosk=0` clears) or `VITE_KIOSK=1` locks the app to `/demo` and hides the rail, Settings, expert screens and dev panel (`features/shared/kiosk.ts`).
```

## Parked

Nothing is parked in this session. An earlier session stopped on a permission prompt. The prompt's command was not recorded.
