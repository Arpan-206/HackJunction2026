"""Step 2: Gemma 4 31B on the Verda VM writes one coaching line per train and val example; the filter keeps the good ones.

    python coach_tune/label.py [--tries 3] [--concurrency 96]

Needs the teacher served (remote/serve.sh teacher) and the tunnel up. Each example gets up to `--tries` samples at
temperature 0.7 until one passes prompt.check. Writes out/labels/{train,val}.jsonl (kept examples with "completion")
and out/labels/report.md with the keep rate overall, on the first try, and per language and per hint.
Labels come only from this Gemma; nothing from Gemini or any other API.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import oai  # noqa: E402
import prompt  # noqa: E402

DATA = Path(__file__).resolve().parent / "out" / "dataset"
OUT = Path(__file__).resolve().parent / "out" / "labels"


def load(split: str) -> list[dict]:
    return [json.loads(x) for x in (DATA / f"{split}.jsonl").read_text().splitlines() if x.strip()]


def label_source(model: str, precision: str) -> dict:
    """Where a label came from. Refuses any model that is not a self-hosted open-weights Gemma 4."""
    if not model.startswith(oai.TEACHER_PREFIX):
        raise SystemExit(f"refusing to label with {model!r}: labels come only from our self-hosted Gemma 4 on Verda")
    return {"model": model, "precision": precision, "host": "verda-vm via ssh tunnel", "self_hosted": True}


async def label(rows: list[dict], model: str, tries: int, concurrency: int, precision: str = "bf16") -> list[dict]:
    source = label_source(model, precision)

    async def one(client, ex):
        attempts = []
        for k in range(tries):
            line, dt = await oai.complete(client, model, prompt.messages(ex), temperature=0.7)
            v = prompt.check(line, ex["top_finger"], ex["top_hint"], ex["lang"])
            attempts.append({"line": v["line"], "s": round(dt, 3), **{n: v[n] for n in ("finger_ok", "direction_ok", "style_ok")}})
            if v["ok"]:
                return {**ex, "completion": v["line"], "try": k + 1, "attempts": attempts, "label_source": source}
        return {**ex, "completion": None, "try": None, "attempts": attempts, "label_source": source}

    return await oai.run_all(rows, one, concurrency)


def report(results: dict[str, list[dict]], seconds: float, model: str) -> str:
    rows = [r for rs in results.values() for r in rs]
    n = len(rows)
    kept = [r for r in rows if r["completion"]]
    first = [r for r in kept if r["try"] == 1]
    calls = sum(len(r["attempts"]) for r in rows)
    att = [a for r in rows for a in r["attempts"]]
    out = [f"# Labels from {model}", "", f"Wall time {seconds:.0f} s, {calls} calls.", "",
           "| Measure | Value |", "| --- | --- |",
           f"| Examples | {n} |", f"| Kept (any try) | {len(kept)} ({100 * len(kept) / n:.1f}%) |",
           f"| Kept on the first try | {len(first)} ({100 * len(first) / n:.1f}%) |",
           f"| Single-call pass rate | {100 * sum(a['finger_ok'] and a['direction_ok'] and a['style_ok'] for a in att) / len(att):.1f}% |",
           f"| Right finger, all calls | {100 * sum(a['finger_ok'] for a in att) / len(att):.1f}% |",
           f"| Right direction, all calls | {100 * sum(a['direction_ok'] for a in att) / len(att):.1f}% |",
           f"| Style, all calls | {100 * sum(a['style_ok'] for a in att) / len(att):.1f}% |", ""]
    for key in ("lang", "top_hint", "top_finger"):
        tot, ok = Counter(r[key] for r in rows), Counter(r[key] for r in kept)
        out += [f"| {key} | examples | kept % |", "| --- | --- | --- |"]
        out += [f"| {k} | {tot[k]} | {100 * ok[k] / tot[k]:.1f} |" for k in sorted(tot)] + [""]
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tries", type=int, default=3)
    ap.add_argument("--concurrency", type=int, default=96)
    ap.add_argument("--precision", default="bf16", help="the teacher precision as served, recorded on every label")
    ap.add_argument("--limit", type=int, default=0, help="label only the first N per split (smoke test)")
    a = ap.parse_args()
    model = asyncio.run(oai.served_model())
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    results = {}
    for split in ("train", "val"):
        rows = load(split)[: a.limit or None]
        results[split] = asyncio.run(label(rows, model, a.tries, a.concurrency, a.precision))
        with (OUT / f"{split}.jsonl").open("w") as f:
            for r in results[split]:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(split, len(rows), "kept", sum(1 for r in results[split] if r["completion"]), f"{time.time() - t0:.0f} s", flush=True)
    text = report(results, time.time() - t0, f"{model} ({a.precision}, self-hosted on Verda)")
    (OUT / "report.md").write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
