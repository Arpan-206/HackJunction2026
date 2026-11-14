import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from core.config import load_config
from core.schema import SchemaRegistry


@pytest.fixture(scope="session")
def cfg():
    c = load_config(ROOT / "config.toml")
    # never pick up calibrations a teammate saved in backend/data on this machine
    c.calibration.data_dir = str(ROOT / "tests" / "no-calibration-data")
    return c


@pytest.fixture(scope="session")
def schemas():
    return SchemaRegistry(ROOT / "schema")
