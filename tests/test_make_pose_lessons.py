"""tools/make_pose_lessons.py: the seeded shadow puppets and fingerspelling letters as core lessons.

The lessons are written in the core's format, load with core.recorder.Lesson, and play through the core's own
session on the fake clock: a learner holding each shape passes every step, a wrong shape does not, and a replay
of the lesson's own take passes it end to end.
"""

import json

import numpy as np
import pytest

from core import hand as H
from core.clock import FakeClock
from core.coach import Coach
from core.recorder import LESSON_SCHEMA, Lesson
from core.session import Session
from tools import make_pose_lessons as mpl


@pytest.fixture(scope="module")
def built(tmp_path_factory, cfg):
    out = tmp_path_factory.mktemp("lessons")
    lessons = mpl.build_all(cfg, out)
    return out, {l.id: l for l in lessons}


def _session(cfg, lessons_dir, tmp_path):
    clock = FakeClock()
    s = Session(cfg, clock, lessons_dir, Coach(None, cfg.coach, cfg.score.timing_hint_ms), fake=True)
    s.attempts_log = tmp_path / "attempts.jsonl"
    return s, clock


def _feed(s, clock, curl, n, dt_us=33_333):
    for _ in range(n):
        clock.advance_us(dt_us)
        h = H.synth_hand(side="right", curl=curl, t_us=clock.now_us(), device_id=2)
        H.finish_hand(h, s.cfg.hand)
        s.update_hand("right", h)
        s.tick(clock.now_us())
    return s.drain()


def _events(msgs, name):
    return [m for m in msgs if m["type"] == "event" and m.get("name") == name]


def test_one_lesson_per_course_and_word(built):
    out, lessons = built
    assert set(lessons) == {
        "pose-shadow-puppets",
        "pose-fingerspelling-a-m",
        "pose-fingerspelling-n-z",
        "pose-spell-junction",
        "pose-spell-geppetto",
    }
    assert [s.name for s in lessons["pose-shadow-puppets"].steps] == [
        "The rabbit",
        "The talking dog",
        "The swan",
        "The flapping bird",
        "The snail",
    ]
    letters = lessons["pose-fingerspelling-a-m"].steps + lessons["pose-fingerspelling-n-z"].steps
    assert [s.name for s in letters] == [f"The letter {c}" for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
    assert [s.name for s in lessons["pose-spell-junction"].steps] == [f"Letter {c}" for c in "JUNCTION"]
    # The dog's jaw moves the thumb, so its step is a move; held shapes are holds.
    kinds = {s.name: s.kind for s in lessons["pose-shadow-puppets"].steps}
    assert kinds["The talking dog"] == "move" and kinds["The snail"] == "hold"
    for lid in lessons:
        d = json.loads((out / lid / "lesson.json").read_text())
        assert d["schema"] == LESSON_SCHEMA and d["task"] == "general"
        assert d["task_config"]["made_by"] == "tools/make_pose_lessons.py"
        assert (out / lid / "trace.npz").exists()


def test_lessons_load_and_hold_the_seeded_curls(built, cfg):
    out, _ = built
    lesson = Lesson.load(out / "pose-fingerspelling-a-m")
    assert lesson.trace is not None and len(lesson.steps) == 13
    b = next(s for s in lesson.steps if s.name == "The letter B")
    want = H.synth_hand(side="right", curl={"thumb": 0.8, "index": 0, "middle": 0, "ring": 0, "little": 0})
    assert np.abs(b.key_angles - want.angles).max() < 1.0
    assert b.note.startswith("A flat hand")


def test_the_tool_reads_the_seed_courses_the_frontend_mock_copies():
    repo = mpl.ROOT
    for f in mpl.SEED_DIR.glob("*.json"):
        d = json.loads(f.read_text())
        if d["skill"] not in mpl.SKILLS:
            continue
        mock = repo / "frontend" / "src" / "mock" / "data" / f"seed-{f.stem.replace('_', '-')}.json"
        assert json.loads(mock.read_text()) == d, mock.name


def test_pose_at_matches_the_backend_keyframe_rule():
    dog = next(m for m in json.loads(mpl.MOVES_FILE.read_text()) if m["id"] == "sp_talking_dog")["default_motion"]
    assert mpl.motion_period_s(dog) == pytest.approx(1.2)
    assert mpl.pose_at(dog, 1.1).curl["thumb"] == pytest.approx(0.60)
    assert mpl.pose_at(dog, 0.5).curl["thumb"] == pytest.approx(0.10)
    assert mpl.pose_at(dog, 0.6 + 0.6 * mpl.KEYFRAME_BLEND / 2).curl["thumb"] == pytest.approx(0.35)


def test_a_learner_holding_each_letter_spells_junction(built, cfg, tmp_path, schemas):
    out, lessons = built
    s, clock = _session(cfg, out, tmp_path)
    s.handle_command("lesson_load", {"lesson_id": "pose-spell-junction"})
    s.handle_command("set_mode", {"mode": "learn"})
    s.drain()
    moves = mpl.load_moves()
    passed = []
    for i, ch in enumerate("JUNCTION"):
        assert s.step_index == i
        curl = mpl.pose_at(moves[f"fs_{ch.lower()}"]["default_motion"], 0.0).curl
        msgs = _feed(s, clock, curl, n=90)
        for m in msgs:
            schemas.validate_message(m)
        got = _events(msgs, "step_passed")
        assert got, f"letter {ch} did not pass"
        passed.append(got[0]["data"]["step"])
        if i == 7:
            assert _events(msgs, "lesson_complete")
    assert passed == list(range(8))


def test_a_wrong_shape_does_not_pass(built, cfg, tmp_path):
    out, _ = built
    s, clock = _session(cfg, out, tmp_path)
    s.handle_command("lesson_load", {"lesson_id": "pose-fingerspelling-a-m"})
    s.handle_command("set_mode", {"mode": "learn"})
    s.drain()
    # Step 0 is A (a fist with the thumb up); a flat B hand must not pass it.
    msgs = _feed(s, clock, {"thumb": 0.8, "index": 0, "middle": 0, "ring": 0, "little": 0}, n=120)
    assert not _events(msgs, "step_passed")
    assert s.step_index == 0


def test_a_replay_of_the_take_passes_every_puppet(built, cfg, tmp_path):
    """Play the lesson's own recorded take back as the learner: every step, the moving dog included, passes."""
    out, _ = built
    lesson = Lesson.load(out / "pose-shadow-puppets")
    s, clock = _session(cfg, out, tmp_path)
    s.handle_command("lesson_load", {"lesson_id": lesson.id})
    s.handle_command("set_mode", {"mode": "learn"})
    s.drain()
    tr = lesson.trace
    passed = []
    for k, step in enumerate(lesson.steps):
        w = tr.window(step.t0_us, step.t1_us)
        idx = np.arange(len(tr))[w]
        for _ in range(4):  # loop the step's slice of the take until it passes
            for i in idx:
                clock.advance_us(12_000)
                h = H.HandState(
                    side="right",
                    device_id=2,
                    source="glove",
                    t_us=clock.now_us(),
                    joints_local=tr.joints_local()[i],
                    wrist_p=np.asarray(tr.wrist_p[i], dtype=float),
                    wrist_q=np.asarray(tr.wrist_q[i], dtype=float),
                )
                H.finish_hand(h, cfg.hand)
                s.update_hand("right", h)
                s.tick(clock.now_us())
                got = _events(s.drain(), "step_passed")
                if got:
                    passed.append((step.name, got[0]["data"]["step"]))
                    break
            if len(passed) > k:
                break
        assert len(passed) > k, f"{step.name} did not pass on its own replay"
    assert [p[1] for p in passed] == list(range(len(lesson.steps)))


def test_cli_list_and_write(tmp_path, capsys):
    assert mpl.main(["--list", "--skill", "shadow_puppets"]) == 0
    listed = capsys.readouterr().out
    assert "pose-shadow-puppets | The rabbit, The talking dog" in listed and "spell" not in listed
    assert mpl.main(["--out", str(tmp_path), "--skill", "fingerspelling", "--word", "hi"]) == 0
    assert (tmp_path / "pose-spell-hi" / "lesson.json").exists()
    assert not (tmp_path / "pose-shadow-puppets").exists()
