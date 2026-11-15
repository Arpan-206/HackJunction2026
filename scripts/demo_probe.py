"""One tiny chat completion against an OpenAI-compatible server on Verda, to prove the model really answers.

    verda/.venv/bin/python scripts/demo_probe.py URL MODEL [--tries 12] [--gap 10]

The key is VERDA_INFERENCE_KEY, read from the environment or from its line in the repo-root .env. It is never
printed. Exit code 0 when the model answered with text, else 1.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import httpx

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
KEY_NAME = "VERDA_INFERENCE_KEY"


def key() -> str:
    value = os.environ.get(KEY_NAME)
    if value:
        return value
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(KEY_NAME + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"{KEY_NAME} missing")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("model")
    ap.add_argument("--tries", type=int, default=12)
    ap.add_argument("--gap", type=float, default=10.0)
    a = ap.parse_args()
    body = {
        "model": a.model,
        "messages": [{"role": "user", "content": "Reply with the single word OK."}],
        "max_tokens": 8,
        "temperature": 0,
    }
    last = "no attempt"
    with httpx.Client(timeout=30, headers={"Authorization": f"Bearer {key()}"}) as c:
        for n in range(1, a.tries + 1):
            t0 = time.monotonic()
            try:
                r = c.post(a.url.rstrip("/") + "/v1/chat/completions", json=body)
                if r.status_code == 200:
                    text = (
                        r.json()["choices"][0]["message"].get("content") or ""
                    ).strip()
                    if text:
                        print(
                            f"{a.model} answered in {time.monotonic() - t0:.2f} s (try {n}): {text[:40]}"
                        )
                        return 0
                    last = "empty answer"
                else:
                    last = f"HTTP {r.status_code}"
            except (httpx.HTTPError, KeyError, ValueError) as e:
                last = type(e).__name__
            if n < a.tries:
                time.sleep(a.gap)
    print(
        f"{a.model} did not answer at {a.url} after {a.tries} tries (last: {last})",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
