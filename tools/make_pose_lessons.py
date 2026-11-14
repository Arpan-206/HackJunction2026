"""Turn the seeded pose skills (shadow puppets, fingerspelling) into core lessons.

    python -m tools.make_pose_lessons [--out lessons] [--skill shadow_puppets --skill fingerspelling]
        [--word JUNCTION --word GEPPETTO] [--hold-s 2.0] [--list]

The backend's seed courses (backend/app/data/seed/*.json, the same files the
frontend's mock mode copies) hold every shape as a motion spec: per-finger curl
0 (straight) to 1 (closed), plus wrist yaw, pitch and roll for keyframes. This
tool plays each step's motion on the core's synthetic hand (core.hand.synth_hand,
the same hand the fake source builds), records it with the core's own Recorder
and cuts it into one step per seed step, exactly like core.fake.build_fake_lesson.
The result is lessons/<id>/lesson.json plus trace.npz in the core's format, so
`python -m core --fake --lesson <id>` and the practice flow play them.

Only recorded letters are emitted (backend/app/data/fingerspelling_packs.json): an ASL letter the pack does not mark
recorded is left out, a word with such a letter is skipped, and a pack whose letters a person recorded (the slot kit,
the camera) gets one lesson of its recorded poses. A letter that is not recorded yet never becomes a step.

One core lesson per seed course. A held shape becomes a hold step; a shape with
a motion (the talking dog's jaw, the bird's wings, J and Z) plays its loop
twice and becomes a move step. Spelled words (--word) become one lesson with a
step per letter, built from the fs_<letter> moves. The two-handed puppets are
recorded on the right hand only, because a core lesson has one master hand.

Every curl is an estimate (see the move descriptions and STATUS-shadows.md)
until an expert records the shapes with the gloves.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from core import geom
from core import hand as H
from core.config import load_config
from core.recorder import Lesson, Recorder

SEED_DIR = ROOT / "backend" / "app" / "data" / "seed"
MOVES_FILE = ROOT / "backend" / "app" / "data" / "moves.json"
PACKS_FILE = ROOT / "backend" / "app" / "data" / "fingerspelling_packs.json"
SKILLS = ("shadow_puppets", "fingerspelling")
WORDS = ("JUNCTION", "GEPPETTO")
# The backend synthesiser eases into each key over this fraction of its slot (backend/app/constants.py).
KEYFRAME_BLEND = 0.5
MOVE_S = 0.6  # transition between two shapes
HOLD_S = 2.0  # a held shape
LESSON_PREFIX = "pose-"


@dataclass
class Pose:
    curl: dict[str, float]
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0

    def wrist_q(self) -> np.ndarray:
        """Wrist orientation in the wrist frame: yaw about +Y, pitch about +X, roll about the finger axis (-Z)."""
        q = geom.yaw_quat(self.yaw)
        q = geom.quat_mul(
            q, geom.quat_from_axis_angle(np.array([1.0, 0.0, 0.0]), self.pitch)
        )
        return geom.quat_mul(
            q, geom.quat_from_axis_angle(np.array([0.0, 0.0, -1.0]), self.roll)
        )


def _blend(a: Pose, b: Pose, u: float) -> Pose:
    return Pose(
        {f: a.curl[f] + (b.curl[f] - a.curl[f]) * u for f in H.FINGERS},
        a.yaw + (b.yaw - a.yaw) * u,
        a.pitch + (b.pitch - a.pitch) * u,
        a.roll + (b.roll - a.roll) * u,
    )


def _smoothstep(k: float) -> float:
    k = max(0.0, min(1.0, k))
    return k * k * (3 - 2 * k)


def _key_pose(key: dict) -> Pose:
    return Pose(
        {f: float(key["pose"][f]) for f in H.FINGERS},
        float(key.get("yaw", 0.0)),
        float(key.get("pitch", 0.0)),
        float(key.get("roll", 0.0)),
    )


def motion_period_s(motion: dict) -> float | None:
    """Seconds one loop lasts, or None for a held shape."""
    if motion["preset"] == "keyframes":
        return sum(float(k["ms"]) for k in motion["keys"]) / 1000.0
    if motion["preset"] == "hold_pose":
        return None
    raise ValueError(f"preset {motion['preset']!r} is not a pose motion")


def pose_at(motion: dict, t_s: float) -> Pose:
    """The pose at time t, as the backend synthesiser plays it (hold_pose, keyframes; right hand)."""
    if motion["preset"] == "hold_pose":
        return Pose({f: float(motion["pose"][f]) for f in H.FINGERS})
    keys = motion["keys"]
    period = motion_period_s(motion)
    phase = t_s % period
    start = 0.0
    for i, key in enumerate(keys):
        slot = float(key["ms"]) / 1000.0
        if phase < start + slot or i == len(keys) - 1:
            k = _smoothstep((phase - start) / (slot * KEYFRAME_BLEND))
            return _blend(_key_pose(keys[i - 1]), _key_pose(key), k)
        start += slot
    raise AssertionError("unreachable")


@dataclass
class PoseStep:
    name: str
    note: str
    motion: dict


def step_duration_s(motion: dict, hold_s: float) -> float:
    period = motion_period_s(motion)
    if period is None:
        return hold_s
    return max(hold_s, 2 * period) if len(motion["keys"]) > 1 else max(hold_s, period)


def record_lesson(
    cfg,
    lesson_id: str,
    title: str,
    steps: list[PoseStep],
    task_config: dict,
    hold_s: float = HOLD_S,
    master_hand: str = "right",
) -> Lesson:
    """Play the steps on the synthetic hand, record them and cut one step per PoseStep."""
    rec = Recorder(cfg.record, cfg.score.hold_ms_default)
    rate = float(cfg.record.rate_hz)
    rec.start(
        0,
        title,
        "general",
        task_config,
        master_hand,
        source="fake",
        master_name="Demo expert",
    )
    rest_p = np.asarray(cfg.rest_pose[master_hand].p, dtype=float)
    # Timeline: each step owns [start, start + MOVE_S + dur]; the first MOVE_S eases in from the previous shape.
    spans = []
    t = 0.0
    for s in steps:
        dur = step_duration_s(s.motion, hold_s)
        spans.append((t, t + MOVE_S, t + MOVE_S + dur))
        t += MOVE_S + dur
    total = t
    ends: list[Pose] = []
    for s, (_, a, b) in zip(steps, spans):
        ends.append(pose_at(s.motion, b - a))
    n = int(total * rate)
    for i in range(n + 1):
        ts = i / rate
        k = next(
            j for j, (_, _, b) in enumerate(spans) if ts <= b or j == len(spans) - 1
        )
        t0, a, _ = spans[k]
        prev_end = ends[k - 1] if k > 0 else pose_at(steps[0].motion, 0.0)
        if ts < a:
            p = _blend(
                prev_end, pose_at(steps[k].motion, 0.0), _smoothstep((ts - t0) / MOVE_S)
            )
        else:
            p = pose_at(steps[k].motion, ts - a)
        h = H.synth_hand(
            side=master_hand,
            curl=p.curl,
            wrist_p=rest_p,
            wrist_q=p.wrist_q(),
            t_us=int(round(ts * 1e6)),
            device_id=2,
        )
        H.finish_hand(h, cfg.hand)
        rec.add(h)
    for t0, a, _ in spans[1:]:
        rec.mark(int(round((t0 + a) / 2 * 1e6)))
    lesson = rec.stop(int(round(total * 1e6)), save=True, lesson_id=lesson_id)
    assert lesson is not None and len(lesson.steps) == len(steps), (
        lesson_id,
        lesson and len(lesson.steps),
    )
    for st, ps in zip(lesson.steps, steps):
        st.name = ps.name
        st.note = ps.note
        st.named_by = "manual"
    return lesson


def _shape_name(title: str) -> str:
    """ "Lesson 2: The talking dog" -> "The talking dog"."""
    head, sep, tail = title.partition(":")
    return tail.strip() if sep and head.lower().startswith("lesson") else title


def load_courses(skills=SKILLS) -> list[dict]:
    out = []
    for f in sorted(SEED_DIR.glob("*.json")):
        d = json.loads(f.read_text())
        if d.get("skill") in skills:
            out.append(d)
    return out


def load_moves() -> dict[str, dict]:
    return {m["id"]: m for m in json.loads(MOVES_FILE.read_text())}


def load_packs(path: Path = PACKS_FILE) -> list[dict]:
    """The fingerspelling packs (backend/app/data/fingerspelling_packs.json)."""
    return json.loads(path.read_text(encoding="utf-8"))["packs"]


def recorded_letter_moves(packs: list[dict]) -> set[str]:
    """Move ids of letters a pack marks recorded. A letter move outside this set is never emitted."""
    return {
        x["move_id"]
        for p in packs
        for x in p["letters"]
        if x["status"] == "recorded" and x.get("move_id")
    }


def _is_letter_move(move_id: str) -> bool:
    return move_id.startswith("fs_") and not move_id.startswith("fs_word_")


def course_steps(course: dict, recorded: set[str] | None = None) -> list[PoseStep]:
    """One PoseStep per seed step. Word steps are skipped (spelled words come from --word), and so is any letter
    the packs do not mark recorded (`recorded`, default: read the pack file)."""
    recorded = recorded_letter_moves(load_packs()) if recorded is None else recorded
    out = []
    for s in course["steps"]:
        mid = str(s.get("move_id", ""))
        if mid.startswith("fs_word_") or (_is_letter_move(mid) and mid not in recorded):
            continue
        out.append(PoseStep(_shape_name(s["title"]), s["instruction"], s["motion"]))
    return out


def word_steps(
    word: str, moves: dict[str, dict], recorded: set[str] | None = None
) -> list[PoseStep]:
    """One step per letter of an ASL word. A letter with no move, or not recorded in the pack, raises ValueError."""
    recorded = recorded_letter_moves(load_packs()) if recorded is None else recorded
    steps = []
    for ch in word.upper():
        m = moves.get(f"fs_{ch.lower()}")
        if m is None:
            raise ValueError(f"no fingerspelling move for {ch!r}")
        if m["id"] not in recorded:
            raise ValueError(f"{ch} is not recorded yet")
        steps.append(PoseStep(f"Letter {ch}", m["description"], m["default_motion"]))
    return steps


def pack_short_name(pack: dict) -> str:
    """ "Finnish fingerspelling (sormiaakkoset)" -> "Sormiaakkoset". The same rule as the slot kit's take titles."""
    name = pack["name"]
    return (
        name.split("(", 1)[1].rstrip(")").strip().capitalize() if "(" in name else name
    )


def pack_pose_steps(pack: dict) -> list[PoseStep]:
    """The letters a person recorded into a pack (a pose, no catalogue move), as hold steps. Unrecorded slots: none.

    Step names are the bare letter and the lesson title avoids "fingerspell": core/priors/facts.py reads lessons named
    like that with the ASL letter model, which is wrong for another alphabet.
    """
    out = []
    for x in pack["letters"]:
        if x["status"] != "recorded" or x.get("move_id") or not x.get("pose"):
            continue
        note = f"Recorded by {x['recorded_by']} on {str(x['recorded_at'])[:10]} against {x['reference']}."
        out.append(
            PoseStep(
                x["letter"], note, {"preset": "hold_pose", "pose": dict(x["pose"])}
            )
        )
    return out


def course_lesson_id(course: dict) -> str:
    cid = str(course["id"])
    return LESSON_PREFIX + (cid.removeprefix("seed-"))


def build_all(
    cfg,
    out_dir: Path,
    skills=SKILLS,
    words=WORDS,
    hold_s: float = HOLD_S,
) -> list[Lesson]:
    """Write one lesson per seed course of the skills, one per word, and one per pack with letters a person recorded.
    Only recorded letters are emitted. Overwrites earlier runs of this tool."""
    lessons = []
    packs = load_packs()
    recorded = recorded_letter_moves(packs)
    for course in load_courses(skills):
        steps = course_steps(course, recorded)
        if not steps:
            continue
        lid = course_lesson_id(course)
        lesson = record_lesson(
            cfg,
            lid,
            course["title"],
            steps,
            {
                "skill": course["skill"],
                "seed": course["id"],
                "made_by": "tools/make_pose_lessons.py",
            },
            hold_s,
        )
        lesson.save(out_dir, keyframes=False, overwrite=True)
        lessons.append(lesson)
    if "fingerspelling" in skills:
        moves = load_moves()
        for w in words:
            lid = f"{LESSON_PREFIX}spell-{w.lower()}"
            try:
                steps = word_steps(w, moves, recorded)
            except ValueError as e:
                print(f"skipped {lid}: {e}")
                continue
            lesson = record_lesson(
                cfg,
                lid,
                f"ASL fingerspelling alphabet: spell {w.upper()}",
                steps,
                {
                    "skill": "fingerspelling",
                    "word": w.upper(),
                    "made_by": "tools/make_pose_lessons.py",
                },
                hold_s,
            )
            lesson.save(out_dir, keyframes=False, overwrite=True)
            lessons.append(lesson)
        for pack in packs:
            steps = pack_pose_steps(pack)
            if not steps:
                continue
            lesson = record_lesson(
                cfg,
                f"{LESSON_PREFIX}pack-{pack['id']}",
                f"{pack_short_name(pack)}: the recorded letters",
                steps,
                {
                    "skill": "fingerspelling",
                    "pack": pack["id"],
                    "made_by": "tools/make_pose_lessons.py",
                },
                hold_s,
            )
            lesson.save(out_dir, keyframes=False, overwrite=True)
            lessons.append(lesson)
    return lessons


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--config", default=str(ROOT / "config.toml"))
    ap.add_argument(
        "--out",
        default=None,
        help="lessons folder (default: [server] lessons_dir in the config)",
    )
    ap.add_argument(
        "--skill",
        action="append",
        choices=SKILLS,
        help="only these skills (repeatable)",
    )
    ap.add_argument(
        "--word",
        action="append",
        help=f"words to spell (repeatable; default {' '.join(WORDS)})",
    )
    ap.add_argument(
        "--hold-s", type=float, default=HOLD_S, help="seconds each held shape lasts"
    )
    ap.add_argument(
        "--list",
        action="store_true",
        help="print the lessons and steps it would write, write nothing",
    )
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    skills = tuple(args.skill or SKILLS)
    words = tuple(w.upper() for w in (args.word or WORDS))
    if args.list:
        for c in load_courses(skills):
            names = [s.name for s in course_steps(c)]
            if names:
                print(course_lesson_id(c), "|", ", ".join(names))
        if "fingerspelling" in skills:
            for w in words:
                print(f"{LESSON_PREFIX}spell-{w.lower()}", "|", " ".join(w))
            for pack in load_packs():
                steps = pack_pose_steps(pack)
                if steps:
                    print(
                        f"{LESSON_PREFIX}pack-{pack['id']}",
                        "|",
                        ", ".join(x.name for x in steps),
                    )
                else:
                    missing = [
                        x["letter"]
                        for x in pack["letters"]
                        if x["status"] != "recorded"
                    ]
                    if missing:
                        print(
                            f"(no lesson for {pack['id']}: not recorded yet: {', '.join(missing)})"
                        )
        return 0
    out = Path(args.out) if args.out else ROOT / cfg.server.lessons_dir
    out.mkdir(parents=True, exist_ok=True)
    for lesson in build_all(cfg, out, skills, words, args.hold_s):
        kinds = "".join("H" if s.kind == "hold" else "M" for s in lesson.steps)
        print(
            f"{out / lesson.id}  {len(lesson.steps)} steps [{kinds}]  {lesson.duration_us / 1e6:.1f} s"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
