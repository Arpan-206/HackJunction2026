"""Step 1: read the expert's real glove takes and export what the policy work needs, with no core import later.

Run from the repo root with the core's Python (it has the core package and numpy only):

    .venv/bin/python robot_policy/prepare.py

Reads (never writes) the archived expert takes in logs/archive-fresh-2318/core_lessons/takes (core lesson folders,
SPEC.md "Lesson files") and the Dex3-1 retarget of core/robot.py (config.toml [robot]). Writes:

    robot_policy/out/data/takes.npz      per take: time (s), the 18 angle features (deg), step index
    robot_policy/out/data/retarget.json  the retarget as a matrix: q = clip(sign * rad(offset + W @ angles), lower, upper)
    robot_policy/out/data/takes.json     title, duration, steps and take-to-take distances

The matrix is checked against core.robot.Retargeter on every real frame, so the standalone code moves the simulated
hand exactly as the live core would move the real one.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from core import hand as H
from core.config import load_config
from core.robot import Retargeter

TAKES = ROOT / "logs" / "archive-fresh-2318" / "core_lessons" / "takes"
OUT = Path(__file__).resolve().parent / "out" / "data"
SIDE = "right"
# The real gloves ran in two live sessions on 14 Nov 2026 (run folders logs/live/20261114-131952, from 13:19, and
# logs/live/20261114-222113, from 22:21, Helsinki time; their solver logs name the glove devices). Takes made before
# the first session are left out: two exist from 08:22, and we cannot show that a real glove made them.
FIRST_GLOVE_SESSION_UTC = "2026-11-14T11:19:00"


def retarget_matrix(rt: Retargeter, side: str) -> dict:
    names = rt.joint_names(side)
    model = rt.models[side]
    W = np.zeros((len(names), len(H.ANGLE_NAMES)))
    offset, sign, lower, upper = [], [], [], []
    for i, e in enumerate(rt.entries):
        j = model.joints[names[i]]
        for a, w in e.weights.items():
            W[i, H.ANGLE_NAMES.index(a)] = w
        s = e.sign_left if side == "left" else e.sign_right
        sign.append(rt._auto_sign(j) if s is None else float(s))
        offset.append(e.offset_deg)
        lower.append(j.lower)
        upper.append(j.upper)
    return {
        "side": side,
        "joints": names,
        "angle_names": list(H.ANGLE_NAMES),
        "W": W.tolist(),
        "offset_deg": offset,
        "sign": sign,
        "lower": lower,
        "upper": upper,
        "fingers": [e.finger for e in rt.entries],
    }


def apply(m: dict, angles: np.ndarray) -> np.ndarray:
    raw = np.asarray(m["sign"]) * np.radians(
        np.asarray(m["offset_deg"]) + angles @ np.asarray(m["W"]).T
    )
    return np.clip(raw, m["lower"], m["upper"])


def main() -> int:
    cfg = load_config()
    rt = Retargeter(cfg.robot, ROOT)
    m = retarget_matrix(rt, SIDE)
    OUT.mkdir(parents=True, exist_ok=True)
    arrays, meta, worst, skipped = {}, [], 0.0, []
    for d in sorted(TAKES.iterdir()):
        if not (d / "trace.npz").is_file():
            continue
        L = json.loads((d / "lesson.json").read_text())
        if (L.get("master") or {}).get("hand") != SIDE or L.get("source") != "glove":
            continue
        created = (
            datetime.fromisoformat(L["created"])
            .astimezone(UTC)
            .replace(tzinfo=None)
            .isoformat()
        )
        if created < FIRST_GLOVE_SESSION_UTC:
            skipped.append(d.name)
            continue
        z = np.load(d / "trace.npz")
        a = z["angles"].astype(np.float64)
        t = (z["t_us"] - z["t_us"][0]) / 1e6
        q = apply(m, a)
        ref = np.array([[rt.targets(row, SIDE).q[n] for n in m["joints"]] for row in a])
        worst = max(worst, float(np.abs(q - ref).max()))
        arrays[f"{d.name}/t"], arrays[f"{d.name}/angles"], arrays[f"{d.name}/step"] = (
            t,
            a.astype(np.float32),
            z["step"],
        )
        meta.append(
            {
                "id": d.name,
                "title": L.get("title"),
                "created": L.get("created"),
                "rate_hz": L.get("rate_hz"),
                "duration_s": round(float(t[-1]), 2),
                "frames": len(t),
                "steps": [
                    {
                        "name": s.get("name"),
                        "kind": s.get("kind"),
                        "t0_s": s.get("t0_us", 0) / 1e6,
                        "t1_s": s.get("t1_us", 0) / 1e6,
                    }
                    for s in L["steps"]
                ],
                "joint_range_deg": np.degrees(q.max(0) - q.min(0)).round(1).tolist(),
                "clipped_share": round(
                    float(
                        np.mean(
                            (q <= np.asarray(m["lower"]) + 1e-9)
                            | (q >= np.asarray(m["upper"]) - 1e-9)
                        )
                    ),
                    3,
                ),
            }
        )
    if worst > 1e-9:
        raise SystemExit(
            f"the matrix retarget differs from core.robot.Retargeter by {worst} rad"
        )
    np.savez_compressed(OUT / "takes.npz", **arrays)
    (OUT / "retarget.json").write_text(json.dumps(m, indent=1) + "\n")
    (OUT / "takes.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(
        f"{len(meta)} real {SIDE}-hand glove takes, {sum(x['frames'] for x in meta)} frames, "
        f"{sum(x['duration_s'] for x in meta):.0f} s; matrix retarget equals core.robot (max diff {worst:.1e} rad); "
        f"left out, made before the first glove session: {skipped}"
    )
    for x in meta:
        print(
            x["id"],
            x["created"][11:19] if x.get("created") else "",
            x["duration_s"],
            [s["kind"] for s in x["steps"]],
            x["joint_range_deg"],
            x["clipped_share"],
            (x["title"] or "")[:36],
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
