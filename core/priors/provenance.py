"""Provenance of every training example in the priors lane, and the check on it.

Each training run writes a manifest: ``core/priors/data/<name>.provenance.json``
with one entry per distinct source and the number of examples drawn from it,
plus a per-example source array in the run's npz where one is kept.

Allowed source kinds:

- ``open_dataset:<name>``: a dataset in OPEN_DATASETS, with its licence;
- ``generator:<module>...``: our own code generating examples;
- ``self_hosted_gemma:<endpoint>``: our Gemma on Verda, called directly.

Anything else fails the check, and so does any source that names Gemini,
the Decisions API, or the held-out real captures (logs/live).
"""

from __future__ import annotations

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"

OPEN_DATASETS = {
    "furelise": {
        "licence": "CC BY-NC 4.0",
        "url": "https://huggingface.co/datasets/rcwang/for_elise",
        "credit": "Wang, Xu, Shi, Schumann, Liu. FurElise: Capturing and Physically Synthesizing Hand Motions of Piano Performance. SIGGRAPH Asia 2024.",
    },
}
ALLOWED_KINDS = ("open_dataset", "generator", "self_hosted_gemma")
FORBIDDEN_WORDS = ("gemini", "decisions", "logs/live", "solver_12277", ".rgmp")


def check_source(tag: str) -> str | None:
    """None if the tag is allowed, else the reason it is not."""
    low = tag.lower()
    for w in FORBIDDEN_WORDS:
        if w in low:
            return f"forbidden source word {w!r} in {tag!r}"
    kind, _, rest = tag.partition(":")
    if kind not in ALLOWED_KINDS:
        return f"source kind {kind!r} not allowed in {tag!r}"
    if kind == "open_dataset":
        name = rest.split(":", 1)[0]
        if name not in OPEN_DATASETS:
            return f"dataset {name!r} is not in OPEN_DATASETS"
    if kind == "generator" and not rest.startswith("core.priors."):
        return f"generator {rest!r} is not our own code under core.priors"
    if kind == "self_hosted_gemma" and "verda" not in low:
        return f"Gemma endpoint {rest!r} is not on Verda"
    return None


def write_manifest(name: str, sources: list[str], meta: dict) -> Path:
    counts: dict[str, int] = {}
    for s in sources:
        counts[s] = counts.get(s, 0) + 1
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / f"{name}.provenance.json"
    path.write_text(
        json.dumps(
            {"name": name, "n_examples": len(sources), "sources": counts, **meta},
            indent=1,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return path


def check_manifests(data_dir: Path = DATA_DIR) -> list[str]:
    """Every problem in every manifest; empty when all sources are allowed."""
    problems = []
    for p in sorted(data_dir.glob("*.provenance.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        total = 0
        for tag, n in d["sources"].items():
            total += int(n)
            why = check_source(tag)
            if why:
                problems.append(f"{p.name}: {why}")
        if total != d["n_examples"]:
            problems.append(f"{p.name}: counts {total} != n_examples {d['n_examples']}")
    return problems
