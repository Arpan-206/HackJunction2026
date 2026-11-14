"""coach_tune label and evaluation logic against a stub model: no server, no Verda, no network."""

import asyncio
import json
import sys
from pathlib import Path

import pytest

LANE = Path(__file__).resolve().parents[1] / "coach_tune"
sys.path.insert(0, str(LANE))

httpx = pytest.importorskip("httpx")
import evaluate  # noqa: E402
import label  # noqa: E402
import oai  # noqa: E402
import prompt  # noqa: E402

LINES = {
    ("index", "too_curled", "en"): "Straighten your index finger a little.",
    ("ring", "too_flat", "de"): "Beuge den Ringfinger etwas mehr.",
    ("thumb", "too_closed", "fi"): "Levitä peukaloa hieman erilleen.",
    ("middle", "too_spread", "en"): "Bring your middle finger closer to the others, nicely done.",
}


def ex(i, finger, hint, lang):
    return {"id": f"x{i}", "task": "Pinch", "step_name": "close", "step_index": 0, "kind": "hold", "hand": "right",
            "score": 50, "errors": [{"finger": finger, "hint": hint, "err_deg": 30}], "top_finger": finger,
            "top_hint": hint, "lang": lang, "unit": "u", "split": "test"}


ROWS = [ex(i, *k) for i, k in enumerate(LINES)] + [ex(9, "little", "too_flat", "en")]


def stub(monkeypatch):
    async def complete(client, model, messages, temperature, max_tokens=48, base_url=None):
        user = messages[-1]["content"]
        for (f, h, lang), line in LINES.items():
            if f"{f} {h.replace('_', ' ')}" in user and prompt.LANG_NAMES[lang] in user:
                return line, 0.01
        return "Relax and try again with 3 degrees less.", 0.01

    async def served_model(base_url=None):
        return "google/gemma-4-31B-it"

    monkeypatch.setattr(oai, "complete", complete)
    monkeypatch.setattr(oai, "served_model", served_model)


def test_label_keeps_only_lines_that_pass(monkeypatch):
    stub(monkeypatch)
    out = asyncio.run(label.label(ROWS, "google/gemma-4-31B-it", tries=2, concurrency=4))
    kept = {r["id"] for r in out if r["completion"]}
    assert kept == {"x0", "x1", "x2", "x3"}
    assert len(next(r for r in out if r["id"] == "x9")["attempts"]) == 2
    assert "Kept (any try) | 4 (80.0%)" in label.report({"train": out}, 1.0, "stub")


def test_evaluate_run_and_report(monkeypatch, tmp_path):
    stub(monkeypatch)
    test = tmp_path / "test.jsonl"
    test.write_text("\n".join(json.dumps(r) for r in ROWS))
    monkeypatch.setattr(evaluate, "TEST", test)
    monkeypatch.setattr(evaluate, "OUT", tmp_path / "eval")
    for s in ("untuned", "tuned"):
        m = asyncio.run(evaluate.run(s, latency_n=3, concurrency=2))
        assert m["finger_pct"] == 80.0 and m["all_pct"] == 80.0
    text = evaluate.report()
    assert "NOT better" in text
    assert text.count("\n| ") >= 2 + len(ROWS)
