"""Fingerspelling packs (lane fingerspelling-packs): the ASL alphabet migrated into the pack model, the Finnish pack
empty until a person records it, and no letter ever carrying a guessed pose."""

import json

import pytest
from app import constants as c
from app.schemas.fingerspelling import PackLetter
from app.services.fingerspelling import load_packs
from app.services.moves import load_moves
from fastapi.testclient import TestClient
from pydantic import ValidationError

FINNISH_SLOTS = ["S", "U", "O", "M", "I", "Ä", "Ö"]


def _packs() -> dict:
    return {p.id: p for p in load_packs()}


def test_the_asl_pack_holds_every_seeded_letter_with_its_sources() -> None:
    asl = _packs()["asl"]
    assert asl.name == "ASL fingerspelling alphabet"
    assert [x.letter for x in asl.letters] == list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    moves = {m.id for m in load_moves()}
    for x in asl.letters:
        assert x.status == "recorded"
        assert x.recorded_by == "seeded from written sources"
        assert x.move_id == f"fs_{x.letter.lower()}" and x.move_id in moves
        assert "wikipedia.org/wiki/Stokoe_notation" in x.reference
    assert {s.url for s in asl.sources} >= {
        "https://en.wikipedia.org/wiki/Stokoe_notation",
        "https://en.wikipedia.org/wiki/American_manual_alphabet",
        "https://www.startasl.com/american-sign-language-alphabet/",
    }


def test_the_finnish_pack_is_empty_until_a_person_records_it() -> None:
    fi = _packs()["fi"]
    assert fi.name == "Finnish fingerspelling (sormiaakkoset)"
    assert [x.letter for x in fi.letters] == FINNISH_SLOTS
    for x in fi.letters:
        assert x.status == "not_recorded"
        assert (
            x.pose is None
            and x.move_id is None
            and x.lesson_id is None
            and x.recorded_by is None
        )
    assert fi.default_reference.url == "https://suvi.viittomat.net/alphabet.php"
    # Nothing in the move catalogue is a Finnish letter: no generated or guessed shape exists anywhere.
    assert not any(
        "sormiaakko" in m.name.lower() or "finnish" in m.name.lower()
        for m in load_moves()
    )


def test_a_letter_that_is_not_recorded_cannot_carry_a_pose() -> None:
    pose = {"thumb": 0.5, "index": 0.5, "middle": 0.5, "ring": 0.5, "little": 0.5}
    with pytest.raises(ValidationError, match="not recorded yet"):
        PackLetter(letter="Ä", status="not_recorded", pose=pose)
    with pytest.raises(ValidationError, match="needs recorded_by"):
        PackLetter(
            letter="Ä",
            status="recorded",
            pose=pose,
            reference="chart",
            recorded_at="2026-11-14",
        )
    with pytest.raises(ValidationError, match="needs a move_id"):
        PackLetter(
            letter="Ä",
            status="recorded",
            recorded_by="Aino",
            reference="chart",
            recorded_at="2026-11-14",
        )
    ok = PackLetter(
        letter="Ä",
        status="recorded",
        recorded_by="Aino",
        reference="chart",
        recorded_at="2026-11-14",
        pose=pose,
    )
    assert ok.pose is not None


def test_the_mock_copy_matches_the_backend_file() -> None:
    mock = (
        c.FINGERSPELLING_PACKS_FILE.parents[3]
        / "frontend"
        / "src"
        / "mock"
        / "data"
        / "fingerspelling-packs.json"
    )
    assert json.loads(mock.read_text(encoding="utf-8")) == json.loads(
        c.FINGERSPELLING_PACKS_FILE.read_text(encoding="utf-8")
    )


def test_the_packs_route(client: TestClient) -> None:
    res = client.get("/api/fingerspelling/packs")
    assert res.status_code == 200
    body = res.json()
    assert [p["id"] for p in body] == ["asl", "fi"]
    fi = client.get("/api/fingerspelling/packs/fi").json()
    assert [x["letter"] for x in fi["letters"]] == FINNISH_SLOTS
    assert client.get("/api/fingerspelling/packs/xx").status_code == 404


def test_the_alphabet_is_named_asl_wherever_a_user_sees_it(client: TestClient) -> None:
    lessons = {lesson["id"]: lesson for lesson in client.get("/api/lessons").json()}
    for lid in (
        "seed-fingerspelling-a-m",
        "seed-fingerspelling-n-z",
        "seed-fingerspelling-words",
    ):
        assert lessons[lid]["title"].startswith("ASL fingerspelling alphabet: ")
    letters = [m for m in load_moves() if m.id.startswith("fs_") and len(m.id) == 4]
    assert all(m.name == f"ASL letter {m.id[3:].upper()}" for m in letters)
