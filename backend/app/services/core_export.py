"""Every stored take and lesson, also written locally as a core lesson folder (SPEC.md "Lesson files").

Arpan's side reads a demonstration as a core lesson folder (core/recorder.py Lesson, verda/recording.py):

    <folder>/lesson.json         schema geppetto.lesson/1: steps cut from the glove trace, key poses, finger weights
    <folder>/trace.npz           every sample: t_us, 18 angles, 26 joints, wrist position and orientation, step
    <folder>/frames/step_XX.jpg  a sketch of each step's key pose

Who reads it, all on this machine:
- the local training and tuning tools: coach_tune/build_dataset.py (every lesson folder), weights/check_lessons.py
  and the core's own lesson loader;
- verda/gemma_client.py (scripts/verda_lesson.py), which puts the sketches and a trace summary into the request to the
  model hosted on Verda. Verda hosts inference only: it keeps no files and trains nothing, so nothing is uploaded.

Our own JSON files stay the source of truth (and "Open file location" points at them). The export sits next to them:

    <data_dir>/core_lessons/takes/<take id>-<side>/   one folder per hand in the take
    <data_dir>/core_lessons/lessons/<lesson id>/      the lesson's recorded steps joined into one trace, one core step each
    <data_dir>/core_lessons/manifest.json             what was exported from which file, and why anything was skipped

The core's own recorder (core/recorder.py, imported read only from the repo root) cuts the steps and weighs the
fingers, so a take exported here is the lesson the core would have recorded from the same angles. The 26 joint positions
come from the core's synthetic hand (core.hand.synth_joints) driven by the measured angles, because our glove frames
carry angles, not positions. Angles are the raw glove flexion; the backend's flat and fist calibration is not applied.

A background worker keeps the folders in step with the stored files: at start-up, whenever a take or lesson is saved
or deleted, and every CORE_EXPORT_SYNC_INTERVAL_S seconds (which also catches bundle imports).
`scripts/core_export_sync.py` runs one sync by hand.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import sys
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np

from app import constants as c
from app.core.utils import utc_now_iso
from app.schemas.frames import GloveFrame, HandFrame
from app.schemas.lesson import Lesson
from app.schemas.records import Recording

log = logging.getLogger(__name__)

_CORE_ID = re.compile(c.CORE_LESSON_ID_PATTERN)
_core_cache: SimpleNamespace | None = None
_core_error: str | None = None


def load_core(repo_root: Path = c.REPO_ROOT) -> SimpleNamespace | None:
    """Import the core's hand model, recorder and config from the repo root, once. None when the core is not there."""
    global _core_cache, _core_error
    if _core_cache is not None or _core_error is not None:
        return _core_cache
    root = str(repo_root)
    if root not in sys.path:
        sys.path.append(root)  # appended, so nothing in the backend is shadowed
    try:
        from core import hand as H
        from core.config import load_config
        from core.recorder import Recorder
    except Exception as exc:  # the backend runs without the core, e.g. deployed alone
        _core_error = f"{type(exc).__name__}: {exc}"
        log.warning("Core lesson export off: the core could not be imported from %s (%s)", root, _core_error)
        return None
    cfg = load_config()
    _core_cache = SimpleNamespace(H=H, Recorder=Recorder, cfg=cfg)
    return _core_cache


def core_id(raw: str) -> str:
    """A folder and lesson id the core accepts (letters, digits, - and _, starting with a letter or digit)."""
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", raw).strip("-_") or "take"
    return cleaned if _CORE_ID.match(cleaned) else f"t{cleaned}"


# -- glove frames to core hands ----------------------------------------------------------------------------------------


def angles_deg(hand: HandFrame, core: SimpleNamespace) -> tuple[np.ndarray, np.ndarray]:
    """The core's 18 angle features in degrees, and 26 wrist-frame joints, from one backend hand.

    The angles are the inverse of core/compat.py hand_to_glove_hand: thumb flexion is [CMC, MCP, IP] and the core keeps
    MCP and IP; the other fingers map MCP, PIP, DIP one to one; spread maps thumb, index, ring and little to the four
    spread slots. Without spread the synthetic hand's own fan is used. The joints are the core's synthetic hand bent
    to the measured flexion.
    """
    H = core.H
    a = np.zeros(H.N_ANGLES)
    thumb = hand.flexion["thumb"]
    a[H.FLEXION_SLOTS["thumb"]] = np.degrees([thumb[1], thumb[2]])
    for f in ("index", "middle", "ring", "little"):
        a[H.FLEXION_SLOTS[f]] = np.degrees(hand.flexion[f])
    per_joint = {f: tuple(float(a[i]) for i in H.FLEXION_SLOTS[f]) for f in H.FINGERS}
    joints = H.synth_joints(side=hand.side, joint_angles=per_joint)
    if hand.spread is not None:
        s = hand.spread
        a[14:18] = np.degrees([s.thumb, s.index, s.ring, s.little])
    else:
        a[14:18] = H.angle_features(joints)[14:18]
    return a, joints


def hand_state(hand: HandFrame, t_us: int, core: SimpleNamespace) -> Any:
    """A core HandState for one backend hand at one instant."""
    angles, joints = angles_deg(hand, core)
    held = hand.wrist_pos is not None
    state = core.H.HandState(
        side=hand.side,
        device_id=0,
        source="glove",
        t_us=int(t_us),
        joints_local=joints,
        wrist_p=np.asarray(hand.wrist_pos if held else (0.0, 0.0, 0.0), dtype=float),
        wrist_q=np.asarray(hand.wrist_quat, dtype=float),
        anchor="held" if held else "rest",
    )
    state.angles = angles
    return state


def lesson_source(frames: list[GloveFrame]) -> str:
    """`fake` when every frame came from the simulator, else `glove` (core lesson.json `source`)."""
    return "fake" if frames and all(f.source == "simulator" for f in frames) else "glove"


def sides_in(rec: Recording) -> list[str]:
    """The hands the take holds frames for, left before right."""
    present = {h.side for f in rec.frames for h in f.hands}
    return [s for s in c.SIDES if s in present]


@dataclass
class Segment:
    """One stretch of glove frames that becomes one or more core steps."""

    frames: list[GloveFrame]
    name: str | None = None
    note: str | None = None


def record_folder(
    core: SimpleNamespace,
    segments: list[Segment],
    side: str,
    out_parent: Path,
    lesson_id: str,
    meta: dict[str, Any],
) -> tuple[Path, Any] | None:
    """Run the core's recorder over the segments for one hand and save the lesson folder under out_parent.

    One segment: the recorder cuts the steps itself (marks none, stillness rule), as it does for a take with no marks.
    Several segments: a mark at every join, so each segment is exactly one core step, named and noted from the lesson.
    Returns the folder and the core lesson, or None when the hand has fewer than two samples.
    """
    rec = core.Recorder(core.cfg.record, core.cfg.score.hold_ms_default)
    rec.start(0, meta["title"], "general", meta.get("task_config", {}), side, source=meta["source"], master_name=meta["expert"])
    offset_s = 0.0
    joins: list[int] = []
    last_us = 0
    for k, seg in enumerate(segments):
        if k > 0:
            joins.append(last_us + 1)
            offset_s = last_us / 1e6 + c.CORE_EXPORT_STEP_GAP_S
        for frame in seg.frames:
            hand = frame.hand(side)  # type: ignore[arg-type]
            if hand is None:
                continue
            t_us = int(round((offset_s + frame.t) * 1e6))
            rec.add(hand_state(hand, t_us, core))
            last_us = max(last_us, t_us)
    for t in joins:
        rec.mark(t)
    lesson = rec.stop(last_us, save=True, lesson_id=lesson_id)
    if lesson is None:
        return None
    if len(segments) > 1 and len(lesson.steps) == len(segments):
        for step, seg in zip(lesson.steps, segments, strict=True):
            step.name, step.note, step.named_by = seg.name or step.name, seg.note, "manual"
    elif len(lesson.steps) == 1 and segments[0].name:
        step = lesson.steps[0]
        step.name, step.note, step.named_by = segments[0].name, segments[0].note, "manual"
    lesson.created = meta.get("created") or lesson.created
    return lesson.save(out_parent, keyframes=True, overwrite=True), lesson


# -- the manifest and the worker ---------------------------------------------------------------------------------------


@dataclass
class SyncReport:
    """What one sync did."""

    exported: list[str] = field(default_factory=list)
    unchanged: int = 0
    skipped: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    available: bool = True


def _fingerprint(*paths: Path) -> str:
    """Size and modification time of the files a folder was built from (missing files count too)."""
    h = hashlib.sha256()
    for p in paths:
        try:
            st = p.stat()
            h.update(f"{p.name}:{st.st_size}:{st.st_mtime_ns};".encode())
        except OSError:
            h.update(f"{p.name}:missing;".encode())
    return h.hexdigest()[:16]


class CoreLessonExporter:
    """Keeps <out_dir> in step with the stored takes and lessons."""

    def __init__(self, data_dir: Path, out_dir: Path | None = None, enabled: bool = True) -> None:
        """Watch data_dir's recordings/ and lessons/; write under out_dir (default <data_dir>/core_lessons)."""
        self.data_dir = Path(data_dir)
        self.out_dir = Path(out_dir) if out_dir is not None else self.data_dir / c.CORE_EXPORT_DIR_NAME
        self.enabled = enabled
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # paths
    @property
    def manifest_path(self) -> Path:
        """The manifest file."""
        return self.out_dir / c.CORE_EXPORT_MANIFEST_FILE

    def _rel(self, p: Path) -> str:
        """A path relative to the export folder, with forward slashes."""
        return p.relative_to(self.out_dir).as_posix()

    def _take_file(self, take_id: str) -> Path:
        return self.data_dir / "recordings" / f"{take_id}.json"

    # worker
    def start(self) -> None:
        """Sync once in the background, then on every notify() and every CORE_EXPORT_SYNC_INTERVAL_S."""
        if not self.enabled or self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="core-export", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop the worker and wait for a sync in progress."""
        if self._thread is None:
            return
        self._stop.set()
        self._wake.set()
        self._thread.join(timeout=30)
        self._thread = None

    def notify(self) -> None:
        """A take or lesson was saved or deleted: sync soon."""
        self._wake.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                report = self.sync()
                if report.exported or report.removed or report.failed:
                    log.info(
                        "Core lesson export: %d written, %d removed, %d failed, %d unchanged (%s)",
                        len(report.exported), len(report.removed), len(report.failed), report.unchanged, self.out_dir,
                    )
            except Exception:
                log.warning("Core lesson export sync failed", exc_info=True)
            self._wake.wait(c.CORE_EXPORT_SYNC_INTERVAL_S)
            if self._stop.is_set():
                break
            self._wake.clear()
            self._stop.wait(c.CORE_EXPORT_DEBOUNCE_S)

    # manifest
    def manifest(self) -> dict[str, Any]:
        """The manifest as stored, or an empty one."""
        try:
            data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("entries"), list):
                return data
        except (OSError, ValueError):
            pass
        return {"entries": []}

    def _write_manifest(self, entries: list[dict[str, Any]]) -> None:
        doc = {
            "schema": c.CORE_EXPORT_SCHEMA,
            "updated_at": utc_now_iso(),
            "format": f"{c.CORE_LESSON_SCHEMA} lesson folders (SPEC.md 'Lesson files')",
            "read_by": "core.recorder.Lesson.load, coach_tune/build_dataset.py, weights/check_lessons.py, verda/gemma_client.py (request context for the model hosted on Verda); all local, nothing uploaded",
            "angles": "raw glove flexion in degrees; the backend's flat and fist calibration is not applied",
            "joints": "core.hand.synth_joints driven by the measured angles (our glove frames carry no joint positions)",
            "entries": sorted(entries, key=lambda e: (e["kind"], e.get("created") or "", e["id"])),
        }
        self.out_dir.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.out_dir, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(doc, handle, indent=2)
            os.replace(tmp, self.manifest_path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    # sync
    def sync(self) -> SyncReport:
        """Export every take and lesson whose files changed, drop folders whose source is gone, rewrite the manifest."""
        report = SyncReport()
        if not self.enabled:
            report.available = False
            return report
        core = load_core()
        if core is None:
            report.available = False
            return report
        with self._lock:
            old = {(e["kind"], e["id"]): e for e in self.manifest()["entries"]}
            entries: list[dict[str, Any]] = []
            seen: set[tuple[str, str]] = set()
            for kind, folder in (("take", "recordings"), ("lesson", "lessons")):
                for path in sorted((self.data_dir / folder).glob("*.json")):
                    key = (kind, path.stem)
                    seen.add(key)
                    entry = self._sync_one(core, kind, path, old.get(key), report)
                    if entry is not None:
                        entries.append(entry)
            for key, entry in old.items():
                if key not in seen:
                    self._remove_folders(entry)
                    report.removed.append(f"{key[0]}:{key[1]}")
            self._write_manifest(entries)
        return report

    def _sources(self, kind: str, path: Path) -> list[Path]:
        """The files a folder is built from: the take, or the lesson plus the takes its steps use."""
        if kind == "take":
            return [path]
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            ids = [s.get("reference_recording_id") for s in raw.get("steps", [])]
        except (OSError, ValueError, AttributeError):
            ids = []
        return [path, *(self._take_file(i) for i in ids if isinstance(i, str) and re.match(c.SAFE_ID_PATTERN, i))]

    def _sync_one(
        self, core: SimpleNamespace, kind: str, path: Path, old: dict[str, Any] | None, report: SyncReport
    ) -> dict[str, Any] | None:
        fp = _fingerprint(*self._sources(kind, path))
        if old is not None and old.get("fingerprint") == fp and all((self.out_dir / f).is_dir() for f in old.get("folders", [])):
            report.unchanged += 1
            return old
        if old is not None:
            self._remove_folders(old)
        try:
            entry = self.export_take(core, path) if kind == "take" else self.export_lesson(core, path)
        except Exception as exc:
            log.warning("Core lesson export of %s %s failed", kind, path.stem, exc_info=True)
            report.failed.append(f"{kind}:{path.stem}")
            entry = self._entry(kind, path.stem, path, reason=f"export failed: {type(exc).__name__}: {exc}")
        entry["fingerprint"] = fp
        if entry["folders"]:
            report.exported.append(f"{kind}:{path.stem}")
        elif not entry.get("reason", "").startswith("export failed"):
            report.skipped.append(f"{kind}:{path.stem}")
        return entry

    def _entry(self, kind: str, item_id: str, path: Path, **extra: Any) -> dict[str, Any]:
        return {
            "kind": kind,
            "id": item_id,
            "source_file": path.relative_to(self.data_dir).as_posix(),
            "exported_at": utc_now_iso(),
            "folders": [],
            **extra,
        }

    def _remove_folders(self, entry: dict[str, Any]) -> None:
        for rel in entry.get("folders", []):
            target = (self.out_dir / rel).resolve()
            if self.out_dir.resolve() in target.parents:
                shutil.rmtree(target, ignore_errors=True)

    def _save(self, core: SimpleNamespace, segments: list[Segment], side: str, sub: str, folder_id: str, meta: dict) -> dict | None:
        """Record one folder into a temporary place, then move it to <out_dir>/<sub>/<folder_id>."""
        parent = self.out_dir / sub
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=self.out_dir, prefix=".tmp-") as tmp:
            made = record_folder(core, segments, side, Path(tmp), folder_id, meta)
            if made is None:
                return None
            built, lesson = made
            target = parent / folder_id
            if target.exists():
                shutil.rmtree(target)
            shutil.move(str(built), str(target))
        frames = sorted(p.name for p in (target / "frames").glob("*.jpg"))
        return {
            "folder": self._rel(target),
            "side": side,
            "steps": len(lesson.steps),
            "kinds": [s.kind for s in lesson.steps],
            "frames": len(frames),
            "duration_s": round(lesson.duration_us / 1e6, 3),
            "rate_hz": lesson.rate_hz,
        }

    def _lesson_titles(self, lesson_id: str | None, step_id: str | None) -> tuple[Lesson | None, Any]:
        """The stored lesson and step a take belongs to, when they exist."""
        if not lesson_id or not re.match(c.SAFE_ID_PATTERN, lesson_id):
            return None, None
        path = self.data_dir / "lessons" / f"{lesson_id}.json"
        try:
            lesson = Lesson.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None, None
        step = next((s for s in lesson.steps if s.id == step_id), None)
        return lesson, step

    def export_take(self, core: SimpleNamespace, path: Path) -> dict[str, Any]:
        """One folder per hand of a stored take (<take id>-<side>)."""
        rec = Recording.model_validate_json(path.read_text(encoding="utf-8"))
        lesson, step = self._lesson_titles(rec.lesson_id, rec.step_id)
        title = f"{lesson.title}: {step.title}" if lesson and step else (step.title if step else f"Expert take {rec.started_at[:16]}")
        source = lesson_source(rec.frames)
        entry = self._entry(
            "take",
            rec.id,
            path,
            title=title,
            created=rec.started_at,
            lesson_id=rec.lesson_id,
            step_id=rec.step_id,
            hands=rec.hands,
            glove_source=source,
            video=rec.video.model_dump() if rec.video else None,
            parts=[],
        )
        sides = sides_in(rec)
        if not sides:
            entry["reason"] = "the take has no hand frames"
            return entry
        meta = {
            "title": title,
            "source": source,
            "expert": lesson.master_name if lesson else c.CORE_EXPORT_DEFAULT_EXPERT,
            "created": rec.started_at,
            "task_config": {"geppetto": {"recording_id": rec.id, "lesson_id": rec.lesson_id, "step_id": rec.step_id}},
        }
        segment = Segment(rec.frames, step.title if step else None, step.instruction if step else None)
        for side in sides:
            part = self._save(core, [segment], side, c.CORE_EXPORT_TAKES_DIR, core_id(f"{rec.id}-{side}"), meta)
            if part is not None:
                entry["parts"].append(part)
                entry["folders"].append(part["folder"])
        if not entry["folders"]:
            entry["reason"] = "fewer than two samples per hand"
        return entry

    def export_lesson(self, core: SimpleNamespace, path: Path) -> dict[str, Any]:
        """One folder for a lesson: the reference take of each recorded step, joined in step order, one core step each.

        The core lesson has one demonstrating hand: the hand most steps name ("both" counts for each). A step whose
        take lacks that hand, or a step with no take (a synthesised motion), is listed under skipped_steps.
        """
        lesson = Lesson.model_validate_json(path.read_text(encoding="utf-8"))
        entry = self._entry("lesson", lesson.id, path, title=lesson.title, created=lesson.created_at, skill=lesson.skill)
        takes: list[tuple[Any, Recording]] = []
        skipped: list[dict[str, str]] = []
        for step in lesson.steps:
            rid = step.reference_recording_id
            take_path = self._take_file(rid) if rid and re.match(c.SAFE_ID_PATTERN, rid) else None
            if take_path is None or not take_path.exists():
                skipped.append({"step_id": step.id, "title": step.title, "reason": "no recorded take"})
                continue
            takes.append((step, Recording.model_validate_json(take_path.read_text(encoding="utf-8"))))
        votes = {s: 0 for s in c.SIDES}
        for step, rec in takes:
            for s in c.SIDES:
                if (step.hands in (s, "both")) and s in sides_in(rec):
                    votes[s] += 1
        side = max(c.SIDES, key=lambda s: (votes[s], s == "right"))
        segments: list[Segment] = []
        used: list[str] = []
        for step, rec in takes:
            if side not in sides_in(rec):
                skipped.append({"step_id": step.id, "title": step.title, "reason": f"the take has no {side} hand"})
                continue
            segments.append(Segment(rec.frames, step.title, step.instruction))
            used.append(rec.id)
        entry.update(side=side, recording_ids=used, skipped_steps=skipped)
        if not segments:
            entry["reason"] = "no step has a recorded take"
            return entry
        frames = [f for seg in segments for f in seg.frames]
        source = lesson_source(frames)
        meta = {
            "title": lesson.title,
            "source": source,
            "expert": lesson.master_name,
            "created": lesson.created_at,
            "task_config": {"geppetto": {"lesson_id": lesson.id, "skill": lesson.skill, "recording_ids": used}},
        }
        part = self._save(core, segments, side, c.CORE_EXPORT_LESSONS_DIR, core_id(lesson.id), meta)
        entry["glove_source"] = source
        if part is None:
            entry["reason"] = "fewer than two samples"
            return entry
        entry["parts"] = [part]
        entry["folders"] = [part["folder"]]
        return entry

    def folders_for(self, item_id: str) -> list[Path]:
        """The exported folders of a take or lesson id, from the manifest."""
        for e in self.manifest()["entries"]:
            if e["id"] == item_id:
                return [self.out_dir / f for f in e.get("folders", [])]
        return []

