"""The FurElise piano ranges file: shape, order, held-out pianists, provenance."""

from __future__ import annotations

import json

import pytest

from core import hand as H
from core.priors import piano
from core.priors.provenance import DATA_DIR

pytestmark = pytest.mark.skipif(not piano.RANGES_FILE.exists(), reason="piano ranges not built")


def _ranges():
    return json.loads(piano.RANGES_FILE.read_text())


def test_percentiles_are_ordered_for_every_joint():
    d = _ranges()
    for key in ("all", "pressing", "not_pressing"):
        if not d.get(key):
            continue
        for n in H.ANGLE_NAMES:
            r = d[key][n]
            assert r["p5"] <= r["p25"] <= r["p50"] <= r["p75"] <= r["p95"], (key, n)


def test_test_pianists_never_set_the_range():
    d = _ranges()
    test_ids = {p["piece_id"] for p in d["pieces"] if p["split"] == "test"}
    prov = json.loads((DATA_DIR / "piano_furelise.provenance.json").read_text())
    assert not test_ids & set(prov["pieces_train"])
    for tag in prov["sources"]:
        assert tag.startswith("open_dataset:furelise:")
        assert tag.split(":")[2].removeprefix("piece_") not in test_ids


def test_held_out_pianists_mostly_inside_the_band():
    d = _ranges()
    held = d.get("held_out_pianists_inside_p5_p95")
    if held is None:
        pytest.skip("no held-out pianists in this build")
    rates = held["per_joint"].values()
    # a 5 to 95 band holds 90% of training frames; other pianists should sit near that
    assert min(rates) > 0.6
    assert sum(rates) / len(rates) > 0.8


def test_suggested_tolerances_per_finger():
    tol = _ranges()["suggested_tolerances"]
    for f in H.FINGERS:
        assert 0 < tol[f]["perfect_deg"] < tol[f]["wrong_deg"]
