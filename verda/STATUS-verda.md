# STATUS-verda.md

Lane "verda": a large multimodal Gemma on Verda turns a recorded demonstration into a lesson. Branch `verda`,
directory `verda/`, submission text in `docs/VERDA.md`. Written Sat 14 Nov 2026 and updated as the lane went.
Nothing outside `verda/` and `docs/VERDA.md` was edited.

## What works and how to run it

All commands run in `verda/` with uv. Secrets come from the main checkout's `.env` (or `$GEPPETTO_ENV_FILE`);
nothing prints or stores a key.

| Piece | File | Run |
| --- | --- | --- |
| Deploy Gemma 4 31B behind vLLM on a Verda serverless container, wait for health, smoke test, record timings | `deploy.py`, `warm_up.sh` | `uv run python deploy.py [--gpu H200]` |
| Tear it down and record hours and cost | `teardown.py` | `uv run python teardown.py` |
| Replica state and vLLM logs | `logs.py` | `uv run python logs.py` |
| One timestamped cost line | `status.py` | `uv run python status.py` |
| Recording folder from a raw glove capture, with key pose sketches | `recording.py` | `recording_from_capture(capture, out_dir, side, marks)` |
| Lesson from a recording: pictures plus glove trace summary in, backend `Lesson` JSON out | `gemma_client.py` | `lesson_from_recording(folder)` or `uv run python gemma_client.py out/recordings/worn-solver-right` |
| OpenAI-compatible provider shaped for the backend's `LLMClient` protocol | `openai_compat.py` | imported by `compare.py`; patch below |
| Three-way comparison and report | `compare.py` | `uv run python compare.py` |
| Offline tests (18) | `tests/` | `uv run pytest -q` |

Decisions taken without asking:

- Model `google/gemma-4-31B-it`: the largest multimodal Gemma, Apache 2.0, ungated; 62.5 GB bf16 fits one 80 GB GPU.
- Verda product: Serverless Containers through the `verda` Python SDK (REST under the hood), image `vllm/vllm-openai:v0.29.0` as Verda's tutorial recommends.
- GPU: H200 first, H100 second (`pick_gpu` falls back when none is free). First run landed on an H100 and crash-looped: 32768 tokens of KV cache do not fit beside 59 GiB of weights. Context is now 12288 tokens (prompts stay under 9k).
- Output format: vLLM structured outputs with the backend's `LessonBase` JSON schema; on a 400 the client retries with plain JSON mode and validates itself.
- The "video frames" for a glove-only recording are the core recorder's key pose sketches (`frames/step_XX.jpg`). Camera frames or a video file, when present, are used instead (`recording.video_frames`).
- Secrets: the HF token (optional, Gemma 4 is ungated) is stored as a Verda secret named `geppetto-hf-token` and injected as `HF_TOKEN`.
- Scaling for the hackathon: one replica, no scale to zero, torn down between sessions. `--min-replicas 0` turns on scale to zero.

## Written but untested

| Item | Why | How to test |
| --- | --- | --- |
| `recording.video_frames` | No camera video in the repo | Give `lesson_from_recording` a folder whose `frames/` holds camera stills, or call `video_frames` on an mp4 |
| `deploy.py --min-replicas 0` (scale to zero) | Not needed during the lane; would add a cold start to every call | Deploy with it, wait for scale-down, time the first call |
| `deploy.py --spot` | Not tried | Deploy with it and watch for preemption |
| The `HF_TOKEN` secret path | Gemma 4 is ungated, so the download never needed it | Nothing to do unless a gated model is served |

## Backend patch: point the backend's model client at an OpenAI-compatible URL

The backend cannot do this by configuration today. `LLM_PROVIDER` accepts `fake`, `gemini` and `ollama`; the
Ollama client speaks Ollama's `/api/chat` with its `format` field, which vLLM does not serve. The patch below adds a
fourth provider. `openai_compat.py` is written to be copied unchanged.

1. Copy `verda/openai_compat.py` to `backend/app/services/llm/openai_compat.py`.
2. `backend/app/core/config.py`, in `Settings`:

```python
    openai_base_url: str = "http://localhost:8000"
    openai_api_key: str | None = None
    openai_model: str = c.DEFAULT_OPENAI_MODEL
    llm_provider: Literal["fake", "gemini", "ollama", "openai"] = "fake"
```

3. `backend/app/constants.py`:

```python
DEFAULT_OPENAI_MODEL = "google/gemma-4-31B-it"
```

4. `backend/app/services/llm/registry.py`, in `_build`, before the `return FakeLLM()` line:

```python
        if name == "openai":
            return OpenAICompatLLM(self._settings.openai_base_url, self._settings.openai_api_key, self._settings.openai_model)
```

   with `from app.services.llm.openai_compat import OpenAICompatLLM` among the imports.

5. `backend/.env.example`: add `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` (names only).
6. Run with `LLM_PROVIDER=openai OPENAI_BASE_URL=https://containers.verda.com/geppetto-gemma OPENAI_API_KEY=<the Verda inference key> OPENAI_MODEL=google/gemma-4-31B-it`.

`test_openai_compat.py::test_backend_lesson_generator_runs_on_the_provider` already proves the backend's
`LessonGenerator` runs on the provider unchanged. The frontend's `/dev` panel names providers; `openai` would
show there as is. The user-facing copy still says "the AI Assistant", so nothing else changes.

Optional, for pictures through the backend: add `image_paths: list[str] | None = None` to `LLMRequest` and let
`OpenAICompatLLM._chat` put them in the user turn as `image_url` parts before the text, the way
`gemma_client.build_messages` does. Not needed for the comparison.

## What a human must do next

1. Check the Verda console balance against the running cost line in `docs/VERDA.md` and `~/geppetto-progress/verda.log`.
2. Before the demo video and the Sunday review: `cd verda && ./warm_up.sh`, wait for "healthy", run the demo, then `uv run python teardown.py`. Budget about 15 minutes of start-up.
3. Decide whether to apply the backend patch above (one owner for lessons stays `backend/`; this only adds a provider).
4. If the fine-tune lane produces a model, serve it with `deploy.py --model <hf id>`; nothing else changes.
