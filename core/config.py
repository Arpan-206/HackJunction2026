"""Load config.toml into attribute-accessible sections. Every threshold lives there."""
from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = REPO_ROOT / "config.toml"


class Section(dict):
    """A dict whose keys are also attributes. Nested dicts become Sections."""

    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as e:
            raise AttributeError(f"config has no key {name!r} (available: {sorted(self.keys())})") from e

    def __setattr__(self, name: str, value: Any) -> None:
        self[name] = value

    def get_path(self, dotted: str, default: Any = None) -> Any:
        node: Any = self
        for part in dotted.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node


def _wrap(obj: Any) -> Any:
    if isinstance(obj, dict):
        return Section({k: _wrap(v) for k, v in obj.items()})
    if isinstance(obj, list):
        return [_wrap(v) for v in obj]
    return obj


def load_config(path: str | Path | None = None) -> Section:
    p = Path(path) if path else DEFAULT_CONFIG_PATH
    with open(p, "rb") as f:
        data = tomllib.load(f)
    cfg = _wrap(data)
    cfg["_path"] = str(p)
    cfg["_root"] = str(p.resolve().parent)
    return cfg


def config_from_dict(data: dict) -> Section:
    return _wrap(data)
