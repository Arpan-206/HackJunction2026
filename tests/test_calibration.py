"""Per-wearer flat and fist calibration read from the backend's stored files (core/calibration.py)."""

import json

import numpy as np
import pytest

from core import hand as H
from core.calibration import (
    Calibrations,
    angles_to_triples,
    load_hand,
    triples_to_angles,
)
from core.clock import FakeClock
from core.coach import Coach
from core.compat import hand_to_glove_hand
from core.config import load_config
from core.session import Session
from tests.conftest import ROOT

FLAT = {"thumb": 0.25, "index": 0.35, "middle": 0.3, "ring": 0.32, "little": 0.6}
FIST = {"thumb": 0.9, "index": 1.0, "middle": 1.0, "ring": 1.0, "little": 1.0}


def raw_angles(curl: dict, side: str = "right") -> np.ndarray:
    return H.synth_hand(side=side, curl=curl).angles


def write_range(d, cid, side, flat, fist, created_at, thumb=None):
    """A backend `Calibration` file (backend/app/schemas/records.py)."""
    (d / "calibrations").mkdir(parents=True, exist_ok=True)
    body = {
        "id": cid,
        "side": side,
        "flat": flat,
        "fist": fist,
        "created_at": created_at,
    }
    if thumb is not None:
        body["thumb"] = thumb
    (d / "calibrations" / f"{cid}.json").write_text(json.dumps(body))


def write_wearer(d, wid, wearer, ranges, neutral, created_at):
    """A backend `WearerCalibration` file (backend/app/schemas/rig.py)."""
    (d / "glove_calibrations").mkdir(parents=True, exist_ok=True)
    body = {
        "id": wid,
        "wearer": wearer,
        "created_at": created_at,
        "neutral": [
            {
                "side": side,
                "offsets": offs,
                "yaw_zero_deg": 0.0,
                "noise_deg": 0.3,
                "yaw_spread_deg": 0.5,
                "frames": 120,
            }
            for side, offs in neutral.items()
        ],
        "quality": {
            "noise_deg": 0.3,
            "bias_deg": 30.0,
            "heading_reliable": None,
            "grade": "fair",
            "notes": [],
        },
        "range_calibration_ids": ranges,
        "reinit": False,
        "verified": False,
    }
    (d / "glove_calibrations" / f"{wid}.json").write_text(json.dumps(body))


def zeros():
    return {f: [0.0, 0.0, 0.0] for f in H.FINGERS}


@pytest.fixture
def ccfg(tmp_path):
    c = load_config(ROOT / "config.toml")
    c.calibration.data_dir = str(tmp_path / "data")
    c.calibration.enabled = True
    c.calibration.max_gain = 0.0  # exact maths here; the cap has its own test
    return c


def test_compat_triples_map_back_onto_the_18_angles():
    h = H.synth_hand(side="left", curl=FLAT)
    flex = hand_to_glove_hand(h)["flexion"]
    back = triples_to_angles(flex)
    slots = [s for f in H.FINGERS for s in H.FLEXION_SLOTS[f]]
    assert np.allclose(back[slots], h.angles[slots], atol=0.01)
    again = triples_to_angles(angles_to_triples(h.angles))
    assert np.allclose(again[slots], h.angles[slots], atol=0.01)


def test_flat_reads_zero_fist_reads_full_and_spread_is_untouched(ccfg, tmp_path):
    d = tmp_path / "data"
    flat, fist = raw_angles(FLAT), raw_angles(FIST)
    write_range(
        d,
        "r1",
        "right",
        angles_to_triples(flat),
        angles_to_triples(fist),
        "2026-11-14T10:00:00Z",
    )
    cal = load_hand(d, "right", "", ccfg.calibration, ccfg.hand)
    assert cal is not None and cal.origin["range"] == "measured"
    out = cal.apply(flat)
    slots = [s for f in H.FINGERS for s in H.FLEXION_SLOTS[f]]
    use = cal.usable
    assert np.allclose(out[slots][use[slots]], 0.0, atol=0.05)
    top = cal.apply(fist)
    for f in H.FINGERS:
        full = (
            ccfg.hand.curl_full_thumb_deg if f == "thumb" else ccfg.hand.curl_full_deg
        )
        for s in H.FLEXION_SLOTS[f]:
            if use[s]:
                assert top[s] == pytest.approx(full, abs=0.1)
    assert np.allclose(out[14:], flat[14:])  # spread slots stay raw
    mid = cal.apply((flat + fist) / 2)
    assert mid[3] == pytest.approx(ccfg.hand.curl_full_deg / 2, abs=0.5)


def test_two_wearers_with_different_offsets_read_the_same_after_calibration(
    ccfg, tmp_path
):
    d = tmp_path / "data"
    # wearer A's glove reads 20 degrees more on every flexion joint, wearer B
    # has a narrower range; the same relative pose must read the same.
    base_flat, base_fist = raw_angles(FLAT), raw_angles(FIST)
    a_flat, a_fist = base_flat + 20, base_fist + 20
    b_flat, b_fist = base_flat, base_flat + 0.7 * (base_fist - base_flat)
    write_range(
        d,
        "ra",
        "right",
        angles_to_triples(a_flat),
        angles_to_triples(a_fist),
        "2026-11-14T10:00:00Z",
    )
    write_range(
        d,
        "rb",
        "left",
        angles_to_triples(b_flat),
        angles_to_triples(b_fist),
        "2026-11-14T10:00:00Z",
    )
    ca = load_hand(d, "right", "", ccfg.calibration, ccfg.hand)
    cb = load_hand(d, "left", "", ccfg.calibration, ccfg.hand)
    pose_a = a_flat + 0.4 * (a_fist - a_flat)
    pose_b = b_flat + 0.4 * (b_fist - b_flat)
    slots = [
        s
        for f in H.FINGERS
        for s in H.FLEXION_SLOTS[f]
        if ca.usable[s] and cb.usable[s]
    ]
    assert np.abs(pose_a[slots] - pose_b[slots]).mean() > 10  # raw: not comparable
    assert np.allclose(ca.apply(pose_a)[slots], cb.apply(pose_b)[slots], atol=0.2)


def test_without_a_wearer_the_newest_side_record_with_a_flat_wins(ccfg, tmp_path):
    d = tmp_path / "data"
    flat = angles_to_triples(raw_angles(FLAT))
    fist = angles_to_triples(raw_angles(FIST))
    write_range(d, "old", "right", flat, fist, "2026-11-14T09:00:00Z")
    write_range(d, "new", "right", flat, fist, "2026-11-14T11:00:00Z")
    write_range(d, "lefty", "left", flat, fist, "2026-11-14T12:00:00Z")
    write_range(d, "empty", "right", zeros(), zeros(), "2026-11-14T13:00:00Z")
    cal = load_hand(d, "right", "", ccfg.calibration, ccfg.hand)
    assert cal.origin["range_calibration_id"] == "new"


def test_flat_only_uses_the_nominal_range(ccfg, tmp_path):
    d = tmp_path / "data"
    flat = raw_angles(FLAT)
    write_range(
        d, "f", "right", angles_to_triples(flat), zeros(), "2026-11-14T10:00:00Z"
    )
    cal = load_hand(d, "right", "", ccfg.calibration, ccfg.hand)
    assert cal.origin["range"] == "nominal"
    out = cal.apply(flat + 30)
    assert out[2] == pytest.approx(30, abs=0.1)  # index mcp: 30 deg past flat


def test_wearer_record_picks_its_range_ids_and_falls_back_to_neutral(ccfg, tmp_path):
    d = tmp_path / "data"
    flat, fist = raw_angles(FLAT), raw_angles(FIST)
    write_range(
        d,
        "szy-r",
        "right",
        angles_to_triples(flat),
        angles_to_triples(fist),
        "2026-11-14T10:00:00Z",
    )
    write_range(
        d,
        "other-r",
        "right",
        angles_to_triples(flat + 5),
        angles_to_triples(fist),
        "2026-11-14T12:00:00Z",
    )
    neutral_left = angles_to_triples(raw_angles(FLAT, "left"))
    write_wearer(
        d,
        "w1",
        "Szymon",
        {"right": "szy-r"},
        {"left": neutral_left},
        "2026-11-14T10:01:00Z",
    )
    write_wearer(d, "w0", "Szymon", {}, {}, "2026-11-14T08:00:00Z")
    r = load_hand(d, "right", "szymon", ccfg.calibration, ccfg.hand)
    assert (
        r.origin["range_calibration_id"] == "szy-r" and r.origin["wearer"] == "Szymon"
    )
    left = load_hand(d, "left", "Szymon", ccfg.calibration, ccfg.hand)
    assert left is not None and left.origin["range"] == "nominal"
    assert load_hand(d, "left", "Nobody", ccfg.calibration, ccfg.hand) is None


def test_session_scores_on_calibrated_angles_and_compat_sends_raw(ccfg, tmp_path):
    d = tmp_path / "data"
    flat, fist = raw_angles(FLAT), raw_angles(FIST)
    write_range(
        d,
        "r1",
        "right",
        angles_to_triples(flat),
        angles_to_triples(fist),
        "2026-11-14T10:00:00Z",
    )
    s = Session(
        ccfg,
        FakeClock(),
        tmp_path / "lessons",
        Coach(None, ccfg.coach, ccfg.score.timing_hint_ms),
    )
    assert s.calibrations.status()["right"]["range_calibration_id"] == "r1"
    assert s.calibrations.status()["left"] is None
    h = H.synth_hand(side="right", curl=FLAT, device_id=2)
    H.finish_hand(h, ccfg.hand)
    s.update_hand("right", h)
    assert h.angles_raw is not None
    assert max(h.curl.values()) < 0.05  # flat reads flat
    sent = hand_to_glove_hand(h)["flexion"]["index"]
    assert sent[0] == pytest.approx(np.radians(h.angles_raw[2]), abs=1e-3)
    before = h.angles.copy()
    s.update_hand("right", h)  # a held pose handed in twice is not calibrated twice
    assert np.allclose(before, h.angles)
    # a camera hand and the left hand (no calibration) are left alone
    c = H.synth_hand(side="right", curl=FLAT, source="camera")
    s.update_hand("right", c)
    assert c.angles_raw is None


def test_calibrate_command_reloads_from_disk(ccfg, tmp_path):
    d = tmp_path / "data"
    s = Session(
        ccfg,
        FakeClock(),
        tmp_path / "lessons",
        Coach(None, ccfg.coach, ccfg.score.timing_hint_ms),
    )
    assert s.calibrations.status() == {"left": None, "right": None}
    write_range(
        d,
        "late",
        "left",
        angles_to_triples(raw_angles(FLAT, "left")),
        angles_to_triples(raw_angles(FIST, "left")),
        "2026-11-14T10:00:00Z",
    )
    s.handle_command("calibrate", {})
    assert s.calibrations.status()["left"]["range_calibration_id"] == "late"


def test_disabled_and_fake_sessions_skip_calibration(ccfg, tmp_path):
    d = tmp_path / "data"
    write_range(
        d,
        "r1",
        "right",
        angles_to_triples(raw_angles(FLAT)),
        angles_to_triples(raw_angles(FIST)),
        "2026-11-14T10:00:00Z",
    )
    fake_s = Session(
        ccfg,
        FakeClock(),
        tmp_path / "l1",
        Coach(None, ccfg.coach, ccfg.score.timing_hint_ms),
        fake=True,
    )
    h = H.synth_hand(side="right", curl=FLAT)
    fake_s.update_hand("right", h)
    assert h.angles_raw is None
    ccfg.calibration.enabled = False
    cals = Calibrations(ccfg)
    assert cals.reload() == {"left": None, "right": None}


def test_gain_cap_keeps_a_small_range_from_amplifying_noise(ccfg, tmp_path):
    d = tmp_path / "data"
    flat = raw_angles(FLAT)
    fist = flat.copy()
    fist[[0, 1]] += 14.0  # the real thumb: about 14 deg from flat to fist
    fist[2:14] += 60.0
    write_range(
        d,
        "t",
        "right",
        angles_to_triples(flat),
        angles_to_triples(fist),
        "2026-11-14T10:00:00Z",
    )
    ccfg.calibration.max_gain = 2.0
    cal = load_hand(d, "right", "", ccfg.calibration, ccfg.hand)
    out = cal.apply(flat + 7.0)
    # thumb: 7 deg of movement reads 14 (gain 2), not 30 (gain 60 / 14)
    assert out[0] == pytest.approx(14.0, abs=0.1)
    # index: range 60 is above full / 2 = 45, so the gain is 90 / 60
    assert out[2] == pytest.approx(7.0 * 90 / 60, abs=0.1)


def test_thumb_folded_capture_sets_the_thumb_range(ccfg, tmp_path):
    """The demo table's thumb-folded phase replaces the fist's thumb as the closed end."""
    d = tmp_path / "data"
    flat, fist = raw_angles(FLAT), raw_angles(FIST)
    loose = fist.copy()
    for s in H.FLEXION_SLOTS["thumb"]:
        loose[s] = flat[s] + 8.0  # a loose fist barely moves the thumb
    folded = flat.copy()
    for s in H.FLEXION_SLOTS["thumb"]:
        folded[s] = flat[s] + 40.0
    write_range(
        d,
        "r1",
        "right",
        angles_to_triples(flat),
        angles_to_triples(loose),
        "2026-11-14T10:00:00Z",
        thumb=angles_to_triples(folded),
    )
    cal = load_hand(d, "right", "", ccfg.calibration, ccfg.hand)
    assert cal is not None and cal.origin["thumb"] == "measured"
    for s in H.FLEXION_SLOTS["thumb"]:
        assert cal.fist[s] == pytest.approx(folded[s], abs=0.1)
        assert cal.usable[s]
    top = cal.apply(folded)
    for s in H.FLEXION_SLOTS["thumb"]:
        assert top[s] == pytest.approx(ccfg.hand.curl_full_thumb_deg, abs=0.1)
    for s in H.FLEXION_SLOTS["index"]:
        assert cal.fist[s] == pytest.approx(fist[s], abs=0.1)
