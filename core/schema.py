"""JSON Schema registry. If code and schema disagree, the schema wins."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from .config import REPO_ROOT

# Message type -> schema file stem.
MESSAGE_SCHEMAS = {
    "hello": "hello",
    "frame": "frame",
    "session": "session",
    "lesson": "lesson_message",
    "event": "event",
    "coach": "coach",
    "ack": "ack",
    "cmd": "cmd",
    "robot": "robot",
}


class SchemaRegistry:
    def __init__(self, schema_dir: str | Path | None = None) -> None:
        self.dir = Path(schema_dir) if schema_dir else REPO_ROOT / "schema"
        self.docs: dict[str, dict] = {}
        resources = []
        for path in sorted(self.dir.glob("*.json")):
            doc = json.loads(path.read_text())
            self.docs[path.stem] = doc
            resources.append((doc["$id"], Resource.from_contents(doc)))
        self.registry = Registry().with_resources(resources)
        self._validators: dict[str, Draft202012Validator] = {}
        for stem, doc in self.docs.items():
            Draft202012Validator.check_schema(doc)
            self._validators[stem] = Draft202012Validator(doc, registry=self.registry)

    def names(self) -> list[str]:
        return sorted(self.docs)

    def get(self, name: str) -> dict:
        return self.docs[name]

    def validator(self, name: str) -> Draft202012Validator:
        return self._validators[name]

    def validate(self, name: str, obj: Any) -> None:
        """Raise jsonschema.ValidationError if obj does not match schema `name`."""
        self._validators[name].validate(obj)

    def errors(self, name: str, obj: Any) -> list[str]:
        return [f"{'/'.join(str(p) for p in e.absolute_path)}: {e.message}" for e in self._validators[name].iter_errors(obj)]

    def validate_message(self, msg: dict) -> None:
        """Validate any WebSocket message by its `type` field."""
        t = msg.get("type")
        if t not in MESSAGE_SCHEMAS:
            raise ValueError(f"unknown message type {t!r}")
        self.validate(MESSAGE_SCHEMAS[t], msg)

    def is_valid_message(self, msg: dict) -> bool:
        try:
            self.validate_message(msg)
            return True
        except Exception:
            return False


_default: SchemaRegistry | None = None


def default_registry() -> SchemaRegistry:
    global _default
    if _default is None:
        _default = SchemaRegistry()
    return _default
