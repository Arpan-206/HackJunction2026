"""Prove that shared lessons stay identical and scoreable: clone, import, score before and after.

Run from backend/ after `lesson_sync.py export` was committed on this branch:

    uv run python scripts/lesson_sync_proof.py --source-data /path/to/original/backend/data

Steps:
1. Clone this repo (HEAD) into a temp folder with core.autocrlf=true (what Git for Windows sets) and compare every
   bundle file's SHA-256 with the manifest: line-ending conversion must not touch them.
2. Import the clone's lessons/shared into an empty data dir with lesson_sync.py.
3. Score each recorded take with the backend's own ScoringService, once on the original data (original ids) and once on
   the imported data (prefixed ids), with the same step weights, tolerance, margin and calibrations:
   a) take against another take of the same seed step as reference_recording_id (a real recorded reference);
   b) take against its seed step's motion reference.
   Every overall and per-finger score must match within 0.01.
4. Compare every imported core lesson folder file byte for byte with the original.
The original data is only read.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import lesson_sync  # noqa: E402
from app.schemas.lesson import Lesson  # noqa: E402
from app.schemas.records import Calibration, Recording, ScoreRequest  # noqa: E402
from app.services.calibration import CalibrationService  # noqa: E402
from app.services.recorder import Recorder  # noqa: E402
from app.services.scoring import ScoringService  # noqa: E402
from app.services.storage.json_store import JsonStore  # noqa: E402
from app.services.storage.seed import load_seed_lessons  # noqa: E402

TOL = 0.01
FINGERS = ("thumb", "index", "middle", "ring", "little")


def scorer(data_dir: Path) -> ScoringService:
    """The backend's scorer over one data dir, without the live glove pipeline."""
    recorder = Recorder(JsonStore(data_dir / "recordings", Recording))
    cals = CalibrationService(JsonStore(data_dir / "calibrations", Calibration), None)  # type: ignore[arg-type]
    return ScoringService(recorder, cals)


def numbers(result) -> dict[str, float]:
    out = {"overall": float(result.overall)}
    for f in FINGERS:
        out[f] = float(getattr(result.per_finger, f))
    return out


def take_calibrations(data_dir: Path) -> dict[str, str]:
    """take id -> the range calibration id the core export recorded for it (core_lessons manifest)."""
    path = data_dir / "core_lessons" / "manifest.json"
    out: dict[str, str] = {}
    if path.is_file():
        for e in json.loads(path.read_text(encoding="utf-8")).get("entries", []):
            for part in e.get("parts", []) or []:
                cal = (part.get("calibration") or {}).get("range_calibration_id")
                if e.get("kind") == "take" and cal:
                    out[e["id"]] = cal
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-data", type=Path, required=True, help="the original backend data dir (read only)")
    ap.add_argument("--recorder", default="arpan")
    ap.add_argument("--repo", type=Path, default=lesson_sync.REPO_ROOT)
    args = ap.parse_args()
    src = args.source_data.resolve()
    rec = args.recorder
    work = Path(tempfile.mkdtemp(prefix="lesson-sync-proof-"))
    clone = work / "clone"
    subprocess.run(
        ["git", "clone", "-q", "--config", "core.autocrlf=true", str(args.repo), str(clone)], check=True
    )
    # 1. autocrlf: every file must still match the manifest
    bundle = clone / "lessons" / "shared" / rec
    manifest = lesson_sync.verify(bundle)
    crlf_json = sum(
        1 for f in manifest["files"] if f["path"].endswith(".json") and b"\r\n" in (bundle / f["path"]).read_bytes()
    )
    print(f"autocrlf clone: {len(manifest['files'])} files verified by SHA-256, {crlf_json} JSON files with CRLF")
    # 2. import into an empty data dir
    data = clone / "backend" / "data-proof"
    report = lesson_sync.import_bundles(clone / "lessons" / "shared", data, work / "root_lessons", only=[rec])
    print(f"import: added {len(report.added)}, skipped {len(report.skipped)}, replaced {len(report.replaced)}")
    # 3. scores
    seeds = {lesson.id: lesson for lesson in load_seed_lessons()}
    original, imported = scorer(src), scorer(data)
    cals = take_calibrations(src)
    takes = sorted(src.joinpath("recordings").glob("*.json"))
    by_step: dict[tuple[str, str], list[str]] = {}
    for p in takes:
        r = json.loads(p.read_text(encoding="utf-8"))
        if r.get("lesson_id") in seeds:
            by_step.setdefault((r["lesson_id"], r["step_id"]), []).append(r["id"])
    rows = []
    worst = 0.0
    for (lesson_id, step_id), ids in sorted(by_step.items()):
        step = next((s for s in seeds[lesson_id].steps if s.id == step_id), None)
        if step is None:
            continue
        common = {"tolerance": step.tolerance, "weights": step.weights, "margin": "standard"}
        cases = []
        ref = ids[0]
        for att in ids[1:]:
            cases.append(("take", ref, att))
        if step.motion is not None:
            cases += [("motion", None, att) for att in ids]
        for kind, ref_id, att in cases:
            def req(m: dict[str, str]) -> ScoreRequest:
                body = dict(common, attempt_recording_id=m.get(att, att))
                if kind == "take":
                    body["reference_recording_id"] = m.get(ref_id, ref_id)
                else:
                    body["reference_motion"] = step.motion
                if att in cals:
                    body["attempt_calibration_id"] = m.get(cals[att], cals[att])
                if kind == "take" and ref_id in cals:
                    body["reference_calibration_id"] = m.get(cals[ref_id], cals[ref_id])
                return ScoreRequest(**body)

            ident: dict[str, str] = {}
            pref = {k: lesson_sync.prefixed(k, rec) for k in [att, ref_id or "", cals.get(att, ""), cals.get(ref_id or "", "")] if k}
            a, b = numbers(original.score(req(ident))), numbers(imported.score(req(pref)))
            diff = max(abs(a[k] - b[k]) for k in a)
            worst = max(worst, diff)
            rows.append((lesson_id, step_id, kind, ref_id or "motion", att, a["overall"], b["overall"], diff,
                         "weights" if step.weights else "-", "yes" if att in cals else "no"))
    print("| lesson | step | reference | attempt take | original | imported | max diff (all fingers) | weights | calibrated |")
    print("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r[0]} | {r[1]} | {r[3]} | {r[4]} | {r[5]:.4f} | {r[6]:.4f} | {r[7]:.6f} | {r[8]} | {r[9]} |")
    print(f"cases {len(rows)}, worst difference {worst:.6f} (limit {TOL})")
    # 4. core lesson folders byte for byte (trace.npz, frames)
    same = differ = 0
    for p in sorted((src / "core_lessons" / "takes").rglob("*")):
        if not p.is_file() or p.name == "lesson.json":
            continue
        rel = p.relative_to(src / "core_lessons" / "takes")
        new = data / "core_lessons" / "takes" / lesson_sync.prefixed(rel.parts[0], rec) / Path(*rel.parts[1:])
        ok = new.is_file() and hashlib.sha256(new.read_bytes()).digest() == hashlib.sha256(p.read_bytes()).digest()
        same, differ = same + ok, differ + (not ok)
    print(f"core take folder files (traces, frames) byte-identical: {same}, different or missing: {differ}")
    print(f"work folder: {work}")
    return 0 if worst <= TOL and differ == 0 and rows else 1


if __name__ == "__main__":
    sys.exit(main())
