"""The lesson client against a fake model: prompt shape, validation, retry, finalisation. No network."""

import json

import gemma_client as G
import httpx
import paths
import pytest
import recording as R

FIXTURE = paths.CAPTURE_FIXTURE

pytestmark = pytest.mark.skipif(
    not FIXTURE.exists(), reason="real capture fixture not in the repo"
)

GOOD_LESSON = {
    "title": "Open, point, fist",
    "skill": "general",
    "summary": "Three hand shapes from the glove recording.",
    "steps": [
        {
            "title": "Lesson 1: Open hand",
            "instruction": "Spread all five fingers.",
            "move_id": "general_spread",
            "hands": "right",
            "motion": {
                "preset": "hold_pose",
                "pose": {"thumb": 0, "index": 0, "middle": 0, "ring": 0, "little": 0},
            },
        },
        {
            "title": "Lesson 2: Point",
            "instruction": "Curl every finger but the index.",
            "move_id": "not_a_real_move",
            "hands": "right",
        },
    ],
}


@pytest.fixture(scope="module")
def folder(tmp_path_factory):
    out = tmp_path_factory.mktemp("rec")
    return R.recording_from_capture(
        FIXTURE, out, side="left", marks=2, lesson_id="worn-left"
    )


def test_messages_put_pictures_first_then_the_prompt(folder):
    rec = R.load_recording(folder)
    msgs = G.build_messages(
        rec, "teach this", None, G.MoveCatalog(), R.pick_frames(rec, 2)
    )
    assert msgs[0]["role"] == "system" and "lesson designer" in msgs[0]["content"]
    content = msgs[1]["content"]
    assert [part["type"] for part in content] == ["image_url", "image_url", "text"]
    text = content[-1]["text"]
    assert text.startswith("MASTER REQUEST:\nteach this")
    assert "RECORDED DEMONSTRATION" in text and "MOVE CATALOGUE" in text
    assert "- general_fist: Fist (general, motion preset hold_pose)" in text
    assert "FAILED VALIDATION" not in text


def test_valid_answer_becomes_a_backend_lesson(folder):
    calls = []

    def chat(messages, schema):
        calls.append((messages, schema))
        return G.ChatResult(
            text=json.dumps(GOOD_LESSON),
            usage={"prompt_tokens": 10, "completion_tokens": 5},
            latency_s=0.5,
        )

    result = G.generate_lesson(folder, "teach this", None, chat=chat, max_frames=2)
    assert (
        result.attempts == 1
        and result.latency_s == 0.5
        and result.usage == {"prompt_tokens": 10, "completion_tokens": 5}
    )
    assert calls[0][1]["properties"][
        "steps"
    ]  # the backend's LessonBase schema went to the server
    lesson = result.lesson
    assert lesson["source"] == "generated" and lesson["id"] and lesson["created_at"]
    assert lesson["steps"][0]["move_id"] == "general_spread"
    assert (
        lesson["steps"][1]["move_id"] is None
    )  # unknown ids are dropped, as the backend does
    assert (
        G.lesson_from_recording(folder, chat=chat, max_frames=1)["title"]
        == "Open, point, fist"
    )


def test_recorded_hand_overrides_the_model(folder):
    # The fixture is a left-hand take; the model answers "right", as Gemma 4 did on 14 Nov.
    def chat(messages, schema):
        return G.ChatResult(text=json.dumps(GOOD_LESSON))

    assert G.recorded_hand(R.load_recording(folder)) == "left"
    lesson = G.lesson_from_recording(folder, chat=chat, max_frames=1)
    assert [s["hands"] for s in lesson["steps"]] == ["left", "left"]


def test_invalid_answer_is_retried_with_the_errors(folder):
    answers = iter(['{"title": "no steps"}', json.dumps(GOOD_LESSON)])
    seen = []

    def chat(messages, schema):
        seen.append(messages[1]["content"][-1]["text"])
        return G.ChatResult(text=next(answers), latency_s=1.0)

    result = G.generate_lesson(folder, "", None, chat=chat, max_frames=1)
    assert result.attempts == 2 and result.latency_s == 2.0
    assert "FAILED VALIDATION" in seen[1] and "FAILED VALIDATION" not in seen[0]
    assert len(result.errors) == 1


def test_never_valid_raises(folder):
    def chat(messages, schema):
        return G.ChatResult(text="not json")

    with pytest.raises(G.LessonGenerationError):
        G.generate_lesson(folder, chat=chat, max_frames=1, max_retries=1)


def test_endpoint_falls_back_to_json_object_when_the_schema_is_rejected():
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        assert request.headers["Authorization"] == "Bearer key"
        if body["response_format"]["type"] == "json_schema":
            return httpx.Response(400, json={"error": "unsupported schema"})
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "{}"}}],
                "usage": {"prompt_tokens": 3},
            },
        )

    ep = G.Endpoint(
        "https://containers.example/x", "key", transport=httpx.MockTransport(handler)
    )
    result = ep.chat([{"role": "user", "content": "hi"}], schema={"type": "object"})
    assert (
        result.text == "{}"
        and result.schema_mode == "json_object"
        and result.usage == {"prompt_tokens": 3}
    )
    assert [b["response_format"]["type"] for b in bodies] == [
        "json_schema",
        "json_object",
    ]
    assert bodies[0]["model"] == G.DEFAULT_MODEL
