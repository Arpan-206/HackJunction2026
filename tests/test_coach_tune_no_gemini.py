"""Proof that coach_tune labelling cannot reach Gemini or the Decisions API, and that the training build refuses any
label not written by our self-hosted Gemma 4 and any real-capture input. No network: the transport is recorded."""

import asyncio
import os
import re
import sys
from pathlib import Path

import pytest

LANE = Path(__file__).resolve().parents[1] / "coach_tune"
sys.path.insert(0, str(LANE))

httpx = pytest.importorskip("httpx")
import label
import make_sft
import oai

ROW = {
    "id": "x0",
    "task": "Pinch",
    "step_name": "close",
    "step_index": 0,
    "kind": "hold",
    "hand": "right",
    "score": 50,
    "errors": [{"finger": "index", "hint": "too_curled", "err_deg": 30}],
    "top_finger": "index",
    "top_hint": "too_curled",
    "lang": "en",
    "source": "synthetic",
}
# Code that could reach another model: imports of Google or backend clients, their hosts, or their key variables.
FORBIDDEN = re.compile(
    r"^\s*(import|from)\s+\S*(genai|gemini|google|app|decisions)|googleapis|generativelanguage|GEMINI_|DECISIONS_",
    re.IGNORECASE | re.MULTILINE,
)


class RecordingEnv(dict):
    """os.environ stand-in that records every key read."""

    def __init__(self, base):
        super().__init__(base)
        self.read: list[str] = []

    def get(self, key, default=None):
        self.read.append(key)
        return super().get(key, default)

    def __getitem__(self, key):
        self.read.append(key)
        return super().__getitem__(key)


def test_lane_code_names_no_gemini_or_decisions():
    for f in [*LANE.glob("*.py"), *LANE.glob("remote/*.sh")]:
        hits = FORBIDDEN.findall(f.read_text())
        assert not hits, f"{f.name} mentions {hits}"


def test_label_run_touches_only_the_tunnel(monkeypatch):
    hosts: list[str] = []

    async def send(self, request, *args, **kwargs):
        hosts.append(request.url.host)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": "Straighten your index finger a little."}}
                ]
            },
            request=request,
        )

    env = RecordingEnv(os.environ)
    monkeypatch.setattr(os, "environ", env)
    monkeypatch.setattr(httpx.AsyncClient, "send", send)
    out = asyncio.run(
        label.label([ROW], "google/gemma-4-31B-it", tries=1, concurrency=1)
    )
    assert out[0]["completion"] == "Straighten your index finger a little."
    assert out[0]["label_source"]["self_hosted"] is True
    assert hosts and set(hosts) <= set(oai.ALLOWED_HOSTS)
    assert not [k for k in env.read if "GEMINI" in k.upper() or "DECISION" in k.upper()]


@pytest.mark.parametrize(
    "url",
    [
        "https://generativelanguage.googleapis.com",
        "https://decisions.example.com",
        "http://localhost.evil.com:8001",
        "https://containers.datacrunch.io.evil.io/x",
    ],
)
def test_client_refuses_other_hosts(url):
    with pytest.raises(oai.ForbiddenHost):
        oai.check_host(url)


@pytest.mark.parametrize("model", ["gemini-3.5-flash-lite", "gpt-4o", "stub"])
def test_label_refuses_a_teacher_that_is_not_our_gemma(model):
    with pytest.raises(SystemExit):
        label.label_source(model, "bf16")


def test_sft_build_fails_on_foreign_labels_and_capture_rows():
    good = {
        **ROW,
        "completion": "x",
        "label_source": label.label_source("google/gemma-4-31B-it", "bf16"),
    }
    make_sft.check_rows([good])
    with pytest.raises(SystemExit):
        make_sft.check_rows(
            [
                {
                    **good,
                    "label_source": {
                        "model": "gemini-3.5-flash-lite",
                        "self_hosted": False,
                    },
                }
            ]
        )
    with pytest.raises(SystemExit):
        make_sft.check_rows([{**good, "label_source": None}])
    with pytest.raises(SystemExit):
        make_sft.check_rows([{**good, "source": "capture"}])


def test_built_dataset_keeps_captures_in_test_only():
    data = LANE / "out" / "dataset"
    if not (data / "train.jsonl").exists():
        pytest.skip("dataset not built here")
    for split in ("train", "val"):
        text = (data / f"{split}.jsonl").read_text()
        assert '"source": "capture"' not in text


def test_gateway_key_is_the_only_secret_read(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("GEMINI_API_KEY=nope\nVERDA_INFERENCE_KEY=k123\n")
    monkeypatch.setattr(oai, "ENV_FILE", env_file)
    env = RecordingEnv(
        {k: v for k, v in os.environ.items() if k != "VERDA_INFERENCE_KEY"}
    )
    monkeypatch.setattr(os, "environ", env)
    assert oai.headers("https://containers.datacrunch.io/coach-tune-teacher") == {
        "Authorization": "Bearer k123"
    }
    assert oai.headers("http://localhost:8001") == {}
    assert env.read == ["VERDA_INFERENCE_KEY"]
    oai.check_host("https://containers.datacrunch.io/coach-tune-teacher")
