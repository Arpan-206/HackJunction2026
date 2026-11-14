"""Rokoko Studio JSON v3 and v4 mapping, datagram decoding and the UDP protocol, using constructed schema fixtures."""

import json
import math
from pathlib import Path

import pytest

from app import constants as c
from app.core.errors import ServiceUnavailableError
from app.schemas.frames import GloveFrame
from app.services.gloves import rokoko_udp
from app.services.gloves.rokoko_mapper import map_payload

FIXTURES = Path(__file__).parent / "fixtures"
FIST = {"thumb": (0.5, 0.6, 0.7), "index": (0.9, 1.45, 0.9), "middle": (0.9, 1.45, 0.9),
        "ring": (0.9, 1.45, 0.9), "little": (0.9, 1.45, 0.9)}


def load(name: str) -> dict:
    """Load a fixture frame."""
    return json.loads((FIXTURES / name).read_text(encoding="utf8"))


@pytest.mark.parametrize("tag", ["v3", "v4"])
def test_open_hand_has_zero_flexion_and_world_wrist(tag: str) -> None:
    """An open hand is flat on every joint; the wrist quaternion is the world hand rotation, not identity."""
    hands = {h.side: h for h in map_payload(load(f"{tag}_open.json"))}
    assert set(hands) == {"left", "right"}
    for hand in hands.values():
        assert all(abs(a) < 1e-3 for triple in hand.flexion.values() for a in triple)
        assert abs(hand.wrist_quat[1]) > 0.1  # yawed about Y, so world space was kept


@pytest.mark.parametrize("tag", ["v3", "v4"])
def test_fist_recovers_per_joint_angles(tag: str) -> None:
    """Per joint bend is recovered from world rotations, including the thumb layout of each version."""
    for hand in map_payload(load(f"{tag}_fist.json")):
        for finger, expected in FIST.items():
            for got, want in zip(hand.flexion[finger], expected, strict=True):
                assert math.isclose(got, want, abs_tol=2e-3), (tag, hand.side, finger)


@pytest.mark.parametrize("tag", ["v3", "v4"])
def test_single_finger_is_isolated(tag: str) -> None:
    """Curling only the index leaves the other fingers flat."""
    hand = map_payload(load(f"{tag}_index_half.json"))[0]
    assert math.isclose(hand.flexion["index"][1], 0.725, abs_tol=2e-3)
    assert all(abs(a) < 1e-3 for f in ("middle", "ring", "little", "thumb") for a in hand.flexion[f])


@pytest.mark.parametrize("tag", ["v3", "v4"])
def test_sweep_frames_all_map_to_valid_glove_frames(tag: str) -> None:
    """Every frame in the replay sweep maps to a contract-valid GloveFrame with two hands."""
    lines = (FIXTURES / f"{tag}_sweep.jsonl").read_text(encoding="utf8").splitlines()
    assert len(lines) > 10
    for line in lines:
        frame = GloveFrame(t=0.0, source="rokoko_udp", hands=map_payload(json.loads(line)))
        assert len(frame.hands) == 2


def test_v4_detected_by_payload_not_version_field() -> None:
    """v4 frames carry version "3,0"; detection uses scene.newtons, and both formats map the same hand."""
    v4 = load("v4_fist.json")
    assert v4["version"] == "3,0" and v4["scene"]["actors"] == []
    left_v3 = next(h for h in map_payload(load("v3_fist.json")) if h.side == "left")
    left_v4 = next(h for h in map_payload(v4) if h.side == "left")
    for finger in c.FINGERS:
        assert all(math.isclose(a, b, abs_tol=2e-3) for a, b in zip(left_v3.flexion[finger], left_v4.flexion[finger], strict=True))


def test_meta_flags_skip_hands_without_gloves() -> None:
    """A hand the meta marks as not controlled is omitted, in v3 and v4."""
    v3 = load("v3_fist.json")
    v3["scene"]["actors"][0]["meta"]["hasRightGlove"] = False
    assert [h.side for h in map_payload(v3)] == ["left"]
    v4 = load("v4_fist.json")
    v4["scene"]["newtons"][0]["meta"]["hasLeftHand"] = False
    assert [h.side for h in map_payload(v4)] == ["right"]


def test_first_actor_wins_per_side_and_unknown_shape_is_empty() -> None:
    """Two actors give one hand per side; garbage gives nothing."""
    v3 = load("v3_fist.json")
    v3["scene"]["actors"].append(v3["scene"]["actors"][0])
    assert len(map_payload(v3)) == 2
    assert map_payload({"scene": {"actors": [], "newtons": []}}) == []
    assert map_payload({"nope": 1}) == []


def test_decode_plain_and_lz4_datagrams() -> None:
    """Plain JSON decodes; LZ4 frames decode when lz4 is installed, otherwise a clear 503 is raised."""
    raw = json.dumps(load("v3_open.json")).encode()
    assert rokoko_udp.decode_datagram(raw)["version"] == 3
    try:
        import lz4.frame  # noqa: PLC0415
    except ImportError:
        with pytest.raises(ServiceUnavailableError):
            rokoko_udp.decode_datagram(c.LZ4_FRAME_MAGIC + b"junk")
        return
    packed = lz4.frame.compress(raw)
    assert packed[:4] == c.LZ4_FRAME_MAGIC
    assert rokoko_udp.decode_datagram(packed)["scene"]["actors"][0]["name"] == "Actor 01"


def test_udp_protocol_emits_frames_and_survives_garbage() -> None:
    """The datagram protocol emits a frame per good datagram and drops bad ones without raising."""
    out: list[GloveFrame] = []
    proto = rokoko_udp._Protocol(out.append)
    proto.datagram_received(b"not json", ("127.0.0.1", 1))
    proto.datagram_received(json.dumps(load("v4_fist.json")).encode(), ("127.0.0.1", 1))
    assert len(out) == 1 and out[0].source == "rokoko_udp" and len(out[0].hands) == 2
