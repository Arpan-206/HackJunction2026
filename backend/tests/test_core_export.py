"""Takes and lessons exported locally as core lesson folders (services/core_export.py), and the Verda inference settings.

No network: the client for the model hosted on Verda is driven with a stub chat function.
"""

import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import pytest
from app import constants as c
from app.core.config import Settings
from app.main import create_app
from app.schemas.frames import GloveFrame, HandFrame
from app.schemas.lesson import Lesson, Step
from app.schemas.records import Recording
from app.services import core_export as V
from app.services.storage.json_store import JsonStore
from fastapi.testclient import TestClient

CORE = V.load_core()
pytestmark = pytest.mark.skipif(
    CORE is None, reason="the core is not importable from the repo root"
)


def _hand(side: str, curl: float) -> HandFrame:
    """A hand whose four fingers bend `curl` radians at every joint and whose thumb bends half as much."""
    return HandFrame(
        side=side,  # type: ignore[arg-type]
        wrist_quat=(0.0, 0.0, 0.0, 1.0),
        flexion={
            "thumb": (0.2, curl / 2, curl / 2),
            **{f: (curl, curl, curl) for f in ("index", "middle", "ring", "little")},
        },
    )


def _take(
    take_id: str,
    sides=("left", "right"),
    seconds: float = 3.0,
    lesson_id=None,
    step_id=None,
    source="rokoko_udp",
    curl_to: float = 1.2,
) -> Recording:
    """Open hand, close over the first half, hold the fist for the second half, at 60 Hz."""
    frames = []
    n = int(seconds * 60)
    for i in range(n):
        t = i / 60
        u = min(1.0, t / (seconds / 2))
        curl = curl_to * (0.5 - 0.5 * math.cos(math.pi * u))
        frames.append(
            GloveFrame(
                t=round(t, 4), source=source, hands=[_hand(s, curl) for s in sides]
            )
        )
    return Recording(
        id=take_id,
        lesson_id=lesson_id,
        step_id=step_id,
        started_at="2026-11-14T18:00:00+00:00",
        duration_s=frames[-1].t,
        fps=60.0,
        hands="both" if len(sides) == 2 else sides[0],
        frames=frames,
    )


def _store(data: Path):
    return JsonStore(data / "recordings", Recording), JsonStore(
        data / "lessons", Lesson
    )


def test_angles_invert_the_core_compat_mapping() -> None:
    """A core hand sent through core/compat.py and read back gives the same 18 raw angles."""
    from core import hand as H
    from core.compat import hand_to_glove_hand

    h = H.synth_hand(
        "left",
        curl={"thumb": 0.4, "index": 0.8, "middle": 0.2, "ring": 0.6, "little": 0.9},
    )
    hand = HandFrame.model_validate(hand_to_glove_hand(h))
    angles, joints = V.angles_deg(hand, CORE)
    assert np.allclose(angles, h.angles, atol=0.02)
    assert joints.shape == (26, 3)


def test_all_zero_spread_counts_as_unknown() -> None:
    """The simulator and the UDP mapper send spread as zeros; the synthetic fan stands in, not four 0 degree angles."""
    from app.schemas.common import FingerValues

    from core import hand as H

    zero = _hand("right", 0.4).model_copy(update={"spread": FingerValues()})
    angles, joints = V.angles_deg(zero, CORE)
    assert np.allclose(angles[14:18], H.angle_features(joints)[14:18])
    assert np.all(angles[14:18] > 1.0)
    measured = _hand("right", 0.4).model_copy(
        update={"spread": FingerValues(thumb=0.5, index=0.2, ring=0.1, little=0.3)}
    )
    assert np.allclose(
        V.angles_deg(measured, CORE)[0][14:18], np.degrees([0.5, 0.2, 0.1, 0.3])
    )


def _calibration(data: Path, side: str, flat: float, fist: float) -> None:
    """A backend flat and fist record (calibrations/<id>.json, radians), as POST /calibrations stores it."""
    (data / "calibrations").mkdir(parents=True, exist_ok=True)
    triples = lambda v: {f: [v, v, v] for f in c.FINGERS}
    doc = {
        "id": f"cal-{side}",
        "side": side,
        "flat": triples(flat),
        "fist": triples(fist),
        "created_at": "2026-11-14T17:00:00+00:00",
    }
    (data / "calibrations" / f"cal-{side}.json").write_text(
        json.dumps(doc), encoding="utf-8"
    )


def test_real_glove_takes_get_the_cores_calibration(tmp_path: Path) -> None:
    """A glove take is calibrated as the live core records (flat 0, fist curl_full_deg); a simulator take is not."""
    if not CORE.CAL.Calibrations(CORE.cfg).enabled:
        pytest.skip("config.toml [calibration] is off")
    recs, _ = _store(tmp_path)
    recs.save(_take("glove01", sides=("right",)))
    recs.save(_take("sim01", sides=("right",), source="simulator"))
    _calibration(tmp_path, "right", flat=0.3, fist=1.5)
    exporter = V.CoreLessonExporter(tmp_path)
    exporter.sync()
    full = float(CORE.cfg.hand.curl_full_deg)
    glove = json.loads(
        (tmp_path / "core_lessons/takes/glove01-right/lesson.json").read_text(
            encoding="utf-8"
        )
    )
    # the held fist at 1.2 rad sits three quarters of the way from flat (0.3) to fist (1.5)
    assert glove["steps"][-1]["key_angles"][2] == pytest.approx(0.75 * full, abs=0.5)
    sim = json.loads(
        (tmp_path / "core_lessons/takes/sim01-right/lesson.json").read_text(
            encoding="utf-8"
        )
    )
    assert sim["steps"][-1]["key_angles"][2] == pytest.approx(
        math.degrees(1.2), abs=0.5
    )
    parts = {e["id"]: e["parts"][0] for e in exporter.manifest()["entries"]}
    assert parts["glove01"]["calibration"]["range_calibration_id"] == "cal-right"
    assert parts["sim01"]["calibration"] is None
    # a new calibration rebuilds the glove folder only
    _calibration(tmp_path, "right", flat=0.1, fist=1.5)
    (tmp_path / "calibrations" / "cal-right.json").rename(
        tmp_path / "calibrations" / "cal-right2.json"
    )
    doc = json.loads(
        (tmp_path / "calibrations" / "cal-right2.json").read_text(encoding="utf-8")
    )
    doc.update(id="cal-right2", created_at="2026-11-14T18:30:00+00:00")
    (tmp_path / "calibrations" / "cal-right2.json").write_text(
        json.dumps(doc), encoding="utf-8"
    )
    again = exporter.sync()
    assert again.exported == ["take:glove01"] and again.unchanged == 1


def test_take_becomes_one_core_folder_per_hand(tmp_path: Path) -> None:
    recs, _ = _store(tmp_path)
    recs.save(_take("take01"))
    exporter = V.CoreLessonExporter(tmp_path)
    report = exporter.sync()
    assert report.exported == ["take:take01"]
    for side in ("left", "right"):
        folder = tmp_path / "core_lessons" / "takes" / f"take01-{side}"
        doc = json.loads((folder / "lesson.json").read_text(encoding="utf-8"))
        assert doc["schema"] == c.CORE_LESSON_SCHEMA
        assert doc["master"]["hand"] == side and doc["source"] == "glove"
        assert doc["created"] == "2026-11-14T18:00:00+00:00"
        assert (folder / "trace.npz").exists()
        assert min(p.name for p in (folder / "frames").iterdir()) == "step_00.jpg"
        last = doc["steps"][-1]
        assert last["kind"] == "hold"
        # the held fist: 1.2 rad on every finger joint, 0.6 rad on the thumb MCP and IP
        assert last["key_angles"][2] == pytest.approx(math.degrees(1.2), abs=0.5)
        assert last["key_angles"][0] == pytest.approx(math.degrees(0.6), abs=0.5)
        # the core reads it back with its own loader
        from core.recorder import Lesson as CoreLesson

        loaded = CoreLesson.load(folder)
        assert loaded.trace is not None and len(loaded.trace) == 180
    manifest = json.loads(
        (tmp_path / "core_lessons" / "manifest.json").read_text(encoding="utf-8")
    )
    entry = manifest["entries"][0]
    assert manifest["schema"] == c.CORE_EXPORT_SCHEMA
    assert entry["kind"] == "take" and entry["source_file"] == "recordings/take01.json"
    assert entry["folders"] == ["takes/take01-left", "takes/take01-right"]


def test_sync_skips_unchanged_and_drops_deleted(tmp_path: Path) -> None:
    recs, _ = _store(tmp_path)
    recs.save(_take("take01", sides=("right",), source="simulator"))
    exporter = V.CoreLessonExporter(tmp_path)
    exporter.sync()
    doc = json.loads(
        (tmp_path / "core_lessons/takes/take01-right/lesson.json").read_text(
            encoding="utf-8"
        )
    )
    assert (
        doc["source"] == "fake"
    )  # a simulator take is marked, so nobody trains on it as a real expert
    again = exporter.sync()
    assert again.exported == [] and again.unchanged == 1
    recs.delete("take01")
    gone = exporter.sync()
    assert gone.removed == ["take:take01"]
    assert not (tmp_path / "core_lessons/takes/take01-right").exists()
    assert (
        json.loads(
            (tmp_path / "core_lessons/manifest.json").read_text(encoding="utf-8")
        )["entries"]
        == []
    )


def test_lesson_joins_recorded_steps_one_core_step_each(tmp_path: Path) -> None:
    recs, lessons = _store(tmp_path)
    recs.save(_take("takeA", sides=("right",), lesson_id="les1", step_id="s1"))
    recs.save(
        _take("takeB", sides=("right",), lesson_id="les1", step_id="s2", curl_to=0.5)
    )
    lessons.save(
        Lesson(
            id="les1",
            created_at="2026-11-14T18:30:00+00:00",
            title="Grip",
            skill="general",
            master_name="Szymon",
            steps=[
                Step(
                    id="s1",
                    title="Close the fist",
                    instruction="Curl every finger.",
                    hands="right",
                    reference_recording_id="takeA",
                ),
                Step(
                    id="s2",
                    title="Half grip",
                    instruction="Stop half way.",
                    hands="right",
                    reference_recording_id="takeB",
                ),
                Step(
                    id="s3",
                    title="Wave",
                    instruction="Synthesised only.",
                    hands="right",
                ),
            ],
        )
    )
    V.CoreLessonExporter(tmp_path).sync()
    folder = tmp_path / "core_lessons/lessons/les1"
    doc = json.loads((folder / "lesson.json").read_text(encoding="utf-8"))
    assert [s["name"] for s in doc["steps"]] == ["Close the fist", "Half grip"]
    assert [s["note"] for s in doc["steps"]] == ["Curl every finger.", "Stop half way."]
    assert {s["named_by"] for s in doc["steps"]} == {"manual"}
    assert doc["master"] == {"name": "Szymon", "hand": "right"}
    manifest = json.loads(
        (tmp_path / "core_lessons/manifest.json").read_text(encoding="utf-8")
    )
    entry = next(e for e in manifest["entries"] if e["kind"] == "lesson")
    assert entry["recording_ids"] == ["takeA", "takeB"]
    assert entry["skipped_steps"] == [
        {"step_id": "s3", "title": "Wave", "reason": "no recorded take"}
    ]
    # the take titles come from the lesson
    take_doc = json.loads(
        (tmp_path / "core_lessons/takes/takeA-right/lesson.json").read_text(
            encoding="utf-8"
        )
    )
    assert take_doc["title"] == "Grip: Close the fist"


def test_a_lesson_without_takes_is_listed_not_exported(tmp_path: Path) -> None:
    _, lessons = _store(tmp_path)
    lessons.save(
        Lesson(
            id="seedish",
            created_at="x",
            title="Typed",
            skill="general",
            steps=[Step(title="Only words", instruction="none")],
        )
    )
    report = V.CoreLessonExporter(tmp_path).sync()
    assert report.skipped == ["lesson:seedish"]
    entry = json.loads(
        (tmp_path / "core_lessons/manifest.json").read_text(encoding="utf-8")
    )["entries"][0]
    assert entry["folders"] == [] and entry["reason"] == "no step has a recorded take"


def test_arpans_gemma_client_reads_an_exported_take(tmp_path: Path) -> None:
    """verda/gemma_client.py turns the exported folder into a lesson: pictures plus trace summary in, Lesson out."""
    if not (c.VERDA_LANE_DIR / "gemma_client.py").exists():
        pytest.skip("verda/ lane not in this checkout")
    recs, _ = _store(tmp_path)
    recs.save(_take("take01", sides=("right",)))
    V.CoreLessonExporter(tmp_path).sync()
    sys.path.insert(0, str(c.VERDA_LANE_DIR))
    try:
        import gemma_client as G
    finally:
        sys.path.remove(str(c.VERDA_LANE_DIR))
    seen = {}

    def chat(messages, schema):
        seen["messages"] = messages
        lesson = {
            "title": "Close the fist",
            "skill": "general",
            "summary": "",
            "steps": [
                {"title": "Close", "instruction": "Curl every finger.", "hands": "left"}
            ],
        }
        return G.ChatResult(text=json.dumps(lesson))

    result = G.generate_lesson(tmp_path / "core_lessons/takes/take01-right", chat=chat)
    content = seen["messages"][-1]["content"]
    assert any(
        part["type"] == "image_url" for part in content
    )  # the key pose sketches go as pictures
    assert "Demonstrating hand: right" in content[-1]["text"]
    assert (
        result.lesson["steps"][0]["hands"] == "right"
    )  # the gloves, not the model, say which hand


def test_the_app_exports_a_take_when_it_is_stopped(tmp_path: Path) -> None:
    settings = Settings(
        data_dir=tmp_path,
        llm_provider="fake",
        gemini_api_key=None,
        glove_source="simulator",
        rokoko_udp_port=0,
        glove_monitor=False,
        glove_autostart="off",
        core_export=True,
    )
    with TestClient(create_app(settings)) as client:
        rid = client.post("/api/recordings/start", json={"hands": "right"}).json()[
            "recording_id"
        ]
        time.sleep(0.6)
        assert client.post(f"/api/recordings/{rid}/stop").status_code == 200
        folder = tmp_path / "core_lessons" / "takes" / f"{rid}-right"
        deadline = time.monotonic() + 10
        while not (folder / "lesson.json").exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        assert (folder / "lesson.json").exists()


def test_export_off_writes_nothing(tmp_path: Path) -> None:
    recs, _ = _store(tmp_path)
    recs.save(_take("take01"))
    report = V.CoreLessonExporter(tmp_path, enabled=False).sync()
    assert not report.available
    assert not (tmp_path / "core_lessons").exists()


def test_verda_names_configure_the_openai_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The Verda lane's own variable names reach the backend's OpenAI-compatible provider."""
    from app.services.llm.registry import LLMState

    monkeypatch.setenv("VERDA_GEMMA_URL", "https://containers.example/geppetto-gemma")
    monkeypatch.setenv("VERDA_INFERENCE_KEY", "test-key")
    monkeypatch.setenv("VERDA_GEMMA_MODEL", "google/gemma-4-31B-it")
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    s = Settings(_env_file=None, llm_provider="gemini", llm_routes="lesson=openai")
    assert s.openai_base_url == "https://containers.example/geppetto-gemma"
    assert s.openai_api_key == "test-key"
    state = LLMState(s)
    assert state.openai_configured()
    assert state.chain_for("lesson") == ["openai", "gemini"]


def test_empty_openai_lines_do_not_hide_the_verda_names(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A .env copied from .env.example has empty OPENAI_ lines; the Verda names below them still count."""
    monkeypatch.setenv("OPENAI_BASE_URL", "")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("OPENAI_MODEL", "")
    monkeypatch.setenv("VERDA_GEMMA_URL", "https://containers.example/geppetto-gemma")
    monkeypatch.setenv("VERDA_INFERENCE_KEY", "test-key")
    monkeypatch.setenv("VERDA_GEMMA_MODEL", "google/gemma-4-31B-it")
    s = Settings(_env_file=None)
    assert s.openai_base_url == "https://containers.example/geppetto-gemma"
    assert s.openai_api_key == "test-key"
    assert s.openai_model == "google/gemma-4-31B-it"
    # an OPENAI_ value that is set wins
    monkeypatch.setenv("OPENAI_BASE_URL", "https://other.example")
    assert Settings(_env_file=None).openai_base_url == "https://other.example"


def _scripts():
    """The two Verda scripts, imported as modules."""
    sys.path.insert(0, str(c.BACKEND_ROOT / "scripts"))
    try:
        import core_export_sync
        import verda_lesson
    finally:
        sys.path.remove(str(c.BACKEND_ROOT / "scripts"))
    return core_export_sync, verda_lesson


def test_scripts_sync_dry_run_and_save(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    """core_export_sync exports; verda_lesson --dry-run prints the prompt summary; a stubbed Verda call saves a lesson."""
    if not (c.VERDA_LANE_DIR / "gemma_client.py").exists():
        pytest.skip("verda/ lane not in this checkout")
    recs, lessons = _store(tmp_path)
    recs.save(_take("take01"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("VERDA_GEMMA_URL", "https://containers.example/geppetto-gemma")
    monkeypatch.setenv("VERDA_INFERENCE_KEY", "test-key")
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    sync, lesson_cli = _scripts()
    assert sync.main() == 0
    assert (tmp_path / "core_lessons/takes/take01-right/lesson.json").exists()

    assert lesson_cli.main(["take01", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "Demonstrating hand: right" in out and "step_00.jpg" in out

    G = lesson_cli.gemma_client()
    calls = []

    def fake_chat(self, messages, schema=None, **_):
        calls.append(self.base_url)
        body = {
            "title": "Fist",
            "skill": "general",
            "steps": [{"title": "Close", "instruction": "Curl."}],
        }
        return G.ChatResult(text=json.dumps(body))

    monkeypatch.setattr(G.Endpoint, "chat", fake_chat)
    assert lesson_cli.main(["take01", "--side", "left", "--save"]) == 0
    assert calls == ["https://containers.example/geppetto-gemma"]
    saved = [x for x in lessons.list() if x.title == "Fist"]
    assert (
        saved and saved[0].source == "generated" and saved[0].steps[0].hands == "left"
    )


def test_lesson_cli_names_the_missing_endpoint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, lesson_cli = _scripts()
    monkeypatch.setattr(lesson_cli, "ENDPOINT_FILE", tmp_path / "none.json")
    s = Settings(_env_file=None)
    assert lesson_cli.endpoint_settings(s)[0] == ""


def test_arpans_weights_tool_reads_an_exported_lesson(tmp_path: Path) -> None:
    """weights/check_lessons.py, a local tool on core lesson folders, rebuilds the weights of an exported lesson."""
    tool = c.REPO_ROOT / "weights" / "check_lessons.py"
    if not tool.exists():
        pytest.skip("weights/ not in this checkout")
    recs, lessons = _store(tmp_path)
    recs.save(_take("takeA", sides=("right",)))
    lessons.save(
        Lesson(
            id="les1",
            created_at="x",
            title="Fist",
            skill="general",
            steps=[
                Step(
                    id="s1",
                    title="Close",
                    instruction="Curl.",
                    reference_recording_id="takeA",
                )
            ],
        )
    )
    V.CoreLessonExporter(tmp_path).sync()
    import importlib.util

    spec = importlib.util.spec_from_file_location("check_lessons", tool)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    res = mod.check(tmp_path / "core_lessons/lessons/les1", None, "", 0, "")
    assert (
        res["lesson"] == "les1"
        and res["master_hand"] == "right"
        and len(res["steps"]) == 1
    )
