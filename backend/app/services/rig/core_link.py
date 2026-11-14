"""Imports the core's RCSP client and RGMP parser (repo root `core/`) instead of copying them.

The core is the teammate's glove pipeline; the backend reuses its protocol code read-only. The repo root is appended
(not prepended) to sys.path so nothing of the backend's own is shadowed.
"""

import importlib
import logging
import sys
from types import ModuleType

from app import constants as c

log = logging.getLogger(__name__)


def _core_module(name: str) -> ModuleType | None:
    """Import core.<name>, or None (logged once) when the core is not next to the backend."""
    root = str(c.REPO_ROOT)
    if root not in sys.path:
        sys.path.append(root)
    try:
        return importlib.import_module(f"core.{name}")
    except Exception as exc:  # the core is optional for the backend: status falls back to ports and processes
        log.warning(
            "core.%s is not importable (%s); glove status runs without it", name, exc
        )
        return None


def rcsp() -> ModuleType | None:
    """core.rcsp: RcspClient, RcspError."""
    return _core_module("rcsp")


def rgmp() -> ModuleType | None:
    """core.rgmp: RgmpParser and the definition types."""
    return _core_module("rgmp")
