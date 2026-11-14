"""Expert media: upload limits, serving with range requests, delete, and the video references on takes and steps."""

import pytest
from app import constants as c
from fastapi.testclient import TestClient

CLIP = bytes(range(256)) * 40


def _upload(
    client: TestClient, data: bytes = CLIP, mime: str = "video/webm", **form: str
):
    """Upload a clip with optional form fields."""
    return client.post(
        "/api/media", files={"video": ("take.webm", data, mime)}, data=form
    )


def test_upload_serve_and_delete(client: TestClient) -> None:
    """A stored clip comes back byte for byte at its url, then 404s once deleted."""
    res = _upload(client, duration_s="4.5")
    assert res.status_code == 201
    info = res.json()
    assert info["url"] == f"/api/media/{info['id']}"
    assert info["content_type"] == "video/webm"
    assert info["duration_s"] == 4.5 and info["size_bytes"] == len(CLIP)
    got = client.get(info["url"])
    assert got.status_code == 200 and got.content == CLIP
    assert got.headers["content-type"].startswith("video/webm")
    assert client.delete(info["url"]).status_code == 204
    assert client.get(info["url"]).status_code == 404
    assert client.delete(info["url"]).status_code == 404


def test_codec_parameters_are_accepted(client: TestClient) -> None:
    """MediaRecorder's type carries codecs; the base type decides."""
    res = _upload(client, mime="video/webm;codecs=vp9")
    assert res.status_code == 201 and res.json()["content_type"] == "video/webm"
    assert res.json()["duration_s"] is None


def test_range_request_returns_partial_content(client: TestClient) -> None:
    """Seeking needs ranges: bytes=100-199 answers 206 with exactly those bytes."""
    url = _upload(client, mime="video/mp4").json()["url"]
    res = client.get(url, headers={"Range": "bytes=100-199"})
    assert res.status_code == 206
    assert res.content == CLIP[100:200]
    assert res.headers["content-range"] == f"bytes 100-199/{len(CLIP)}"
    assert res.headers.get("accept-ranges") == "bytes"


def test_wrong_type_is_415(client: TestClient) -> None:
    """Non-video uploads are rejected."""
    assert _upload(client, mime="image/png").status_code == 415


def test_oversize_is_413_and_leaves_nothing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Uploads above the size cap are rejected and no partial file is kept."""
    monkeypatch.setattr(c, "MEDIA_MAX_BYTES", 100)
    assert _upload(client).status_code == 413
    media_dir = client.app.state.services.settings.data_dir / c.MEDIA_DIR_NAME  # type: ignore[attr-defined]
    assert not any(p.suffix in (".webm", ".part") for p in media_dir.iterdir())


def test_empty_file_is_400(client: TestClient) -> None:
    """An empty recording (a MediaRecorder that captured nothing) is refused."""
    assert _upload(client, data=b"").status_code == 400


def test_bad_duration_is_400(client: TestClient) -> None:
    """A negative stated duration is refused."""
    assert _upload(client, duration_s="-1").status_code == 400


def test_unknown_or_unsafe_id(client: TestClient) -> None:
    """Unknown ids 404; ids that could leave the media folder are refused."""
    assert client.get("/api/media/nope").status_code == 404
    assert client.get("/api/media/..%2Fsecret").status_code in (400, 404)


def _take(client: TestClient) -> str:
    """Record a short simulator take and return its id."""
    rid = client.post("/api/recordings/start", json={"hands": "right"}).json()[
        "recording_id"
    ]
    client.post(f"/api/recordings/{rid}/stop")
    return rid


def test_take_video_attach_and_detach(client: TestClient) -> None:
    """A take keeps its webcam video and sync offset; the list and the full recording both show it."""
    rid = _take(client)
    info = _upload(client).json()
    res = client.put(
        f"/api/recordings/{rid}/video", json={"media_id": info["id"], "offset_s": 0.25}
    )
    assert res.status_code == 200
    video = {"media_id": info["id"], "url": info["url"], "offset_s": 0.25}
    assert res.json()["video"] == video
    assert client.get(f"/api/recordings/{rid}").json()["video"] == video
    listed = [r for r in client.get("/api/recordings").json() if r["id"] == rid]
    assert listed[0]["video"] == video
    assert client.delete(f"/api/recordings/{rid}/video").json()["video"] is None


def test_take_video_needs_known_media_and_take(client: TestClient) -> None:
    """Attaching an unknown video or to an unknown take is 404."""
    rid = _take(client)
    assert (
        client.put(
            f"/api/recordings/{rid}/video", json={"media_id": "nope"}
        ).status_code
        == 404
    )
    info = _upload(client).json()
    assert (
        client.put(
            "/api/recordings/nope/video", json={"media_id": info["id"]}
        ).status_code
        == 404
    )


def test_step_tutorial_video_round_trips(client: TestClient) -> None:
    """A step stores its tutorial video reference; old lessons without one read null."""
    info = _upload(client).json()
    tutorial = {"media_id": info["id"], "url": info["url"], "offset_s": 3.5}
    body = {
        "title": "Grip",
        "skill": "general",
        "steps": [
            {"title": "Hold", "instruction": "Hold it.", "tutorial_video": tutorial}
        ],
    }
    lesson = client.post("/api/lessons", json=body).json()
    assert lesson["steps"][0]["tutorial_video"] == tutorial
    assert lesson["steps"][0]["video_url"] is None
    plain = client.post(
        "/api/lessons",
        json={**body, "steps": [{"title": "Hold", "instruction": "Hold it."}]},
    ).json()
    assert plain["steps"][0]["tutorial_video"] is None


def test_tutorial_video_stays_out_of_the_llm_schema() -> None:
    """The model never writes media references."""
    from app.schemas.lesson import LessonBase
    from app.services.llm.schema import llm_schema

    step = llm_schema(LessonBase)["$defs"]["Step"]["properties"]
    assert "tutorial_video" not in step
