"""Download the MediaPipe hand landmarker model into models/. Network needed once.

python -m tools.fetch_models
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.camera import MODEL_URL

if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "models" / "hand_landmarker.task"
    out.parent.mkdir(exist_ok=True)
    if out.exists():
        print(f"already there: {out} ({out.stat().st_size} bytes)")
        sys.exit(0)
    print(f"downloading {MODEL_URL} -> {out}")
    urllib.request.urlretrieve(MODEL_URL, out)
    print(f"done: {out.stat().st_size} bytes")
