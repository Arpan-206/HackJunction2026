"""The external glove source and the Studio Command API client."""

import asyncio

import httpx
import pytest
from app.core.config import Settings
from app.core.errors import (
    BadRequestError,
    InvalidFrameError,
    ServiceUnavailableError,
    SourceInactiveError,
)
from app.services.gloves.manager import GloveManager
from app.services.gloves.rokoko_command import StudioCommandClient
from app.services.smoothing.one_euro import GloveSmoother
from fastapi.testclient import TestClient

FLEX = {f: [0.5, 0.4, 0.3] for f in ("thumb", "index", "middle", "ring", "little")}


def make_manager() -> GloveManager:
    """A manager with smoothing off so values are easy to assert."""
    smoother = GloveSmoother()
    smoother.configure(enabled=False)
    return GloveManager(Settings(glove_source="simulator", rokoko_udp_port=0), smoother)


def test_ingest_requires_active_source_then_emits_to_subscribers() -> None:
    """Frames are refused until the source is switched to external, then reach subscribers as replay frames."""

    async def run() -> None:
        manager = make_manager()
        with pytest.raises(SourceInactiveError):
            manager.ingest({"hands": []})
        await manager.switch_source("external")  # type: ignore[arg-type]
        queue = manager.subscribe()
        assert (
            manager.ingest({"t": 1.5, "hands": [{"side": "left", "flexion": FLEX}]})
            == 1
        )
        frame = queue.get_nowait()
        assert frame.source == "replay" and frame.t == 1.5
        assert frame.hands[0].wrist_quat == (0.0, 0.0, 0.0, 1.0) and frame.hands[
            0
        ].flexion["index"] == (0.5, 0.4, 0.3)
        await manager.stop()

    asyncio.run(run())


def test_ingest_accepts_single_hand_and_batches_and_rejects_bad_input() -> None:
    """A bare hand and a batch are accepted; a bad flexion shape or oversize batch is a 400."""

    async def run() -> None:
        manager = make_manager()
        await manager.switch_source("external")  # type: ignore[arg-type]
        queue = manager.subscribe()
        assert manager.ingest({"side": "right", "flexion": FLEX}) == 1
        assert (
            manager.ingest(
                {"frames": [{"hands": [{"side": "right", "flexion": FLEX}]}] * 3}
            )
            == 3
        )
        assert queue.qsize() == 4
        with pytest.raises(InvalidFrameError):
            manager.ingest({"side": "right", "flexion": {"index": [0, 0, 0]}})
        with pytest.raises(InvalidFrameError):
            manager.ingest({"frames": [{"hands": []}] * 601})
        await manager.stop()

    asyncio.run(run())


def test_command_client_builds_urls_and_maps_errors() -> None:
    """Calibrate posts to /v1/{key}/calibrate; non-zero response codes and connection errors become app errors."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/info"):
            return httpx.Response(
                200,
                json={
                    "description": "no device",
                    "response_code": 14,
                    "parameters": [],
                },
            )
        if request.url.path.endswith("/livestream"):
            raise httpx.ConnectError("refused")
        return httpx.Response(
            200, json={"description": "ok", "response_code": 0, "parameters": []}
        )

    client = StudioCommandClient(api_key="abc", transport=httpx.MockTransport(handler))

    async def run() -> None:
        await client.calibrate(countdown_s=5, pose="tpose")
        assert seen[
            0
        ].url.path == "/v1/abc/calibrate" and b'"countdown_delay":5' in seen[
            0
        ].content.replace(b" ", b"")
        with pytest.raises(BadRequestError):
            await client.info()
        with pytest.raises(ServiceUnavailableError):
            await client.set_livestream(True)
        with pytest.raises(BadRequestError):
            await client.calibrate(pose="bogus")

    asyncio.run(run())


HAND = {"side": "right", "flexion": FLEX}


def _use_external(client: TestClient) -> None:
    """Switch the running app to the external source through the dev route."""
    assert (
        client.post("/api/dev/state", json={"glove_source": "external"}).json()[
            "glove_source"
        ]
        == "external"
    )


def test_http_ingest_reaches_ws_gloves(client: TestClient) -> None:
    """A hand pushed over HTTP comes out of /ws/gloves as a replay frame."""
    _use_external(client)
    with client.websocket_connect("/ws/gloves") as ws:
        assert client.post("/api/ingest/frames", json=HAND).json() == {"accepted": 1}
        frame = ws.receive_json()
    assert frame["source"] == "replay" and frame["hands"][0]["side"] == "right"


def test_ws_ingest_reaches_ws_gloves_and_reports_errors(client: TestClient) -> None:
    """WS ingest feeds the stream, answers bad messages with an error and stays open."""
    _use_external(client)
    with (
        client.websocket_connect("/ws/gloves") as out,
        client.websocket_connect("/ws/ingest") as ingest,
    ):
        ingest.send_json({"side": "right", "flexion": {"index": [0, 0, 0]}})
        err = ingest.receive_json()
        assert err["type"] == "error" and err["status"] == 422
        ingest.send_text("not json")
        assert ingest.receive_json()["type"] == "error"
        ingest.send_json(HAND)
        assert out.receive_json()["source"] == "replay"


def test_ingest_conflict_unless_activate(client: TestClient) -> None:
    """Inactive source gives 409 with a clear detail; ?activate=1 switches and accepts."""
    res = client.post("/api/ingest/frames", json=HAND)
    assert res.status_code == 409 and "external" in res.json()["detail"]
    res = client.post("/api/ingest/frames?activate=1", json=HAND)
    assert res.status_code == 200
    assert client.get("/api/dev/state").json()["glove_source"] == "external"


def test_http_ingest_batch_and_invalid(client: TestClient) -> None:
    """A batch counts every frame; an invalid frame is a 422."""
    _use_external(client)
    batch = {"frames": [{"hands": [HAND]}] * 4}
    assert client.post("/api/ingest/frames", json=batch).json() == {"accepted": 4}
    res = client.post(
        "/api/ingest/frames", json={"side": "right", "flexion": {"index": [0, 0, 0]}}
    )
    assert res.status_code == 422 and "Invalid frame" in res.json()["detail"]
