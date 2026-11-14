"""Fingerspelling (lane shadows): the 26 letters and two spelled words load, ship as seed courses and score with the
existing scorer; the shadow puppets' motions score against themselves and apart from each other."""

import pytest
from app.schemas.motion import HoldPose, Keyframes, MotionSpec
from app.services.motion import synthesiser
from app.services.moves import load_moves
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
SPEC = TypeAdapter(MotionSpec)


def _moves() -> dict:
    return {m.id: m for m in load_moves()}


def _frames(motion: dict, seconds: float, side: str = "right") -> list[dict]:
    spec = SPEC.validate_python(motion)
    return [f.model_dump() for f in synthesiser.synthesise(spec, side, seconds, 30)]


def _score(client: TestClient, reference: dict, attempt: dict, seconds: float = 3.0) -> float:
    res = client.post(
        "/api/score",
        json={"reference_motion": reference, "attempt_frames": _frames(attempt, seconds), "side": "right"},
    )
    assert res.status_code == 200, res.text
    return res.json()["overall"]


def test_every_letter_is_a_right_hand_move_with_no_prop() -> None:
    moves = _moves()
    letters = [moves[f"fs_{c.lower()}"] for c in LETTERS]
    assert all(m.skill == "fingerspelling" and m.hands == "right" and m.prop == "none" for m in letters)
    assert all("estimates" in m.description for m in letters)
    # Static letters hold; P and Q turn down; J and Z carry their motion.
    moving = {c for c in LETTERS if isinstance(moves[f"fs_{c.lower()}"].default_motion, Keyframes)}
    assert moving == {"J", "P", "Q", "Z"}
    assert isinstance(moves["fs_a"].default_motion, HoldPose)
    j = moves["fs_j"].default_motion
    assert isinstance(j, Keyframes) and any(k.roll != 0 for k in j.keys)
    z = moves["fs_z"].default_motion
    assert isinstance(z, Keyframes) and len({round(k.yaw, 3) for k in z.keys}) == 2


def test_words_are_one_key_or_motion_per_letter() -> None:
    moves = _moves()
    word = moves["fs_word_junction"].default_motion
    assert isinstance(word, Keyframes)
    # J has three keys, the other seven letters one each.
    assert len(word.keys) == 3 + 7
    assert synthesiser.motion_period(word) == pytest.approx(8 * 1.2, abs=0.01)


def test_seed_courses_cover_the_alphabet(client: TestClient) -> None:
    lessons = {lesson["id"]: lesson for lesson in client.get("/api/lessons").json()}
    a_m = lessons["seed-fingerspelling-a-m"]["steps"]
    n_z = lessons["seed-fingerspelling-n-z"]["steps"]
    assert [s["move_id"] for s in a_m + n_z] == [f"fs_{c.lower()}" for c in LETTERS]
    assert all(lessons[i]["skill"] == "fingerspelling" for i in ("seed-fingerspelling-a-m", "seed-fingerspelling-words"))
    words = lessons["seed-fingerspelling-words"]["steps"]
    assert [s["move_id"] for s in words] == ["fs_word_junction", "fs_word_geppetto"]
    assert len(client.get("/api/moves", params={"skill": "fingerspelling"}).json()) == 28


@pytest.mark.parametrize("letter", list("ABLSY"))
def test_a_letter_scores_its_own_shape(client: TestClient, letter: str) -> None:
    m = _moves()[f"fs_{letter.lower()}"].default_motion.model_dump()
    assert _score(client, m, m) >= 90


def test_letters_the_gloves_can_tell_apart_score_apart(client: TestClient) -> None:
    moves = _moves()
    b = moves["fs_b"].default_motion.model_dump()
    a = moves["fs_a"].default_motion.model_dump()
    y = moves["fs_y"].default_motion.model_dump()
    assert _score(client, b, a) < 60
    assert _score(client, y, b) < 60


def test_u_and_v_differ_only_by_spread_so_they_score_alike(client: TestClient) -> None:
    """The solver gives curl, not spread: U and V share their curls, which the chart and the status note say."""
    moves = _moves()
    u = moves["fs_u"].default_motion.model_dump()
    v = moves["fs_v"].default_motion.model_dump()
    assert u["pose"] == v["pose"]
    assert _score(client, u, v) >= 90


PUPPETS = ["sp_rabbit", "sp_talking_dog", "sp_swan", "sp_flapping_bird", "sp_snail"]


@pytest.mark.parametrize("puppet", PUPPETS)
def test_each_puppet_scores_its_own_shape(client: TestClient, puppet: str) -> None:
    m = _moves()[puppet].default_motion.model_dump()
    assert _score(client, m, m, 4.2) >= 90


def test_the_rabbit_and_the_swan_carry_their_motion() -> None:
    moves = _moves()
    rabbit = moves["sp_rabbit"].default_motion
    swan = moves["sp_swan"].default_motion
    assert isinstance(rabbit, Keyframes) and {k.pose.index for k in rabbit.keys} == {0.0, 0.3}
    assert isinstance(swan, Keyframes) and {round(k.pitch, 2) for k in swan.keys} == {0.0, -0.35}
    # Each loop starts on the upright shape, so a still frame at t=0 shows the ears up and the neck level.
    assert synthesiser.pose_at(rabbit, 0.0).curls[1] == pytest.approx(0.0)
    assert synthesiser.pose_at(swan, 0.0).pitch == pytest.approx(0.0)


def test_a_wrong_puppet_scores_lower(client: TestClient) -> None:
    moves = _moves()
    rabbit = moves["sp_rabbit"].default_motion.model_dump()
    swan = moves["sp_swan"].default_motion.model_dump()
    assert _score(client, rabbit, swan, 4.2) < _score(client, rabbit, rabbit, 4.2) - 30
