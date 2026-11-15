"""lesson_sync.py: id prefixing, idempotent export, no overwrite without --force, hash failure, Windows-unsafe names."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import lesson_sync as ls


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


@pytest.fixture
def source(tmp_path: Path) -> Path:
    data = tmp_path / "src"
    _write(
        data / "recordings" / "abc123.json",
        {"id": "abc123", "lesson_id": "les1", "step_id": "s1", "frames": []},
    )
    _write(
        data / "lessons" / "les1.json",
        {
            "id": "les1",
            "steps": [
                {"id": "s1", "reference_recording_id": "abc123", "take_ids": ["abc123"]}
            ],
        },
    )
    _write(data / "lessons" / "seed-piano.json", {"id": "seed-piano", "steps": []})
    _write(data / "calibrations" / "cal1.json", {"id": "cal1", "side": "right"})
    _write(
        data / "glove_calibrations" / "wc1.json",
        {"id": "wc1", "wearer": "Ana", "range_calibration_ids": {"right": "cal1"}},
    )
    take = data / "core_lessons" / "takes" / "abc123-right"
    _write(
        take / "lesson.json",
        {"id": "abc123-right", "task_config": {"geppetto": {"recording_id": "abc123"}}},
    )
    (take / "trace.npz").write_bytes(b"\x00\x01\r\n\x02")
    _write(
        data / "core_lessons" / "manifest.json",
        {
            "schema": "x",
            "entries": [
                {
                    "kind": "take",
                    "id": "abc123",
                    "folders": ["takes/abc123-right"],
                    "parts": [
                        {
                            "folder": "takes/abc123-right",
                            "calibration": {"range_calibration_id": "cal1"},
                        }
                    ],
                }
            ],
        },
    )
    return data


def _export(source: Path, shared: Path, recorder: str = "ana"):
    return ls.export(source, None, shared, recorder)


def test_ids_prefixed_and_references_rewritten(source: Path, tmp_path: Path) -> None:
    shared = tmp_path / "shared"
    _export(source, shared)
    b = shared / "ana"
    lesson = json.loads((b / "backend/lessons/ana-les1.json").read_text())
    assert lesson["steps"][0]["reference_recording_id"] == "ana-abc123"
    assert lesson["steps"][0]["take_ids"] == ["ana-abc123"]
    take = json.loads((b / "backend/recordings/ana-abc123.json").read_text())
    assert take["id"] == "ana-abc123" and take["lesson_id"] == "ana-les1"
    wc = json.loads((b / "backend/glove_calibrations/ana-wc1.json").read_text())
    assert (
        wc["range_calibration_ids"] == {"right": "ana-cal1"} and wc["wearer"] == "Ana"
    )
    core = json.loads(
        (b / "core_lessons/takes/ana-abc123-right/lesson.json").read_text()
    )
    assert core["id"] == "ana-abc123-right"
    assert core["task_config"]["geppetto"]["recording_id"] == "ana-abc123"
    entry = json.loads((b / "core_lessons/manifest.json").read_text())["entries"][0]
    assert entry["folders"] == ["takes/ana-abc123-right"]
    assert entry["parts"][0]["calibration"]["range_calibration_id"] == "ana-cal1"
    assert (
        b / "core_lessons/takes/ana-abc123-right/trace.npz"
    ).read_bytes() == b"\x00\x01\r\n\x02"
    assert not (
        b / "backend/lessons/ana-seed-piano.json"
    ).exists()  # seeds ship with the app


def test_prefix_once_and_export_idempotent(source: Path, tmp_path: Path) -> None:
    assert ls.prefixed("ana-abc", "ana") == "ana-abc"
    assert ls.prefixed("abc", "ana") == "ana-abc"
    shared = tmp_path / "shared"
    _export(source, shared)
    first = (shared / "ana" / ls.MANIFEST).read_bytes()
    summary = _export(source, shared)
    assert summary.get("unchanged") is True
    assert (shared / "ana" / ls.MANIFEST).read_bytes() == first
    # exporting an already prefixed store does not prefix twice
    shared2 = tmp_path / "shared2"
    _export(shared / "ana" / "backend", shared2)
    assert (shared2 / "ana" / "backend/recordings/ana-abc123.json").exists()


def test_import_no_overwrite_then_force(source: Path, tmp_path: Path) -> None:
    shared = tmp_path / "shared"
    _export(source, shared)
    dest = tmp_path / "dest"
    r = ls.import_bundles(shared, dest, None)
    assert "take ana-abc123" in r.added and not r.skipped and not r.replaced
    assert (dest / "core_lessons/takes/ana-abc123-right/trace.npz").is_file()
    assert (
        json.loads((dest / "core_lessons/manifest.json").read_text())["entries"][0][
            "id"
        ]
        == "ana-abc123"
    )
    r = ls.import_bundles(shared, dest, None)
    assert not r.added and any("identical" in s for s in r.skipped)
    _write(dest / "recordings" / "ana-abc123.json", {"id": "ana-abc123", "local": True})
    r = ls.import_bundles(shared, dest, None)
    assert any(s.startswith("take ana-abc123 (exists and differs") for s in r.skipped)
    assert (
        json.loads((dest / "recordings/ana-abc123.json").read_text())["local"] is True
    )
    r = ls.import_bundles(shared, dest, None, force=True)
    assert "take ana-abc123" in r.replaced
    assert "local" not in json.loads((dest / "recordings/ana-abc123.json").read_text())


def test_dry_run_writes_nothing(source: Path, tmp_path: Path) -> None:
    shared = tmp_path / "shared"
    ls.export(source, None, shared, "ana", dry_run=True)
    assert not shared.exists()
    _export(source, shared)
    dest = tmp_path / "dest"
    r = ls.import_bundles(shared, dest, None, dry_run=True)
    assert r.added and not (dest / "recordings").exists()


def test_corrupted_file_fails_import(source: Path, tmp_path: Path) -> None:
    shared = tmp_path / "shared"
    _export(source, shared)
    trace = shared / "ana" / "core_lessons/takes/ana-abc123-right/trace.npz"
    trace.write_bytes(trace.read_bytes().replace(b"\r\n", b"\n"))
    dest = tmp_path / "dest"
    with pytest.raises(ls.SyncError, match="hash check failed"):
        ls.import_bundles(shared, dest, None)
    assert not dest.exists()
    assert ls.main(["import", "--shared", str(shared), "--data-dir", str(dest)]) == 1


@pytest.mark.parametrize(
    "name", ["a:b", "con", "NUL.json", "x?", "trail.", "trail ", 'q"', "a|b", "a<b"]
)
def test_windows_unsafe_names(name: str) -> None:
    assert ls.check_name(name) is not None


def test_path_checks() -> None:
    assert ls.check_name("arpan-0bbcca28f9f1-right") is None
    assert ls.check_paths(["a/B.json", "a/b.json"])  # case-insensitive collision
    assert ls.check_paths(["x/" + "y" * 200])  # too long
    assert not ls.check_paths(["arpan/backend/recordings/arpan-0bbcca28f9f1.json"])


def test_unsafe_id_refuses_export(source: Path, tmp_path: Path) -> None:
    _write(source / "calibrations" / "bad.json", {"id": "bad:id"})
    with pytest.raises(ls.SyncError, match="unsafe id"):
        _export(source, tmp_path / "shared")


def _add_other_wearer(source: Path) -> None:
    _write(source / "calibrations" / "cal2.json", {"id": "cal2", "side": "left"})
    _write(
        source / "calibrations" / "cal3.json", {"id": "cal3", "side": "left"}
    )  # no wearer, no take
    _write(
        source / "glove_calibrations" / "wc2.json",
        {
            "id": "wc2",
            "wearer": "Zed Visitor",
            "range_calibration_ids": {"left": "cal2"},
        },
    )
    _write(
        source / "glove_calibrations" / "wc3.json",
        {"id": "wc3", "wearer": "Bo", "range_calibration_ids": {"left": "cal1"}},
    )


def test_other_wearers_left_out_by_default(source: Path, tmp_path: Path) -> None:
    _add_other_wearer(source)
    shared = tmp_path / "shared"
    summary = ls.export(source, None, shared, "ana", wearers={"bo"})
    b = shared / "ana"
    names = sorted(p.name for p in (b / "backend/glove_calibrations").iterdir())
    assert names == ["ana-wc1.json", "ana-wc3.json"]  # the recorder and --wearers bo
    cals = sorted(p.name for p in (b / "backend/calibrations").iterdir())
    assert cals == [
        "ana-cal1.json"
    ]  # cal1 is the take's and a kept wearer's; cal2 and cal3 stay out
    blob = b"".join(p.read_bytes() for p in b.rglob("*") if p.is_file())
    assert b"Zed" not in blob and b"cal2" not in blob
    assert summary["left_out"] == {
        "wearer calibration records of other wearers": 1,
        "flat and fist calibrations of other wearers": 1,
        "flat and fist calibrations with no known wearer and no exported take": 1,
    }


def test_take_calibration_kept_without_wearer(source: Path, tmp_path: Path) -> None:
    (
        source / "glove_calibrations" / "wc1.json"
    ).unlink()  # cal1 now has no wearer, but the take used it
    shared = tmp_path / "shared"
    ls.export(source, None, shared, "ana")
    assert (shared / "ana/backend/calibrations/ana-cal1.json").is_file()


def test_include_other_wearers_flag(source: Path, tmp_path: Path) -> None:
    _add_other_wearer(source)
    shared = tmp_path / "shared"
    ls.export(source, None, shared, "ana", include_other_wearers=True)
    assert (shared / "ana/backend/glove_calibrations/ana-wc2.json").is_file()
    assert (shared / "ana/backend/calibrations/ana-cal3.json").is_file()
    assert (
        ls.main(
            [
                "export",
                "--data-dir",
                str(source),
                "--shared",
                str(tmp_path / "s2"),
                "--recorder",
                "ana",
                "--root-lessons",
                str(tmp_path / "none"),
            ]
        )
        == 0
    )
    assert not (tmp_path / "s2/ana/backend/glove_calibrations/ana-wc2.json").exists()


def _session_source(tmp_path: Path) -> Path:
    data = tmp_path / "sess"
    _write(
        data / "recordings" / "t1.json",
        {"id": "t1", "lesson_id": "l1", "started_at": "2026-11-15T01:00:00+00:00"},
    )
    _write(
        data / "recordings" / "t2.json",
        {
            "id": "t2",
            "lesson_id": "seed-piano",
            "started_at": "2026-11-15T01:00:00+00:00",
        },
    )
    _write(
        data / "recordings" / "t3.json",
        {"id": "t3", "lesson_id": "l3", "started_at": "2026-11-13T01:00:00+00:00"},
    )
    _write(
        data / "lessons" / "l1.json",
        {
            "id": "l1",
            "title": "Bow",
            "master_name": "Szymon",
            "created_at": "2026-11-15T01:05:00+00:00",
            "steps": [{"id": "s", "reference_recording_id": "t1"}],
        },
    )
    _write(
        data / "lessons" / "l2.json",
        {
            "id": "l2",
            "title": "Other",
            "master_name": "Arpan",
            "created_at": "2026-11-15T01:05:00+00:00",
            "steps": [],
        },
    )
    _write(
        data / "lessons" / "l3.json",
        {
            "id": "l3",
            "title": "Old",
            "master_name": "Szymon",
            "created_at": "2026-11-13T01:05:00+00:00",
            "steps": [{"id": "s", "reference_recording_id": "t3"}],
        },
    )
    _write(
        data / "lessons" / "fake-x.json",
        {
            "id": "fake-x",
            "master_name": "Szymon",
            "created_at": "2026-11-15T02:00:00+00:00",
            "steps": [],
        },
    )
    _write(data / "lessons" / "seed-piano.json", {"id": "seed-piano", "steps": []})
    return data


def test_recorder_and_since_filters(tmp_path: Path) -> None:
    data = _session_source(tmp_path)
    session = ls.Session(only_recorder=True, since=ls.parse_since("2026-11-14"))
    summary = ls.export(data, None, tmp_path / "shared", "szymon", session=session)
    b = tmp_path / "shared" / "szymon" / "backend"
    assert sorted(p.name for p in (b / "lessons").iterdir()) == ["szymon-l1.json"]
    assert sorted(p.name for p in (b / "recordings").iterdir()) == ["szymon-t1.json"]
    left = summary["left_out"]
    assert left["expert is not szymon"] == 1 and left["recorded before --since"] == 1
    assert (
        left["test fixture (fake-*)"] == 1
        and left["take not used by a kept lesson"] == 2
    )
    # since alone keeps every expert's lessons of the session
    s2 = ls.export(
        data,
        None,
        tmp_path / "s2",
        "szymon",
        session=ls.Session(since=ls.parse_since("2026-11-14")),
    )
    assert s2["items"]["lesson"] == 2


def _installed(tmp_path: Path) -> Path:
    dest = tmp_path / "machine" / "data"
    _write(
        dest / "lessons" / "old1.json",
        {"id": "old1", "title": "Old one", "master_name": "Arpan"},
    )
    _write(dest / "lessons" / "seed-piano.json", {"id": "seed-piano", "title": "Piano"})
    _write(dest / "recordings" / "r9.json", {"id": "r9"})
    _write(
        dest / "core_lessons" / "takes" / "r9-right" / "lesson.json", {"id": "r9-right"}
    )
    _write(dest / "calibrations" / "mine.json", {"id": "mine"})
    _write(dest / "glove_calibrations" / "me.json", {"id": "me", "wearer": "Arpan"})
    return dest


def test_replace_backs_up_then_installs_only_bundle(
    source: Path, tmp_path: Path
) -> None:
    shared = tmp_path / "shared"
    _export(source, shared)
    dest = _installed(tmp_path)
    before = {
        p.relative_to(dest).as_posix(): p.read_bytes()
        for p in dest.rglob("*")
        if p.is_file()
    }
    dry = ls.import_bundles(shared, dest, None, dry_run=True, replace=True)
    assert "lessons/old1.json" in dry.removed and (dest / "lessons/old1.json").exists()
    r = ls.import_bundles(shared, dest, None, replace=True)
    backup = r.backup
    assert (
        backup is not None
        and backup.parent.name == "lesson_backups"
        and dest not in backup.parents
    )
    for rel in (
        "lessons/old1.json",
        "recordings/r9.json",
        "core_lessons/takes/r9-right/lesson.json",
    ):
        assert (backup / rel).read_bytes() == before[rel]
    assert not (backup / "lessons/seed-piano.json").exists()
    assert sorted(p.name for p in (dest / "lessons").iterdir()) == [
        "ana-les1.json",
        "seed-piano.json",
    ]
    assert sorted(p.name for p in (dest / "recordings").iterdir()) == [
        "ana-abc123.json"
    ]
    assert (dest / "core_lessons/takes/ana-abc123-right/trace.npz").is_file()
    assert not (dest / "core_lessons/takes/r9-right").exists()
    # calibrations untouched, and the bundle's not installed
    assert sorted(p.name for p in (dest / "calibrations").iterdir()) == ["mine.json"]
    assert sorted(p.name for p in (dest / "glove_calibrations").iterdir()) == [
        "me.json"
    ]
    assert any("keeps this machine's calibrations" in s for s in r.skipped)


def test_replace_refused_on_empty_or_corrupt_bundle(
    source: Path, tmp_path: Path
) -> None:
    dest = _installed(tmp_path)
    empty = tmp_path / "empty_src"
    _write(empty / "calibrations" / "c.json", {"id": "c"})
    ls.export(empty, None, tmp_path / "e", "ana")
    with pytest.raises(ls.SyncError, match="no lessons and no takes"):
        ls.import_bundles(tmp_path / "e", dest, None, replace=True)
    shared = tmp_path / "shared"
    _export(source, shared)
    trace = shared / "ana" / "core_lessons/takes/ana-abc123-right/trace.npz"
    trace.write_bytes(b"broken")
    with pytest.raises(ls.SyncError, match="hash check failed"):
        ls.import_bundles(shared, dest, None, replace=True)
    with pytest.raises(ls.SyncError, match="no backend data folder"):
        ls.import_bundles(tmp_path / "e", tmp_path / "nowhere", None, replace=True)
    assert (dest / "lessons/old1.json").exists() and not (
        dest.parent / "lesson_backups"
    ).exists()


def test_summary_line_sorted_and_seeds_apart(tmp_path: Path) -> None:
    dest = tmp_path / "d"
    _write(
        dest / "lessons" / "b.json",
        {"id": "b", "title": "Bow", "master_name": "Szymon"},
    )
    _write(
        dest / "lessons" / "a.json",
        {"id": "a", "title": "Arch", "master_name": "szymon K"},
    )
    _write(dest / "lessons" / "seed-x.json", {"id": "seed-x", "title": "Seed"})
    _write(dest / "recordings" / "t.json", {"id": "t"})
    assert (
        ls.summary_line(dest)
        == "installed: 2 lessons | recorders: szymon 2 | names: Arch; Bow | takes: 1 | seeds: 1"
    )


def test_recorder_name_sanitised() -> None:
    assert ls.sanitise_recorder("Arpan Pandey!") == "arpanpandey"
    with pytest.raises(ls.SyncError):
        ls.sanitise_recorder("!!!")
