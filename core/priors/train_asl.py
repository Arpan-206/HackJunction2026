"""Train and evaluate the ASL letter recogniser; write the model, report and provenance.

    python -m core.priors.train_asl [--n 300] [--seed 7]

Evaluation is leave one calibration session out: the model is trained on
the other sessions' wearers (plus an ideal glove) and tested on the left
out session's wearers, for every session. The final model trains on all.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from . import asl
from .provenance import write_manifest

OUT = Path(__file__).resolve().parent / "out"


def evaluate(n: int, seed: int) -> dict:
    wearers = asl.wearer_records()
    sessions: dict[str, list[asl.Wearer]] = {}
    for w in wearers:
        sessions.setdefault(w.created_at[:16], []).append(w)
    per_session = []
    held_scores, held_y = [], []
    total_conf = None
    classes = None
    for i, (key, test_w) in enumerate(sorted(sessions.items())):
        train_w = [w for k, ws in sessions.items() if k != key for w in ws]
        tr = asl.build_dataset(train_w, n, seed + i)
        te = asl.build_dataset(test_w, n // 2, seed + 100 + i, include_ideal=False)
        m = asl.LetterModel.fit(tr)
        held_scores.append(m.log_scores(te.X))
        held_y.append(te.y)
        p = m.proba(te.X)
        top1 = float((p.argmax(1) == te.y).mean())
        top2 = float(np.mean([y in np.argsort(r)[::-1][:2] for r, y in zip(p, te.y)]))
        per_session.append(
            {
                "session": key,
                "records": [w.record_id for w in test_w],
                "top1": round(top1, 3),
                "top2": round(top2, 3),
                "n": len(te.y),
            }
        )
        c = asl.confusion(m, te)
        total_conf = c if total_conf is None else total_conf + c
        classes = m.classes
    S, Y = np.vstack(held_scores), np.concatenate(held_y)
    temp = asl.fit_temperature(S, Y)
    z = S / temp
    z = np.exp(z - z.max(axis=1, keepdims=True))
    reliab = asl.calibration_table(z / z.sum(axis=1, keepdims=True), Y)
    ideal = asl.build_dataset([], n, seed + 999, include_ideal=True)
    m_all = asl.LetterModel.fit(asl.build_dataset(wearers, n, seed))
    ideal_top1 = float((m_all.predict(ideal.X) == ideal.y).mean())
    return {
        "per_session": per_session,
        "mean_top1": round(float(np.mean([s["top1"] for s in per_session])), 3),
        "mean_top2": round(float(np.mean([s["top2"] for s in per_session])), 3),
        "ideal_glove_top1": round(ideal_top1, 3),
        "classes": classes,
        "confusion": total_conf.tolist(),
        "temperature": round(temp, 3),
        "reliability": reliab,
        "wearers": [w.record_id for w in wearers],
    }


def confusion_markdown(classes: list[str], conf: list[list[int]]) -> str:
    head = "| true \\ read | " + " | ".join(c.upper() for c in classes) + " | recall |"
    sep = "| --- " * (len(classes) + 2) + "|"
    rows = [head, sep]
    for c, r in zip(classes, conf):
        tot = sum(r) or 1
        k = classes.index(c)
        rows.append(
            f"| {c.upper()} | "
            + " | ".join(str(v) if v else "." for v in r)
            + f" | {r[k] / tot:.0%} |"
        )
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args(argv)
    ev = evaluate(a.n, a.seed)
    wearers = asl.wearer_records()
    ds = asl.build_dataset(wearers, a.n, a.seed)
    model = asl.LetterModel.fit(ds)
    model.temperature = ev["temperature"]
    groups = asl.letter_groups(asl.letter_curls())
    meta = {
        "component": "asl_letters",
        "inputs": [
            "backend/app/data/moves.json (fs_ moves)",
            "backend/data/calibrations (records listed)",
        ],
        "calibration_records": [w.record_id for w in wearers],
        "seed": a.seed,
        "n_per_letter": a.n,
        "held_out_real_data_used": False,
    }
    model.save(
        extra={
            "metrics": {
                k: ev[k]
                for k in (
                    "mean_top1",
                    "mean_top2",
                    "ideal_glove_top1",
                    "per_session",
                    "reliability",
                )
            },
            "merged_groups": [g for g in groups if len(g) > 1],
            "provenance": "core/priors/data/asl_letters.provenance.json",
        }
    )
    write_manifest("asl_letters", list(ds.source), meta)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "asl_eval.json").write_text(
        json.dumps(ev, indent=1) + "\n", encoding="utf-8"
    )
    (OUT / "asl_confusion.md").write_text(
        confusion_markdown(ev["classes"], ev["confusion"]) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                k: ev[k]
                for k in (
                    "mean_top1",
                    "mean_top2",
                    "ideal_glove_top1",
                    "temperature",
                    "reliability",
                )
            },
            indent=1,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
