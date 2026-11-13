"""Prepare pydantic JSON schemas for providers that accept only a conservative subset."""

from typing import Any

from pydantic import BaseModel

_DROPPED_KEYWORDS = {"discriminator", "default", "title"}


def _clean(node: Any, is_property_map: bool = False) -> Any:
    """Recursively remove unsupported keywords, leaving property names untouched."""
    if isinstance(node, dict):
        return {
            k: _clean(v, is_property_map=(k == "properties" and not is_property_map))
            for k, v in node.items()
            if is_property_map or k not in _DROPPED_KEYWORDS
        }
    if isinstance(node, list):
        return [_clean(v) for v in node]
    return node


def llm_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Return the model's JSON schema without discriminator, default and title keywords."""
    return _clean(model.model_json_schema())
