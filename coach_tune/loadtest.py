"""Load test of the tuned coach endpoint: hints per second and latency at 1, 10, 50 and 200 simultaneous learners.

    COACH_TUNE_BASE_URL=https://containers.datacrunch.io/coach-tune-trainer \\
      /Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python coach_tune/loadtest.py [--seconds 30] [--levels 1,10,50,200]

A "simultaneous learner" here is one request in flight at all times: each of N workers sends a hint request, waits for
the answer and sends the next one at once (a closed loop). This is harder than real use, where the app asks for at most
one hint per learner every 5 s (frontend AI_HINT_MIN_GAP_MS). Prompts are the held-out test examples of the hint job.
Latency is measured from this laptop through the Verda container gateway, so it includes the internet round trip.
Writes out/loadtest/result.json and prints a table. Talks only to our own vLLM (oai.check_host).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
import time
from pathlib import Path

import httpx

os.environ.pop("COACH_TUNE_TASK", None)  # the load test is always the hint job, the one served in the demo
sys.path.insert(0, str(Path(__file__).resolve().parent))
import oai
import prompt

LANE = Path(__file__).resolve().parent
TEST = LANE / "out" / "dataset" / "test.jsonl"
OUT = LANE / "out" / "loadtest"
HINT_GAP_S = 5.0  # the app's minimum gap between two hint requests of one learner


def q(xs: list[float], p: float) -> float:
    s = sorted(xs)
    return round(s[min(len(s) - 1, int(p * len(s)))], 3) if s else float("nan")


async def level(model: str, rows: list[dict], n: int, seconds: float) -> dict:
    lat: list[float] = []
    errors = 0
    stop = time.perf_counter() + seconds
    rng = random.Random(n)
    limits = httpx.Limits(max_connections=n, max_keepalive_connections=n)
    async with httpx.AsyncClient(timeout=120, headers=oai.headers(), limits=limits) as client:
        # open the connections first, so the TLS handshakes are not counted
        await asyncio.gather(*(oai.complete(client, model, prompt.messages(rng.choice(rows)), 0.0) for _ in range(n)), return_exceptions=True)

        async def worker() -> None:
            nonlocal errors
            while time.perf_counter() < stop:
                ex = rng.choice(rows)
                try:
                    _, dt = await oai.complete(client, model, prompt.messages(ex), 0.0)
                    lat.append(dt)
                except Exception:
                    errors += 1
                    await asyncio.sleep(0.2)

        t0 = time.perf_counter()
        stop = t0 + seconds
        await asyncio.gather(*(worker() for _ in range(n)))
        wall = time.perf_counter() - t0
    done = len(lat)
    rate = done / wall if wall > 0 else 0.0
    return {
        "simultaneous": n,
        "seconds": round(wall, 1),
        "hints": done,
        "errors": errors,
        "hints_per_s": round(rate, 1),
        "latency_p50_s": q(lat, 0.5),
        "latency_p95_s": q(lat, 0.95),
        "latency_max_s": round(max(lat), 3) if lat else float("nan"),
        # learners one GPU serves when each asks for a hint every HINT_GAP_S seconds, the app's maximum rate
        "learners_at_app_rate": int(rate * HINT_GAP_S),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=30.0)
    ap.add_argument("--levels", default="1,10,50,200")
    ap.add_argument("--usd-per-hour", type=float, default=5.77, help="list price of the GPU serving the model (H100)")
    ap.add_argument("--gpu", default="1x H100 80 GB")
    a = ap.parse_args()
    rows = [json.loads(x) for x in TEST.read_text().splitlines() if x.strip()]
    model = asyncio.run(oai.served_model())
    results = []
    for n in [int(x) for x in a.levels.split(",")]:
        r = asyncio.run(level(model, rows, n, a.seconds))
        r["usd_per_learner_hour_at_app_rate"] = round(a.usd_per_hour / r["learners_at_app_rate"], 5) if r["learners_at_app_rate"] else None
        results.append(r)
        print(json.dumps(r), flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    out = {"model": model, "gpu": a.gpu, "usd_per_hour": a.usd_per_hour, "hint_gap_s": HINT_GAP_S, "host": oai.where(),
           "when": time.strftime("%Y-%m-%d %H:%M"), "levels": results}
    (OUT / "result.json").write_text(json.dumps(out, indent=2) + "\n")
    print("\n| Simultaneous learners | Hints per second | Latency p50 s | Latency p95 s | Errors | Learners at one hint per 5 s | USD per learner-hour |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for r in results:
        print(f"| {r['simultaneous']} | {r['hints_per_s']} | {r['latency_p50_s']} | {r['latency_p95_s']} | {r['errors']} | {r['learners_at_app_rate']} | {r['usd_per_learner_hour_at_app_rate']} |")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
