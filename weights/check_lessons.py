"""Recompute per-finger step weights for real lessons and print them as a table (nothing is written).

    python weights/check_lessons.py LESSON_DIR [LESSON_DIR ...] [--data-dir backend/data] [--wearer arpan]
        [--takes N] [--keys jfjf] [--json OUT]

Each lesson is loaded with core.recorder.Lesson, its weights are rebuilt with
core.recorder.reweight_lesson from its own trace, and the master hand's
calibration (core.calibration.load_hand, the same files the live core reads)
supplies the unusable-joint mask. `--takes` and `--keys` override task_config
to show the takes and the typing chart on the same data. The lesson folders
are never changed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core import hand as H
from core.calibration import load_hand
from core.config import load_config
from core.recorder import Lesson, reweight_lesson


def check(
    lesson_dir: Path, data_dir: Path | None, wearer: str, takes: int, keys: str
) -> dict:
    cfg = load_config()
    lesson = Lesson.load(lesson_dir)
    before = [dict(s.weights) for s in lesson.steps]
    cal = None
    if data_dir is not None:
        cal = load_hand(data_dir, lesson.master_hand, wearer, cfg.calibration, cfg.hand)
    if takes:
        lesson.task_config = {**lesson.task_config, "takes": takes}
    if keys:
        lesson.task, lesson.task_config = (
            "typing",
            {**lesson.task_config, "keys": list(keys)},
        )
    reweight_lesson(lesson, cfg.record, None if cal is None else cal.finger_weights())
    return {
        "lesson": lesson.id,
        "master_hand": lesson.master_hand,
        "calibration": None if cal is None else cal.summary(),
        "steps": [
            {
                "index": s.index,
                "kind": s.kind,
                "before": before[i],
                "after": s.weights,
                "from": s.weights_from,
            }
            for i, s in enumerate(lesson.steps)
        ],
    }


def print_table(res: dict) -> None:
    print(f"\n{res['lesson']} ({res['master_hand']} hand)")
    cal = res["calibration"]
    if cal:
        print(
            f"calibration {cal.get('range_calibration_id')}: unusable {cal.get('unusable')}"
        )
    print(
        "| Step | Kind | Takes | Weights before | Weights after | Consistency | Calibration | Chart |"
    )
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    fmt = lambda d: " ".join(f"{f[0]}{d[f]:.2f}" for f in H.FINGERS)
    for s in res["steps"]:
        src = s["from"]
        print(
            f"| {s['index'] + 1} | {s['kind']} | {src['takes']} | {fmt(s['before'])} | {fmt(s['after'])} "
            f"| {fmt(src['consistency'])} | {fmt(src['calibration'])} | {src['chart'] or '-'} |"
        )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("lessons", nargs="+", type=Path)
    ap.add_argument("--data-dir", type=Path, default=None)
    ap.add_argument("--wearer", default="")
    ap.add_argument("--takes", type=int, default=0)
    ap.add_argument("--keys", default="")
    ap.add_argument("--json", type=Path, default=None)
    a = ap.parse_args()
    out = [check(d, a.data_dir, a.wearer, a.takes, a.keys) for d in a.lessons]
    for r in out:
        print_table(r)
    if a.json:
        a.json.write_text(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
