"""Expert training persistence: drafts on disk, bundle export and import, backups after publish, and calibrations
that survive a restart. Everything runs on the simulator in a temporary data folder; no paid API is reachable."""

import json
import time
from pathlib import Path

from app import constants as c
from app.core.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient


def _settings(data_dir: Path) -> Settings:
    """The test settings of conftest.py, for a given data folder."""
    return Settings(
        data_dir=data_dir,
        llm_provider="fake",
        gemini_api_key=None,
        glove_source="simulator",
        rokoko_udp_port=0,
        glove_monitor=False,
        glove_autostart="off",
    )


def _record(client: TestClient, step_id: str, seconds: float = 0.4) -> str:
    """Record one short simulator take and return its id."""
    rid = client.post(
        "/api/recordings/start", json={"step_id": step_id, "hands": "right"}
    ).json()["recording_id"]
    time.sleep(seconds)
    rec = client.post(f"/api/recordings/{rid}/stop").json()
    assert rec["frames"], "the simulator should have filled the take"
    return rid


def _publish(client: TestClient, take_ids: list[str], title: str = "Pottery") -> dict:
    """Model the takes and publish a one-step lesson from them, as the scratch flow does."""
    model = client.post(
        "/api/recordings/model", json={"recording_ids": take_ids, "side": "right"}
    ).json()
    step = {
        "title": "Move 1",
        "instruction": "Follow the expert's hand, finger by finger.",
        "hands": "right",
        "reference_recording_id": model["reference_recording_id"],
        "take_ids": model["take_ids"],
        "repetitions": len(take_ids),
        "tolerance": model["tolerance"],
    }
    res = client.post(
        "/api/lessons",
        json={
            "title": title,
            "skill": "general",
            "summary": "",
            "master_name": "Szymon",
            "source": "scratch",
            "steps": [step],
        },
    )
    assert res.status_code == 201
    return res.json()


DRAFT = {
    "v": 2,
    "id": "abc12345",
    "screen": "record",
    "takeIds": {"free_x": ["r1", "r2"]},
    "moves": [],
}


def test_draft_put_get_latest_and_delete(client: TestClient) -> None:
    assert client.get("/api/drafts/scratch").status_code == 404
    saved = client.put(
        "/api/drafts/scratch/abc12345", json={"schema_version": 2, "draft": DRAFT}
    ).json()
    assert saved["id"] == "abc12345" and saved["draft"] == DRAFT and saved["updated_at"]
    newer = {**DRAFT, "id": "def67890"}
    client.put(
        "/api/drafts/scratch/def67890", json={"schema_version": 2, "draft": newer}
    )
    assert client.get("/api/drafts/scratch").json()["id"] == "def67890"
    assert client.get("/api/drafts/scratch/abc12345").json()["draft"] == DRAFT
    assert client.delete("/api/drafts/scratch/def67890").status_code == 204
    assert (
        client.delete("/api/drafts/scratch/def67890").status_code == 204
    )  # already gone is fine
    assert client.get("/api/drafts/scratch").json()["id"] == "abc12345"


def test_draft_rejects_bad_ids_and_oversize(client: TestClient) -> None:
    assert client.put(
        "/api/drafts/scratch/..%2Fevil", json={"schema_version": 2, "draft": DRAFT}
    ).status_code in (400, 404)
    assert (
        client.put(
            "/api/drafts/other/abc", json={"schema_version": 2, "draft": DRAFT}
        ).status_code
        == 422
    )
    big = {"blob": "x" * (c.DRAFT_MAX_BYTES + 10)}
    assert (
        client.put(
            "/api/drafts/scratch/big", json={"schema_version": 2, "draft": big}
        ).status_code
        == 413
    )


def test_draft_survives_a_backend_restart(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as first:
        first.put(
            "/api/drafts/scratch/abc12345", json={"schema_version": 2, "draft": DRAFT}
        )
    assert (tmp_path / c.DRAFTS_DIR_NAME / "abc12345.json").exists()
    with TestClient(create_app(_settings(tmp_path))) as second:
        got = second.get("/api/drafts/scratch").json()
    assert got["draft"] == DRAFT


def test_calibration_is_loaded_from_disk_on_startup(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path))) as first:
        assert first.get("/api/calibrations/active").json() == {
            "left": None,
            "right": None,
            "wearer": None,
        }
        cal = first.post(
            "/api/calibrations",
            json={"side": "right", "phase": "flat", "duration_s": 0.3},
        ).json()
    with TestClient(create_app(_settings(tmp_path))) as second:
        active = second.get("/api/calibrations/active").json()
        latest = second.get("/api/calibrations/latest", params={"side": "right"}).json()
    assert active["right"]["id"] == cal["id"] == latest["id"]
    assert active["left"] is None


def test_publish_writes_a_backup_and_keeps_the_newest(
    client: TestClient, tmp_path: Path
) -> None:
    takes = [_record(client, f"free_a:rep{n}") for n in (1, 2, 3)]
    lesson = _publish(client, takes)
    exports = tmp_path / c.EXPORTS_DIR_NAME
    files = sorted(exports.glob(f"pottery-*{c.BUNDLE_FILE_SUFFIX}"))
    assert len(files) == 1
    backup = json.loads(files[0].read_text(encoding="utf-8"))
    assert backup["lessons"][0]["id"] == lesson["id"]
    assert {r["id"] for r in backup["recordings"]} == set(takes)
    body = {
        k: lesson[k]
        for k in ("title", "skill", "summary", "master_name", "source", "steps")
    }
    for _ in range(c.EXPORT_BACKUPS_KEEP + 1):
        assert client.put(f"/api/lessons/{lesson['id']}", json=body).status_code == 200
    assert (
        len(list(exports.glob(f"pottery-*{c.BUNDLE_FILE_SUFFIX}")))
        == c.EXPORT_BACKUPS_KEEP
    )


def test_export_then_import_round_trip_into_a_fresh_backend(
    client: TestClient, tmp_path: Path
) -> None:
    client.post(
        "/api/calibrations", json={"side": "right", "phase": "flat", "duration_s": 0.3}
    )
    takes = [_record(client, f"free_b:rep{n}") for n in (1, 2, 3)]
    lesson = _publish(client, takes, title="Bowl throwing")
    res = client.get(f"/api/lessons/{lesson['id']}/export")
    assert res.status_code == 200
    assert (
        'filename="bowl-throwing.geppetto.json"' in res.headers["content-disposition"]
    )
    bundle = res.json()
    assert (
        bundle["format"] == c.BUNDLE_FORMAT
        and bundle["format_version"] == c.BUNDLE_FORMAT_VERSION
    )
    assert {r["id"] for r in bundle["recordings"]} == set(takes)
    assert len(bundle["takes_models"]) == 1
    model = bundle["takes_models"][0]["model"]
    assert set(model["take_ids"]) == set(takes)
    assert model["tolerance"] == lesson["steps"][0]["tolerance"]
    assert bundle["calibrations"] and bundle["calibrations"][0]["side"] == "right"

    other = tmp_path / "laptop2"
    with TestClient(create_app(_settings(other))) as fresh:
        report = fresh.post("/api/lessons/import", json=bundle).json()
        assert {i["id"] for i in report["created"] if i["kind"] == "recording"} == set(
            takes
        )
        assert report["conflicts"] == [] and report["lesson_ids"] == [lesson["id"]]
        assert fresh.get(f"/api/lessons/{lesson['id']}").json() == lesson
        assert fresh.get(f"/api/recordings/{takes[0]}").status_code == 200
        again = fresh.post("/api/lessons/import", json=bundle).json()
        assert again["created"] == [] and again["conflicts"] == []
        assert len(again["unchanged"]) == len(report["created"])


def test_import_never_overwrites_a_different_local_copy_silently(
    client: TestClient,
) -> None:
    takes = [_record(client, f"free_c:rep{n}") for n in (1, 2)]
    lesson = _publish(client, takes, title="Weaving")
    bundle = client.get(f"/api/lessons/{lesson['id']}/export").json()
    edited = {
        k: lesson[k]
        for k in ("title", "skill", "summary", "master_name", "source", "steps")
    }
    edited["summary"] = "Edited here after the export."
    client.put(f"/api/lessons/{lesson['id']}", json=edited)

    report = client.post("/api/lessons/import", json=bundle).json()
    assert [(i["kind"], i["id"]) for i in report["conflicts"]] == [
        ("lesson", lesson["id"])
    ]
    assert (
        client.get(f"/api/lessons/{lesson['id']}").json()["summary"]
        == "Edited here after the export."
    )

    forced = client.post(
        "/api/lessons/import", params={"overwrite": "true"}, json=bundle
    ).json()
    assert [i["id"] for i in forced["overwritten"]] == [lesson["id"]]
    assert (
        client.get(f"/api/lessons/{lesson['id']}").json()["summary"]
        == lesson["summary"]
    )


def test_import_rejects_a_newer_format(client: TestClient) -> None:
    res = client.post(
        "/api/lessons/import",
        json={"format": c.BUNDLE_FORMAT, "format_version": c.BUNDLE_FORMAT_VERSION + 1},
    )
    assert res.status_code == 422


def test_export_all_holds_everything_but_video_bytes(client: TestClient) -> None:
    rid = _record(client, "free_d:rep1")
    client.put(
        "/api/drafts/scratch/abc12345", json={"schema_version": 2, "draft": DRAFT}
    )
    res = client.get("/api/export/all")
    assert res.status_code == 200
    bundle = res.json()
    assert bundle["kind"] == "all"
    assert rid in {r["id"] for r in bundle["recordings"]}
    assert [d["id"] for d in bundle["drafts"]] == ["abc12345"]
    assert any(
        lesson["id"].startswith(c.SEED_LESSON_PREFIX) for lesson in bundle["lessons"]
    )
    assert all(m["data_base64"] is None for m in bundle["media"])


def test_export_lessons_of_one_skill(client: TestClient) -> None:
    takes = [_record(client, f"free_e:rep{n}") for n in (1, 2)]
    a = _publish(client, takes, title="Knots")
    b = _publish(client, takes, title="Knots")
    res = client.get(
        "/api/export/lessons", params={"ids": f"{a['id']},{b['id']}", "name": "Knots"}
    )
    assert res.status_code == 200
    bundle = res.json()
    assert [lesson["id"] for lesson in bundle["lessons"]] == [a["id"], b["id"]]
    assert len(bundle["recordings"]) == 2
    assert client.get("/api/export/lessons", params={"ids": "nope"}).status_code == 404
