"""The verda lane's modules live one level up; the core and backend paths come from `paths`."""

import sys
from pathlib import Path

LANE = Path(__file__).resolve().parent.parent
if str(LANE) not in sys.path:
    sys.path.insert(0, str(LANE))

import paths

paths.add_repo_paths()
