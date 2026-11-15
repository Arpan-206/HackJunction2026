"""Share recorded lessons between machines (macOS and Windows) through Git: export into lessons/shared/, import back.

Run from backend/ (the same line works in a macOS shell and in Windows PowerShell):

    uv run python scripts/lesson_sync.py export --recorder arpan
    uv run python scripts/lesson_sync.py import

Export writes lessons/shared/<recorder>/ in the repo: the backend's lesson records (seed lessons are skipped: they ship
with the app), its takes (glove frame recordings), both kinds of calibration, the core lesson folders that
services/core_export.py made from them (lesson.json, trace.npz, frames/*.jpg) and the matching core_lessons manifest
entries, plus the root lessons/ folders that Git does not track. Every id is prefixed with "<recorder>-" (once), and
every reference to it is rewritten. A manifest (sync-manifest.json) lists every file with its size and SHA-256.

Import verifies every hash first (one bad file stops the import before anything is written), then copies each item into
the backend data directory, never over an existing id unless --force, and prints three lists: added, skipped, replaced.

Pure standard library: pathlib only, no shell-outs except an optional `git ls-files` to skip tracked root lessons.
See docs/LESSON_SYNC.md.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import getpass
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

FORMAT = "geppetto.lesson-sync/1"
MANIFEST = "sync-manifest.json"
SEED_PREFIX = "seed-"
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
RECORDER_MAX = 20
# Relative path budget inside the repo, so the repo itself can sit up to about 100 characters deep on Windows
# (MAX_PATH is 260) without long path support.
REL_PATH_MAX = 150
WINDOWS_FORBIDDEN = set('<>:"/\\|?*')
WINDOWS_RESERVED = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
SIDES = ("left", "right", "both")

REPO_ROOT = Path(__file__).resolve().parents[2]

# kind -> folder under backend data dir and under the bundle's backend/ folder
BACKEND_KINDS = {
    "lesson": "lessons",
    "take": "recordings",
    "calibration": "calibrations",
    "glove_calibration": "glove_calibrations",
}


class SyncError(Exception):
    """A real error: the command exits non-zero with this message."""


# -- names and ids -----------------------------------------------------------------------------------------------------


def sanitise_recorder(raw: str) -> str:
    """Lower-case letters and digits only, at most RECORDER_MAX characters."""
    name = re.sub(r"[^a-z0-9]+", "", raw.lower())[:RECORDER_MAX]
    if not name:
        raise SyncError(f"recorder name {raw!r} has no letters or digits")
    return name


def default_recorder() -> str:
    """The OS user name, sanitised (calibration wearer names such as 'Guest 18:27:31' are not stable enough)."""
    try:
        return sanitise_recorder(getpass.getuser())
    except Exception:  # noqa: BLE001 - any failure falls back to a fixed name
        return "unknown"


def prefixed(item_id: str, recorder: str) -> str:
    """Add '<recorder>-' once: an id that already carries it is kept, so a second export changes nothing."""
    if item_id.startswith(f"{recorder}-"):
        return item_id
    return f"{recorder}-{item_id}"


def check_name(part: str) -> str | None:
    """Why a single path component is unsafe on Windows or macOS, or None when it is fine."""
    if not part or part in (".", ".."):
        return "empty or dot name"
    bad = sorted({ch for ch in part if ch in WINDOWS_FORBIDDEN or ord(ch) < 32})
    if bad:
        return f"forbidden characters {''.join(bad)!r}"
    if part[-1] in " .":
        return "ends with a space or a dot"
    if part.split(".")[0].upper() in WINDOWS_RESERVED:
        return "reserved Windows name"
    return None


def check_paths(rel_paths: list[str]) -> list[str]:
    """Every problem with a set of relative POSIX paths: unsafe names, long paths, names equal but for case."""
    problems: list[str] = []
    seen: dict[str, str] = {}
    for rel in rel_paths:
        for part in rel.split("/"):
            why = check_name(part)
            if why:
                problems.append(f"{rel}: {why}")
        if len(rel) > REL_PATH_MAX:
            problems.append(f"{rel}: path longer than {REL_PATH_MAX} characters")
        low = rel.casefold()
        if low in seen and seen[low] != rel:
            problems.append(f"{rel}: differs only in case from {seen[low]}")
        seen[low] = rel
    return problems


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rewrite(value: Any, mapping: dict[str, str]) -> Any:
    """Replace every JSON string that equals an old id (or an id-derived name) with its new value; keys stay."""
    if isinstance(value, str):
        return mapping.get(value, value)
    if isinstance(value, list):
        return [rewrite(v, mapping) for v in value]
    if isinstance(value, dict):
        return {k: rewrite(v, mapping) for k, v in value.items()}
    return value


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_compact(obj: Any) -> bytes:
    """The backend's own JSON store style (pydantic model_dump_json): compact, UTF-8."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def dump_pretty(obj: Any) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def write_bytes(path: Path, data: bytes) -> None:
    """Write atomically (temp file in the same folder, then replace)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


# -- export ------------------------------------------------------------------------------------------------------------


@dataclass
class Plan:
    """Files to write: relative POSIX path in the bundle -> bytes, or a source file copied byte for byte."""

    data: dict[str, bytes] = field(default_factory=dict)
    copies: dict[str, Path] = field(default_factory=dict)
    items: dict[str, list[str]] = field(default_factory=dict)
    left_out: dict[str, int] = field(default_factory=dict)

    def add_item(self, kind: str, item_id: str) -> None:
        self.items.setdefault(kind, []).append(item_id)

    def paths(self) -> list[str]:
        return sorted([*self.data, *self.copies])


def tracked_root_lessons(repo: Path) -> set[str] | None:
    """Folder names under lessons/ that Git tracks in the source repo, or None when Git cannot tell."""
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "ls-files", "lessons"],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return {line.split("/")[1] for line in out.splitlines() if line.count("/") >= 2}


def wearer_key(name: Any) -> str:
    """The first word of a wearer name, lower-case letters and digits only ('Arpan P.' -> 'arpan')."""
    if not isinstance(name, str) or not name.strip():
        return ""
    return re.sub(r"[^a-z0-9]+", "", name.strip().split()[0].lower())


def take_calibration_ids(data_dir: Path) -> set[str]:
    """Flat and fist calibration ids that the core export used for the takes (core_lessons manifest parts)."""
    path = data_dir / "core_lessons" / "manifest.json"
    out: set[str] = set()
    if path.is_file():
        for entry in read_json(path).get("entries", []):
            for part in entry.get("parts") or []:
                cal = (part or {}).get("calibration") or {}
                if entry.get("kind") == "take" and isinstance(
                    cal.get("range_calibration_id"), str
                ):
                    out.add(cal["range_calibration_id"])
    return out


def filter_wearers(
    records: dict[str, list[tuple[str, Path, Any]]],
    data_dir: Path,
    allowed: set[str],
    plan: Plan,
) -> None:
    """Keep only the allowed wearers' calibrations (the privacy rule, docs/LESSON_SYNC.md).

    A wearer calibration record is kept when the first word of its wearer name is on the allowlist. A flat and fist
    calibration (it carries no name) is kept when a kept wearer record points to it, or when an exported take was
    recorded with it, so that take still scores the same. Every other calibration is left out and counted.
    """
    kept_wearers, other_wearers = [], []
    for row in records.get("glove_calibration", []):
        (
            kept_wearers
            if wearer_key(row[2].get("wearer")) in allowed
            else other_wearers
        ).append(row)
    wanted = {
        i
        for r in kept_wearers
        for i in (r[2].get("range_calibration_ids") or {}).values()
    }
    wanted |= take_calibration_ids(data_dir)
    other_ids = {
        i
        for r in other_wearers
        for i in (r[2].get("range_calibration_ids") or {}).values()
    }
    kept_cals, dropped_cals = [], []
    for row in records.get("calibration", []):
        (kept_cals if row[0] in wanted else dropped_cals).append(row)
    records["glove_calibration"] = kept_wearers
    records["calibration"] = kept_cals
    plan.left_out |= {
        "wearer calibration records of other wearers": len(other_wearers),
        "flat and fist calibrations of other wearers": sum(
            r[0] in other_ids for r in dropped_cals
        ),
        "flat and fist calibrations with no known wearer and no exported take": sum(
            r[0] not in other_ids for r in dropped_cals
        ),
    }


@dataclass
class Session:
    """Export filter: only the recorder's own lessons (only_recorder), and nothing older than since (UTC)."""

    only_recorder: bool = False
    since: _dt.datetime | None = None


def parse_since(raw: str) -> _dt.datetime:
    """A date (2026-11-15) or date-time (2026-11-15T01:30, 2026-11-15 01:30+02:00); no zone means UTC."""
    try:
        value = _dt.datetime.fromisoformat(raw.strip())
    except ValueError as exc:
        raise SyncError(
            f"--since {raw!r} is not a date or date-time (for example 2026-11-15T01:30)"
        ) from exc
    return value if value.tzinfo else value.replace(tzinfo=_dt.UTC)


def _time(value: Any) -> _dt.datetime | None:
    try:
        return parse_since(value) if isinstance(value, str) and value else None
    except SyncError:
        return None


def session_reason(
    name: Any, created: Any, recorder: str, session: Session, item_id: str = ""
) -> str | None:
    """Why a lesson stays out of a session export, or None when it goes in."""
    if item_id.startswith("fake-") or item_id.startswith(f"{recorder}-fake-"):
        return "test fixture (fake-*)"
    if session.only_recorder and wearer_key(name) != recorder:
        return f"expert is not {recorder}"
    if session.since is not None:
        when = _time(created)
        if when is None or when < session.since:
            return "recorded before --since"
    return None


def filter_session(
    records: dict[str, list[tuple[str, Path, Any]]],
    recorder: str,
    session: Session,
    plan: Plan,
) -> None:
    """Keep the recorder's lessons of this session (master_name, created_at) and the takes they use.

    With --only-recorder a take goes in only when a kept lesson uses it (reference or take_ids, or its lesson_id);
    takes of seed lessons are practice and stay out. Without it, a take is kept when it passes --since (started_at).
    """
    kept, why = [], {}
    for row in records.get("lesson", []):
        reason = session_reason(
            row[2].get("master_name"),
            row[2].get("created_at"),
            recorder,
            session,
            row[0],
        )
        if reason:
            why[reason] = why.get(reason, 0) + 1
        else:
            kept.append(row)
    records["lesson"] = kept
    lesson_ids = {r[0] for r in kept}
    used = {
        i
        for r in kept
        for s in r[2].get("steps", [])
        for i in [s.get("reference_recording_id"), *(s.get("take_ids") or [])]
        if i
    }
    takes = []
    for row in records.get("take", []):
        obj = row[2]
        linked = row[0] in used or obj.get("lesson_id") in lesson_ids
        if session.only_recorder and not linked:
            reason = "take not used by a kept lesson"
        elif (
            session.since is not None
            and not linked
            and (
                (_time(obj.get("started_at")) or session.since) < session.since
                or not obj.get("started_at")
            )
        ):
            reason = "take recorded before --since"
        else:
            reason = None
        if reason:
            why[reason] = why.get(reason, 0) + 1
        else:
            takes.append(row)
    records["take"] = takes
    plan.left_out.update(why)


def build_export(
    data_dir: Path,
    root_lessons: Path | None,
    recorder: str,
    tracked: set[str] | None,
    allowed: set[str] | None = None,
    session: Session | None = None,
) -> Plan:
    """Read the source data and plan the bundle, ids prefixed and references rewritten."""
    plan = Plan()
    mapping: dict[str, str] = {}
    records: dict[str, list[tuple[str, Path, Any]]] = {}
    for kind, folder in BACKEND_KINDS.items():
        rows = []
        for path in sorted((data_dir / folder).glob("*.json")):
            obj = read_json(path)
            item_id = obj.get("id", path.stem) if isinstance(obj, dict) else path.stem
            if kind == "lesson" and str(item_id).startswith(SEED_PREFIX):
                continue  # seeds ship with the app on every machine
            if not SAFE_ID.match(str(item_id)):
                raise SyncError(f"{path}: unsafe id {item_id!r}")
            new = prefixed(item_id, recorder)
            if not SAFE_ID.match(new):
                raise SyncError(
                    f"{path}: prefixed id {new!r} is longer than 64 characters"
                )
            mapping[item_id] = new
            mapping[f"{folder}/{item_id}.json"] = f"{folder}/{new}.json"
            if kind == "take":
                for side in SIDES:
                    mapping[f"{item_id}-{side}"] = f"{new}-{side}"
                    mapping[f"takes/{item_id}-{side}"] = f"takes/{new}-{side}"
            if kind == "lesson":
                mapping[f"lessons/{item_id}"] = f"lessons/{new}"
            rows.append((item_id, path, obj))
        records[kind] = rows
    if session is not None:
        filter_session(records, recorder, session, plan)
    if allowed is not None:
        filter_wearers(records, data_dir, allowed, plan)
    for kind, rows in records.items():
        folder = BACKEND_KINDS[kind]
        for item_id, _path, obj in rows:
            new = mapping[item_id]
            plan.data[f"backend/{folder}/{new}.json"] = dump_compact(
                rewrite(obj, mapping)
            )
            plan.add_item(kind, new)

    # core lesson folders made by services/core_export.py, with their manifest entries
    core_dir = data_dir / "core_lessons"
    core_manifest = core_dir / "manifest.json"
    kept_entries = []
    if core_manifest.is_file():
        manifest = read_json(core_manifest)
        exported = {(k, i) for k, rows in records.items() for i, _p, _o in rows}
        for entry in manifest.get("entries", []):
            if (entry.get("kind"), entry.get("id")) not in exported:
                continue
            for rel in entry.get("folders", []):
                src = core_dir / rel
                if not src.is_dir():
                    continue
                new_rel = mapping.get(rel, rel)
                add_core_folder(plan, src, f"core_lessons/{new_rel}", mapping)
            if allowed is not None:
                for part in entry.get("parts") or []:
                    cal = (part or {}).get("calibration")
                    if (
                        isinstance(cal, dict)
                        and cal.get("wearer")
                        and wearer_key(cal["wearer"]) not in allowed
                    ):
                        cal["wearer"] = None  # never carry another wearer's name
            kept_entries.append(rewrite(entry, mapping))
        header = {k: v for k, v in manifest.items() if k != "entries"}
        plan.data["core_lessons/manifest.json"] = dump_pretty(
            {**header, "entries": kept_entries}
        )

    # root lessons/ folders of the core that Git does not track (the glove slot recordings)
    if root_lessons is not None and root_lessons.is_dir():
        for folder in sorted(root_lessons.iterdir()):
            if folder.name == "shared" or not (folder / "lesson.json").is_file():
                continue
            if tracked is not None and folder.name in tracked:
                continue
            if session is not None:
                core = read_json(folder / "lesson.json")
                reason = session_reason(
                    (core.get("master") or {}).get("name"),
                    core.get("created"),
                    recorder,
                    session,
                    folder.name,
                )
                if reason:
                    key = f"root core lesson: {reason}"
                    plan.left_out[key] = plan.left_out.get(key, 0) + 1
                    continue
            new = prefixed(folder.name, recorder)
            add_core_folder(plan, folder, f"root_lessons/{new}", {folder.name: new})
            plan.add_item("root_lesson", new)
    return plan


def add_core_folder(
    plan: Plan, src: Path, dest_rel: str, mapping: dict[str, str]
) -> None:
    """Copy a core lesson folder: lesson.json rewritten (its id and references), every other file byte for byte."""
    for path in sorted(p for p in src.rglob("*") if p.is_file()):
        rel = path.relative_to(src).as_posix()
        if rel == "lesson.json":
            plan.data[f"{dest_rel}/lesson.json"] = dump_pretty(
                rewrite(read_json(path), mapping)
            )
        else:
            plan.copies[f"{dest_rel}/{rel}"] = path


def export(
    data_dir: Path,
    root_lessons: Path | None,
    out_root: Path,
    recorder: str,
    dry_run: bool = False,
    tracked: set[str] | None = None,
    wearers: set[str] | None = None,
    include_other_wearers: bool = False,
    session: Session | None = None,
) -> dict[str, Any]:
    """Write lessons/shared/<recorder>/ and its manifest; an unchanged export leaves every file as it was.

    Calibrations of wearers other than the recorder and `wearers` are left out unless include_other_wearers.
    """
    allowed = None if include_other_wearers else {recorder, *(wearers or set())}
    plan = build_export(data_dir, root_lessons, recorder, tracked, allowed, session)
    problems = check_paths([f"{recorder}/{p}" for p in plan.paths()])
    if problems:
        raise SyncError("names unsafe on Windows or macOS:\n  " + "\n  ".join(problems))
    files = []
    for rel in plan.paths():
        if rel in plan.data:
            blob = plan.data[rel]
            files.append(
                {
                    "path": rel,
                    "size": len(blob),
                    "sha256": hashlib.sha256(blob).hexdigest(),
                }
            )
        else:
            src = plan.copies[rel]
            files.append(
                {"path": rel, "size": src.stat().st_size, "sha256": sha256(src)}
            )
    bundle = out_root / recorder
    old_manifest = bundle / MANIFEST
    counts = {k: len(v) for k, v in sorted(plan.items.items())}
    summary = {
        "bundle": str(bundle),
        "files": len(files),
        "bytes": sum(f["size"] for f in files),
        "items": counts,
        "left_out": plan.left_out,
    }
    if dry_run:
        return summary
    if old_manifest.is_file():
        try:
            old = read_json(old_manifest)
        except ValueError:
            old = {}
        if old.get("files") == files and old.get("items") == plan.items:
            summary["unchanged"] = True
            return summary
    # replace this recorder's folder only; other recorders' bundles stay
    if bundle.exists():
        shutil.rmtree(bundle)
    for rel in plan.paths():
        target = bundle.joinpath(*rel.split("/"))
        if rel in plan.data:
            write_bytes(target, plan.data[rel])
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(plan.copies[rel], target)
    manifest = {
        "format": FORMAT,
        "recorder": recorder,
        "exported_at": _dt.datetime.now(_dt.UTC).isoformat(timespec="seconds"),
        "items": plan.items,
        "files": files,
    }
    write_bytes(old_manifest, dump_pretty(manifest))
    return summary


# -- import ------------------------------------------------------------------------------------------------------------


@dataclass
class Report:
    added: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    replaced: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    backup: Path | None = None


BACKUP_DIR = "lesson_backups"


def replace_set(data_dir: Path) -> list[Path]:
    """The installed lessons that --replace removes: lesson records except seeds, every take, and every file of the
    core lesson folders (core_lessons/, which the backend rebuilds from the records). Calibrations are not in it."""
    out = [
        p
        for p in sorted((data_dir / "lessons").glob("*.json"))
        if not p.stem.startswith(SEED_PREFIX)
    ]
    out += sorted((data_dir / "recordings").glob("*.json"))
    core = data_dir / "core_lessons"
    if core.is_dir():
        out += sorted(p for p in core.rglob("*") if p.is_file())
    return out


def backup_and_clear(data_dir: Path, dry_run: bool) -> tuple[set[Path], Path]:
    """Copy the replace set to <data_dir parent>/lesson_backups/<UTC time>/, verify every copy by size and SHA-256,
    and only then remove the originals. The backup folder is outside the data folder, so the app never reads it."""
    files = replace_set(data_dir)
    stamp = _dt.datetime.now(_dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    root = data_dir.parent / BACKUP_DIR
    backup = root / stamp
    if dry_run:
        return set(files), backup.resolve()
    if backup.exists():
        raise SyncError(f"backup folder {backup} exists already; try again in a second")
    backup.mkdir(parents=True)
    ignore = root / ".gitignore"
    if not ignore.exists():
        ignore.write_text("*\n", encoding="utf-8")  # never committed by accident
    for src in files:
        target = backup / src.relative_to(data_dir)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, target)
    copies = [backup / src.relative_to(data_dir) for src in files]
    bad = [
        str(src)
        for src, dst in zip(files, copies, strict=True)
        if not dst.is_file()
        or dst.stat().st_size != src.stat().st_size
        or sha256(dst) != sha256(src)
    ]
    if bad or sum(1 for p in backup.rglob("*") if p.is_file()) != len(files):
        raise SyncError(
            f"backup check failed, nothing removed ({backup}):\n  " + "\n  ".join(bad)
        )
    for src in files:
        src.unlink()
    core = data_dir / "core_lessons"
    if core.is_dir():
        for d in sorted(
            (p for p in core.rglob("*") if p.is_dir()),
            key=lambda p: len(p.parts),
            reverse=True,
        ):
            if not any(d.iterdir()):
                d.rmdir()
    return set(files), backup.resolve()


def summary_line(data_dir: Path) -> str:
    """One stable line to compare two machines: recorded lessons, whose (expert name), titles, takes and seeds."""
    lessons = []
    seeds = 0
    for p in sorted((data_dir / "lessons").glob("*.json")):
        try:
            obj = read_json(p)
        except ValueError:
            continue
        if p.stem.startswith(SEED_PREFIX):
            seeds += 1
        else:
            lessons.append(obj)
    whose: dict[str, int] = {}
    for obj in lessons:
        key = wearer_key(obj.get("master_name")) or "unknown"
        whose[key] = whose.get(key, 0) + 1
    recorders = ", ".join(f"{k} {v}" for k, v in sorted(whose.items())) or "none"
    names = (
        "; ".join(sorted(str(o.get("title", "")).strip() for o in lessons)) or "none"
    )
    takes = len(list((data_dir / "recordings").glob("*.json")))
    return f"installed: {len(lessons)} lessons | recorders: {recorders} | names: {names} | takes: {takes} | seeds: {seeds}"


def verify(bundle: Path) -> dict[str, Any]:
    """Read the manifest and check every file's size and SHA-256; raise SyncError naming every bad file."""
    path = bundle / MANIFEST
    if not path.is_file():
        raise SyncError(f"{bundle}: no {MANIFEST}")
    manifest = read_json(path)
    if manifest.get("format") != FORMAT:
        raise SyncError(
            f"{path}: format {manifest.get('format')!r}, expected {FORMAT!r}"
        )
    bad = []
    for item in manifest.get("files", []):
        rel = item["path"]
        if (
            check_name(rel.split("/")[0])
            or ".." in rel.split("/")
            or rel.startswith("/")
        ):
            bad.append(f"{rel}: unsafe path")
            continue
        target = bundle.joinpath(*rel.split("/"))
        if not target.is_file():
            bad.append(f"{rel}: missing")
        elif target.stat().st_size != item["size"] or sha256(target) != item["sha256"]:
            bad.append(
                f"{rel}: size or SHA-256 differs from the manifest (corrupted, or changed by line-ending conversion)"
            )
    if bad:
        raise SyncError(
            f"{bundle}: hash check failed, nothing imported:\n  " + "\n  ".join(bad)
        )
    return manifest


def import_bundles(
    shared: Path,
    data_dir: Path,
    root_lessons: Path | None,
    force: bool = False,
    dry_run: bool = False,
    only: list[str] | None = None,
    replace: bool = False,
    with_calibrations: bool = False,
) -> Report:
    """Verify every bundle, then copy its items in; existing ids are skipped unless force.

    replace: back up and remove every installed lesson first (backup_and_clear), then install the bundles' lessons.
    Calibrations are never removed, and the bundles' calibrations are not installed unless with_calibrations.
    """
    bundles = (
        sorted(p for p in shared.iterdir() if (p / MANIFEST).is_file())
        if shared.is_dir()
        else []
    )
    if only:
        bundles = [b for b in bundles if b.name in only]
    if not bundles:
        raise SyncError(f"no bundle with {MANIFEST} under {shared}")
    manifests = [
        (b, verify(b)) for b in bundles
    ]  # every hash checked before anything is written
    report = Report()
    cleared: set[Path] = set()
    if replace:
        if not (data_dir / "lessons").is_dir():
            raise SyncError(
                f"--replace refused: no backend data folder with lessons/ at {data_dir}"
            )
        incoming = sum(
            len(m["items"].get(k, []))
            for _b, m in manifests
            for k in ("lesson", "take")
        )
        if incoming == 0:
            raise SyncError(
                "--replace refused: the bundle holds no lessons and no takes, so nothing would be installed"
            )
        cleared, report.backup = backup_and_clear(data_dir, dry_run)
        report.removed = sorted(p.relative_to(data_dir).as_posix() for p in cleared)
    for bundle, manifest in manifests:
        files = [f["path"] for f in manifest["files"]]
        for kind, folder in BACKEND_KINDS.items():
            for item_id in manifest["items"].get(kind, []):
                src = bundle / "backend" / folder / f"{item_id}.json"
                dest = data_dir / folder / f"{item_id}.json"
                label = f"{kind} {item_id}"
                if (
                    replace
                    and not with_calibrations
                    and kind in ("calibration", "glove_calibration")
                ):
                    report.skipped.append(
                        f"{label} (replace keeps this machine's calibrations)"
                    )
                    continue
                if dest.exists() and dest not in cleared:
                    if dest.read_bytes() == src.read_bytes():
                        report.skipped.append(f"{label} (identical)")
                        continue
                    if not force:
                        report.skipped.append(
                            f"{label} (exists and differs; --force replaces it)"
                        )
                        continue
                    report.replaced.append(label)
                else:
                    report.added.append(label)
                if not dry_run:
                    write_bytes(dest, src.read_bytes())
                    if kind in ("take", "lesson"):
                        copy_core_folders(bundle, data_dir, files, item_id, kind)
        if not dry_run:
            merge_core_manifest(bundle, data_dir, manifest)
        for item_id in manifest["items"].get("root_lesson", []):
            label = f"root_lesson {item_id}"
            if root_lessons is None:
                report.skipped.append(f"{label} (no root lessons folder given)")
                continue
            dest = root_lessons / item_id
            if dest.exists() and not force:
                report.skipped.append(f"{label} (exists; --force replaces it)")
                continue
            (report.replaced if dest.exists() else report.added).append(label)
            if not dry_run:
                copy_tree(bundle, files, f"root_lessons/{item_id}", dest)
    return report


def copy_tree(bundle: Path, files: list[str], prefix: str, dest: Path) -> None:
    """Copy the bundle files under prefix/ into dest, replacing dest."""
    if dest.exists():
        shutil.rmtree(dest)
    for rel in files:
        if rel.startswith(prefix + "/"):
            sub = rel[len(prefix) + 1 :]
            target = dest.joinpath(*sub.split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(bundle.joinpath(*rel.split("/")), target)


def copy_core_folders(
    bundle: Path, data_dir: Path, files: list[str], item_id: str, kind: str
) -> None:
    """Copy the core lesson folders of one take (takes/<id>-<side>) or lesson (lessons/<id>)."""
    names = (
        [f"takes/{item_id}-{s}" for s in SIDES]
        if kind == "take"
        else [f"lessons/{item_id}"]
    )
    for name in names:
        prefix = f"core_lessons/{name}"
        if any(rel.startswith(prefix + "/") for rel in files):
            copy_tree(
                bundle,
                files,
                prefix,
                data_dir / "core_lessons" / Path(*name.split("/")),
            )


def merge_core_manifest(bundle: Path, data_dir: Path, manifest: dict[str, Any]) -> None:
    """Add the bundle's core_lessons manifest entries for items now present, keyed by (kind, id)."""
    src = bundle / "core_lessons" / "manifest.json"
    if not src.is_file():
        return
    incoming = read_json(src)
    dest = data_dir / "core_lessons" / "manifest.json"
    current = (
        read_json(dest)
        if dest.is_file()
        else {k: v for k, v in incoming.items() if k != "entries"}
    )
    entries = {(e.get("kind"), e.get("id")): e for e in current.get("entries", [])}
    for entry in incoming.get("entries", []):
        key = (entry.get("kind"), entry.get("id"))
        folders_ok = all(
            (data_dir / "core_lessons" / Path(*f.split("/"))).is_dir()
            for f in entry.get("folders", [])
        )
        if key not in entries and folders_ok:
            entries[key] = entry
    current["entries"] = list(entries.values())
    write_bytes(dest, dump_pretty(current))


# -- command line ------------------------------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("export", "import"):
        p = sub.add_parser(name)
        p.add_argument(
            "--repo",
            type=Path,
            default=REPO_ROOT,
            help="repo holding lessons/shared (default: this one)",
        )
        p.add_argument(
            "--data-dir",
            type=Path,
            default=None,
            help="backend data dir (default: <repo>/backend/data)",
        )
        p.add_argument(
            "--root-lessons",
            type=Path,
            default=None,
            help="core lessons dir (default: <repo>/lessons)",
        )
        p.add_argument(
            "--shared",
            type=Path,
            default=None,
            help="bundle folder (default: <repo>/lessons/shared)",
        )
        p.add_argument(
            "--dry-run",
            action="store_true",
            help="show what would happen, write nothing",
        )
    sub.choices["export"].add_argument(
        "--recorder", default=None, help="name prefixed to every id (default: OS user)"
    )
    sub.choices["export"].add_argument(
        "--wearers",
        default="",
        help="comma-separated wearer names whose calibrations are exported, besides the recorder (first word of the "
        "wearer name, case ignored), for example arpan,szymon",
    )
    sub.choices["export"].add_argument(
        "--include-other-wearers",
        action="store_true",
        help="export every wearer's calibrations and names (off by default: the repo may be public)",
    )
    sub.choices["import"].add_argument(
        "--force", action="store_true", help="replace existing items with the same id"
    )
    sub.choices["import"].add_argument(
        "--only", nargs="*", help="import only these recorders' bundles"
    )
    sub.choices["import"].add_argument(
        "--replace",
        action="store_true",
        help="back up and remove every installed lesson and take first, then install only the bundles' lessons",
    )
    sub.choices["import"].add_argument(
        "--with-calibrations",
        action="store_true",
        help="with --replace: also install the bundles' calibrations",
    )
    sub.choices["export"].add_argument(
        "--only-recorder",
        action="store_true",
        help="export only lessons whose expert (master_name) is the recorder, and the takes they use",
    )
    sub.choices["export"].add_argument(
        "--since",
        default=None,
        help="export only lessons and takes recorded from this date or date-time (UTC if no zone)",
    )
    args = parser.parse_args(argv)
    repo = args.repo.resolve()
    data_dir = (args.data_dir or repo / "backend" / "data").resolve()
    root_lessons = (args.root_lessons or repo / "lessons").resolve()
    shared = (args.shared or repo / "lessons" / "shared").resolve()
    try:
        if args.cmd == "export":
            recorder = (
                sanitise_recorder(args.recorder)
                if args.recorder
                else default_recorder()
            )
            tracked = tracked_root_lessons(repo)
            wearers = {
                sanitise_recorder(w) for w in args.wearers.split(",") if w.strip()
            }
            session = None
            if args.only_recorder or args.since:
                session = Session(
                    args.only_recorder, parse_since(args.since) if args.since else None
                )
            summary = export(
                data_dir,
                root_lessons,
                shared,
                recorder,
                args.dry_run,
                tracked,
                wearers,
                args.include_other_wearers,
                session,
            )
            verb = (
                "would write"
                if args.dry_run
                else ("unchanged" if summary.get("unchanged") else "wrote")
            )
            print(
                f"{verb} {summary['bundle']}: {summary['files']} files, {summary['bytes']} bytes"
            )
            for kind, n in summary["items"].items():
                print(f"  {kind}: {n}")
            if args.include_other_wearers:
                print("every wearer's calibrations included (--include-other-wearers)")
            else:
                allowed = ", ".join(sorted({recorder, *wearers}))
                print(
                    f"left out (calibrations: only these wearers are exported: {allowed}; lessons: the session filter):"
                )
                for why, n in summary["left_out"].items():
                    print(f"  {n} {why}")
        else:
            report = import_bundles(
                shared,
                data_dir,
                root_lessons,
                args.force,
                args.dry_run,
                args.only,
                args.replace,
                args.with_calibrations,
            )
            head = "dry run, nothing written. " if args.dry_run else ""
            print(f"{head}imported into {data_dir}")
            if args.replace:
                verb = (
                    "would back up and remove"
                    if args.dry_run
                    else "backed up and removed"
                )
                print(
                    f"{verb} {len(report.removed)} files; backup folder: {report.backup}"
                )
                for row in report.removed:
                    print(f"  removed {row}")
            for name in ("added", "skipped", "replaced"):
                rows = getattr(report, name)
                print(f"{name} ({len(rows)}):")
                for row in rows:
                    print(f"  {row}")
            print(
                summary_line(data_dir)
                + (" (before the dry run)" if args.dry_run else "")
            )
    except SyncError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
