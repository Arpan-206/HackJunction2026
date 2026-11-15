"""Print the result tables of docs/ROBOT_POLICY.md from the result files, so the write-up copies numbers, never types them.

uv run python report.py
"""

from __future__ import annotations

import json

import common as C


def row(*cells) -> str:
    return "| " + " | ".join(str(c) for c in cells) + " |"


def table(res: dict, title: str) -> None:
    print(f"\n### {title}\n")
    print(
        row(
            "Start and disturbance",
            "Rollouts per system",
            "Policy (deg)",
            "Plain replay (deg)",
            "Replay sent early (deg)",
            "Policy better than plain replay",
            "Policy better than replay sent early",
        )
    )
    print(row(*["---"] * 7))
    for r in res["table"]:
        print(
            row(
                r["condition"],
                r["rollouts_each"],
                r["policy_rms_deg"],
                r["replay_rms_deg"],
                r["replay_lead_rms_deg"],
                f"{100 * r['policy_better_share']:.1f}%",
                f"{100 * r['policy_better_than_lead_share']:.1f}%",
            )
        )


def main() -> int:
    main_res = json.loads((C.OUT / "results.json").read_text())
    tr = main_res["training"]
    print(row("Item", "Value"))
    print(row("---", "---"))
    for k, v in (
        ("GPU", main_res.get("gpu")),
        (
            "Training takes (real, used only as the source of variations)",
            len(tr["training_takes"]),
        ),
        ("Generated variations", tr["generated_references"]),
        ("Held-out real takes", len(main_res["held_out_takes"])),
        ("Policy size (weights)", tr["parameters"]),
        ("Training rollouts", tr["training_rollouts"]),
        ("Length of one training rollout (s)", tr["horizon_steps"] * C.DT),
        ("Updates", tr["iters"]),
        ("Loss", tr.get("loss", "mse")),
        ("Training time (s)", tr["train_seconds"]),
        (
            "Simulated hand time in training (hours)",
            round(tr["simulated_hand_seconds"] / 3600, 1),
        ),
        ("Evaluation rollouts (three systems)", main_res["total_rollouts"]),
        ("Simulated hand time in evaluation (hours)", main_res["simulated_hand_hours"]),
        ("Evaluation time (s)", main_res["eval_seconds"]),
        ("Replay sent early by (ms)", tr["replay_lead"]["ms"]),
    ):
        print(row(k, v))
    table(main_res, "Batched simulator (GPU), held-out real takes")
    for r in main_res["table"]:
        for k in (
            "median_time_to_within_5_deg_s",
            "rms_during_and_0.5s_after_push_deg",
            "median_peak_error_in_push_window_deg",
        ):
            if k in r:
                print(k, r[k])
    mj = C.OUT / "results_mujoco.json"
    if mj.exists():
        m = json.loads(mj.read_text())
        table(m, f"{m['engine']} (CPU), held-out real takes")
        print("total rollouts", m["total_rollouts"], "seconds", m["seconds"])
    print("\n### Per held-out take, batched simulator\n")
    print(
        row(
            "Take",
            "Seconds",
            "Nominal: policy / replay / early",
            "Random start: policy / replay / early",
            "Pushed: policy / replay / early",
        )
    )
    print(row(*["---"] * 5))
    for r in main_res["per_take"]:
        f = lambda c: (
            f"{r[c]['policy_rms_deg']} / {r[c]['replay_rms_deg']} / {r[c]['replay_lead_rms_deg']}"
        )
        print(
            row(
                r["take"],
                r["seconds"],
                f("nominal start"),
                f("random start"),
                f("pushed"),
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
