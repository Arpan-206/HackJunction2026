"""Export Geppetto lesson folders into one LeRobot dataset, one episode per lesson.

Usage:
    uv run geppetto-export --lessons-dir ../lessons --out ./out/geppetto_robot_demos
    uv run geppetto-export --lessons-dir ../lessons --out ./out/geppetto_robot_demos --overwrite
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from lerobot.datasets.lerobot_dataset import LeRobotDataset

from . import convert as _convert
from .convert import (
    build_retargeter,
    dataset_features,
    lesson_to_frames,
    load_lesson,
    robot_action_names,
)

REPO_ID = "geppetto/robot-demos"


def find_lessons(lessons_dir: Path) -> list[Path]:
    return sorted(p.parent for p in lessons_dir.glob("*/lesson.json"))


def export(lessons_dir: Path, out: Path, overwrite: bool = False) -> LeRobotDataset:
    lesson_dirs = find_lessons(lessons_dir)
    if not lesson_dirs:
        raise SystemExit(f"no lesson folders (*/lesson.json) found under {lessons_dir}")

    if out.exists():
        if not overwrite:
            raise SystemExit(f"{out} already exists; pass --overwrite to replace it")
        shutil.rmtree(out)

    rt = build_retargeter()
    angle_names = list(_convert.H.ANGLE_NAMES)
    n_joints = len(_convert.H.JOINT_NAMES)

    kept, skipped = 0, 0
    first_lesson = load_lesson(lesson_dirs[0])
    action_names = robot_action_names(rt, first_lesson.hand_side)
    features = dataset_features(angle_names, n_joints, action_names)

    dataset = LeRobotDataset.create(
        repo_id=REPO_ID,
        fps=round(first_lesson.rate_hz),
        features=features,
        root=out,
        robot_type=rt.model_name,
        use_videos=False,
    )

    for lesson_dir in lesson_dirs:
        lesson = load_lesson(lesson_dir)
        if list(robot_action_names(rt, lesson.hand_side)) != action_names:
            print(
                f"skip {lesson.id}: action names do not match the dataset's (hand side mismatch?)",
                file=sys.stderr,
            )
            skipped += 1
            continue
        frames = lesson_to_frames(lesson, rt)
        for frame in frames:
            task = frame.pop("_task")
            timestamp = frame.pop("_timestamp")
            dataset.add_frame(frame, task=task, timestamp=timestamp)
        dataset.save_episode()
        kept += 1
        print(f"kept {lesson.id}: {len(frames)} frames, hand={lesson.hand_side}")

    print(f"kept {kept} of {kept + skipped} lessons as episodes -> {out}")
    return dataset


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lessons-dir",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "lessons",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "out" / "geppetto_robot_demos",
    )
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    export(args.lessons_dir, args.out, overwrite=args.overwrite)


if __name__ == "__main__":
    main()
