"""Run the same recordings through three lesson paths and write a side-by-side report.

    uv run python compare.py [--recordings out/recordings/worn-solver-right ...] [--text "..."] [--skip-gemini]

Paths:
  A  gemma-pictures   Gemma 4 on Verda; the step pictures plus the glove trace summary (gemma_client.generate_lesson).
  B  gemma-text       Gemma 4 on Verda through the backend's own LessonGenerator with OpenAICompatLLM; text only.
  C  gemini-text      Gemini through the backend's LessonGenerator: the existing path, text only.

B and C receive the identical text: the request plus the glove trace summary, as the "master request". A adds the
pictures. Every run is written to out/compare/<recording>-<path>.json; out/compare/summary.md holds the table.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import paths

paths.add_repo_paths()

import gemma_client as G
import recording as R
from app.core.config import Settings
from app.services.llm.lesson_generator import LessonGenerator
from app.services.llm.registry import LLMState
from app.services.moves import MoveCatalog
from openai_compat import OpenAICompatLLM

COMPARE_DIR = paths.OUT / "compare"
GEMINI_STATE_DIR = paths.OUT / "gemini_state"
DEFAULT_TEXT = "Teach the hand skill shown in this recording."
PATHS = ("gemma-pictures", "gemma-text", "gemini-text")


def text_for_backend(rec: R.Recording, text: str) -> str:
    """What the text-only paths get as the master request: the request and the glove trace summary."""
    return f"{text}\n\nRECORDED DEMONSTRATION (measured by the gloves):\n{R.trace_summary(rec)}"


async def run_backend(
    generator: LessonGenerator, text: str, skill: str | None
) -> dict[str, Any]:
    """One LessonGenerator.generate call, timed, as a plain record. All calls share one event loop: the Gemini
    client keeps its connections bound to the loop that made them."""
    t0 = time.monotonic()
    response = await generator.generate(text, skill)
    return {
        "lesson": response.lesson.model_dump(),
        "provider": response.provider,
        "attempts": response.attempts,
        "latency_s": round(time.monotonic() - t0, 2),
    }


def digest(lesson: dict[str, Any]) -> dict[str, Any]:
    """The few things worth comparing by eye."""
    steps = lesson.get("steps", [])
    return {
        "title": lesson.get("title"),
        "skill": lesson.get("skill"),
        "steps": len(steps),
        "step_titles": [s.get("title") for s in steps],
        "move_ids": [s.get("move_id") for s in steps],
        "presets": [(s.get("motion") or {}).get("preset") for s in steps],
    }


def summary_table(records: list[dict[str, Any]]) -> str:
    lines = [
        "| Recording | Path | Provider | Model | Attempts | Latency s | Steps | Title | Move ids |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in records:
        d = r["digest"]
        lines.append(
            f"| {r['recording']} | {r['path']} | {r['provider']} | {r.get('model', '')} | {r['attempts']} | {r['latency_s']:.1f} | "
            f"{d['steps']} | {d['title']} | {', '.join(str(m) for m in d['move_ids'])} |"
        )
    return "\n".join(lines)


def steps_text(records: list[dict[str, Any]]) -> str:
    out = []
    for r in records:
        out.append(f"### {r['recording']}: {r['path']} ({r['provider']})\n")
        for s in r["lesson"].get("steps", []):
            out.append(
                f"- {s.get('title')}: {s.get('instruction')} [move {s.get('move_id')}, hands {s.get('hands')}]"
            )
        out.append("")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(amain(argv))


async def amain(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--recordings",
        nargs="*",
        default=None,
        help="lesson folders; default: every folder in out/recordings",
    )
    ap.add_argument("--text", default=DEFAULT_TEXT)
    ap.add_argument("--skill", default=None)
    ap.add_argument("--skip-gemini", action="store_true")
    ap.add_argument(
        "--skip-gemma",
        action="store_true",
        help="only the Gemini path (no endpoint needed)",
    )
    ap.add_argument("--max-frames", type=int, default=R.DEFAULT_MAX_FRAMES)
    a = ap.parse_args(argv)

    folders = (
        [Path(p) for p in a.recordings]
        if a.recordings
        else sorted(p for p in (paths.OUT / "recordings").iterdir() if p.is_dir())
    )
    secrets = paths.load_secrets()
    COMPARE_DIR.mkdir(parents=True, exist_ok=True)
    moves = MoveCatalog()

    gemma_endpoint = None
    gemma_backend = None
    if not a.skip_gemma:
        gemma_endpoint = G.Endpoint.from_env(secrets)
        state = LLMState(Settings(llm_provider="fake", data_dir=GEMINI_STATE_DIR))
        state.use(
            OpenAICompatLLM(
                gemma_endpoint.base_url, gemma_endpoint.api_key, gemma_endpoint.model
            )
        )
        gemma_backend = LessonGenerator(state, moves)
    gemini_backend = None
    if not a.skip_gemini:
        paths.require(secrets, "GEMINI_API_KEY")
        settings = Settings(
            llm_provider="gemini",
            gemini_api_key=secrets["GEMINI_API_KEY"],
            data_dir=GEMINI_STATE_DIR,
        )
        gemini_backend = LessonGenerator(LLMState(settings), moves)
        gemini_model = settings.gemini_model

    records: list[dict[str, Any]] = []
    for folder in folders:
        rec = R.load_recording(folder)
        text = text_for_backend(rec, a.text)
        runs: list[tuple[str, dict[str, Any]]] = []
        if gemma_endpoint is not None and gemma_backend is not None:
            try:
                result = G.generate_lesson(
                    folder,
                    a.text,
                    a.skill,
                    endpoint=gemma_endpoint,
                    max_frames=a.max_frames,
                )
                runs.append(
                    ("gemma-pictures", {"lesson": result.lesson, **result.stats()})
                )
            except Exception as exc:  # noqa: BLE001 - the report must show failures too
                runs.append(
                    (
                        "gemma-pictures",
                        {
                            "lesson": {},
                            "provider": "failed",
                            "model": gemma_endpoint.model,
                            "attempts": 0,
                            "latency_s": 0.0,
                            "error": f"{type(exc).__name__}: {exc}"[:500],
                        },
                    )
                )
            runs.append(
                (
                    "gemma-text",
                    {
                        **await run_backend(gemma_backend, text, a.skill),
                        "model": gemma_endpoint.model,
                    },
                )
            )
        if gemini_backend is not None:
            runs.append(
                (
                    "gemini-text",
                    {
                        **await run_backend(gemini_backend, text, a.skill),
                        "model": gemini_model,
                    },
                )
            )
        for name, data in runs:
            record = {
                "recording": folder.name,
                "path": name,
                "t": datetime.now(UTC).replace(microsecond=0).isoformat(),
                "input_text": text,
                **data,
            }
            record["digest"] = digest(record["lesson"])
            (COMPARE_DIR / f"{folder.name}-{name}.json").write_text(
                json.dumps(record, indent=2) + "\n", encoding="utf-8"
            )
            records.append(record)
            print(
                f"{folder.name:24s} {name:15s} {record['provider']:12s} {record['attempts']} attempt(s) {record['latency_s']:6.1f} s  {record['digest']['steps']} steps  {record['digest']['title']}"
            )

    report = [
        "# Gemma on Verda against Gemini: the same recordings, three paths",
        "",
        f"Written {datetime.now(UTC).astimezone().strftime('%Y-%m-%d %H:%M %Z')} by verda/compare.py.",
        "",
        "A `gemma-pictures` run sends the step sketches and the glove trace summary to Gemma 4 on Verda. A `gemma-text` run",
        "sends the same summary, text only, through the backend's own LessonGenerator with the OpenAI-compatible provider.",
        "A `gemini-text` run is the backend's existing Gemini path on that same text.",
        "",
        summary_table(records),
        "",
        "## Steps each path wrote",
        "",
        steps_text(records),
    ]
    (COMPARE_DIR / "summary.md").write_text("\n".join(report), encoding="utf-8")
    print(f"\nwrote {COMPARE_DIR / 'summary.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
