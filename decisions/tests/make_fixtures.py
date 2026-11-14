"""Build the test fixtures from the real Smartgloves II capture committed in the repo.

    python decisions/tests/make_fixtures.py        # from the repo root, core venv active

Input: backend/tests/fixtures/rgmp/worn_solver.rgmp.gz (Szymon's worn-glove solver capture).
The right glove records a three-step lesson (marks spread evenly over the take),
the left glove is scored against it with the core's own StepScorer, exactly as
tools/score_capture.py does. Output, in decisions/tests/fixtures/:

* lesson.json      the lesson (Lesson.to_json(), no trace)
* steps.json       the three steps (Step.to_json(): key_angles, key_joints, weights, ...)
* digests.json     digest_step() per step, what name_steps gets
* summaries.json   step summaries sampled every 1.5 s of the left hand's attempt, each
                   validated against schema/step_summary.json
* keyframe_XX.jpg  the core's sepia key-pose sketch per step (stands in for a camera frame)

Nothing is written outside this folder. The core is imported read-only.
"""

from __future__ import annotations

import gzip
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from core import hand as H
from core.config import load_config
from core.recorder import Recorder, digest_step, render_keyframe
from core.schema import SchemaRegistry
from core.scorer import StepScorer, Tolerances
from tools.score_capture import hands_from_capture

CAPTURE = ROOT / "backend" / "tests" / "fixtures" / "rgmp" / "worn_solver.rgmp.gz"
OUT = Path(__file__).resolve().parent / "fixtures"
SAMPLE_EVERY_US = 1_500_000


def main() -> int:
    cfg = load_config(ROOT / "config.toml")
    schemas = SchemaRegistry(ROOT / "schema")
    with tempfile.TemporaryDirectory() as td:
        raw = Path(td) / "worn_solver.rgmp"
        raw.write_bytes(gzip.decompress(CAPTURE.read_bytes()))
        hands = hands_from_capture(cfg, raw)
    master, learner = hands["right"], hands["left"]
    print(
        f"capture: {len(master)} right frames (expert), {len(learner)} left frames (learner)"
    )

    rec = Recorder(cfg.record, cfg.score.hold_ms_default)
    t0 = master[0].t_us
    rec.start(
        t0,
        "Real capture: three shapes",
        "general",
        {},
        "right",
        source="glove",
        master_name="capture",
    )
    for h in master:
        rec.add(h)
    span = master[-1].t_us - t0
    for k in range(1, 3):
        rec.mark(t0 + span * k // 3)
    lesson = rec.stop(master[-1].t_us, save=True, lesson_id="decisions-fixture")
    assert lesson is not None and len(lesson.steps) == 3, "expected three steps"
    OUT.mkdir(parents=True, exist_ok=True)

    lesson_json = lesson.to_json()
    (OUT / "lesson.json").write_text(
        json.dumps({**lesson_json, "steps": []}, indent=1) + "\n"
    )
    (OUT / "steps.json").write_text(
        json.dumps([s.to_json() for s in lesson.steps], indent=None) + "\n"
    )
    (OUT / "digests.json").write_text(
        json.dumps([digest_step(s) for s in lesson.steps], indent=1) + "\n"
    )
    for s in lesson.steps:
        render_keyframe(s, "right", OUT / f"keyframe_{s.index:02d}.jpg")
        print(
            f"  step {s.index} {s.kind} weights {s.weights} curl {H.curl_from_angles(s.key_angles, 90, 60)}"
        )

    tol = Tolerances(cfg.score.perfect_deg, cfg.score.wrong_deg)
    summaries: list[dict] = []
    for step in lesson.steps:
        sc = StepScorer("left", lesson, step, cfg.score, tol)
        t_start = learner[0].t_us
        sc.reset_attempt(t_start)
        next_sample = t_start + SAMPLE_EVERY_US
        for h in learner:
            fs = sc.update(h.t_us, h.angles, None)
            if fs.passed:
                summaries.append(
                    sc.summary(h.t_us, "general", lesson.title, stuck=False)
                )
                sc.reset_attempt(h.t_us)
                next_sample = h.t_us + SAMPLE_EVERY_US
                continue
            if h.t_us >= next_sample:
                stuck = sc.elapsed_s(h.t_us) >= float(cfg.score.stuck_s)
                summaries.append(
                    sc.summary(h.t_us, "general", lesson.title, stuck=stuck)
                )
                next_sample = h.t_us + SAMPLE_EVERY_US
        summaries.append(
            sc.summary(learner[-1].t_us, "general", lesson.title, stuck=False)
        )
    for s in summaries:
        schemas.validate("step_summary", s)
    (OUT / "summaries.json").write_text(json.dumps(summaries, indent=None) + "\n")
    passed = sum(1 for s in summaries if s["passed"])
    stuck = sum(1 for s in summaries if s["stuck_s"] is not None)
    print(
        f"summaries: {len(summaries)} ({passed} passed, {stuck} stuck), all valid against schema/step_summary.json"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
