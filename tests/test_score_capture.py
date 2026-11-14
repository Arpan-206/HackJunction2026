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
