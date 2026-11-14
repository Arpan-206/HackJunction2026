"""Learn mode on Szymon's real capture fixture, if it is in the repo."""

import gzip

import pytest

from tests.conftest import ROOT

FIXTURE = ROOT / "backend/tests/fixtures/rgmp/worn_solver.rgmp.gz"


@pytest.mark.skipif(not FIXTURE.exists(), reason="teammate fixture not present")
def test_real_capture_records_and_scores(cfg, tmp_path):
    from core.recorder import Recorder
    from core.scorer import StepScorer, Tolerances
    from tools.score_capture import hands_from_capture

    raw = tmp_path / "worn_solver.rgmp"
    raw.write_bytes(gzip.decompress(FIXTURE.read_bytes()))
    hands = hands_from_capture(cfg, raw)
    assert len(hands["left"]) > 50 and len(hands["right"]) > 50
    assert all(h.source == "glove" and h.tracked for h in hands["right"])
    rec = Recorder(cfg.record, cfg.score.hold_ms_default)
    m = hands["right"]
    rec.start(m[0].t_us, "real", "general", {}, "right")
    for h in m:
        rec.add(h)
    rec.mark(m[len(m) // 2].t_us)
    lesson = rec.stop(m[-1].t_us, save=True, lesson_id="real-eval")
    assert lesson is not None and len(lesson.steps) == 2
    sc = StepScorer(
        "left",
        lesson,
        lesson.steps[0],
        cfg.score,
        Tolerances(cfg.score.perfect_deg, cfg.score.wrong_deg),
    )
    sc.reset_attempt(hands["left"][0].t_us)
    fs = None
    for h in hands["left"]:
        fs = sc.update(h.t_us, h.angles, None)
    assert (
        fs is not None
        and 0.0 <= fs.overall <= 1.0
        and set(fs.err_deg) == {"thumb", "index", "middle", "ring", "little"}
    )


@pytest.mark.skipif(not FIXTURE.exists(), reason="teammate fixture not present")
def test_real_capture_calibrates_from_its_flat_and_fist_slices(cfg, tmp_path):
    import json

    import numpy as np

    from core import hand as H
    from tools.score_capture import (
        PHASES,
        aligned_phase_error,
        calibrate_hands,
        phase_segments,
    )

    raw = tmp_path / "worn_solver.rgmp"
    raw.write_bytes(gzip.decompress(FIXTURE.read_bytes()))
    from tools.score_capture import hands_from_capture

    hands = hands_from_capture(cfg, raw)
    assert all(len(phase_segments(hands[s])) == len(PHASES) for s in hands)
    out = tmp_path / "cal"
    summ = calibrate_hands(cfg, hands, "capture", out, "")
    for side in ("left", "right"):
        assert summ[side]["range"] == "measured"
        body = json.loads((out / "calibrations" / f"capture-{side}.json").read_text())
        assert body["side"] == side and set(body["flat"]) == set(H.FINGERS)
        flat_slice = phase_segments(hands[side])[0]
        # the wearer's own flat pose now reads close to 0 on every finger
        for f in H.FINGERS:
            flex = np.median([h.angles[H.FLEXION_SLOTS[f]].mean() for h in flat_slice])
            assert flex < 8, f"{side} {f} reads {flex:.1f} deg in its own flat pose"

        assert all(h.angles_raw is not None for h in hands[side])
    res = aligned_phase_error(hands, use_raw=False)
    assert set(res["per_phase_median"]) == set(PHASES[2:])
