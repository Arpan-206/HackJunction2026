"""The backend-shaped provider against a fake server: it honours LLMClient and the backend's generator can use it."""

import asyncio
import json

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.services.llm.base import LLMRequest
from app.services.llm.lesson_generator import LessonGenerator
from app.services.llm.registry import LLMState
from app.services.moves import MoveCatalog
from openai_compat import OpenAICompatLLM

LESSON = {
    "title": "Fist and point",
    "skill": "general",
    "steps": [{"title": "Lesson 1: Fist", "instruction": "Close the hand.", "move_id": "general_fist"}],
}


def fake_server(answer: str, reject_schema: bool = False):
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if reject_schema and body.get("response_format", {}).get("type") == "json_schema":
            return httpx.Response(400, json={"error": "bad schema"})
        return httpx.Response(200, json={"choices": [{"message": {"content": answer}}]})

    return bodies, httpx.MockTransport(handler)


def test_generate_json_sends_schema_and_returns_content():
    bodies, transport = fake_server(json.dumps(LESSON))
    llm = OpenAICompatLLM("https://host/dep/", "k", "google/gemma-4-31B-it", transport=transport)
    req = LLMRequest(system="sys", prompt="user", user_text="user", schema={"type": "object"})
    text = asyncio.run(llm.generate_json(req))
    assert json.loads(text) == LESSON
    body = bodies[0]
    assert body["model"] == "google/gemma-4-31B-it"
    assert body["messages"] == [{"role": "system", "content": "sys"}, {"role": "user", "content": "user"}]
    assert body["response_format"] == {"type": "json_schema", "json_schema": {"name": "lesson", "schema": {"type": "object"}}}


def test_generate_text_has_no_response_format_and_schema_rejection_falls_back():
    bodies, transport = fake_server("hello", reject_schema=True)
    llm = OpenAICompatLLM("https://host/dep", None, "m", transport=transport)
    assert asyncio.run(llm.generate_text(LLMRequest(system="s", prompt="p", user_text="p"))) == "hello"
    assert "response_format" not in bodies[0] and "Authorization" not in llm._headers
    asyncio.run(llm.generate_json(LLMRequest(system="s", prompt="p", user_text="p", schema={"type": "object"})))
    assert [b.get("response_format", {}).get("type") for b in bodies[1:]] == ["json_schema", "json_object"]


def test_server_errors_become_service_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="down")

    llm = OpenAICompatLLM("https://host/dep", "k", "m", transport=httpx.MockTransport(handler))
    with pytest.raises(ServiceUnavailableError):
        asyncio.run(llm.generate_text(LLMRequest(system="s", prompt="p", user_text="p")))


def test_backend_lesson_generator_runs_on_the_provider(tmp_path):
    bodies, transport = fake_server(json.dumps(LESSON))
    state = LLMState(Settings(llm_provider="fake", data_dir=tmp_path))
    state.use(OpenAICompatLLM("https://host/dep", "k", "m", transport=transport))
    response = asyncio.run(LessonGenerator(state, MoveCatalog()).generate("teach a fist", None))
    assert response.provider == "openai" and response.attempts == 1
    assert response.lesson.title == "Fist and point" and response.lesson.steps[0].move_id == "general_fist"
    assert bodies[0]["response_format"]["json_schema"]["schema"]["properties"]["steps"]
