"""lesson_sync.py: id prefixing, idempotent export, no overwrite without --force, hash failure, Windows-unsafe names."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import lesson_sync as ls  # noqa: E402


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


@pytest.fixture
def source(tmp_path: Path) -> Path:
    data = tmp_path / "src"
    _write(data / "recordings" / "abc123.json", {"id": "abc123", "lesson_id": "les1", "step_id": "s1", "frames": []})
    _write(
        data / "lessons" / "les1.json",
        {"id": "les1", "steps": [{"id": "s1", "reference_recording_id": "abc123", "take_ids": ["abc123"]}]},
    )
    _write(data / "lessons" / "seed-piano.json", {"id": "seed-piano", "steps": []})
    _write(data / "calibrations" / "cal1.json", {"id": "cal1", "side": "right"})
    _write(
        data / "glove_calibrations" / "wc1.json",
        {"id": "wc1", "wearer": "Ana", "range_calibration_ids": {"right": "cal1"}},
    )
    take = data / "core_lessons" / "takes" / "abc123-right"
    _write(take / "lesson.json", {"id": "abc123-right", "task_config": {"geppetto": {"recording_id": "abc123"}}})
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
                    "parts": [{"folder": "takes/abc123-right", "calibration": {"range_calibration_id": "cal1"}}],
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
    assert wc["range_calibration_ids"] == {"right": "ana-cal1"} and wc["wearer"] == "Ana"
    core = json.loads((b / "core_lessons/takes/ana-abc123-right/lesson.json").read_text())
    assert core["id"] == "ana-abc123-right"
    assert core["task_config"]["geppetto"]["recording_id"] == "ana-abc123"
    entry = json.loads((b / "core_lessons/manifest.json").read_text())["entries"][0]
    assert entry["folders"] == ["takes/ana-abc123-right"]
    assert entry["parts"][0]["calibration"]["range_calibration_id"] == "ana-cal1"
    assert (b / "core_lessons/takes/ana-abc123-right/trace.npz").read_bytes() == b"\x00\x01\r\n\x02"
    assert not (b / "backend/lessons/ana-seed-piano.json").exists()  # seeds ship with the app


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
    assert json.loads((dest / "core_lessons/manifest.json").read_text())["entries"][0]["id"] == "ana-abc123"
    r = ls.import_bundles(shared, dest, None)
    assert not r.added and any("identical" in s for s in r.skipped)
    _write(dest / "recordings" / "ana-abc123.json", {"id": "ana-abc123", "local": True})
    r = ls.import_bundles(shared, dest, None)
    assert any(s.startswith("take ana-abc123 (exists and differs") for s in r.skipped)
    assert json.loads((dest / "recordings/ana-abc123.json").read_text())["local"] is True
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


@pytest.mark.parametrize("name", ["a:b", "con", "NUL.json", "x?", "trail.", "trail ", 'q"', "a|b", "a<b"])
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
    _write(source / "calibrations" / "cal3.json", {"id": "cal3", "side": "left"})  # no wearer, no take
    _write(
        source / "glove_calibrations" / "wc2.json",
        {"id": "wc2", "wearer": "Zed Visitor", "range_calibration_ids": {"left": "cal2"}},
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
    assert cals == ["ana-cal1.json"]  # cal1 is the take's and a kept wearer's; cal2 and cal3 stay out
    blob = b"".join(p.read_bytes() for p in b.rglob("*") if p.is_file())
    assert b"Zed" not in blob and b"cal2" not in blob
    assert summary["left_out"] == {
        "wearer calibration records of other wearers": 1,
        "flat and fist calibrations of other wearers": 1,
        "flat and fist calibrations with no known wearer and no exported take": 1,
    }


def test_take_calibration_kept_without_wearer(source: Path, tmp_path: Path) -> None:
    (source / "glove_calibrations" / "wc1.json").unlink()  # cal1 now has no wearer, but the take used it
    shared = tmp_path / "shared"
    ls.export(source, None, shared, "ana")
    assert (shared / "ana/backend/calibrations/ana-cal1.json").is_file()


def test_include_other_wearers_flag(source: Path, tmp_path: Path) -> None:
    _add_other_wearer(source)
    shared = tmp_path / "shared"
    ls.export(source, None, shared, "ana", include_other_wearers=True)
    assert (shared / "ana/backend/glove_calibrations/ana-wc2.json").is_file()
    assert (shared / "ana/backend/calibrations/ana-cal3.json").is_file()
    assert ls.main(
        ["export", "--data-dir", str(source), "--shared", str(tmp_path / "s2"), "--recorder", "ana",
         "--root-lessons", str(tmp_path / "none")]
    ) == 0
    assert not (tmp_path / "s2/ana/backend/glove_calibrations/ana-wc2.json").exists()


def test_recorder_name_sanitised() -> None:
    assert ls.sanitise_recorder("Arpan Pandey!") == "arpanpandey"
    with pytest.raises(ls.SyncError):
        ls.sanitise_recorder("!!!")
