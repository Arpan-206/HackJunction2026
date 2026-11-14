"""The tuned coach behind COACH_MODEL=tuned: off by default, first for hints when on, falls back, labels who answered.

Stubs only: an httpx MockTransport stands in for the vLLM server.
"""

import asyncio
import importlib.util
import json
from pathlib import Path

import httpx
import pytest
from app.core.config import Settings
from app.schemas.api import CoachHintRequest
from app.services.llm import tuned as tuned_mod
from app.services.llm.base import LLMRequest
from app.services.llm.chain import ChainLLM
from app.services.llm.coach import CoachService
from app.services.llm.registry import LLMState
from app.services.llm.tuned import NotAFingerCue, TunedCoachLLM, example_from_request

PROMPT_FILE = Path(__file__).resolve().parents[2] / "coach_tune" / "prompt.py"


def settings(tmp_path: Path, **kw) -> Settings:
    return Settings(_env_file=None, data_dir=tmp_path, gemini_api_key=None, **kw)


def transport(line: str, seen: list[dict] | None = None, status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(json.loads(request.content))
        if status != 200:
            return httpx.Response(status, json={"error": "down"})
        return httpx.Response(200, json={"choices": [{"message": {"content": line}}]})

    return httpx.MockTransport(handler)


def hint_request(**kw) -> LLMRequest:
    body = CoachHintRequest.model_validate({"move_name": "Pinch", "deviations": {"index": 30}, **kw})
    return LLMRequest("sys", "prompt", body.model_dump_json(), task="hint")


def test_off_by_default(tmp_path):
    state = LLMState(settings(tmp_path, llm_provider="gemini", llm_fallback="none"))
    assert state.chain_for("hint") == ["gemini"]


def test_needs_url_even_when_flag_on(tmp_path):
    state = LLMState(settings(tmp_path, llm_provider="gemini", llm_fallback="none", coach_model="tuned"))
    assert state.chain_for("hint") == ["gemini"]


def test_on_puts_tuned_first_for_hints_only(tmp_path):
    s = settings(
        tmp_path,
        llm_provider="gemini",
        llm_fallback="openai",
        openai_base_url="http://gemma31b",
        coach_model="tuned",
        tuned_base_url="http://tuned",
    )
    state = LLMState(s)
    assert state.chain_for("hint") == ["tuned", "gemini", "openai"]
    assert state.chain_for("lesson") == ["gemini", "openai"]
    assert isinstance(state.client_for("hint"), ChainLLM)


def test_prompt_matches_training_prompt():
    spec = importlib.util.spec_from_file_location("coach_tune_prompt", PROMPT_FILE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert tuned_mod.SYSTEM == mod.SYSTEM
    assert tuned_mod.FIX == mod.FIX
    ex = {"task": "Pinch", "step_name": "close", "step_index": 0, "kind": "move", "hand": "right", "score": 40,
          "errors": [{"finger": "index", "hint": "too_curled", "err_deg": 30}], "lang": "de"}
    assert tuned_mod.user_prompt(ex) == mod.user_prompt(ex)


def test_example_signs_follow_the_coach_convention():
    ex, draft = example_from_request(CoachHintRequest.model_validate({"deviations": {"index": 30, "ring": -10}}))
    assert ex["errors"][0] == {"finger": "index", "hint": "too_curled", "err_deg": 30}
    assert draft["cue_type"] == "extend" and draft["focus_finger"] == "index"
    ex, draft = example_from_request(CoachHintRequest.model_validate({"deviations": {"ring": -30}}))
    assert ex["errors"][0]["hint"] == "too_flat" and draft["cue_type"] == "curl"


def test_timing_cue_is_not_its_job():
    with pytest.raises(NotAFingerCue):
        example_from_request(CoachHintRequest.model_validate({"deviations": {"index": 1}, "timing_ms": 400}))


def test_provider_wraps_the_line_in_a_hint_draft():
    seen: list[dict] = []
    llm = TunedCoachLLM("http://tuned", None, "m", transport=transport("Straighten your index finger a little.", seen))
    out = json.loads(asyncio.run(llm.generate_json(hint_request())))
    assert out["hint"] == "Straighten your index finger a little."
    assert out["focus_finger"] == "index" and out["cue_type"] == "extend"
    assert seen[0]["messages"][0]["content"] == tuned_mod.SYSTEM
    assert "Language: English" in seen[0]["messages"][1]["content"]


class Fallback:
    name = "gemini"
    supports_video = False

    async def generate_json(self, request):
        return json.dumps({"hint": "Lift your index finger a little.", "focus_finger": "index", "cue_type": "extend", "severity": "high"})

    async def generate_text(self, request):
        return "x"


def test_chain_falls_back_when_tuned_is_down():
    tuned = TunedCoachLLM("http://tuned", None, "m", transport=transport("", status=503))
    chain = ChainLLM([tuned, Fallback()])
    out = json.loads(asyncio.run(chain.generate_json(hint_request())))
    assert out["hint"] == "Lift your index finger a little."
    assert chain.last_answered == "gemini"
    assert chain.last_errors[0].startswith("tuned:")


def test_coach_reports_tuned_as_the_provider(tmp_path):
    s = settings(tmp_path, llm_provider="gemini", llm_fallback="none", coach_model="tuned", tuned_base_url="http://tuned")
    state = LLMState(s)
    state._clients["bare:tuned"] = TunedCoachLLM("http://tuned", None, "m", transport=transport("Straighten your index finger a little."))
    state._clients["bare:gemini"] = Fallback()
    res = asyncio.run(CoachService(state).hint(CoachHintRequest.model_validate({"move_name": "Pinch", "deviations": {"index": 30}})))
    assert res.provider == "tuned"
    assert "index" in res.hint
