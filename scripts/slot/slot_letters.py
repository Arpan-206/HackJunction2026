"""Record fingerspelling letters into a pack: a person holds each letter from the official chart, the core records it.

The slot kit's step 9 uses this module, and so does the camera path:

    python -m core --camera                                  # the core's camera source, same recorder
    python scripts/slot/slot_letters.py --pack fi --letter Ä --by "Aino" [--reference URL] [--core-port 8765]

Nothing here makes up a handshape. Each letter is a hold take recorded by the core (record_start, hold, record_stop),
and its pose is the held curls the core measured, read back from the saved lesson. The pack file
(backend/app/data/fingerspelling_packs.json) and its frontend copy get the letter with who recorded it, the reference
they held it against, when, the core lesson id and the pose. A dry run writes a copy in its run folder instead.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
for p in (str(HERE), str(REPO)):
    if p not in sys.path:
        sys.path.insert(0, p)

FINGERS = ("thumb", "index", "middle", "ring", "little")
BACKEND_PACKS = Path("backend/app/data/fingerspelling_packs.json")
MOCK_PACKS = Path("frontend/src/mock/data/fingerspelling-packs.json")
RECORD_FIELDS = ("recorded_by", "reference", "recorded_at", "move_id", "lesson_id", "pose")


def pack_files(repo: Path) -> list[Path]:
    """The pack file and its verbatim frontend copy: both are written together."""
    return [repo / BACKEND_PACKS, repo / MOCK_PACKS]


def load_packs(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_packs(paths: list[Path], data: dict) -> None:
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    for p in paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


def find_pack(data: dict, pack_id: str) -> dict:
    for p in data["packs"]:
        if p["id"] == pack_id:
            return p
    raise KeyError(f"no fingerspelling pack {pack_id!r}")


def letters_to_record(pack: dict, wanted: list[str] | None = None) -> list[str]:
    """The pack's slots to record: the ones asked for, else every slot not recorded yet. A letter outside the pack is refused."""
    slots = [x["letter"] for x in pack["letters"]]
    if wanted:
        want = [w.strip().upper() for w in wanted if w.strip()]
        bad = [w for w in want if w not in slots]
        if bad:
            raise ValueError(f"{', '.join(bad)} not a slot of {pack['name']} (slots: {', '.join(slots)})")
        return want
    return [x["letter"] for x in pack["letters"] if x["status"] != "recorded"]


def take_title(pack: dict, letter: str) -> str:
    """The core lesson title of a recorded take.

    It says neither "fingerspell" nor "letter X": core/priors/facts.py would read such a lesson with the ASL letter
    model, which is wrong for any other alphabet.
    """
    name = pack["name"]
    if "(" in name:  # "Finnish fingerspelling (sormiaakkoset)" -> "Sormiaakkoset"
        name = name.split("(", 1)[1].rstrip(")").strip().capitalize()
    return f"{name}: {letter}"


def curls_from_lesson(lesson: dict) -> dict[str, float]:
    """The held curls of a recorded take: the longest hold step's key pose, through the core's own angle-to-curl rule."""
    import numpy as np

    from core import hand as H

    steps = lesson.get("steps") or []
    if not steps:
        raise ValueError("the take has no steps")
    holds = [s for s in steps if s.get("kind") == "hold"] or steps
    best = max(holds, key=lambda s: int(s.get("t1_us", 0)) - int(s.get("t0_us", 0)))
    curls = H.curl_from_angles(np.asarray(best["key_angles"], dtype=float), 90.0, 60.0)
    return {f: round(float(curls[f]), 3) for f in FINGERS}


def store_letter(data: dict, pack_id: str, letter: str, recorded_by: str, reference: str, lesson_id: str,
                 pose: dict[str, float], recorded_at: str | None = None) -> dict:
    """Mark one slot recorded, with who, against what, when, the core lesson and the pose. Returns the slot."""
    if not recorded_by.strip():
        raise ValueError("a recorded letter needs the name of the person who recorded it")
    if not reference.strip():
        raise ValueError("a recorded letter needs the reference it was held against")
    if set(pose) != set(FINGERS) or not all(0.0 <= float(v) <= 1.0 for v in pose.values()):
        raise ValueError(f"pose must give a curl 0..1 for each of {', '.join(FINGERS)}")
    pack = find_pack(data, pack_id)
    slot = next((x for x in pack["letters"] if x["letter"] == letter), None)
    if slot is None:
        raise ValueError(f"{letter} is not a slot of {pack['name']}")
    slot.update(
        status="recorded",
        recorded_by=recorded_by.strip(),
        reference=reference.strip(),
        recorded_at=recorded_at or time.strftime("%Y-%m-%dT%H:%M:%S"),
        move_id=None,
        lesson_id=lesson_id,
        pose={f: float(pose[f]) for f in FINGERS},
    )
    return slot


@dataclass
class Take:
    letter: str
    lesson_id: str | None = None
    pose: dict | None = None
    error: str | None = None


def record_take(core, http_get, letter: str, title: str, pose_seconds: float, hold_seconds: float, say) -> Take:
    """One hold take on the core: get into the shape, record_start, hold still, record_stop, read the lesson back."""
    say(f"   get into {letter} ({pose_seconds:.0f} s)")
    time.sleep(pose_seconds)
    core.cmd("record_start", {"title": title})
    say(f"   HOLD {letter} still ({hold_seconds:.0f} s)")
    time.sleep(hold_seconds)
    ack = core.cmd("record_stop", {"save": True}, check=False)
    if not ack.get("ok"):
        return Take(letter, error=str(ack.get("error")))
    lid = ack["result"]["lesson_id"]
    try:
        return Take(letter, lid, curls_from_lesson(http_get(lid)))
    except Exception as e:  # a take we cannot read back is not stored
        return Take(letter, lid, error=f"{type(e).__name__}: {e}")


def main(argv: list[str] | None = None) -> int:
    from slot_links import CoreLink, http
    from slot_log import Console

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pack", default="fi")
    ap.add_argument("--letter", action="append", help="slot to record (repeatable); default every slot not recorded yet")
    ap.add_argument("--by", default="", help="the name of the person recording (asked if missing)")
    ap.add_argument("--reference", default="", help="URL or document name held against (default: the pack's chart)")
    ap.add_argument("--core-port", type=int, default=8765)
    ap.add_argument("--pose-seconds", type=float, default=3.0)
    ap.add_argument("--hold-seconds", type=float, default=3.0)
    ap.add_argument("--hand", default="right", choices=("left", "right"))
    a = ap.parse_args(argv)
    c = Console()
    files = pack_files(REPO)
    data = load_packs(files[0])
    pack = find_pack(data, a.pack)
    todo = letters_to_record(pack, a.letter)
    if not todo:
        c.say(f"Every slot of {pack['name']} is recorded. Name one with --letter to record it again.")
        return 0
    by = a.by or c.text("Your name (stored as recorded_by)", "")
    ref = a.reference or c.text("Reference you hold the letters against", pack["default_reference"]["url"])
    base = f"http://127.0.0.1:{a.core_port}"
    core = CoreLink(f"ws://127.0.0.1:{a.core_port}/ws")
    try:
        core.cmd("set_task", {"task": "general"})
        core.cmd("set_roles", {"left": "free", "right": "free", a.hand: "master"})
        core.cmd("set_mode", {"mode": "record"})
        for letter in todo:
            c.say(f"--- {letter}: hold it as the chart shows ({ref}) ---")
            c.enter("Press Enter, then make the letter.")
            t = record_take(core, lambda lid: http("GET", f"{base}/lessons/{lid}", timeout=5), letter,
                            take_title(pack, letter), a.pose_seconds, a.hold_seconds, c.say)
            if t.error or not t.pose:
                c.say(f"Not stored: {t.error}")
                continue
            store_letter(data, a.pack, letter, by, ref, t.lesson_id or "", t.pose)
            write_packs(files, data)
            c.say(f"Stored {letter}: {t.pose} (lesson {t.lesson_id})")
        core.cmd("set_mode", {"mode": "idle"})
    finally:
        core.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
