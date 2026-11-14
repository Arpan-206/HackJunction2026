"""Expert drafts on disk: the in-progress "Start from scratch" session, so a closed tab or a new laptop loses nothing."""

import json

from app import constants as c
from app.core.errors import AppError, NotFoundError
from app.core.utils import utc_now_iso
from app.schemas.persist import DraftDoc, DraftKind, DraftPut
from app.services.storage.json_store import JsonStore


class DraftTooLargeError(AppError):
    """The draft exceeds DRAFT_MAX_BYTES."""

    status_code = 413


class DraftService:
    """Saves, finds and deletes drafts, one JSON file each, pruning the oldest beyond DRAFTS_KEEP."""

    def __init__(self, store: JsonStore[DraftDoc]) -> None:
        """Use the given store (<data_dir>/drafts)."""
        self._store = store

    def save(self, kind: DraftKind, draft_id: str, body: DraftPut) -> DraftDoc:
        """Write a draft (replacing the one with this id) and return it with its save time."""
        size = len(json.dumps(body.draft, separators=(",", ":")).encode("utf-8"))
        if size > c.DRAFT_MAX_BYTES:
            raise DraftTooLargeError(
                f"draft is larger than {c.DRAFT_MAX_BYTES // 1024} KB"
            )
        doc = DraftDoc(
            id=draft_id,
            kind=kind,
            schema_version=body.schema_version,
            updated_at=utc_now_iso(),
            draft=body.draft,
        )
        self._store.save(doc)
        self._prune()
        return doc

    def _prune(self) -> None:
        """Delete the oldest drafts beyond DRAFTS_KEEP."""
        docs = sorted(self._store.list(), key=lambda d: d.updated_at, reverse=True)
        for old in docs[c.DRAFTS_KEEP :]:
            self._store.delete(old.id)

    def latest(self, kind: DraftKind) -> DraftDoc:
        """The most recently saved draft of a kind, or NotFoundError."""
        docs = [d for d in self._store.list() if d.kind == kind]
        if not docs:
            raise NotFoundError(f"no {kind} draft saved")
        return max(docs, key=lambda d: d.updated_at)

    def get(self, kind: DraftKind, draft_id: str) -> DraftDoc:
        """One draft by id, or NotFoundError."""
        doc = self._store.get(draft_id)
        if doc is None or doc.kind != kind:
            raise NotFoundError(f"{kind} draft {draft_id} not found")
        return doc

    def delete(self, kind: DraftKind, draft_id: str) -> None:
        """Delete a draft; deleting one that is already gone is fine."""
        doc = self._store.get(draft_id)
        if doc is not None and doc.kind == kind:
            self._store.delete(draft_id)

    def list(self) -> list[DraftDoc]:
        """Every stored draft, oldest first."""
        return self._store.list()

    def put_doc(self, doc: DraftDoc) -> DraftDoc:
        """Write a draft exactly as given (an import keeps its save time)."""
        return self._store.save(doc)

    def find(self, draft_id: str) -> DraftDoc | None:
        """A draft by id of any kind, or None."""
        return self._store.get(draft_id)
