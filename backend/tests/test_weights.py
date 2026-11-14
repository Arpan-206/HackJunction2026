"""Per-finger step weights in the backend scorer (STATUS-weights.md at the repo root)."""

import numpy as np
from app.schemas.common import Tolerance
from app.schemas.lesson import Step
from app.schemas.records import Calibration
from app.services import scoring
from fastapi.testclient import TestClient

from tests.test_scoring import _clumsy_frames, _post

FINGERS = ("thumb", "index", "middle", "ring", "little")


def _cmp(errors: dict[str, float]) -> scoring.Comparison:
    dev = {f: -errors.get(f, 0.0) for f in FINGERS}
    return scoring.Comparison(
        {f: errors.get(f, 0.0) for f in FINGERS}, dev, 0.0, 0.0
    )


def test_no_weights_changes_nothing() -> None:
    cmp = _cmp({"ring": 30.0, "index": 5.0})
    assert scoring.to_result(cmp, Tolerance()) == scoring.to_result(
        cmp, Tolerance(), weights=dict.fromkeys(FINGERS, 1.0)
    )


def test_the_one_to_fix_is_only_a_weighted_finger() -> None:
    cmp = _cmp({"ring": 40.0, "middle": 12.0})
    plain = scoring.to_result(cmp, Tolerance())
    assert plain.worst_finger == "ring" and "ring" in plain.hint
    light = scoring.to_result(cmp, Tolerance(), weights={**dict.fromkeys(FINGERS, 1.0), "ring": 0.1})
    assert light.worst_finger == "middle"
    assert "ring" not in light.hint
    assert light.overall > plain.overall
    # a zero-weight finger never breaks within_tolerance
    zero = scoring.to_result(cmp, Tolerance(angle_deg=15), weights={**dict.fromkeys(FINGERS, 1.0), "ring": 0.0})
    assert zero.within_tolerance is True


def test_focus_falls_back_to_the_heaviest_fingers() -> None:
    w = {**dict.fromkeys(FINGERS, 0.1), "index": 0.2}
    assert scoring.focus_fingers(w) == ["index"]
    assert scoring.focus_fingers(dict.fromkeys(FINGERS, 0.0)) == []
    r = scoring.to_result(_cmp({"ring": 40.0}), Tolerance(), weights=dict.fromkeys(FINGERS, 0.0))
    assert r.worst_finger == "ring"  # nothing weighted: fall back to every finger, never crash


def test_score_request_weights_over_the_api(client: TestClient) -> None:
    frames = _clumsy_frames()
    plain = _post(client, frames)
    assert plain["worst_finger"] == "ring"
    weighted = _post(client, frames, weights={**dict.fromkeys(FINGERS, 1.0), "ring": 0.0})
    assert weighted["worst_finger"] != "ring"
    assert "ring" not in weighted["hint"]
    assert weighted["overall"] > plain["overall"]
    assert _post(client, frames, weights=None) == plain


def test_step_weights_are_optional_and_additive() -> None:
    s = Step(title="t", instruction="i")
    assert s.weights is None
    s2 = Step.model_validate({"title": "t", "instruction": "i", "weights": {"thumb": 0.0, "index": 1.0, "middle": 1.0, "ring": 0.2, "little": 1.0}})
    assert s2.weights is not None and s2.weights.ring == 0.2


# Arpan's real right-hand range from the glove slot (backend/data/calibrations/c8713cacaff6.json): the thumb reads
# less bent in the fist than flat, so this calibration cannot read the thumb.
REAL_RIGHT = Calibration(
    id="c8713cacaff6",
    side="right",
    flat={"thumb": (0.9129, 0.8876, 0.2603), "index": (0.8082, 0.293, 0.1962), "middle": (0.5602, 0.8699, 0.5828), "ring": (0.3921, 1.0903, 0.7319), "little": (0.3146, 0.8156, 0.5462)},
    fist={"thumb": (1.1208, 0.4842, 0.1908), "index": (1.4608, 1.423, 0.9574), "middle": (1.7345, 1.345, 0.9032), "ring": (1.8115, 1.37, 0.9207), "little": (1.7811, 1.2779, 0.8594)},
    created_at="2026-11-14T11:34:24Z",
)  # fmt: skip


def test_real_calibration_masks_the_unreadable_thumb_joints() -> None:
    masks = scoring.calibration_masks(REAL_RIGHT)
    assert masks is not None
    joints, weights = masks
    # the thumb's cmc stand-in still moves, so the finger keeps one joint and its weight; mcp and ip are masked
    assert weights == dict.fromkeys(FINGERS, 1.0)
    assert joints[0].tolist() == [1.0, 0.0, 0.0]
    assert joints[1:].all()
    dead = REAL_RIGHT.model_copy(update={"fist": {**REAL_RIGHT.fist, "thumb": (0.5, 0.4, 0.1)}})
    assert scoring.calibration_masks(dead)[1]["thumb"] == 0.0


def test_joint_mask_drops_a_joint_from_total_flexion() -> None:
    ref = np.zeros((20, 5, 3))
    att = ref.copy()
    att[:, 3, 0] = np.radians(30)  # only ring MCP differs
    assert scoring.compare(ref, att).error_deg["ring"] > 25
    mask = np.ones((5, 3))
    mask[3, 0] = 0
    assert scoring.compare(ref, att, joint_mask=mask).error_deg["ring"] == 0


def test_take_weights_drop_a_finger_the_expert_varies() -> None:
    base = np.full((10, 5, 3), 0.5)
    takes = []
    for ring in (0.1, 0.5, 0.9):
        t = base.copy()
        t[:, 3, :] = ring
        takes.append(t)
    w, sd = scoring.take_weights(takes)
    assert w["ring"] == 0.2 and sd["ring"] > 45
    assert all(w[f] == 1.0 for f in ("thumb", "index", "middle", "little"))
    assert scoring.take_weights(takes[:1])[0] == dict.fromkeys(FINGERS, 1.0)
