"""Send one recorded take or lesson to Gemma on Verda and get a lesson back (Arpan's verda/gemma_client.py).

Run from backend/:
    uv run python scripts/verda_lesson.py TAKE_OR_LESSON_ID [--side right] [--text "..."] [--skill general]
                                          [--dry-run] [--save] [--out lesson.json]

The id is a take id (backend/data/recordings/<id>.json) or a lesson id (backend/data/lessons/<id>.json). The script
syncs the core lesson export first, picks the exported core lesson folder (data/core_lessons/takes/<id>-<side> or
data/core_lessons/lessons/<id>), and hands it to verda/gemma_client.py: the key pose sketches go as pictures and the glove
trace summary as text, to the vLLM server's /v1/chat/completions; the answer is validated as a backend Lesson.

--dry-run prints what the model would get (the trace summary and the picture names) and calls nothing.
--save stores the generated lesson in data/lessons, so it shows in the app (source "generated").

Endpoint and key: the backend's own settings (backend/.env or the environment), OPENAI_BASE_URL or VERDA_GEMMA_URL,
OPENAI_API_KEY or VERDA_INFERENCE_KEY, OPENAI_MODEL or VERDA_GEMMA_MODEL. With no base URL set it falls back to
base_url in verda/out/endpoint.json (written by verda/deploy.py). The key is never printed.
The deployment must be up (verda/deploy.py or verda/warm_up.sh); it is billed per hour while it runs.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import constants as c  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.core.utils import new_id, utc_now_iso  # noqa: E402
from app.schemas.lesson import Lesson  # noqa: E402
from app.services.llm.registry import UNSET_OPENAI_URL  # noqa: E402
from app.services.storage.json_store import JsonStore  # noqa: E402
from app.services.core_export import CoreLessonExporter  # noqa: E402

ENDPOINT_FILE = c.VERDA_LANE_DIR / "out" / "endpoint.json"


def gemma_client():
    """Arpan's client module from verda/, imported read only."""
    lane = str(c.VERDA_LANE_DIR)
    if not (c.VERDA_LANE_DIR / "gemma_client.py").exists():
        raise SystemExit(f"verda/gemma_client.py not found under {lane}")
    if lane not in sys.path:
        sys.path.insert(0, lane)
    import gemma_client as G

    return G


def endpoint_settings(settings: Settings) -> tuple[str, str | None, str]:
    """Base URL, key and model from the backend settings, the base URL falling back to verda/out/endpoint.json."""
    base = settings.openai_base_url.rstrip("/")
    model = settings.openai_model
    if "openai_base_url" not in settings.model_fields_set or not base or base == UNSET_OPENAI_URL:
        base = ""
        if ENDPOINT_FILE.exists():
            info = json.loads(ENDPOINT_FILE.read_text(encoding="utf-8"))
            base = str(info.get("base_url") or "").rstrip("/")
            if "openai_model" not in settings.model_fields_set:
                model = str(info.get("model") or model)
    return base, settings.openai_api_key, model


def pick_folder(exporter: CoreLessonExporter, item_id: str, side: str | None) -> Path:
    """The exported folder for a take (one per hand) or a lesson."""
    folders = exporter.folders_for(item_id)
    if side:
        folders = [f for f in folders if f.name.endswith(f"-{side}")]
    elif len(folders) > 1:
        folders = [f for f in folders if f.name.endswith("-right")] or folders
    if not folders:
        entry = next((e for e in exporter.manifest()["entries"] if e["id"] == item_id), None)
        why = (entry.get("reason") or f"no {side} hand") if entry else "no take or lesson with that id"
        raise SystemExit(f"nothing exported for {item_id}: {why}")
    return folders[0]


def main(argv: list[str] | None = None) -> int:
    """Pick the folder, then dry-run or call Gemma on Verda."""
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("id", help="a take id or a lesson id")
    ap.add_argument("--side", choices=c.SIDES, default=None, help="for a two-hand take; default right")
    ap.add_argument("--text", default="", help="the expert's request to the model")
    ap.add_argument("--skill", default=None)
    ap.add_argument("--dry-run", action="store_true", help="print what the model would get; call nothing")
    ap.add_argument("--save", action="store_true", help="store the generated lesson in data/lessons")
    ap.add_argument("--out", default=None, help="also write the lesson JSON here")
    a = ap.parse_args(argv)

    settings = Settings()
    exporter = CoreLessonExporter(settings.data_dir, settings.core_export_dir, enabled=True)
    if not exporter.sync().available:
        raise SystemExit("the core could not be imported from the repo root, so the take cannot be exported")
    folder = pick_folder(exporter, a.id, a.side)
    G = gemma_client()
    print(f"Recording folder: {folder}", file=sys.stderr)
    if a.dry_run:
        import recording as R

        rec = R.load_recording(folder)
        print(R.trace_summary(rec))
        print("Pictures: " + (", ".join(p.name for p in R.pick_frames(rec)) or "none"))
        return 0

    base, key, model = endpoint_settings(settings)
    if not base:
        raise SystemExit("no Verda endpoint: set VERDA_GEMMA_URL (or OPENAI_BASE_URL) in backend/.env, or run verda/deploy.py")
    if not key:
        raise SystemExit("no Verda key: set VERDA_INFERENCE_KEY (or OPENAI_API_KEY) in backend/.env")
    endpoint = G.Endpoint(base_url=base, api_key=key, model=model)
    result = G.generate_lesson(folder, a.text, a.skill, endpoint=endpoint)
    text = json.dumps(result.lesson, indent=2)
    print(text)
    print(json.dumps(result.stats()), file=sys.stderr)
    if a.out:
        Path(a.out).write_text(text + "\n", encoding="utf-8")
    if a.save:
        body = {k: v for k, v in result.lesson.items() if k not in ("id", "created_at")}
        lesson = Lesson(**body, id=new_id(), created_at=utc_now_iso())
        JsonStore(settings.data_dir / "lessons", Lesson).save(lesson)
        print(f"Saved as lesson {lesson.id}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
