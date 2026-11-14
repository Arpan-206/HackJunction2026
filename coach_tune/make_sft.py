"""Kept labels to the training files train_lora.py reads: {"messages": [system, user], "completion": line}.

    python coach_tune/make_sft.py      # writes out/sft/{train,val}.jsonl
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import oai  # noqa: E402
import prompt  # noqa: E402

LANE = Path(__file__).resolve().parent
SRC = LANE / "out" / "labels"
DST = LANE / "out" / "sft"


class BadTrainingRow(SystemExit):
    """A row that must never be trained on: a label not from our self-hosted Gemma, or a real-capture input."""


def check_rows(rows: list[dict]) -> None:
    """Fail the build on any label source other than our self-hosted Gemma 4, or any real-capture frame."""
    for r in rows:
        src = r.get("label_source") or {}
        if not (src.get("self_hosted") is True and str(src.get("model", "")).startswith(oai.TEACHER_PREFIX)):
            raise BadTrainingRow(f"{r.get('id')}: label source {src!r} is not our self-hosted Gemma 4")
        if r.get("source") != "synthetic":
            raise BadTrainingRow(f"{r.get('id')}: input source {r.get('source')!r}; real captures are test data only")


def main() -> int:
    DST.mkdir(parents=True, exist_ok=True)
    for split in ("train", "val"):
        rows = [json.loads(x) for x in (SRC / f"{split}.jsonl").read_text().splitlines() if x.strip()]
        kept = [r for r in rows if r.get("completion")]
        check_rows(kept)
        with (DST / f"{split}.jsonl").open("w") as f:
            for r in kept:
                f.write(json.dumps({"id": r["id"], "messages": prompt.messages(r), "completion": r["completion"]}, ensure_ascii=False) + "\n")
        print(split, len(kept), "of", len(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
