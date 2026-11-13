"""A tiny JSON-file store: one file per pydantic model, written atomically."""

import os
import re
import tempfile
from pathlib import Path
from typing import Generic, TypeVar

from pydantic import BaseModel

from app import constants as c
from app.core.errors import BadRequestError

M = TypeVar("M", bound=BaseModel)
_SAFE_ID = re.compile(c.SAFE_ID_PATTERN)


class JsonStore(Generic[M]):
    """Persists models that have a string `id` attribute as <directory>/<id>.json."""

    def __init__(self, directory: Path, model: type[M]) -> None:
        """Create the directory if needed."""
        self._dir = directory
        self._model = model
        self._dir.mkdir(parents=True, exist_ok=True)

    def _path(self, item_id: str) -> Path:
        """Return the file for an id, rejecting ids that could escape the directory."""
        if not _SAFE_ID.match(item_id):
            raise BadRequestError(f"invalid id: {item_id!r}")
        return self._dir / f"{item_id}.json"

    def save(self, item: M) -> M:
        """Write the model atomically (temp file then rename) and return it."""
        path = self._path(item.id)  # type: ignore[attr-defined]
        fd, tmp = tempfile.mkstemp(dir=self._dir, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(item.model_dump_json())
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return item

    def get(self, item_id: str) -> M | None:
        """Return the stored model, or None."""
        path = self._path(item_id)
        if not path.exists():
            return None
        return self._model.model_validate_json(path.read_text(encoding="utf-8"))

    def list(self) -> list[M]:
        """Return every stored model, oldest file first."""
        files = sorted(self._dir.glob("*.json"), key=lambda p: p.stat().st_mtime)
        return [self._model.model_validate_json(p.read_text(encoding="utf-8")) for p in files]
