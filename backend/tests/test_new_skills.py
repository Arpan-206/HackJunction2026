"""New skills: shadow puppets, surgical grips and crochet moves load, synthesise and ship as seed lessons; keyframes work."""

import math

import pytest
from fastapi.testclient import TestClient

from app import constants as c
from app.schemas.motion import HoldPose, Keyframes
from app.services.motion import synthesiser
from app.services.moves import load_moves

NEW_SKILLS = {"shadow_puppets", "surgical_grips", "crochet"}


def _curl_of(hand, finger_index: int) -> float:
    """Recover the curl of a finger from its MCP flexion (breathing ignored, so only roughly)."""
    name = c.FINGERS[finger_index]
    mcp = hand.flexion[name][0]
    scale = c.THUMB_FLEXION_SCALE if finger_index == 0 else 1.0
    return (mcp / scale - c.RELAXED_FLEXION[finger_index][0]) / c.FULL_FLEXION[finger_index][0]


def test_new_skill_moves_load_with_no_prop() -> None:
    """Every move of the new skills validates, needs no prop and has the right hands."""
    moves = [m for m in load_moves() if m.skill in NEW_SKILLS]
    by_skill = {s: [m for m in moves if m.skill == s] for s in NEW_SKILLS}
    assert len(by_skill["shadow_puppets"]) == 5
    assert len(by_skill["surgical_grips"]) == 8
    assert len(by_skill["crochet"]) == 5
    assert all(m.prop == "none" for m in moves)
    assert {m.id for m in by_skill["shadow_puppets"] if m.hands == "both"} == {"sp_flapping_bird", "sp_snail"}
    assert all(m.hands == "both" for m in by_skill["crochet"])
    assert all("estimates" in m.description for m in moves)


@pytest.mark.parametrize("move", [m for m in load_moves() if m.skill in NEW_SKILLS], ids=lambda m: m.id)
def test_every_new_move_synthesises_for_its_hands(move) -> None:
    """Each new move synthesises finite frames for every hand it uses."""
    sides = ("left", "right") if move.hands == "both" else (move.hands,)
    for side in sides:
        frames = synthesiser.synthesise(move.default_motion, side, 2.0, 30)
        assert len(frames) == 60
        for f in frames:
            hand = f.hands[0]
            assert hand.side == side
            assert all(math.isfinite(v) for v in hand.wrist_quat)
            assert all(math.isfinite(v) for name in c.FINGERS for v in hand.flexion[name])


def test_hold_pose_left_pose_gives_each_hand_its_shape() -> None:
    """The snail: the left hand is the fist shell, the right hand the feelers; without left_pose both match."""
    snail = next(m for m in load_moves() if m.id == "sp_snail").default_motion
    assert isinstance(snail, HoldPose) and snail.left_pose is not None
    left = synthesiser.hand_frame(snail, "left", 0.0)
    right = synthesiser.hand_frame(snail, "right", 0.0)
    assert _curl_of(left, 1) == pytest.approx(0.95, abs=0.05)
    assert _curl_of(right, 1) == pytest.approx(0.0, abs=0.05)
    plain = HoldPose(pose=snail.pose)
    assert synthesiser.hand_frame(plain, "left", 0.0).flexion == synthesiser.hand_frame(plain, "right", 0.0).flexion


def test_keyframes_period_holds_and_wraps() -> None:
    """A keyframes loop lasts the sum of its keys, reaches and holds each key, and repeats exactly."""
    dog = next(m for m in load_moves() if m.id == "sp_talking_dog").default_motion
    assert isinstance(dog, Keyframes)
    assert synthesiser.motion_period(dog) == pytest.approx(1.2)
    # Late in the second slot the thumb is fully open, late in the first it is closed again.
    assert synthesiser.pose_at(dog, 1.1).curls[0] == pytest.approx(0.60)
    assert synthesiser.pose_at(dog, 0.5).curls[0] == pytest.approx(0.10)
    # Half way through easing in, the thumb is half way.
    assert synthesiser.pose_at(dog, 0.6 + 0.6 * c.KEYFRAME_BLEND / 2).curls[0] == pytest.approx(0.35)
    a = synthesiser.hand_frame(dog, "right", 0.37)
    b = synthesiser.hand_frame(dog, "right", 0.37 + 1.2)
    assert a.flexion == b.flexion and a.wrist_quat == b.wrist_quat


def test_keyframes_wrist_angles_and_left_keys() -> None:
    """Wrist pitch flaps the bird; crochet's yarn hand follows its own keys, stretched to the hook hand's period."""
    bird = next(m for m in load_moves() if m.id == "sp_flapping_bird").default_motion
    up = synthesiser.pose_at(bird, 0.35)
    down = synthesiser.pose_at(bird, 0.75)
    assert up.pitch == pytest.approx(math.radians(30), abs=1e-3)
    assert down.pitch == pytest.approx(-math.radians(30), abs=1e-3)
    assert synthesiser.hand_frame(bird, "right", 0.35).wrist_quat != synthesiser.hand_frame(bird, "right", 0.75).wrist_quat

    chain = next(m for m in load_moves() if m.id == "cr_chain").default_motion
    assert isinstance(chain, Keyframes) and chain.left_keys
    hook_yo = synthesiser.pose_at(chain, 0.33, "right")
    yarn_yo = synthesiser.pose_at(chain, 0.33, "left")
    assert hook_yo.roll == pytest.approx(math.radians(40), abs=1e-3)
    assert yarn_yo.roll == 0.0
    assert yarn_yo.curls[1] == pytest.approx(0.05)
    assert hook_yo.curls[1] == pytest.approx(0.40)


def test_stitches_differ_by_yarn_over_count() -> None:
    """Chain and slip stitch have one yarn-over, single crochet two, double crochet four."""
    moves = {m.id: m.default_motion for m in load_moves()}
    counts = {}
    for mid in ("cr_chain", "cr_slip_stitch", "cr_single", "cr_double"):
        spec = moves[mid]
        assert isinstance(spec, Keyframes)
        counts[mid] = sum(1 for k in spec.keys if k.roll > 0)
    assert counts == {"cr_chain": 1, "cr_slip_stitch": 1, "cr_single": 2, "cr_double": 4}


def test_new_seed_lessons_are_served(client: TestClient) -> None:
    """The new seed lessons install, use only moves from the catalogue and need no prop."""
    lessons = {lesson["id"]: lesson for lesson in client.get("/api/lessons").json()}
    moves = {m.id: m for m in load_moves()}
    expected = {"seed-shadow-puppets": 5, "seed-surgical-grips": 5, "seed-surgical-ties": 3, "seed-crochet": 5}
    for lid, n in expected.items():
        lesson = lessons[lid]
        assert len(lesson["steps"]) == n
        for step in lesson["steps"]:
            assert step["prop"] == "none"
            assert step["hands"] == moves[step["move_id"]].hands
    titles = [s["title"] for s in lessons["seed-shadow-puppets"]["steps"]]
    assert titles == ["Lesson 1: The rabbit", "Lesson 2: The talking dog", "Lesson 3: The swan", "Lesson 4: The flapping bird", "Lesson 5: The snail"]
    assert client.get("/api/moves", params={"skill": "crochet"}).status_code == 200


def test_a_keyframed_reference_scores_its_own_motion(client: TestClient) -> None:
    """Scoring a keyframed two-handed move against itself is near perfect for either hand."""
    chain = next(m for m in load_moves() if m.id == "cr_chain").default_motion.model_dump()
    for side in ("left", "right"):
        frames = [f.model_dump() for f in synthesiser.synthesise(Keyframes.model_validate(chain), side, 3.6, 30)]
        body = {"reference_motion": chain, "attempt_frames": frames, "side": side}
        res = client.post("/api/score", json=body)
        assert res.status_code == 200, res.text
        assert res.json()["overall"] >= 90
