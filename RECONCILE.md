# RECONCILE.md: two halves, two contracts, one demo

## 0. Decision (Arpan, Sat 14 Nov, morning)

Route B plus one extra view, with one rule: **each capability has exactly one
owner**, so the demo never shows two scores or two lesson lists that disagree.

| Capability | Owner | How |
| --- | --- | --- |
| Gloves in | `core/` | The only path to real hardware. `backend/` keeps its SDK stub. |
| Live practice screen: hands, ghost, per-frame score, hint | `core/` | His frontend reads the core's `/ws` directly (`frame.hands`, `frame.ghost`, `frame.score`, `coach`). |
| Lesson library, lesson generation from text and video, coach text | `backend/` | Gemini is already wired there. The core builds no model side. |
| Displayed score | One number | The core's live score, shown as 0 to 100 to match his UI. His DTW score is the end-of-step summary, or hidden. |
| Glove frames into his backend | `tools/ingest_bridge.py` | The join between the halves. |

Do not merge the two contracts. Both adapters exist and are tested. Freeze
`SPEC.md` and `docs/CONTRACT.md` as they are and keep the join at the bridge.
Rewriting either side today costs more than the adapter does.

Free win: his backend supports Ollama. Point it at a Gemma model on the
laptop (`LLM_PROVIDER=ollama`, `OLLAMA_MODEL=gemma...`) and the offline coach
for the Gemma bounty exists with almost no new work.

The sections below are the analysis this decision came from.


Written Sat 14 Nov 2026, 07:10, by Arpan's overnight session, before the
decision above. Facts first, then the opinion, then a plan that fits before
the Saturday 23:00 freeze.

## 1. What exists

| | `core/` (Arpan, SPEC.md) | `backend/` + `frontend/` (Szymon, docs/CONTRACT.md) |
| --- | --- | --- |
| Glove input | Rokoko hand solver over RGMP, button and LED over RCSP. Works on the fake solver; real gloves untested. | Rokoko Studio over UDP 14043 (flex axis unverified). The SDK source is a stub (501). |
| Wire | One WebSocket `/ws`: hello, frame (26 joints, ghost, score), session, event, coach, ack. JSON Schema enforced. | REST under `/api` plus `/ws/gloves` (3 flexion values per finger, radians). Pydantic models. |
| Where the maths lives | All in the core: angles, scoring, step machine, ghost placement, coach rules. | Scoring and smoothing in the backend; a browser copy in `frontend/src/mock/`; a live coach in the frontend. |
| Lessons | Recorded from the glove, cut into hold and move steps with key poses. | Steps from a move catalogue and motion specs, takes recorded per step, LLM-drafted lessons. |
| Coaching | Rule lines; a `CoachClient` interface for a model later. | Gemini and Ollama with a fake fallback: hints, plans, lesson generation from text and video. |
| UI | A 2D debug canvas. | The whole product: role select, expert studio, learner dashboard, training room, tests, settings, mock mode. |
| Tests | 88, no hardware. | pytest, vitest, Playwright walks. |

Both halves were tested together twice overnight, without changing his code:

- Route A: `python -m core --port 8000` serves CONTRACT.md's `/api/*` and
  `/ws/gloves` beside SPEC's `/ws`. His frontend showed "Gloves live" and
  listed the core's lessons.
- Route B: `python -m tools.ingest_bridge` pushes the core's hands into his
  backend's `/ws/ingest`. His backend re-emitted them on its `/ws/gloves`.

## 2. Opinion on SPEC.md versus docs/CONTRACT.md

SPEC.md is the better contract for the live loop. It sends 26 joints, so a
viewer can draw bones and a ghost without any maths. It carries the ghost,
the per-finger score, the hint and the coach line in one frame at 30 Hz, and
every message has a schema. One process owns the gloves and the clock.

CONTRACT.md is the better contract for the product around the loop. It has
lessons, takes, calibration, settings, an assistant and a mock mode, and a
frontend of about three hundred files already speaks it. Its glove stream is
thin (three angles per finger, no joints), so his hand is a rigged model
driven by angles, not drawn from positions. That is fine for his renderer.

Switching the frontend to SPEC.md today would mean rewriting its API layer,
its mock router, its training room and its scoring views in one day. That is
not a Saturday job. Switching the core to CONTRACT.md would throw away the
only working path to real gloves and the live ghost. Neither switch is right.

The honest reading: the two documents describe different layers. CONTRACT.md
is the product API. SPEC.md is the sensor and scoring engine. Keep both, and
say so in both files.

## 3. Recommended plan

1. 10:00, decide this in ten minutes: the frontend keeps CONTRACT.md; the core
   is the glove engine; route B is the demo wiring. Write that sentence at
   the top of both SPEC.md and docs/CONTRACT.md.
2. First glove slot: run the core against the solver, read
   `logs/rgmp_definition_*.json`, fix `[rgmp]` in `config.toml` if the stream
   names differ, calibrate, record one lesson. STATUS.md has the checklist.
   Keep a 2 minute capture.
3. Same slot, in parallel: start his backend and the bridge. His frontend then
   shows real hands with no change on his side. Compare his flexion with the
   core's debug view; if a finger bends the wrong way, the fix is in the
   bridge, not in his code.
4. One frontend task for Szymon, half a day: a small consumer of the core's
   `/ws` inside the training room that reads `frame.ghost`, `frame.score` and
   `coach` messages. That gives his room the ghost glued to the learner's
   wrist, the per-finger colours and the rule lines, which his stream cannot
   carry. The schemas in `schema/` are the types.
5. Scoring: one number on stage, the core's live score scaled to 0 to 100.
   His DTW score becomes the end-of-step summary or is hidden. Do not try to
   make them agree numerically today.
6. Gemma and Gemini: his assistant already works through Gemini, and his
   backend also supports Ollama. A local Gemma through Ollama is the offline
   coach for the Gemma bounty. SPEC.md's own Gemma calls are dropped.

## 4. Repo hygiene, after the decision

- Keep `core/`, `schema/`, `tools/`, `tests/` at the root for the hackathon.
  Moving them under one folder is a one-line change later, not today.
- His `CLAUDE.md` says `docs/CONTRACT.md` is the API source of truth. Add:
  "SPEC.md and `schema/` govern `core/` and its `/ws`."
- His rules "uv only" and "no em dashes" hold on this branch: the venv was
  made with `uv venv`, and the files were checked for em dashes. A
  `core/pyproject.toml` for `uv sync` is a ten-minute follow-up.
- Two processes must not both own port 8000. Route B keeps the core on 8765.
- `lessons/` and `logs/` are the core's runtime folders; his are
  `backend/data/`. Both are ignored by git.

## 5. If route A wins instead

Nothing extra is needed to start: `python -m core --port 8000` and his
`npm run dev`. The core then has to grow his newer endpoints (`/coach/plan`,
`/motion/from_text`, `/lessons/generate_from_video`, `hands` on recordings)
or his frontend falls back to mock mode for those screens. That is more work
than route B and loses his assistant. Prefer B.
