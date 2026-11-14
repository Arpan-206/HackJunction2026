"""Dev file reveal: POST /api/dev/reveal and GET /api/dev/locate find stored files inside the data folder only, answer
only localhost while the flag is on, and never launch a real file manager here (subprocess.Popen is patched)."""

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from app import constants as c
from app.core.config import Settings
from app.main import create_app
from app.services import files as files_module
from fastapi.testclient import TestClient

LOCAL = ("127.0.0.1", 50000)


def _settings(data_dir: Path, **over: object) -> Settings:
    """The conftest test settings for a given data folder."""
    base: dict[str, object] = dict(
        data_dir=data_dir,
        llm_provider="fake",
        gemini_api_key=None,
        glove_source="simulator",
        rokoko_udp_port=0,
        glove_monitor=False,
        glove_autostart="off",
    )
    base.update(over)
    return Settings(**base)  # type: ignore[arg-type]


@pytest.fixture
def launched(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """Record every Popen call instead of starting a process."""
    calls: list[list[str]] = []

    class _FakePopen:
        def __init__(self, args: list[str], *_: object, **__: object) -> None:
            calls.append(list(args))

    monkeypatch.setattr(files_module.subprocess, "Popen", _FakePopen)
    return calls


@pytest.fixture
def local(tmp_path: Path, launched: list[list[str]]) -> Iterator[TestClient]:
    """A client that calls from 127.0.0.1."""
    with TestClient(create_app(_settings(tmp_path)), client=LOCAL) as client:
        yield client


def _record(client: TestClient) -> str:
    """Record one short simulator take and return its id."""
    rid = client.post("/api/recordings/start", json={"step_id": "s"}).json()[
        "recording_id"
    ]
    time.sleep(0.3)
    assert client.post(f"/api/recordings/{rid}/stop").status_code == 200
    return rid


def test_reveal_recording_opens_file_manager_and_returns_path(
    local: TestClient, tmp_path: Path, launched: list[list[str]]
) -> None:
    rid = _record(local)
    res = local.post("/api/dev/reveal", json={"kind": "recording", "id": rid})
    assert res.status_code == 200, res.text
    body = res.json()
    expected = (tmp_path / "recordings" / f"{rid}.json").resolve()
    assert Path(body["path"]) == expected
    assert body["opened"] is True
    assert len(launched) == 1
    assert str(expected) in launched[0] or str(expected.parent) in launched[0]


def test_locate_returns_path_without_opening(
    local: TestClient, tmp_path: Path, launched: list[list[str]]
) -> None:
    rid = _record(local)
    res = local.get("/api/dev/locate", params={"kind": "recording", "id": rid})
    assert res.status_code == 200, res.text
    assert (
        Path(res.json()["path"]) == (tmp_path / "recordings" / f"{rid}.json").resolve()
    )
    assert res.json()["opened"] is False
    assert launched == []


def test_locate_seed_lesson(local: TestClient) -> None:
    lesson_id = local.get("/api/lessons").json()[0]["id"]
    res = local.get("/api/dev/locate", params={"kind": "lesson", "id": lesson_id})
    assert res.status_code == 200, res.text
    assert res.json()["path"].endswith(f"{lesson_id}.json")


@pytest.mark.parametrize(
    "kind,item_id",
    [
        ("recording", "../../.env"),
        ("lesson", "..\\..\\.env"),
        ("export", "../../.env"),
        ("export", "..%2F..%2F.env"),
        ("media", "../secret"),
        ("draft", "/etc/passwd"),
    ],
)
def test_path_traversal_is_refused(
    local: TestClient, launched: list[list[str]], kind: str, item_id: str
) -> None:
    res = local.post("/api/dev/reveal", json={"kind": kind, "id": item_id})
    assert res.status_code in (400, 404), res.text
    res = local.get("/api/dev/locate", params={"kind": kind, "id": item_id})
    assert res.status_code in (400, 404), res.text
    assert launched == []


def test_unknown_kind_is_refused(local: TestClient, launched: list[list[str]]) -> None:
    assert (
        local.post("/api/dev/reveal", json={"kind": "env", "id": "x"}).status_code
        == 422
    )
    assert (
        local.get("/api/dev/locate", params={"kind": "env", "id": "x"}).status_code
        == 422
    )
    assert launched == []


def test_missing_file_is_404(local: TestClient, launched: list[list[str]]) -> None:
    for kind in c.DEV_REVEAL_DIRS:
        res = local.post("/api/dev/reveal", json={"kind": kind, "id": "nosuchfile"})
        assert res.status_code == 404, (kind, res.text)
    assert launched == []


def test_symlink_outside_data_dir_is_refused(
    local: TestClient, tmp_path: Path, launched: list[list[str]]
) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside.json"
    outside.write_text("{}", encoding="utf-8")
    link = tmp_path / "recordings" / "escape.json"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("symlinks need extra rights on this machine")
    res = local.get("/api/dev/locate", params={"kind": "recording", "id": "escape"})
    assert res.status_code == 404
    assert launched == []


def test_export_by_lesson_id_finds_newest_backup(
    local: TestClient, tmp_path: Path
) -> None:
    lesson = local.get("/api/lessons").json()[0]
    exports = tmp_path / c.EXPORTS_DIR_NAME
    assert (
        local.get(
            "/api/dev/locate", params={"kind": "export", "id": lesson["id"]}
        ).status_code
        == 404
    )
    res = local.put(f"/api/lessons/{lesson['id']}", json=lesson)
    assert res.status_code == 200, res.text
    backups = sorted(exports.glob(f"*{c.BUNDLE_FILE_SUFFIX}"))
    assert backups, "publishing writes a backup"
    res = local.get("/api/dev/locate", params={"kind": "export", "id": lesson["id"]})
    assert res.status_code == 200, res.text
    assert Path(res.json()["path"]) == backups[-1].resolve()
    by_name = local.get(
        "/api/dev/locate", params={"kind": "export", "id": backups[-1].name}
    )
    assert by_name.status_code == 200
    assert by_name.json()["path"] == res.json()["path"]


def test_non_localhost_is_forbidden(tmp_path: Path, launched: list[list[str]]) -> None:
    with TestClient(
        create_app(_settings(tmp_path)), client=("192.168.1.20", 50000)
    ) as client:
        rid = _record(client)
        assert (
            client.post(
                "/api/dev/reveal", json={"kind": "recording", "id": rid}
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/api/dev/locate", params={"kind": "recording", "id": rid}
            ).status_code
            == 403
        )
    assert launched == []


def test_flag_off_is_forbidden(tmp_path: Path, launched: list[list[str]]) -> None:
    with TestClient(
        create_app(_settings(tmp_path, dev_reveal=False)), client=LOCAL
    ) as client:
        rid = _record(client)
        assert (
            client.post(
                "/api/dev/reveal", json={"kind": "recording", "id": rid}
            ).status_code
            == 403
        )
    assert launched == []


PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


def test_glove_compare_saves_json_and_png_in_the_data_folder(
    local: TestClient, tmp_path: Path
) -> None:
    body = {
        "session": "s1",
        "index": 3,
        "slug": "point",
        "data": {"core": [1, 2]},
        "png": PNG_1PX,
    }
    r = local.post("/api/dev/glove_compare", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    folder = tmp_path / c.GLOVE_COMPARE_DIR / "s1"
    assert Path(out["json_path"]) == (folder / "03-point.json").resolve()
    assert (folder / "03-point.json").read_text(encoding="utf-8") == '{"core":[1,2]}'
    assert (folder / "03-point.png").read_bytes().startswith(b"\x89PNG")


def test_glove_compare_rejects_unsafe_names_and_remote_callers(
    local: TestClient, tmp_path: Path
) -> None:
    bad = {"session": "../x", "index": 1, "slug": "a", "data": {}}
    assert local.post("/api/dev/glove_compare", json=bad).status_code == 422
    with TestClient(create_app(_settings(tmp_path)), client=("10.0.0.9", 5)) as remote:
        ok = {"session": "s", "index": 1, "slug": "a", "data": {}}
        assert remote.post("/api/dev/glove_compare", json=ok).status_code == 403
