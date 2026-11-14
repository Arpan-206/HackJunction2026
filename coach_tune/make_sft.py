"""Kept labels to the training files train_lora.py reads: {"messages": [system, user], "completion": line}.

    python coach_tune/make_sft.py      # writes out/sft/{train,val}.jsonl
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prompt  # noqa: E402

LANE = Path(__file__).resolve().parent
SRC = LANE / "out" / "labels"
DST = LANE / "out" / "sft"


def main() -> int:
    DST.mkdir(parents=True, exist_ok=True)
    for split in ("train", "val"):
        rows = [json.loads(x) for x in (SRC / f"{split}.jsonl").read_text().splitlines() if x.strip()]
        kept = [r for r in rows if r.get("completion")]
        with (DST / f"{split}.jsonl").open("w") as f:
            for r in kept:
                f.write(json.dumps({"id": r["id"], "messages": prompt.messages(r), "completion": r["completion"]}, ensure_ascii=False) + "\n")
        print(split, len(kept), "of", len(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
