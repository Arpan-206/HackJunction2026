"""A recorded demonstration on disk, and the words and pictures a model gets about it.

A recording is a core lesson folder (SPEC.md "Lesson files"): `lesson.json` with the steps the recorder cut from the
glove trace, `frames/step_XX.jpg` with a sketch of each key pose, and `trace.npz` with every sample. Camera frames,
when a recording has them, sit in `frames/` as well and are used in place of the sketches.

`recording_from_capture` builds such a folder from a raw Rokoko capture (`*.rgmp`, gzipped or not) with the core's own
reader and recorder, so the model sees exactly what the glove saw.
"""

from __future__ import annotations

import base64
import gzip
import json
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import paths

paths.add_repo_paths()

from core import hand as H

CURL_FULL_DEG = 90.0
CURL_FULL_THUMB_DEG = 60.0
WORD_STRAIGHT_BELOW = 0.25
WORD_HALF_BELOW = 0.6
IMAGE_MAX_WIDTH = 768
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png")
DEFAULT_MAX_FRAMES = 6


@dataclass
class Recording:
    """One demonstration: the lesson the core cut from it, its pictures and its raw trace."""

    dir: Path
    lesson: dict
    frames: list[Path] = field(default_factory=list)
    trace: dict[str, np.ndarray] | None = None

    @property
    def title(self) -> str:
        return str(self.lesson.get("title") or self.dir.name)

    @property
    def steps(self) -> list[dict]:
        return list(self.lesson.get("steps", []))


def load_recording(folder: str | Path) -> Recording:
    """Read a lesson folder. Frames are every image under `frames/`, sorted by name."""
    folder = Path(folder)
    lesson = json.loads((folder / "lesson.json").read_text(encoding="utf-8"))
    frames_dir = folder / "frames"
    frames = (
        sorted(p for p in frames_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
        if frames_dir.is_dir()
        else []
    )
    trace = None
    npz = folder / "trace.npz"
    if npz.exists():
        with np.load(npz) as z:
            trace = {k: z[k] for k in z.files}
    return Recording(dir=folder, lesson=lesson, frames=frames, trace=trace)


def finger_words(key_angles: list[float] | np.ndarray) -> dict[str, str]:
    """Straight, half bent or curled per finger, with the same thresholds as the core's step digest."""
    curl = H.curl_from_angles(
        np.asarray(key_angles, dtype=float), CURL_FULL_DEG, CURL_FULL_THUMB_DEG
    )
    words = {}
    for finger, value in curl.items():
        words[finger] = (
            "straight"
            if value < WORD_STRAIGHT_BELOW
            else "half bent"
            if value < WORD_HALF_BELOW
            else "curled"
        )
    return words


def flexion_deg(key_angles: list[float] | np.ndarray) -> dict[str, float]:
    """Mean flexion per finger in degrees."""
    angles = np.asarray(key_angles, dtype=float)
    return {f: float(np.mean(angles[H.FLEXION_SLOTS[f]])) for f in H.FINGERS}


def motion_ranges(trace: dict[str, np.ndarray]) -> dict[str, float]:
    """How far each finger travelled over the take: max minus min of its mean flexion, degrees."""
    angles = np.asarray(trace["angles"], dtype=float)
    out = {}
    for f in H.FINGERS:
        mean = angles[:, H.FLEXION_SLOTS[f]].mean(axis=1)
        out[f] = float(mean.max() - mean.min()) if len(mean) else 0.0
    return out


def trace_summary(rec: Recording) -> str:
    """Words and a few numbers about the recording: what the glove measured, step by step."""
    lesson = rec.lesson
    master = lesson.get("master", {})
    duration_s = float(lesson.get("duration_us", 0)) / 1e6
    steps = rec.steps
    samples = (
        len(rec.trace["t_us"])
        if rec.trace is not None and "t_us" in rec.trace
        else None
    )
    sampled = f", {samples} glove samples" if samples else ""
    lines = [
        f"Recording title: {rec.title}.",
        f"Demonstrating hand: {master.get('hand', 'right')}. Duration {duration_s:.1f} s{sampled}. "
        f"The recorder cut it into {len(steps)} step(s) at the moments the hand was still.",
    ]
    if rec.trace is not None and "angles" in rec.trace:
        ranges = motion_ranges(rec.trace)
        lines.append(
            "Finger travel over the whole take (flexion range, degrees): "
            + ", ".join(f"{f} {v:.0f}" for f, v in ranges.items())
            + "."
        )
    lines.append("Steps, in order:")
    for s in steps:
        words = finger_words(s["key_angles"])
        flex = flexion_deg(s["key_angles"])
        most = max(flex, key=flex.get)
        length_s = (int(s["t1_us"]) - int(s["t0_us"])) / 1e6
        kind = "held still" if s.get("kind") == "hold" else "a movement"
        weights = s.get("weights", {})
        quiet = [f for f, w in weights.items() if float(w) < 1.0]
        line = (
            f"{int(s['index']) + 1}. {s.get('name', 'Step')} ({kind}, {length_s:.1f} s): "
            + ", ".join(f"{f} {w}" for f, w in words.items())
            + f". Most bent: {most} at {flex[most]:.0f} degrees."
        )
        if quiet:
            line += f" Fingers that barely moved in this step: {', '.join(quiet)}."
        if s.get("frame"):
            line += f" Picture: {Path(s['frame']).name}."
        lines.append(line)
    return "\n".join(lines)


def pick_frames(rec: Recording, max_frames: int = DEFAULT_MAX_FRAMES) -> list[Path]:
    """Up to max_frames pictures, evenly spread over the recording, in time order."""
    frames = rec.frames
    if len(frames) <= max_frames:
        return list(frames)
    idx = np.linspace(0, len(frames) - 1, num=max_frames).round().astype(int)
    return [frames[i] for i in sorted(set(idx.tolist()))]


def image_data_url(path: Path, max_width: int = IMAGE_MAX_WIDTH) -> str:
    """The picture as a JPEG data URL, shrunk to max_width so a prompt stays small."""
    import cv2

    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"not an image: {path}")
    h, w = img.shape[:2]
    if w > max_width:
        img = cv2.resize(
            img,
            (max_width, int(round(h * max_width / w))),
            interpolation=cv2.INTER_AREA,
        )
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        raise ValueError(f"could not encode {path}")
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def video_frames(
    video: str | Path, out_dir: str | Path, count: int = DEFAULT_MAX_FRAMES
) -> list[Path]:
    """Pull `count` frames, evenly spread, out of a video file into out_dir as frame_XX.jpg."""
    import cv2

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        raise ValueError(f"no frames in {video}")
    wanted = sorted(
        set(np.linspace(0, total - 1, num=count).round().astype(int).tolist())
    )
    written: list[Path] = []
    for n, frame_no in enumerate(wanted):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
        ok, img = cap.read()
        if not ok:
            continue
        p = out_dir / f"frame_{n:02d}.jpg"
        cv2.imwrite(str(p), img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        written.append(p)
    cap.release()
    return written


def recording_from_capture(
    capture: str | Path,
    out_dir: str | Path,
    side: str = "right",
    marks: int = 3,
    lesson_id: str | None = None,
    title: str | None = None,
    config_path: str | Path | None = None,
) -> Path:
    """Record a lesson folder from one glove in a raw RGMP capture, with marks spread evenly over the take.

    Uses the core's reader (`tools.score_capture.hands_from_capture`) and recorder unchanged. Returns the folder.
    """
    from core.config import load_config
    from core.recorder import Recorder
    from tools.score_capture import hands_from_capture

    capture = Path(capture)
    out_dir = Path(out_dir)
    cfg = load_config(config_path)
    with tempfile.TemporaryDirectory() as tmp:
        raw = capture
        if capture.suffix == ".gz":
            raw = Path(tmp) / capture.stem
            raw.write_bytes(gzip.decompress(capture.read_bytes()))
        hands = hands_from_capture(cfg, raw)
    frames = hands[side]
    if len(frames) < 10:
        raise ValueError(
            f"only {len(frames)} tracked frames for the {side} hand in {capture.name}"
        )
    rec = Recorder(cfg.record, cfg.score.hold_ms_default)
    t0 = frames[0].t_us
    rec.start(
        t0,
        title or f"Glove capture, {side} hand",
        "general",
        {},
        side,
        source="glove",
        master_name="capture",
    )
    for h in frames:
        rec.add(h)
    span = frames[-1].t_us - t0
    for k in range(1, marks):
        rec.mark(t0 + span * k // marks)
    lesson = rec.stop(
        frames[-1].t_us,
        save=True,
        lesson_id=lesson_id or f"{capture.name.split('.')[0]}-{side}",
    )
    assert lesson is not None
    target = out_dir / lesson.id
    if target.exists():
        shutil.rmtree(target)
    lesson.save(out_dir, keyframes=True, overwrite=True)
    return target
