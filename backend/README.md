# Apprentice backend

FastAPI service for Apprentice: streams smoothed glove frames over WebSocket, stores lessons, recordings and calibrations as JSON files, scores attempts, and generates lessons with Gemini, Gemma (Ollama) or an offline fake provider. The API and data contract is `../docs/CONTRACT.md`.

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
| `LLM_PROVIDER` | `fake` | `fake`, `gemini` or `ollama` |
| `GEMINI_API_KEY` | none | Required for `gemini` |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model name |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server |
| `OLLAMA_MODEL` | `gemma4:e4b` | Use `gemma4:12b` with 12 to 16 GB of VRAM |
| `GLOVE_SOURCE` | `simulator` | `simulator`, `rokoko_udp` or `rokoko_sdk` (stub) |
| `ROKOKO_UDP_PORT` | `14043` | Studio Custom Streaming port |
| `DATA_DIR` | `./data` | Lessons, recordings and calibrations (JSON files) |

## Layout

- `app/api`: thin routes and the WebSocket; they validate, call one service and return a schema.
- `app/schemas`: one pydantic model per contract type.
- `app/services`: gloves (simulator, Rokoko UDP, SDK stub, manager), motion synthesiser, One Euro smoothing, scoring, recorder, calibration, LLM providers, vision, JSON storage.
- `app/data`: move catalogue and seed lessons.

## Rokoko Studio setup

In Studio: Livestreaming, Custom, UDP, JSON v3 (or v4), port 14043, target the laptop. Then switch the source live with `POST /api/dev/state {"glove_source": "rokoko_udp"}`. The JSON field names are unverified; all payload-shape logic is in `app/services/gloves/rokoko_mapper.py` and the flexion axis and sign are in `app/constants.py` (`ROKOKO_FLEX_AXIS`, `ROKOKO_FLEX_SIGN`). The first unrecognised frame shape is logged once.

## Notes

- `POST /api/lessons/generate` returns an unsaved lesson (with an id); `PUT /api/lessons/{id}` creates it if the id is unknown, so the frontend can save it after editing.
- The `rokoko_sdk` source is a stub because the Rokoko Device SDK driver has its own licence; it answers 501 with an explanation.
