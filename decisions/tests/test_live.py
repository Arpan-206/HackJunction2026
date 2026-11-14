"""Live check against the real Decisions API. Opt in: DECISIONS_LIVE=1, key in the shared .env.

    DECISIONS_LIVE=1 python -m pytest decisions/tests/test_live.py -q -s

Costs a few hundred input tokens per run ($0.10 per million). Never runs by default.
"""

from __future__ import annotations

import pytest

from decisions import config as C
from decisions.client import DecisionsClient
from decisions.judgements import check_outcome, finger_rubric, pick_action
from decisions.log import JsonlLog

pytestmark = pytest.mark.live


@pytest.fixture(scope="module")
def live_client(tmp_path_factory):
    key = C.load_api_key()
    if not key:
        pytest.skip("no GEMINI_API_KEY in the environment or the shared .env")
    cl = DecisionsClient(
        api_key=key,
        log=JsonlLog(tmp_path_factory.mktemp("live") / "decisions.jsonl"),
        enabled=True,
        budget_ms=3000,
    )
    yield cl
    cl.close()


def test_pick_action_live(live_client, summaries):
    stuck = next(s for s in summaries if s["stuck_s"] is not None and not s["passed"])
    passed = next(s for s in summaries if s["passed"])
    for s in (stuck, passed):
        d = pick_action(s, client=live_client)
        print(
            f"\npick_action: {d.action} conf {d.confidence:.2f} focus {d.focus} source {d.source} {d.latency_ms:.0f} ms"
        )
        assert d.source == "model", d.reason
        assert d.action in C.ACTIONS
        assert sum(d.probabilities.values()) == pytest.approx(1.0, abs=0.05)
    assert pick_action(passed, client=live_client).action == "move_on"


def test_check_outcome_live(live_client, keyframe_jpg):
    d = check_outcome(
        keyframe_jpg, "Is this a line drawing of a human hand?", client=live_client
    )
    print(
        f"\ncheck_outcome: {d.answer} p={d.probability:.2f} conf {d.confidence:.2f} {d.latency_ms:.0f} ms"
    )
    assert d.source == "model", d.reason
    assert d.answer is True
    d2 = check_outcome(
        keyframe_jpg, "Is there a cat in this picture?", client=live_client
    )
    assert d2.source == "model" and d2.answer is False


def test_finger_rubric_live(live_client, steps, lesson_meta):
    r = finger_rubric(steps[2], steps[2], lesson=lesson_meta, client=live_client)
    print(
        f"\nfinger_rubric: {r.weights} levels {r.levels} conf {r.confidence:.2f} {r.latency_ms:.0f} ms"
    )
    assert r.source == "model", r.reason
    assert set(r.weights) == set(C.FINGERS) and max(r.weights.values()) == 1.0


def test_latency_fits_the_default_budget(live_client, summaries):
    """Not an assertion on the network, a measurement: how many of five calls land under 600 ms."""
    lat = [pick_action(summaries[i], client=live_client).latency_ms for i in range(5)]
    print(
        "\nlatencies ms:",
        [round(x) for x in lat],
        "under 600:",
        sum(1 for x in lat if x < 600),
        "of 5",
    )
