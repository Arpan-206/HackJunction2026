"""Build the coach-tune dataset: target poses from every lesson, learner attempts from the real capture and from
synthetic perturbations, each scored by the core's own scorer.

    /Users/arpanpandey/Code/Junction/repo/.venv/bin/python coach_tune/build_dataset.py [--total 4200] [--seed 0]

Run from the worktree root. Writes coach_tune/out/dataset/{train,val,test}.jsonl and report.md (git-ignored).

Lessons: every lesson in the main checkout's lessons/ (read only), plus the shadow puppets and fingerspelling
poses from tools/make_pose_lessons.py, written to coach_tune/out/pose_lessons/ (never into lessons/).

Split unit: a lesson, except for the pose lessons, where each shape is its own unit (a puppet, a letter). The
spelled words (JUNCTION, GEPPETTO) reuse the letter shapes, so their steps join the unit of that letter: a held-out
letter is never seen in training under any lesson.

Learner attempts:
- capture: frames of the real capture (5 Hz cache from tools/capture_inventory.py, calibrated with the wearer's
  saved records as the live core does) of the lesson's hand, scored against the step target.
- synthetic: the step target with one finger pushed in one of the four hint directions by 15 to 70 deg (spread
  hints also get a zero-mean flexion wobble on that finger, since a spread slot counts half), small noise elsewhere.
  Kept only when the scorer's worst finger and hint equal the intended ones.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

LANE = Path(__file__).resolve().parent
ROOT = LANE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(LANE))

import prompt as P

from core import hand as H
from core.config import load_config
from core.recorder import Lesson
from core.scorer import Tolerances, focus_fingers, hint_for, score_frame

MAIN = Path("/Users/arpanpandey/Code/Junction/repo")
LESSONS_DIR = MAIN / "lessons"
CAPTURE = MAIN / "logs/live/20261114-131952/solver_12277.rgmp"
CAL_DIR = MAIN / "backend/data"
WEARER = "arpan"
OUT = LANE / "out"
POSE_DIR = OUT / "pose_lessons"
CACHE = OUT / "capture" / "inv5.npz"
DATASET = OUT / "dataset"
CAPTURE_TEST_MAX = 600  # real capture frames: test split only, at most this many
MOVE_TARGETS = 4  # target poses sampled along a move step
LANG_SPLIT = (("en", 0.70), ("de", 0.15), ("fi", 0.15))


# -- config and scoring -----------------------------------------------------------------------------------------------


class Scoring:
    def __init__(self, cfg) -> None:
        s = cfg.score
        self.tol = Tolerances(float(s.perfect_deg), float(s.wrong_deg))
        self.spread_weight = float(s.spread_weight)
        self.focus_min = float(s.focus_min_weight)
        self.pass_score = float(s.pass_score)

    def score(
        self,
        hand: str,
        learner: np.ndarray,
        target: np.ndarray,
        weights: dict[str, float],
        slot_weights: np.ndarray | None = None,
    ) -> dict | None:
        """The scorer's verdict as an example body, or None when there is nothing to fix."""
        fs, flex, spread = score_frame(
            hand,
            learner,
            target,
            weights,
            self.tol,
            self.spread_weight,
            slot_weights,
            self.focus_min,
        )
        # Something to fix: the worst finger scores below the pass score, the rule the scorer's own step summary
        # uses to list a finger (StepScorer.summary). The overall score can still pass when one of five fingers fails.
        if (
            fs.worst is None
            or fs.hint is None
            or fs.fingers[fs.worst] >= self.pass_score
        ):
            return None
        focus = focus_fingers(weights, self.focus_min)
        errors = [
            {
                "finger": fs.worst,
                "hint": fs.hint,
                "err_deg": round(float(fs.err_deg[fs.worst]), 1),
            }
        ]
        others = sorted(
            (f for f in focus if f != fs.worst and fs.fingers[f] < self.pass_score),
            key=lambda f: -fs.err_deg[f],
        )
        for f in others:
            h = hint_for(flex[f], spread[f])
            if h is not None:
                errors.append(
                    {"finger": f, "hint": h, "err_deg": round(float(fs.err_deg[f]), 1)}
                )
        return {
            "score": round(float(fs.overall) * 100, 1),
            "errors": errors[:3],
            "top_finger": fs.worst,
            "top_hint": fs.hint,
        }


def perturb(
    target: np.ndarray,
    finger: str,
    hint: str,
    mag: float,
    rng: np.random.Generator,
    noise_deg: float = 3.0,
) -> np.ndarray:
    """The target with `finger` pushed `mag` degrees in the hint's direction (learner minus master signs as in
    core/scorer.py hint_for), plus small noise on every slot."""
    a = np.asarray(target, dtype=float) + rng.normal(0.0, noise_deg, H.N_ANGLES)
    fs, ss = H.FLEXION_SLOTS[finger], H.FINGER_SPREAD_SLOTS[finger]
    if hint in ("too_flat", "too_curled"):
        sign = -1.0 if hint == "too_flat" else 1.0
        a[fs] += sign * mag * rng.uniform(0.8, 1.2, len(fs))
    else:
        sign = 1.0 if hint == "too_spread" else -1.0
        a[ss] += sign * mag
        # A spread slot counts half and is shared with a neighbour, so spread alone rarely fails a finger. A
        # zero-mean wobble on the finger's own joints raises its error while the mean flexion (the hint) stays small.
        wob = (
            np.array([1.0, -1.0, 0.0][: len(fs)])
            if len(fs) == 3
            else np.array([1.0, -1.0])
        )
        a[fs] += wob * mag * rng.uniform(0.5, 0.8)
    return a


# -- lessons and units ------------------------------------------------------------------------------------------------

LETTER_RE = re.compile(r"(?:the letter\s+)?([A-Z])$", re.IGNORECASE)


def unit_of(lesson: Lesson, step) -> str:
    if not lesson.id.startswith("pose-"):
        return lesson.id
    m = LETTER_RE.search(step.name.strip())
    if m and ("spell" in lesson.id or "fingerspelling" in lesson.id):
        return f"letter-{m.group(1).upper()}"
    return "puppet-" + re.sub(
        r"[^a-z]+", "-", step.name.lower().replace("the ", "")
    ).strip("-")


def unit_kind(unit: str) -> str:
    if unit.startswith("letter-"):
        return "letter"
    if unit.startswith("puppet-"):
        return "puppet"
    if unit.startswith("fake-"):
        return "fake"
    return "real"


def step_targets(lesson: Lesson, step) -> list[np.ndarray]:
    if step.kind == "hold" or lesson.trace is None:
        return [np.asarray(step.key_angles, dtype=float)]
    ts = np.linspace(step.t0_us, step.t1_us, MOVE_TARGETS + 2)[1:-1]
    return [np.asarray(lesson.angles_at(int(t)), dtype=float) for t in ts]


def load_lessons(cfg) -> list[Lesson]:
    from tools import make_pose_lessons as M

    POSE_DIR.mkdir(parents=True, exist_ok=True)
    M.build_all(cfg, POSE_DIR)
    out = []
    for d in sorted(LESSONS_DIR.iterdir()) + sorted(POSE_DIR.iterdir()):
        if (d / "lesson.json").exists():
            out.append(Lesson.load(d))
    return out


def collect_targets(lessons: list[Lesson]) -> dict[str, list[dict]]:
    """unit -> list of target records (lesson, step, target angles, weights, hand)."""
    units: dict[str, list[dict]] = defaultdict(list)
    for lesson in lessons:
        hand = lesson.master_hand or "right"
        for step in lesson.steps:
            w = (
                {f: float(step.weights.get(f, 1.0)) for f in H.FINGERS}
                if step.weights
                else {f: 1.0 for f in H.FINGERS}
            )
            for t in step_targets(lesson, step):
                units[unit_of(lesson, step)].append(
                    {
                        "lesson": lesson.id,
                        "task": lesson.title,
                        "step_name": step.name,
                        "step_index": step.index,
                        "kind": step.kind,
                        "hand": hand,
                        "target": t,
                        "weights": w,
                    }
                )
    return units


# -- split ------------------------------------------------------------------------------------------------------------

HOLDOUT = {
    "real": (2, 1),
    "fake": (1, 0),
    "puppet": (1, 0),
    "letter": (5, 2),
}  # kind: (test, val)


def split_units(units: list[str], seed: int) -> dict[str, str]:
    rng = np.random.default_rng(seed)
    by_kind: dict[str, list[str]] = defaultdict(list)
    for u in sorted(units):
        by_kind[unit_kind(u)].append(u)
    split = {}
    for kind, us in sorted(by_kind.items()):
        order = list(us)
        rng.shuffle(order)
        n_test, n_val = HOLDOUT.get(kind, (0, 0))
        if kind == "real":  # at least one replay lesson in test
            replay = [u for u in order if u.startswith("replay-")]
            order = [replay[0]] + [u for u in order if u != replay[0]]
        for i, u in enumerate(order):
            split[u] = (
                "test" if i < n_test else ("val" if i < n_test + n_val else "train")
            )
    return split


# -- capture ----------------------------------------------------------------------------------------------------------


def capture_frames(cfg) -> dict[str, tuple[np.ndarray, np.ndarray | None]]:
    """side -> (calibrated tracked frames (n, 18), slot weights or None)."""
    from core.calibration import load_hand
    from tools import capture_inventory as inv

    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        w = inv.walk(CAPTURE, rate_hz=5.0, cfg=cfg)
        inv.save_cache(CACHE, w)
    w = inv.load_cache(CACHE)
    out = {}
    for side in ("left", "right"):
        if side not in w:
            continue
        d = w[side]
        ang = np.asarray(d["angles"], dtype=float)[np.asarray(d["tracked"], dtype=bool)]
        cal = load_hand(CAL_DIR, side, WEARER, cfg.calibration, cfg.hand)
        if cal is not None:
            ang = np.stack([cal.apply(a) for a in ang])
        out[side] = (
            ang,
            None if cal is None else cal.slot_weights(),
            None if cal is None else cal.finger_weights(),
        )
    return out


# -- build ------------------------------------------------------------------------------------------------------------


def build(total: int, seed: int) -> list[dict]:
    cfg = load_config(None)
    sc = Scoring(cfg)
    rng = np.random.default_rng(seed)
    lessons = load_lessons(cfg)
    units = collect_targets(lessons)
    split = split_units(list(units), seed)
    cells = [(f, h) for f in H.FINGERS for h in P.HINTS]
    per_cell = total // len(cells)
    examples: list[dict] = []
    cell_count: Counter = Counter()

    def add(rec: dict, body: dict, source: str, unit: str) -> None:
        ex = {
            k: rec[k]
            for k in ("lesson", "task", "step_name", "step_index", "kind", "hand")
        }
        ex.update(body)
        ex.update({"source": source, "unit": unit, "split": split[unit]})
        examples.append(ex)
        cell_count[(body["top_finger"], body["top_hint"])] += 1

    # 1. real capture frames are TEST DATA ONLY (Arpan, 19:05): scored only against held-out test units, capped per
    #    cell. They never enter train or val; build() fails if one does.
    frames = capture_frames(cfg)
    cap_budget = CAPTURE_TEST_MAX
    cap_cell = max(1, cap_budget // len(cells) * 2)
    cap_count: Counter = Counter()
    pool = []
    for unit, recs in units.items():
        if split[unit] != "test":
            continue
        for rec in recs:
            if rec["hand"] not in frames:
                continue
            ang, sw, fw = frames[rec["hand"]]
            idx = rng.choice(len(ang), size=min(60, len(ang)), replace=False)
            weights = {f: rec["weights"][f] * (fw[f] if fw else 1.0) for f in H.FINGERS}
            for i in idx:
                body = sc.score(rec["hand"], ang[i], rec["target"], weights, sw)
                if body is not None:
                    pool.append((unit, rec, body))
    order = rng.permutation(len(pool))
    n_cap = 0
    per_unit_cap: Counter = Counter()
    n_test_units = sum(1 for u in units if split[u] == "test")
    unit_cap_limit = max(10, cap_budget // max(1, n_test_units) * 2)
    for j in order:
        unit, rec, body = pool[j]
        cell = (body["top_finger"], body["top_hint"])
        if n_cap >= cap_budget:
            break
        if cap_count[cell] >= cap_cell or per_unit_cap[unit] >= unit_cap_limit:
            continue
        add(rec, body, "capture", unit)
        cell_count[cell] -= (
            1  # capture rows do not count toward the synthetic per-cell quota
        )
        cap_count[cell] += 1
        per_unit_cap[unit] += 1
        n_cap += 1

    # 2. synthetic fill: every finger x hint cell up to per_cell, spread over units round robin
    unit_list = sorted(units)
    for f, h in cells:
        need = per_cell - cell_count[(f, h)]
        tries = 0
        k = int(rng.integers(len(unit_list)))
        while need > 0 and tries < need * 200:
            tries += 1
            unit = unit_list[k % len(unit_list)]
            k += 1
            rec = units[unit][int(rng.integers(len(units[unit])))]
            if rec["weights"].get(f, 1.0) < sc.focus_min:
                continue
            learner = perturb(rec["target"], f, h, float(rng.uniform(15, 70)), rng)
            body = sc.score(rec["hand"], learner, rec["target"], rec["weights"])
            if body is None or body["top_finger"] != f or body["top_hint"] != h:
                continue
            add(rec, body, "synthetic", unit)
            need -= 1

    leaked = [e for e in examples if e["source"] == "capture" and e["split"] != "test"]
    if leaked:
        raise SystemExit(
            f"{len(leaked)} real-capture examples outside the test split; captures are test data only"
        )

    # 3. ids, languages, prompt check
    examples.sort(
        key=lambda e: (e["split"], e["unit"], e["source"], e["step_index"], e["score"])
    )
    lang_rng = np.random.default_rng(seed)
    langs, probs = zip(*LANG_SPLIT)
    for i, ex in enumerate(examples):
        ex["id"] = f"ct-{i:05d}"
        ex["lang"] = str(lang_rng.choice(langs, p=probs))
        P.user_prompt(ex)
    return examples, split, units


def table(rows: list[list], head: list[str]) -> str:
    lines = [
        "| " + " | ".join(head) + " |",
        "| " + " | ".join("---" for _ in head) + " |",
    ]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def coverage(exs: list[dict]) -> str:
    c = Counter((e["top_finger"], e["top_hint"]) for e in exs)
    rows = [
        [f] + [c[(f, h)] for h in P.HINTS] + [sum(c[(f, h)] for h in P.HINTS)]
        for f in H.FINGERS
    ]
    return table(rows, ["finger"] + list(P.HINTS) + ["total"])


def report(examples: list[dict], split: dict[str, str], seed: int) -> str:
    by = defaultdict(list)
    for e in examples:
        by[e["split"]].append(e)
    out = [
        "# Coach-tune dataset",
        "",
        f"Seed {seed}. Built by `coach_tune/build_dataset.py`. Scorer: core/scorer.py "
        "score_frame, tolerances from config.toml [score].",
        "",
        "## Counts",
        "",
    ]
    rows = []
    for s in ("train", "val", "test"):
        exs = by[s]
        src = Counter(e["source"] for e in exs)
        rows.append(
            [
                s,
                len(exs),
                src["capture"],
                src["synthetic"],
                len({e["unit"] for e in exs}),
            ]
        )
    rows.append(
        [
            "all",
            len(examples),
            sum(r[2] for r in rows),
            sum(r[3] for r in rows),
            len(split),
        ]
    )
    out += [table(rows, ["split", "examples", "capture", "synthetic", "units"]), ""]
    out += [
        "## Held-out units",
        "",
        "A unit is a lesson; for the pose lessons it is one shape (a puppet or a letter, "
        "including that letter inside the spelled words).",
        "",
    ]
    for s in ("test", "val"):
        out.append(
            f"- {s}: " + ", ".join(sorted(u for u, v in split.items() if v == s))
        )
    out += [
        "",
        "## Coverage, finger x hint (the top error)",
        "",
        "### All",
        "",
        coverage(examples),
        "",
    ]
    for s in ("train", "val", "test"):
        out += [f"### {s}", "", coverage(by[s]), ""]
    lang = Counter(e["lang"] for e in examples)
    out += [
        "## Languages",
        "",
        table(
            [
                [k, v, f"{100 * v / len(examples):.1f}%"]
                for k, v in sorted(lang.items())
            ],
            ["lang", "examples", "share"],
        ),
        "",
    ]
    kinds = Counter(e["kind"] for e in examples)
    out += [
        "## Step kinds",
        "",
        table([[k, v] for k, v in sorted(kinds.items())], ["kind", "examples"]),
        "",
    ]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--total", type=int, default=4200)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args(argv)
    examples, split, _ = build(a.total, a.seed)
    DATASET.mkdir(parents=True, exist_ok=True)
    for s in ("train", "val", "test"):
        with (DATASET / f"{s}.jsonl").open("w", encoding="utf-8") as f:
            for e in examples:
                if e["split"] == s:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")
    rep = report(examples, split, a.seed)
    (DATASET / "report.md").write_text(rep + "\n", encoding="utf-8")
    print(rep)
    return 0


if __name__ == "__main__":
    sys.exit(main())
