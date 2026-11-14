"""Where the repo, the backend and the secrets live. Import this first in every verda script.

The lane runs inside the Geppetto checkout. It reads the core (`core/`, `tools/`) and the backend (`backend/app`)
read-only, and it loads secrets from the shared `.env` without ever printing them.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import dotenv_values

LANE = Path(__file__).resolve().parent
ROOT = LANE.parent
BACKEND = ROOT / "backend"
OUT = LANE / "out"
SECRET_PREFIXES = ("VERDA_", "HF_", "GEMINI", "HUGGING_FACE_")


def main_checkout() -> Path:
    """The main checkout of this repo. In a git worktree `.git` is a file that points into the main `.git` dir."""
    dot_git = ROOT / ".git"
    if dot_git.is_file():
        line = dot_git.read_text(encoding="utf-8").strip()
        if line.startswith("gitdir:"):
            gitdir = Path(line.split(":", 1)[1].strip())
            # <main>/.git/worktrees/<name> -> <main>
            if (
                gitdir.parent.name == "worktrees"
                and gitdir.parent.parent.name == ".git"
            ):
                return gitdir.parent.parent.parent
    return ROOT


def env_file() -> Path | None:
    """The first `.env` that exists: $GEPPETTO_ENV_FILE, this checkout, then the main checkout."""
    candidates = [
        os.environ.get("GEPPETTO_ENV_FILE"),
        ROOT / ".env",
        main_checkout() / ".env",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    return None


def load_secrets() -> dict[str, str]:
    """Secrets from the shared `.env`, overridden by real environment variables. Never print the values."""
    values: dict[str, str] = {}
    path = env_file()
    if path is not None:
        values.update({k: v for k, v in dotenv_values(path).items() if v})
    values.update(
        {k: v for k, v in os.environ.items() if k.startswith(SECRET_PREFIXES)}
    )
    # The Gemini key carried a misspelt name for a while; accept both.
    if not values.get("GEMINI_API_KEY") and values.get("GEMINII_API_KEY"):
        values["GEMINI_API_KEY"] = values["GEMINII_API_KEY"]
    return values


def require(secrets: dict[str, str], *names: str) -> None:
    """Fail early, naming the missing variable but never its value."""
    missing = [n for n in names if not secrets.get(n)]
    if missing:
        raise SystemExit(f"missing in .env or the environment: {', '.join(missing)}")


def add_repo_paths() -> None:
    """Make `core`, `tools` and the backend's `app` importable."""
    for p in (ROOT, BACKEND):
        s = str(p)
        if s not in sys.path:
            sys.path.insert(0, s)


CAPTURE_FIXTURE = ROOT / "backend/tests/fixtures/rgmp/worn_solver.rgmp.gz"
