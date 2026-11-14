"""Touch typing: the moves load and synthesise, each drill strikes the right finger of the right hand, and the seed ships."""

import math

import pytest
from app.schemas.motion import HoldPose, Keyframes
from app.services.motion import synthesiser
from app.services.moves import load_moves
from fastapi.testclient import TestClient

TYPING = [m for m in load_moves() if m.skill == "touch_typing"]
HOVER_INDEX = 0.35


def _strikes(spec: Keyframes) -> list[tuple[str, str]]:
    """The (side, finger) of every strike key: a key where one finger is curled clearly past the hover pose."""
    out: list[tuple[str, str]] = []
    fingers = ("thumb", "index", "middle", "ring", "little")
    for i, (right, left) in enumerate(
        zip(spec.keys, spec.left_keys or spec.keys, strict=True)
    ):
        for side, key in (("right", right), ("left", left)):
            curls = key.pose.as_list()
            rest = (0.2, 0.35, 0.35, 0.35, 0.3)
            hit = [
                f for f, c, r in zip(fingers, curls, rest, strict=True) if c - r > 0.2
            ]
            assert len(hit) <= 1, f"key {i} of {side} strikes more than one finger"
            if hit:
                out.append((side, hit[0]))
    return out


def test_typing_moves_load_two_handed_with_the_keyboard() -> None:
    """Eight two-handed drills on the keyboard prop, every curl marked as an estimate."""
    assert len(TYPING) == 8
    assert all(m.hands == "both" and m.prop == "keyboard" for m in TYPING)
    assert all("estimates" in m.description for m in TYPING)
    assert {m.id for m in TYPING} >= {
        "ty_home_row",
        "ty_index_fj",
        "ty_thumb_space",
        "ty_index_reach",
        "ty_rhythm_alternate",
    }


def test_home_row_is_a_curved_hover_for_both_hands() -> None:
    """The rest pose is a soft curve, the same for both hands."""
    rest = next(m for m in TYPING if m.id == "ty_home_row").default_motion
    assert isinstance(rest, HoldPose) and rest.left_pose is None
    assert 0.25 <= rest.pose.index <= 0.45 and rest.pose.thumb < rest.pose.index


@pytest.mark.parametrize(
    ("move_id", "expected"),
    [
        ("ty_index_fj", [("left", "index"), ("right", "index")]),
        ("ty_middle_dk", [("left", "middle"), ("right", "middle")]),
        ("ty_ring_sl", [("left", "ring"), ("right", "ring")]),
        ("ty_little_a_semicolon", [("left", "little"), ("right", "little")]),
        ("ty_thumb_space", [("right", "thumb")]),
        ("ty_index_reach", [("left", "index")] * 2 + [("right", "index")] * 2),
        (
            "ty_rhythm_alternate",
            [
                (s, f)
                for f in ("index", "middle", "ring", "little")
                for s in ("left", "right")
            ],
        ),
    ],
)
def test_each_drill_strikes_the_touch_typing_finger(
    move_id: str, expected: list[tuple[str, str]]
) -> None:
    """F and J are the index fingers, D and K the middle, S and L the ring, A and ; the little, space the thumb."""
    spec = next(m for m in TYPING if m.id == move_id).default_motion
    assert isinstance(spec, Keyframes) and spec.left_keys
    assert sum(k.ms for k in spec.keys) == sum(k.ms for k in spec.left_keys)
    assert _strikes(spec) == expected


def test_rhythm_drill_keeps_an_even_beat() -> None:
    """Every strike in the alternating drill starts the same distance apart."""
    spec = next(m for m in TYPING if m.id == "ty_rhythm_alternate").default_motion
    assert isinstance(spec, Keyframes)
    beats = [a.ms + b.ms for a, b in zip(spec.keys[::2], spec.keys[1::2], strict=True)]
    assert len(set(beats)) == 1


def test_index_reach_turns_the_wrist_a_little() -> None:
    """G and H are reached with a small wrist turn (an estimate); F and J are not."""
    spec = next(m for m in TYPING if m.id == "ty_index_reach").default_motion
    assert isinstance(spec, Keyframes) and spec.left_keys
    yaws = [k.yaw for k in spec.left_keys[::2]]
    assert yaws[0] == 0 and 0 < yaws[1] < math.radians(10)


@pytest.mark.parametrize("move", TYPING, ids=lambda m: m.id)
def test_typing_moves_synthesise_for_both_hands(move) -> None:
    """Both hands synthesise finite frames, and a strike curls the striking finger past the hover pose."""
    for side in ("left", "right"):
        frames = synthesiser.synthesise(move.default_motion, side, 2.0, 30)
        assert len(frames) == 60
        for f in frames:
            hand = f.hands[0]
            assert all(math.isfinite(v) for v in hand.wrist_quat)
    fj = next(m for m in TYPING if m.id == "ty_index_fj").default_motion
    # 0.6 s beat, strike key 210 ms: late in the first strike slot the left index is down and the right one at rest.
    assert synthesiser.pose_at(fj, 0.2, "left").curls[1] == pytest.approx(
        HOVER_INDEX + 0.3
    )
    assert synthesiser.pose_at(fj, 0.2, "right").curls[1] == pytest.approx(HOVER_INDEX)


def test_typing_seed_lesson_is_served(client: TestClient) -> None:
    """The seed course installs with eight two-handed lessons on the keyboard and the air typing test."""
    lessons = {lesson["id"]: lesson for lesson in client.get("/api/lessons").json()}
    lesson = lessons["seed-touch-typing"]
    moves = {m.id: m for m in TYPING}
    assert lesson["skill"] == "touch_typing"
    assert len(lesson["steps"]) == 8
    assert lesson["test"] == {"kind": "air_typing", "opponent": "bot", "rounds": 3}
    for step in lesson["steps"]:
        assert step["hands"] == "both" and step["prop"] == "keyboard"
        assert step["motion"]["preset"] == moves[step["move_id"]].default_motion.preset
    typing = client.get("/api/moves", params={"skill": "touch_typing"}).json()
    assert len(typing) == 8


def test_a_typing_drill_scores_its_own_motion(client: TestClient) -> None:
    """Scoring the F and J drill against itself is near perfect for either hand."""
    fj = next(m for m in TYPING if m.id == "ty_index_fj").default_motion
    body_motion = fj.model_dump()
    for side in ("left", "right"):
        frames = [f.model_dump() for f in synthesiser.synthesise(fj, side, 2.4, 30)]
        body = {"reference_motion": body_motion, "attempt_frames": frames, "side": side}
        res = client.post("/api/score", json=body)
        assert res.status_code == 200, res.text
        assert res.json()["overall"] >= 90
