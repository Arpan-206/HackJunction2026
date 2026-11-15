"""The standalone robot policy work (robot_policy/): the rules that keep its numbers honest.

These tests read source files only. They need no torch and no MuJoCo, so they run in the core's test environment.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
LANE = ROOT / "robot_policy"


def constants(path: Path, *names: str) -> dict:
    tree = ast.parse(path.read_text())
    out = {}
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in names
        ):
            out[node.targets[0].id] = ast.literal_eval(node.value)
    return out


def test_held_out_takes_exist_and_are_real_glove_takes():
    held = constants(LANE / "common.py", "HELD_OUT")["HELD_OUT"]
    assert len(held) == len(set(held)) >= 5
    takes = ROOT / "logs" / "archive-fresh-2318" / "core_lessons" / "takes"
    if not takes.is_dir():
        pytest.skip("the archived expert takes are local data, not in git")
    for tid in held:
        lesson = json.loads((takes / tid / "lesson.json").read_text())
        assert lesson["source"] == "glove" and lesson["master"]["hand"] == "right"
        # made during a live session with the real gloves (prepare.FIRST_GLOVE_SESSION_UTC), never before
        assert lesson["created"][:19] >= "2026-11-14T11:19:00"


def test_training_never_reads_a_held_out_take():
    """`train` builds its references only from takes outside HELD_OUT, and only through `variation`."""
    src = (LANE / "run.py").read_text()
    train = src[src.index("def train(") : src.index("def rms_deg(")]
    assert "sources = [k for k in takes if k not in C.HELD_OUT]" in train
    assert "C.variation(takes[k], rt, rng) for k in sources" in train
    assert "real_reference" not in train
    evaluate = src[src.index("def evaluate(") :]
    assert (
        "for ti, tid in enumerate(C.HELD_OUT)" in evaluate
        and "C.real_reference(takes[tid], rt)" in evaluate
    )
    assert "variation(" not in evaluate


def test_standalone_no_import_from_the_live_app():
    """Only prepare.py may read the core (to export the retarget); nothing imports backend or frontend code."""
    for f in LANE.glob("*.py"):
        text = f.read_text()
        imports = re.findall(
            r"^\s*(?:from|import)\s+([\w.]+)", text, flags=re.MULTILINE
        )
        assert not any(
            m.split(".")[0] in ("backend", "app", "frontend") for m in imports
        ), f.name
        if f.name != "prepare.py":
            assert not any(m.split(".")[0] == "core" for m in imports), f.name


def test_retarget_export_matches_the_core():
    """The exported matrix gives the same joint targets as core.robot.Retargeter on random hands."""
    data = LANE / "out" / "data" / "retarget.json"
    if not data.is_file():
        pytest.skip("run robot_policy/prepare.py first")
    from core.config import load_config
    from core.robot import Retargeter

    m = json.loads(data.read_text())
    rt = Retargeter(load_config().robot, ROOT)
    rng = np.random.default_rng(0)
    for _ in range(50):
        a = rng.uniform(-30, 120, size=18)
        mine = np.clip(
            np.asarray(m["sign"])
            * np.radians(np.asarray(m["offset_deg"]) + np.asarray(m["W"]) @ a),
            m["lower"],
            m["upper"],
        )
        core = rt.targets(a, "right").q
        assert np.allclose(mine, [core[n] for n in m["joints"]], atol=1e-9)


def test_verda_helper_uses_its_own_deployment_name():
    text = (LANE / "verda_ctl.py").read_text()
    assert 'NAME = "robot-policy"' in text
    assert "coach-tune-trainer" not in text and "coach-tune-teacher" not in text
