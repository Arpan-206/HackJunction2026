"""scripts/slot step 9: fingerspelling letters recorded from the official chart into a pack.

No handshape is made up anywhere: a letter is stored only from a hold take the core recorded, with the name of the
person and the reference. The dry run writes a copy in its run folder, never the repo's pack.
"""

import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts" / "slot"))

import slot_letters as L
import slot_steps as S
from slot_log import Console

from core import hand as H

POSE = {"thumb": 0.4, "index": 0.1, "middle": 0.9, "ring": 0.9, "little": 0.9}


def _packs() -> dict:
    return L.load_packs(REPO / L.BACKEND_PACKS)


def test_the_repo_pack_files_agree_and_finnish_is_empty():
    a, b = (L.load_packs(p) for p in L.pack_files(REPO))
    assert a == b
    fi = L.find_pack(a, "fi")
    assert L.letters_to_record(fi) == ["S", "U", "O", "M", "I", "Ä", "Ö"]
    assert all(x["pose"] is None for x in fi["letters"])


def test_store_letter_needs_a_person_a_reference_and_a_real_pose():
    data = _packs()
    with pytest.raises(ValueError, match="name of the person"):
        L.store_letter(data, "fi", "Ä", " ", "chart", "lesson-1", POSE)
    with pytest.raises(ValueError, match="reference"):
        L.store_letter(data, "fi", "Ä", "Aino", "", "lesson-1", POSE)
    with pytest.raises(ValueError, match="curl 0..1"):
        L.store_letter(data, "fi", "Ä", "Aino", "chart", "lesson-1", {"thumb": 2})
    with pytest.raises(ValueError, match="not a slot"):
        L.store_letter(data, "fi", "Å", "Aino", "chart", "lesson-1", POSE)
    slot = L.store_letter(
        data,
        "fi",
        "Ä",
        "Aino",
        "https://suvi.viittomat.net/alphabet.php",
        "lesson-1",
        POSE,
        "2026-11-15T10:00:00",
    )
    assert slot == {
        "letter": "Ä",
        "status": "recorded",
        "recorded_by": "Aino",
        "reference": "https://suvi.viittomat.net/alphabet.php",
        "recorded_at": "2026-11-15T10:00:00",
        "move_id": None,
        "lesson_id": "lesson-1",
        "pose": POSE,
    }
    # The other slots stay not recorded yet.
    assert L.letters_to_record(L.find_pack(data, "fi")) == [
        "S",
        "U",
        "O",
        "M",
        "I",
        "Ö",
    ]


def test_letters_to_record_refuses_letters_outside_the_pack():
    fi = L.find_pack(_packs(), "fi")
    assert L.letters_to_record(fi, ["ä", "s"]) == ["Ä", "S"]
    with pytest.raises(ValueError, match="Å not a slot"):
        L.letters_to_record(fi, ["Å"])


def test_take_titles_never_trigger_the_asl_letter_reader():
    from core.priors.facts import is_fingerspelling

    fi = L.find_pack(_packs(), "fi")
    for letter in L.letters_to_record(fi):
        title = L.take_title(fi, letter)
        assert title == f"Sormiaakkoset: {letter}"
        assert not is_fingerspelling({"lesson": title, "step": {"name": ""}})


def test_curls_come_from_the_recorded_hold_through_the_core_rule():
    held = H.synth_hand(side="right", curl=POSE)
    lesson = {
        "steps": [
            {"kind": "move", "t0_us": 0, "t1_us": 400_000, "key_angles": [0.0] * 18},
            {
                "kind": "hold",
                "t0_us": 400_000,
                "t1_us": 3_000_000,
                "key_angles": held.angles.tolist(),
            },
        ]
    }
    got = L.curls_from_lesson(lesson)
    assert set(got) == set(POSE)
    assert max(abs(got[f] - POSE[f]) for f in POSE) < 0.02
    with pytest.raises(ValueError):
        L.curls_from_lesson({"steps": []})


class FakeCore:
    """Answers the record commands like the core does; each take saves a lesson."""

    def __init__(self):
        self.cmds = []
        self.n = 0

    def cmd(self, name, args=None, check=True, timeout=10.0):
        self.cmds.append((name, args))
        if name == "record_stop":
            self.n += 1
            return {"ok": True, "result": {"lesson_id": f"take-{self.n}"}}
        return {"ok": True, "result": {}}

    def close(self):
        pass


def test_the_step_on_fakes_writes_only_its_run_copy(tmp_path, monkeypatch):
    before = [p.read_bytes() for p in L.pack_files(REPO)]
    held = H.synth_hand(side="right", curl=POSE)
    lesson = {
        "steps": [
            {
                "kind": "hold",
                "t0_us": 0,
                "t1_us": 2_000_000,
                "key_angles": held.angles.tolist(),
            }
        ]
    }
    core = FakeCore()

    class Link:
        def __enter__(self):
            return core

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(S, "link", lambda ctx, *a, **k: Link())
    monkeypatch.setattr(S, "http", lambda *a, **k: lesson)
    monkeypatch.setattr(L.time, "sleep", lambda s: None)
    out = io.StringIO()
    opts = S.Options(pose_seconds=0, freeze_seconds=0, pack_letters=["Ä", "Ö"])
    ctx = S.Ctx(
        console=Console(auto=True, out=out),
        repo=REPO,
        py=sys.executable,
        run_dir=tmp_path,
        wearer="tester",
        dry=True,
        opts=opts,
        core_port=1,
        backend_url="",
        depth_host="",
        depth_port=0,
        data_dir=tmp_path,
        cfg=None,
    )
    r = S.step_pack_letters(ctx)
    assert r.verdict == "look" and "2/2 letters stored" in r.summary
    assert [
        p.read_bytes() for p in L.pack_files(REPO)
    ] == before  # the repo pack is untouched
    copy = json.loads(
        (tmp_path / "fingerspelling_packs.json").read_text(encoding="utf-8")
    )
    fi = L.find_pack(copy, "fi")
    stored = {x["letter"]: x for x in fi["letters"] if x["status"] == "recorded"}
    assert set(stored) == {"Ä", "Ö"}
    assert (
        stored["Ä"]["recorded_by"] == "tester"
    )  # the dry run takes the wearer as the default name
    assert stored["Ä"]["reference"] == "https://suvi.viittomat.net/alphabet.php"
    assert stored["Ä"]["lesson_id"] == "take-1" and stored["Ö"]["lesson_id"] == "take-2"
    assert np.allclose(
        [stored["Ä"]["pose"][f] for f in POSE], [POSE[f] for f in POSE], atol=0.02
    )
    titles = [a["title"] for n, a in core.cmds if n == "record_start"]
    assert titles == ["Sormiaakkoset: Ä", "Sormiaakkoset: Ö"]
    assert "Nothing is generated or guessed" in out.getvalue()


def test_console_text_keeps_the_default_on_enter():
    c = Console(auto=False, out=io.StringIO(), inp=io.StringIO("\nAino\n"))
    assert c.text("Name", "arpan") == "arpan"
    assert c.text("Name", "arpan") == "Aino"
    assert Console(auto=True, out=io.StringIO()).text("Name", "x") == "x"


def test_step_nine_is_registered():
    assert S.STEPS[-1][:2] == (9, "pack_letters")
