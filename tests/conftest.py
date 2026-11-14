import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from core.config import load_config
from core.schema import SchemaRegistry


@pytest.fixture(scope="session")
def cfg():
    return load_config(ROOT / "config.toml")


@pytest.fixture(scope="session")
def schemas():
    return SchemaRegistry(ROOT / "schema")
