"""Settings for the decisions lane. Knobs are environment variables; the key comes from the shared .env.

Nothing in this module prints or logs a secret. Key discovery order:

1. ``GEMINI_API_KEY`` already in the process environment.
2. The file named by ``GEPPETTO_ENV_FILE``.
3. A ``.env`` found by walking up from the repo root. A worktree under
   ``.claude/worktrees/<lane>`` therefore finds the main checkout's ``.env``.

Other knobs: ``DECISIONS_BUDGET_MS`` (default 600), ``DECISIONS_DISABLED=1``
(rules only, no network), ``DECISIONS_LOG`` (default ``logs/decisions.jsonl``),
``DECISIONS_WARMUP=0`` (skip the background connection warm-up).
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

MODEL = "gemini-decision-1"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/decisions"
DEFAULT_BUDGET_MS = 600
KEY_NAMES = ("GEMINI_API_KEY",)
ENV_FILE_VAR = "GEPPETTO_ENV_FILE"

ACTIONS = ("repeat", "slow_down", "isolate_finger", "show_keyframe", "move_on")
FINGERS = ("thumb", "index", "middle", "ring", "little")

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE_DIR.parent


def env_flag(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v.strip().lower() not in ("0", "false", "no", "off")


def budget_ms() -> int:
    try:
        return max(50, int(os.environ.get("DECISIONS_BUDGET_MS", DEFAULT_BUDGET_MS)))
    except ValueError:
        return DEFAULT_BUDGET_MS


def disabled() -> bool:
    return env_flag("DECISIONS_DISABLED", False)


def log_path() -> Path:
    p = os.environ.get("DECISIONS_LOG")
    return Path(p) if p else REPO_ROOT / "logs" / "decisions.jsonl"


def parse_env_file(path: Path) -> dict[str, str]:
    """Minimal .env reader: KEY=VALUE lines, optional ``export``, quotes stripped, comments ignored."""
    out: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return out
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        if k:
            out[k] = v
    return out


def find_env_file(start: Path | None = None) -> Path | None:
    named = os.environ.get(ENV_FILE_VAR)
    if named:
        return Path(named) if Path(named).is_file() else None
    here = (start or REPO_ROOT).resolve()
    for d in [here, *here.parents]:
        cand = d / ".env"
        if cand.is_file():
            return cand
    return None


def load_api_key() -> str | None:
    """The Gemini key, or None. Never logged, never printed."""
    for name in KEY_NAMES:
        v = os.environ.get(name)
        if v:
            return v.strip()
    f = find_env_file()
    if f is None:
        return None
    values = parse_env_file(f)
    for name in KEY_NAMES:
        v = values.get(name)
        if v:
            return v.strip()
    return None


# Rule thresholds mirror the core's config.toml [score] section, read once, read-only.
_DEFAULT_SCORE = {
    "pass_score": 0.85,
    "timing_hint_ms": 150.0,
    "stuck_s": 5.0,
    "wrong_deg": 45.0,
    "perfect_deg": 8.0,
}


def score_thresholds(config_path: Path | None = None) -> dict[str, float]:
    p = config_path or (REPO_ROOT / "config.toml")
    out = dict(_DEFAULT_SCORE)
    try:
        with open(p, "rb") as f:
            data = tomllib.load(f)
        score = data.get("score", {})
        for k in out:
            if k in score:
                out[k] = float(score[k])
    except (OSError, tomllib.TOMLDecodeError, TypeError, ValueError):
        pass
    return out
