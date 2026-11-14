"""Fingerspelling packs: read the pack file, validated on every read so a letter recorded during a slot shows up."""

import json
from pathlib import Path

from app import constants as c
from app.schemas.fingerspelling import FingerspellingPack, PackFile


def load_packs(path: Path | None = None) -> list[FingerspellingPack]:
    """Every pack in the file, validated (a not-recorded letter with a pose is an error, never a silent guess)."""
    raw = json.loads((path or c.FINGERSPELLING_PACKS_FILE).read_text(encoding="utf-8"))
    return PackFile.model_validate(raw).packs


class PackCatalog:
    """Read access to the fingerspelling packs."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path

    def list(self) -> list[FingerspellingPack]:
        return load_packs(self.path)

    def get(self, pack_id: str) -> FingerspellingPack | None:
        return next((p for p in self.list() if p.id == pack_id), None)
