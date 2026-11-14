"""Write every stored take and lesson as a local core lesson folder, once, and print what changed.

Run from backend/:  uv run python scripts/core_export_sync.py

The running backend does the same on its own (at start-up, after every take or lesson save, and every 30 s), so this
is only needed when the backend is not running. Folders land in <DATA_DIR>/core_lessons (or CORE_EXPORT_DIR); the manifest is
<that folder>/manifest.json. Nothing is sent anywhere. Arpan's local tools read the folders (coach_tune, weights), and
scripts/verda_lesson.py puts one into a request to the model hosted on Verda.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import Settings  # noqa: E402
from app.services.core_export import CoreLessonExporter  # noqa: E402


def main() -> int:
    """One sync with the backend's own settings."""
    settings = Settings()
    exporter = CoreLessonExporter(settings.data_dir, settings.core_export_dir, enabled=True)
    report = exporter.sync()
    if not report.available:
        print("The core could not be imported from the repo root, so nothing was exported.")
        return 1
    print(f"Export folder: {exporter.out_dir}")
    print(f"Written: {len(report.exported)}  unchanged: {report.unchanged}  skipped: {len(report.skipped)}  "
          f"removed: {len(report.removed)}  failed: {len(report.failed)}")
    for label, items in (("written", report.exported), ("skipped", report.skipped), ("removed", report.removed),
                         ("failed", report.failed)):
        for item in items:
            print(f"  {label}: {item}")
    print(f"Manifest: {exporter.manifest_path}")
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
