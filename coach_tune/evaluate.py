"""Step 4: score one system on the held-out test lessons, or write the three-way report.

    python coach_tune/evaluate.py --system teacher|untuned|tuned   # whatever serve.sh serves now, via the tunnel
    python coach_tune/evaluate.py --report                         # out/eval/report.md

Quality: every test example once, temperature 0, batched. Metrics: right finger named %, right direction %, style
compliance % (one sentence, at most 14 words, no numbers or degrees), all three at once %. Latency: `--latency-n`
single requests one after another (no batching), from this laptop through the SSH tunnel, p50 and p95.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
import oai
import prompt

LANE = Path(__file__).resolve().parent
TEST = LANE / "out" / "dataset" / "test.jsonl"
OUT = LANE / "out" / "eval"
SYSTEMS = ("untuned", "tuned", "teacher")


def pct(xs: list[bool]) -> float:
    return round(100 * sum(xs) / max(1, len(xs)), 1)


def quantile(xs: list[float], q: float) -> float:
    s = sorted(xs)
    return round(s[min(len(s) - 1, int(q * len(s)))], 3) if s else float("nan")


async def run(system: str, latency_n: int, concurrency: int) -> dict:
    rows = [json.loads(x) for x in TEST.read_text().splitlines() if x.strip()]
    model = await oai.served_model()

    async def one(client, ex):
        line, dt = await oai.complete(
            client, model, prompt.messages(ex), temperature=0.0
        )
        return {
            "id": ex["id"],
            "raw": line,
            "batched_s": round(dt, 3),
            **prompt.check(line, ex["top_finger"], ex["top_hint"], ex["lang"]),
        }

    t0 = time.time()
    results = await oai.run_all(rows, one, concurrency)
    wall = time.time() - t0
    lat = []
    sample = random.Random(1).sample(rows, min(latency_n, len(rows)))
    async with httpx.AsyncClient(timeout=60, headers=oai.headers()) as client:
        await oai.complete(client, model, prompt.messages(sample[0]), 0.0)  # warm
        for ex in sample:
            lat.append((await oai.complete(client, model, prompt.messages(ex), 0.0))[1])
    summary = {
        "system": system,
        "model": model,
        "n": len(results),
        "finger_pct": pct([r["finger_ok"] for r in results]),
        "direction_pct": pct([r["direction_ok"] for r in results]),
        "style_pct": pct([r["style_ok"] for r in results]),
        "all_pct": pct([r["ok"] for r in results]),
        "single_finger_pct": pct([r["single_finger"] for r in results]),
        "latency_p50_s": quantile(lat, 0.5),
        "latency_p95_s": quantile(lat, 0.95),
        "latency_mean_s": round(statistics.mean(lat), 3),
        "latency_n": len(lat),
        "batch_wall_s": round(wall, 1),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / f"{system}.jsonl").open("w") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (OUT / f"{system}.summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return summary


def report() -> str:
    rows = {
        json.loads(x)["id"]: json.loads(x)
        for x in TEST.read_text().splitlines()
        if x.strip()
    }
    sums = {
        s: json.loads((OUT / f"{s}.summary.json").read_text())
        for s in SYSTEMS
        if (OUT / f"{s}.summary.json").exists()
    }
    outs = {
        s: {
            json.loads(x)["id"]: json.loads(x)
            for x in (OUT / f"{s}.jsonl").read_text().splitlines()
        }
        for s in sums
    }
    lessons = sorted({r["unit"] for r in rows.values()})
    lines = [
        "# Coach model evaluation",
        "",
        f"Held-out units ({len(lessons)}), never seen in training: {', '.join(lessons)}.",
        f"{len(rows)} test examples. Quality at temperature 0. Latency: single requests in a row from the laptop through the Verda container gateway (each system on its own 1x H100 serverless container), so it includes the internet round trip.",
        "",
        "| System | Model | Right finger % | Right direction % | Style % | All three % | Latency p50 s | Latency p95 s |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for s, m in sums.items():
        lines.append(
            f"| {s} | {m['model']} | {m['finger_pct']} | {m['direction_pct']} | {m['style_pct']} | {m['all_pct']} | {m['latency_p50_s']} | {m['latency_p95_s']} |"
        )
    if "tuned" in sums and "untuned" in sums:
        better = sums["tuned"]["all_pct"] > sums["untuned"]["all_pct"]
        lines += [
            "",
            "The tuned model is "
            + ("better" if better else "NOT better")
            + f" than the untuned one on the all-three measure "
            f"({sums['tuned']['all_pct']}% against {sums['untuned']['all_pct']}%).",
        ]
    ids = random.Random(7).sample(sorted(rows), min(20, len(rows)))
    lines += [
        "",
        "## 20 side-by-side samples",
        "",
        "| Input | " + " | ".join(sums) + " |",
        "| --- |" + " --- |" * len(sums),
    ]
    for i in ids:
        ex = rows[i]
        cue = f"{ex['lang']}: {ex['top_finger']} {ex['top_hint'].replace('_', ' ')} ({ex['task']}, {ex['step_name']})"
        cells = []
        for s in sums:
            o = outs[s][i]
            mark = "ok" if o["ok"] else "x"
            cells.append(f"{o['line'].replace('|', '/')} [{mark}]")
        lines.append(f"| {cue} | " + " | ".join(cells) + " |")
    text = "\n".join(lines) + "\n"
    (OUT / "report.md").write_text(text)
    return text


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--system", choices=SYSTEMS)
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--latency-n", type=int, default=100)
    ap.add_argument("--concurrency", type=int, default=64)
    a = ap.parse_args()
    if a.report:
        print(report())
        return 0
    if not a.system:
        ap.error("--system or --report")
    asyncio.run(run(a.system, a.latency_n, a.concurrency))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
