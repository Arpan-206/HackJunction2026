# Geppetto backend

FastAPI service for Geppetto: streams smoothed glove frames over WebSocket, stores lessons, recordings and calibrations as JSON files, scores attempts, and generates lessons with Gemini, Gemma on Verda or an offline fake provider. The API and data contract is `../docs/CONTRACT.md`.

## Run

```bash
uv sync                      # core dependencies
uv run uvicorn app.main:app --reload --port 8000
uv run pytest -q             # tests
```

Optional extras:

```bash
uv sync --extra vision       # MediaPipe + OpenCV for POST /api/vision/hands (503 without it)
uv sync --extra rokoko       # LZ4 for compressed Rokoko Studio streams
```

Copy `.env.example` to `.env` to configure. With no configuration the backend runs on the simulator and the fake LLM, so it works with no hardware and no keys.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `fake` | `fake`, `gemini` or `openai` |
| `GEMINI_API_KEY` | none | Required for `gemini` |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini model name |
| `GEMINI_HINT_MODEL` | `gemini-3.5-flash-lite` | Model for live coach hints (same model by default, so both share its 500 per day free quota) |
| `GEMINI_RPM_BUDGET`, `GEMINI_RPD_BUDGET` | 80% of the free limit | Override the request budgets |
| `GLOVE_SOURCE` | `simulator` | `simulator`, `rokoko_udp`, `rokoko_sdk` (stub) or `external` |
| `ROKOKO_UDP_PORT` | `14043` | Studio Custom Streaming port |
| `DATA_DIR` | `./data` | Lessons, recordings and calibrations (JSON files) |
| `OPENAI_BASE_URL` or `VERDA_GEMMA_URL` | none | The model hosted on Verda (Gemma 4 behind vLLM, OpenAI-compatible); empty keeps Verda out of every chain. See `../docs/MODELS.md` |
| `OPENAI_API_KEY` or `VERDA_INFERENCE_KEY` | none | Its bearer key. Each `VERDA_` name fills its `OPENAI_` setting when that is absent or empty |
| `OPENAI_MODEL` or `VERDA_GEMMA_MODEL` | `google/gemma-4-31B-it` | The served model |
| `CORE_EXPORT` | `true` | Also write every take and lesson as a local core lesson folder (below) |
| `CORE_EXPORT_DIR` | `DATA_DIR/core_lessons` | Where those folders go |

## Layout

- `app/api`: thin routes and the WebSocket; they validate, call one service and return a schema.
- `app/schemas`: one pydantic model per contract type.
- `app/services`: gloves (simulator, Rokoko UDP, SDK stub, manager), motion synthesiser, One Euro smoothing, scoring, recorder, calibration, LLM providers, vision, JSON storage.
- `app/data`: move catalogue and seed lessons.

## LLM endpoints

`POST /api/lessons/generate`, `POST /api/coach/plan` (practice plan and master note from scored attempts) and `POST /api/motion/from_text` (free text to a `MotionSpec`) share one pattern: a prompt in `app/services/llm`, pydantic validation, up to 2 retries with errors fed back, then the deterministic fake fallback (`provider: "fake"`). Tests in `tests/test_llm_features.py`.

`POST /api/lessons/generate_from_video` takes a multipart `video` (mp4, webm or mov, up to 50 MB; 413 and 415 otherwise) plus optional `prompt` and `skill`, and returns the same shape. Gemini uploads the file with the google-genai Files API, polls until it is ACTIVE, then generates with the video as a part (own 120 s timeout); other providers return the template with a note that video analysis needs Gemini. The temporary file is always deleted. Tests in `tests/test_video.py`.

## Core lesson export (local)

Every stored take and lesson is also written, on this machine, as a core lesson folder (`../SPEC.md` "Lesson files": `lesson.json` with schema `geppetto.lesson/1`, `trace.npz`, `frames/step_XX.jpg`). That is the one format Arpan's side reads, so a take recorded in our app works with his pipeline as it is. Nothing is uploaded: Verda hosts the model for inference only, and all training runs locally.

- Layout: `DATA_DIR/core_lessons/takes/<take id>-<side>/` (one per hand), `DATA_DIR/core_lessons/lessons/<lesson id>/` (the recorded steps joined, one core step each, named and noted from the lesson; steps with no take are listed as skipped), `DATA_DIR/core_lessons/manifest.json` (source file, fingerprint, folders, hands, steps, pictures, `glove_source` (`glove`, or `fake` for simulator takes), the calibration used per hand, and the reason for anything skipped). `backend/data/` is git-ignored, so none of it is committed.
- Automatic: a worker in the backend syncs at start-up, right after a take is stopped or deleted and a lesson is saved, and every 30 s (bundle imports). The files in `recordings/` and `lessons/` stay the source of truth. `CORE_EXPORT=false` turns it off; `CORE_EXPORT_DIR` moves it.
- The core's own recorder (imported read only from the repo root) cuts the steps and weighs the fingers. Joint positions come from the core's synthetic hand bent to the measured angles (our frames carry angles, not positions). A real glove take gets the flat and fist calibration the live core would apply (`../core/calibration.py`, reading this backend's `calibrations/` and `glove_calibrations/`), so its angles match the lessons the core records itself; a simulator take, or a glove take with no calibration saved, stays raw. A new calibration rebuilds the glove folders.
- By hand: `uv run python scripts/core_export_sync.py`. Code: `app/services/core_export.py`. Tests: `tests/test_core_export.py`.

Who reads the folders, all local (paths from the repo root):

| Tool | Command | Reads |
| --- | --- | --- |
| The core's loader | `core.recorder.Lesson.load(folder)` | one folder |
| Finger weights | `python weights/check_lessons.py backend/data/core_lessons/takes/<id>-right` | one or more folders |
| LeRobot robot dataset | `cd export && uv run geppetto-export --lessons-dir ../backend/data/core_lessons/takes` | every `*/lesson.json` under the folder |
| Lesson from a recording (inference on Verda) | `uv run python scripts/verda_lesson.py <take or lesson id>` in `backend/` | one folder |
| Coach tuning dataset | `coach_tune/build_dataset.py` | only `lessons/` of Arpan's checkout today (a fixed path); it needs a lessons folder option to read these |

To send one take or lesson to the model on Verda (key pose sketches as pictures plus a glove trace summary, Lesson JSON back): `uv run python scripts/verda_lesson.py <take or lesson id> [--side left] [--dry-run] [--save]`. `--dry-run` prints what the model would get and calls nothing; `--save` stores the lesson in `DATA_DIR/lessons`. This is the only network call: one chat request to the Verda endpoint (`VERDA_GEMMA_URL`, else `base_url` in `../verda/out/endpoint.json`) with the bearer key `VERDA_INFERENCE_KEY`. The deployment must be up (`../verda/deploy.py`, billed per hour).

## Gemini request budget

The Gemini free tier is small (about 5 requests per minute and 20 per day for `gemini-3.8-flash`, 10 and 500 for Flash-Lite; see `../research/06_gemini.md`). `app/services/llm/rate_limit.py` counts every Gemini call per model with a sliding 60 s window and a per-day counter (Pacific date, as Google resets), saved in `DATA_DIR/gemini_usage.json` so a restart does not reset the day. Budgets are 80 percent of the limits in `app/constants.py` (`GEMINI_FREE_LIMITS`). When a budget is spent, or Google answers 429 or 503, the call is skipped and the offline answer is returned with provider `fake (rate limited)`, without retries. `POST /api/coach/hint` also caches identical requests for 60 s and answers praise algorithmically. Remaining budget is in `GET /api/dev/state` (`gemini_budget`). Tests stub the SDK and `tests/conftest.py` blanks the key and blocks `genai.Client`, so the suite never reaches Gemini.

## Calibrated scoring

`POST /api/score` accepts `attempt_calibration_id` or `use_latest_calibration` (and optionally `reference_calibration_id`). The attempt is normalised by the learner's flat and fist ranges and mapped into the reference's space, so a stiffer hand is not penalised for a smaller range. Incomplete calibrations are ignored with a message in `warnings`. Tests in `tests/test_scoring.py`.

`POST /api/score` and `POST /api/coach/hint` also take the learner's `margin` (`strict`, `standard`, `relaxed`, `just_trying`). `MARGIN_MULTIPLIERS` in `app/constants.py` scales the step tolerance and every hint threshold (`hints.thresholds`); the relaxed margins (`MARGIN_QUIET`) also stay silent inside the widened band. Without a margin, or with `standard`, every number is unchanged. `ScoreResult.margin` echoes it.

## Rokoko Studio setup

In Studio: Livestreaming, Custom, UDP, JSON v3 (or v4), port 14043, target the laptop. Then switch the source live with `POST /api/dev/state {"glove_source": "rokoko_udp"}`. The JSON field names are verified (see `../research/09_rokoko.md`); the flexion axis and sign are still to be probed with `scripts/probe_flexion.py` while someone wears a glove. All payload-shape logic is in `app/services/gloves/rokoko_mapper.py` and the axis and sign are in `app/constants.py` (`ROKOKO_FLEX_AXIS`, `ROKOKO_FLEX_SIGN`). The first unrecognised frame shape is logged once.

## External source (ML or positioning pipeline)

`POST /api/dev/state {"glove_source": "external"}`, then push frames:

- `POST /api/ingest/frames`: one `GloveFrame`, one `HandFrame` or `{"frames": [...]}` (max 600). Add `?activate=1` to switch the source in the same call. 409 when the source is not `external`, 422 for an invalid frame.
- `WS /ws/ingest` (also `?activate=1`): the same JSON shapes as text messages. Only failures are answered, as `{"type": "error", "status", "detail"}`; the socket stays open.

Frames go through the normal smoothing and out of `/ws/gloves` as `source: "replay"`. Logic is in `app/services/gloves/external.py`; see `../docs/HARDWARE_INTEGRATION.md` section 5.

## Notes

- `POST /api/lessons/generate` returns an unsaved lesson (with an id); `PUT /api/lessons/{id}` creates it if the id is unknown, so the frontend can save it after editing.
- The `rokoko_sdk` source is a stub because the Rokoko Device SDK driver has its own licence; it answers 501 with an explanation.
