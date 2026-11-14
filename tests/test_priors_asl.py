"""The ASL letter recogniser: classes, merged groups, model file, top two."""

from __future__ import annotations

import numpy as np
import pytest

from core.priors import asl


def test_letters_exclude_motion_letters():
    curls = asl.letter_curls()
    assert len(curls) == 24
    assert "j" not in curls and "z" not in curls


def test_identical_targets_are_merged():
    groups = asl.letter_groups(asl.letter_curls())
    merged = {"/".join(g) for g in groups if len(g) > 1}
    assert merged == {"g/q", "h/u/v", "k/p"}


def test_ideal_glove_fit_reads_clear_letters():
    ds = asl.build_dataset([], 60, seed=1)
    m = asl.LetterModel.fit(ds)
    for letter in ("b", "f", "w", "y"):
        a = asl.target_angles(asl.letter_curls()[letter])
        top = m.top2(a)
        assert top[0][0] == letter
        assert 0.5 < top[0][1] <= 1.0
        assert top[1][1] <= top[0][1]


def test_saved_model_loads_and_scores():
    if not asl.MODEL_FILE.exists():
        pytest.skip("model not trained")
    m = asl.LetterModel.load()
    a = asl.target_angles(asl.letter_curls()["b"])
    (c1, p1), (c2, p2) = m.top2(a)
    assert c1 == "b" and p1 > p2
    assert len(m.classes) == 20


def test_wearer_simulation_stays_in_calibrated_range():
    if not asl.CAL_DIR_DEFAULT.exists():
        pytest.skip("no calibration records on this machine")
    w = asl.wearer_records()
    assert w, "expected at least one usable calibration record"
    X = asl.simulate(asl.letter_curls()["a"], w[0], np.random.default_rng(0), 20)
    flex = X[:, asl.FLEX_SLOTS]
    # a usable joint is clipped to [0, full]; an unusable one stays raw
    assert np.isfinite(X).all()
    assert flex.min() >= -1e-9
