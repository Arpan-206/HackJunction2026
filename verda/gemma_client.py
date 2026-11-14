"""Gemma 4 on Verda through vLLM's OpenAI-compatible API: a recorded demonstration in, the backend's lesson JSON out.

    uv run python gemma_client.py out/recordings/worn_solver-right [--text "..."] [--skill general] [--out lesson.json]

`lesson_from_recording()` sends the step sketches (or camera frames) and the glove trace summary of a recording to the
model with the backend's own system prompt, move catalogue and JSON schema, validates the answer with the backend's
`LessonBase` model and finalises it the way `LessonGenerator` does. The result is a `Lesson` as `POST /lessons/generate`
returns it (docs/CONTRACT.md).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError

import paths

paths.add_repo_paths()

import recording as R  # noqa: E402
from app import constants as c  # noqa: E402
from app.core.utils import new_id, utc_now_iso  # noqa: E402
from app.schemas.common import Skill  # noqa: E402
from app.schemas.lesson import Lesson, LessonBase  # noqa: E402
from app.services.llm.lesson_generator import SYSTEM_PROMPT  # noqa: E402
from app.services.llm.schema import llm_schema  # noqa: E402
from app.services.moves import MoveCatalog  # noqa: E402

DEFAULT_MODEL = "google/gemma-4-31B-it"
ENDPOINT_FILE = paths.OUT / "endpoint.json"
CHAT_PATH = "/v1/chat/completions"
MODELS_PATH = "/v1/models"
HEALTH_PATH = "/health"
DEFAULT_TIMEOUT_S = 240.0
MAX_TOKENS = 2048
PROVIDER = "verda-gemma"
RECORDING_PROMPT = """RECORDED DEMONSTRATION (measured by the gloves):
{summary}

The pictures before this text are the key pose of each step, in step order: a sketch of the hand's joints seen from the
front (left half) and from above (right half). Read them together with the numbers to name what the hand is doing.

Write the lesson so a learner can copy this demonstration step by step. Name each step after what the hand does, keep
the step order of the recording, and pick the catalogue move whose pose is closest to each step."""

ChatFn = Callable[[list[dict[str, Any]], dict[str, Any] | None], "ChatResult"]


class LessonGenerationError(RuntimeError):
    """The model never produced a lesson that validates."""


@dataclass
class ChatResult:
    """One chat completion: the text, what it cost and how long it took."""

    text: str
    usage: dict[str, int] = field(default_factory=dict)
    latency_s: float = 0.0
    schema_mode: str = "json_schema"


@dataclass
class Endpoint:
    """A vLLM server behind Verda's container gateway."""

    base_url: str
    api_key: str
    model: str = DEFAULT_MODEL
    timeout_s: float = DEFAULT_TIMEOUT_S
    transport: httpx.BaseTransport | None = None

    @classmethod
    def from_env(cls, secrets: dict[str, str] | None = None) -> Endpoint:
        """Base URL and model from VERDA_GEMMA_URL / VERDA_GEMMA_MODEL, else from out/endpoint.json (written by deploy.py)."""
        secrets = secrets if secrets is not None else paths.load_secrets()
        info: dict[str, Any] = {}
        if ENDPOINT_FILE.exists():
            info = json.loads(ENDPOINT_FILE.read_text(encoding="utf-8"))
        base_url = secrets.get("VERDA_GEMMA_URL") or info.get("base_url")
        if not base_url:
            raise SystemExit("no endpoint: run deploy.py first, or set VERDA_GEMMA_URL")
        paths.require(secrets, "VERDA_INFERENCE_KEY")
        model = secrets.get("VERDA_GEMMA_MODEL") or info.get("model") or DEFAULT_MODEL
        return cls(base_url=base_url.rstrip("/"), api_key=secrets["VERDA_INFERENCE_KEY"], model=model)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=self.timeout_s, transport=self.transport, headers=self._headers())

    def health(self) -> bool:
        """True when vLLM answers its health check through the gateway."""
        with self._client() as client:
            try:
                return client.get(self.base_url + HEALTH_PATH).status_code == 200
            except httpx.HTTPError:
                return False

    def models(self) -> list[str]:
        """The model ids the server serves."""
        with self._client() as client:
            r = client.get(self.base_url + MODELS_PATH)
            r.raise_for_status()
            return [m["id"] for m in r.json().get("data", [])]

    def chat(
        self,
        messages: list[dict[str, Any]],
        schema: dict[str, Any] | None = None,
        temperature: float = c.LLM_TEMPERATURE,
        max_tokens: int = MAX_TOKENS,
    ) -> ChatResult:
        """One chat completion. With a schema the server constrains the output to it (vLLM structured outputs).

        If the server rejects the schema (HTTP 400, an unsupported JSON Schema feature) the call is repeated asking for
        any JSON object; the caller validates either way.
        """
        body: dict[str, Any] = {"model": self.model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        mode = "none"
        if schema is not None:
            body["response_format"] = {"type": "json_schema", "json_schema": {"name": "lesson", "schema": schema}}
            mode = "json_schema"
        started = time.monotonic()
        with self._client() as client:
            r = client.post(self.base_url + CHAT_PATH, json=body)
            if r.status_code == 400 and schema is not None:
                body["response_format"] = {"type": "json_object"}
                mode = "json_object"
                r = client.post(self.base_url + CHAT_PATH, json=body)
            r.raise_for_status()
        data = r.json()
        text = data["choices"][0]["message"].get("content") or ""
        return ChatResult(text=text, usage=data.get("usage") or {}, latency_s=time.monotonic() - started, schema_mode=mode)


def catalogue_text(moves: MoveCatalog, skill: Skill | None) -> str:
    """The move list exactly as the backend's lesson generator writes it."""
    return "\n".join(f"- {m.id}: {m.name} ({m.skill}, motion preset {m.default_motion.preset})" for m in moves.list(skill))


def build_messages(
    rec: R.Recording,
    text: str,
    skill: Skill | None,
    moves: MoveCatalog,
    frames: list[Path],
    errors: str | None = None,
) -> list[dict[str, Any]]:
    """System prompt from the backend; user turn = pictures first, then the request, the trace summary and the catalogue."""
    parts = [
        f"MASTER REQUEST:\n{text.strip() or c.VIDEO_DEFAULT_PROMPT}",
        RECORDING_PROMPT.format(summary=R.trace_summary(rec)),
        f"MOVE CATALOGUE:\n{catalogue_text(moves, skill)}",
    ]
    if errors:
        parts.append(f"YOUR PREVIOUS ANSWER FAILED VALIDATION. Fix these errors and answer again:\n{errors}")
    content: list[dict[str, Any]] = [{"type": "image_url", "image_url": {"url": R.image_data_url(p)}} for p in frames]
    content.append({"type": "text", "text": "\n\n".join(parts)})
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": content}]


def recorded_hand(rec: R.Recording) -> str | None:
    """The hand the gloves measured ("left" or "right"), or None when the recording does not say."""
    hand = (rec.lesson.get("master") or {}).get("hand")
    return hand if hand in ("left", "right") else None


def finalise(draft: LessonBase, moves: MoveCatalog, hand: str | None = None) -> Lesson:
    """What the backend's LessonGenerator does: mark generated, drop unknown move ids, assign server fields.

    `hand` is the hand the gloves measured. The gloves are the ground truth for which hand moved, so a one-hand
    recording sets `hands` on every step (Gemma 4 wrote "right" for a left-hand take on 14 Nov; Gemini did not).
    """
    def fix(s):
        update: dict[str, Any] = {"move_id": s.move_id if s.move_id and moves.get(s.move_id) else None}
        if hand:
            update["hands"] = hand
        return s.model_copy(update=update)

    steps = [fix(s) for s in draft.steps]
    data = draft.model_copy(update={"source": "generated", "steps": steps}).model_dump()
    return Lesson(**data, id=new_id(), created_at=utc_now_iso())


@dataclass
class LessonResult:
    """A finished lesson plus what it took to get it."""

    lesson: dict[str, Any]
    provider: str
    model: str
    attempts: int
    latency_s: float
    usage: dict[str, int]
    schema_mode: str
    frames: list[str]
    prompt_chars: int
    errors: list[str] = field(default_factory=list)

    def stats(self) -> dict[str, Any]:
        """Everything but the lesson, for tables."""
        return {k: v for k, v in self.__dict__.items() if k != "lesson"}


def generate_lesson(
    recording_dir: str | Path,
    text: str = "",
    skill: Skill | None = None,
    *,
    endpoint: Endpoint | None = None,
    chat: ChatFn | None = None,
    frames: list[Path] | None = None,
    max_frames: int = R.DEFAULT_MAX_FRAMES,
    max_retries: int = c.LLM_MAX_RETRIES,
) -> LessonResult:
    """Prompt, validate, retry with the validation errors, like the backend; raise if nothing validates."""
    rec = R.load_recording(recording_dir)
    moves = MoveCatalog()
    pictures = frames if frames is not None else R.pick_frames(rec, max_frames)
    if chat is None:
        endpoint = endpoint or Endpoint.from_env()
        chat = endpoint.chat
    schema = llm_schema(LessonBase)
    errors: str | None = None
    history: list[str] = []
    usage: dict[str, int] = {}
    latency = 0.0
    prompt_chars = 0
    mode = "json_schema"
    attempts = 0
    for _ in range(1 + max_retries):
        attempts += 1
        messages = build_messages(rec, text, skill, moves, pictures, errors)
        prompt_chars = len(messages[-1]["content"][-1]["text"])
        result = chat(messages, schema)
        latency += result.latency_s
        mode = result.schema_mode
        for k, v in (result.usage or {}).items():
            if isinstance(v, int):
                usage[k] = usage.get(k, 0) + v
        try:
            draft = LessonBase.model_validate_json(result.text)
        except ValidationError as exc:
            errors = str(exc)
            history.append(errors)
            continue
        lesson = finalise(draft, moves, recorded_hand(rec))
        return LessonResult(
            lesson=lesson.model_dump(),
            provider=PROVIDER,
            model=endpoint.model if endpoint else "injected",
            attempts=attempts,
            latency_s=latency,
            usage=usage,
            schema_mode=mode,
            frames=[p.name for p in pictures],
            prompt_chars=prompt_chars,
            errors=history,
        )
    raise LessonGenerationError(f"no valid lesson after {attempts} attempts; last errors:\n{errors}")


def lesson_from_recording(recording_dir: str | Path, text: str = "", skill: Skill | None = None, **kwargs: Any) -> dict[str, Any]:
    """The lesson JSON the backend already uses (a `Lesson`, as `POST /lessons/generate` returns it)."""
    return generate_lesson(recording_dir, text, skill, **kwargs).lesson


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("recording", help="a lesson folder: lesson.json, frames/, trace.npz")
    ap.add_argument("--text", default="", help="the expert's request; default: " + c.VIDEO_DEFAULT_PROMPT)
    ap.add_argument("--skill", default=None, choices=["table_tennis", "piano", "shadow_puppets", "surgical_grips", "crochet", "general"])
    ap.add_argument("--max-frames", type=int, default=R.DEFAULT_MAX_FRAMES)
    ap.add_argument("--out", default=None, help="write the lesson JSON here")
    a = ap.parse_args(argv)
    result = generate_lesson(a.recording, a.text, a.skill, max_frames=a.max_frames)
    text = json.dumps(result.lesson, indent=2)
    if a.out:
        Path(a.out).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    print(json.dumps(result.stats()), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
