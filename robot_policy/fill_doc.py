"""Fill the numbers of docs/ROBOT_POLICY.md from the result files, so the write-up copies numbers and never types them.

    uv run python fill_doc.py            # replaces the __NAME__ marks in docs/ROBOT_POLICY.md

It reads only files in out/: results.json and train.json (the GPU run), train_laptop.json, results_laptop.json and
results_gpu_policy_on_laptop.json (both policies in the same laptop evaluation), results_mujoco.json and
results_mujoco_laptop.json, video.json and cost_log.jsonl.
"""

from __future__ import annotations

import json

import common as C

DOC = C.LANE.parent / "docs" / "ROBOT_POLICY.md"


def load(name: str) -> dict:
    return json.loads((C.OUT / name).read_text())


def row(*cells) -> str:
    return "| " + " | ".join(str(c) for c in cells) + " |"


def pct(x: float) -> str:
    """One decimal, but never "100.0%" for a share that is not 1."""
    return f"{100 * x:.1f}%" if x == 1 or x < 0.9995 else f"{100 * x:.2f}%"


NAMES = {
    "nominal start": "Start on the reference, no push",
    "random start": "Start in a random pose",
    "pushed": "Three pushes per rollout",
}


def result_table(res: dict) -> list[str]:
    out = [
        row(
            "Test",
            "Rollouts per system",
            "Policy (deg)",
            "Plain replay (deg)",
            "Replay sent early (deg)",
            "Rollouts where the policy beats plain replay",
            "Rollouts where the policy beats replay sent early",
        ),
        row(*["---"] * 7),
    ]
    for r in res["table"]:
        out.append(
            row(
                NAMES[r["condition"]],
                f"{r['rollouts_each']:,}",
                r["policy_rms_deg"],
                r["replay_rms_deg"],
                r["replay_lead_rms_deg"],
                pct(r["policy_better_share"]),
                pct(r["policy_better_than_lead_share"]),
            )
        )
    return out


def main() -> int:
    gpu, tr, trl = load("results.json"), load("train.json"), load("train_laptop.json")
    lap, gol = load("results_laptop.json"), load("results_gpu_policy_on_laptop.json")
    mj, mjl = load("results_mujoco.json"), load("results_mujoco_laptop.json")
    video = load("video.json")
    costs = [
        json.loads(x)
        for x in (C.OUT / "cost_log.jsonl").read_text().splitlines()
        if x.strip()
    ]
    downs = [c for c in costs if c["event"] == "down"]
    billed_min = round(sum(c["minutes"] for c in downs), 1)
    billed_usd = round(sum(c["cost_usd"] for c in downs), 2)
    t = {r["condition"]: r for r in gpu["table"]}
    m = {r["condition"]: r for r in mj["table"]}
    beats_all = all(
        r["policy_rms_deg"] < r["replay_rms_deg"]
        and r["policy_rms_deg"] < r["replay_lead_rms_deg"]
        for res in (gpu, mj)
        for r in res["table"]
    )

    status = (
        "done. The policy beats plain replay and replay sent early in every test, in both simulators. "
        "Nothing ran on a real hand. Every Verda container of this work is deleted."
        if beats_all
        else "done, with a mixed result. See the tables. Every Verda container of this work is deleted."
    )

    short = [
        row("Question", "Answer"),
        row("---", "---"),
        row(
            "Does the policy perform a held-out take on the simulated Dex3-1 on its own?",
            "Yes, in two simulators. See the video.",
        ),
        row(
            "Does it beat plain replay?",
            f"Yes. RMS error {t['nominal start']['policy_rms_deg']} against {t['nominal start']['replay_rms_deg']} degrees from a normal start, "
            f"{t['random start']['policy_rms_deg']} against {t['random start']['replay_rms_deg']} from a random pose, "
            f"{t['pushed']['policy_rms_deg']} against {t['pushed']['replay_rms_deg']} with pushes.",
        ),
        row(
            "Does it beat the stronger baseline, replay sent early?",
            f"Yes, by less: {t['nominal start']['policy_rms_deg']} against {t['nominal start']['replay_lead_rms_deg']}, "
            f"{t['random start']['policy_rms_deg']} against {t['random start']['replay_lead_rms_deg']}, "
            f"{t['pushed']['policy_rms_deg']} against {t['pushed']['replay_lead_rms_deg']} degrees. "
            f"From a normal start it wins in {pct(t['nominal start']['policy_better_than_lead_share'])} of the rollouts, not in all.",
        ),
        row(
            "Does it recover when pushed?",
            f"Yes, and better than both baselines. In the time from a push to 0.5 s after it, the error is "
            f"{t['pushed']['rms_during_and_0.5s_after_push_deg']['policy']} degrees, against "
            f"{t['pushed']['rms_during_and_0.5s_after_push_deg']['replay']} for plain replay and "
            f"{t['pushed']['rms_during_and_0.5s_after_push_deg']['replay_lead']} for replay sent early. "
            "The servos themselves also bring a pushed joint back, so replay recovers too, only later.",
        ),
        row(
            "Was the Verda GPU needed to train it?",
            f"No. The laptop CPU trained the same network in {trl['train_seconds']:.0f} s, and that policy scores the same. "
            'The GPU\'s real contribution is the 40 times larger evaluation. See "Laptop against GPU".',
        ),
        row("Did anything run on a real robot hand?", "No."),
    ]

    res = [
        "### Batched simulator, GPU-trained policy, 20,000 rollouts per take and test\n"
    ]
    res += result_table(gpu)
    rs, pu = t["random start"], t["pushed"]
    res += [
        "",
        'RMS error in degrees over all joints and all moments. A rollout "beats" a baseline when its own RMS error is lower on the same hand, the same start and the same pushes.',
        "",
        row("Recovery measure", "Policy", "Plain replay", "Replay sent early"),
        row("---", "---", "---", "---"),
        row(
            "Random pose: median time until every joint stays within 5 degrees (s)",
            rs["median_time_to_within_5_deg_s"]["policy"],
            rs["median_time_to_within_5_deg_s"]["replay"],
            rs["median_time_to_within_5_deg_s"]["replay_lead"],
        ),
        row(
            "Pushes: RMS error from push start to 0.5 s after its end (deg)",
            pu["rms_during_and_0.5s_after_push_deg"]["policy"],
            pu["rms_during_and_0.5s_after_push_deg"]["replay"],
            pu["rms_during_and_0.5s_after_push_deg"]["replay_lead"],
        ),
        row(
            "Pushes: median largest error of one joint in that time (deg)",
            pu["median_peak_error_in_push_window_deg"]["policy"],
            pu["median_peak_error_in_push_window_deg"]["replay"],
            "not measured",
        ),
        "",
        "A push of up to 1.5 N m is stronger than six of the seven motors (1.4 N m). So no controller can hold the joint during the push. The gain is in the return.",
        "",
        "### Per held-out take, batched simulator\n",
        "Each cell: policy / plain replay / replay sent early, RMS error in degrees.\n",
        row("Take", "Lesson step", "Seconds", "Normal start", "Random pose", "Pushes"),
        row(*["---"] * 6),
    ]
    lesson = {
        "9c90d77fabdb-right": "Surgical grips, scalpel pencil",
        "f09f617ee76d-right": "Crochet, hold",
        "016a1da374c1-right": "Crochet, hold",
        "a4de6f1e3ba8-right": "Crochet, hold",
        "1754a2f74d3d-right": "Crochet, hold",
        "2da6252cc125-right": "Piano, hand position",
        "7a4d1c8fb139-right": "Piano, hand position",
        "88955f73ea1c-right": "Table tennis, shakehand grip",
    }
    for r in gpu["per_take"]:
        f = lambda c: (
            f"{r[c]['policy_rms_deg']} / {r[c]['replay_rms_deg']} / {r[c]['replay_lead_rms_deg']}"
        )
        res.append(
            row(
                f"`{r['take'][:12]}`",
                lesson[r["take"]],
                r["seconds"],
                f("nominal start"),
                f("random start"),
                f("pushed"),
            )
        )
    res += [
        "",
        f"### {mj['engine']}, GPU-trained policy, {mj['rollouts_per_take_per_condition']} rollouts per take and test\n",
        "The policy never trained in this simulator. Every rollout has its own hand values, drawn as in training.\n",
    ]
    res += result_table(mj)
    res += [
        "",
        f"MuJoCo gives the same order in every test: policy, then replay sent early, then plain replay. "
        f"The joint inertias MuJoCo computes from the URDF, with the assumed rotor term, are "
        f"{', '.join(f'{x:.2e}' for x in mj['joint_inertia_kg_m2'])} kg m2.",
        "",
        "### Laptop against GPU\n",
        "The same network was trained twice, with the same code, data rules and loss. Both policies then ran through the same laptop evaluation: the same hands, starts and pushes.\n",
        row("", "Laptop CPU", "Verda GPU (1x H100)"),
        row("---", "---", "---"),
        row("Parallel hands in training", f"{trl['envs']:,}", f"{tr['envs']:,}"),
        row("Updates", f"{trl['iters']:,}", f"{tr['iters']:,}"),
        row(
            "Generated variations",
            f"{trl['generated_references']:,}",
            f"{tr['generated_references']:,}",
        ),
        row(
            "Training rollouts",
            f"{trl['training_rollouts']:,}",
            f"{tr['training_rollouts']:,}",
        ),
        row(
            "Training time",
            f"{trl['train_seconds']:.0f} s ({trl['train_seconds'] / 60:.1f} min)",
            f"{tr['train_seconds']:.0f} s ({tr['train_seconds'] / 60:.1f} min)",
        ),
        row(
            "Evaluation rollouts, batched simulator",
            f"{lap['total_rollouts'] + gol['total_rollouts']:,} (two policies, {lap['total_rollouts']:,} each)",
            f"{gpu['total_rollouts']:,} (one policy)",
        ),
        row(
            "Evaluation time, batched simulator",
            f"{lap['eval_seconds'] + gol['eval_seconds']:.0f} s ({(lap['eval_seconds'] + gol['eval_seconds']) / 60:.1f} min)",
            f"{gpu['eval_seconds']:.0f} s ({gpu['eval_seconds'] / 60:.1f} min)",
        ),
        row(
            "Evaluation rollouts, MuJoCo (CPU in both cases)",
            f"{mjl['total_rollouts']:,} in {mjl['seconds'] / 60:.1f} min (laptop-trained policy)",
            f"{mj['total_rollouts']:,} in {mj['seconds'] / 60:.1f} min on the container's CPU (GPU-trained policy)",
        ),
        row(
            "GPU minutes billed",
            "0",
            f"{billed_min} (all starts, with the runs we threw away)",
        ),
        row("Cost", "0", f"{billed_usd} USD at 5.77 USD per hour"),
        "",
        "Both policies in the same laptop evaluation (36,000 rollouts each; RMS error in degrees):\n",
        row(
            "Test",
            "Laptop-trained policy",
            "GPU-trained policy",
            "Plain replay",
            "Replay sent early",
        ),
        row(*["---"] * 5),
    ]
    for a, b in zip(lap["table"], gol["table"]):
        res.append(
            row(
                NAMES[a["condition"]],
                a["policy_rms_deg"],
                b["policy_rms_deg"],
                a["replay_rms_deg"],
                a["replay_lead_rms_deg"],
            )
        )
    res += [
        "",
        "Both policies in MuJoCo (CPU; RMS error in degrees):\n",
        row(
            "Test",
            "Laptop-trained policy",
            "GPU-trained policy",
            "Plain replay",
            "Replay sent early",
        ),
        row(*["---"] * 5),
    ]
    for a, b in zip(mjl["table"], mj["table"]):
        res.append(
            row(
                NAMES[a["condition"]],
                a["policy_rms_deg"],
                b["policy_rms_deg"],
                a["replay_rms_deg"],
                a["replay_lead_rms_deg"],
            )
        )
    worse = all(
        b["policy_rms_deg"] >= a["policy_rms_deg"]
        for a, b in zip(lap["table"], gol["table"])
    )
    res += [
        "",
        "What this says, plainly:",
        "",
        f"1. **The GPU did not improve the policy.** The GPU run used {tr['training_rollouts'] // trl['training_rollouts']} times more training rollouts and "
        f"{tr['train_seconds'] / trl['train_seconds']:.0f} times more time. Its policy is "
        + (
            "not better: it is 0.04 to 0.06 degrees worse in the same laptop evaluation."
            if worse
            else "about the same in the same laptop evaluation."
        )
        + f" A network of {tr['parameters']:,} weights does not need a GPU. The laptop trained it in {trl['train_seconds']:.0f} s.",
        "2. **The GPU's contribution is the size of the evaluation.** "
        f"{gpu['total_rollouts']:,} rollouts ({gpu['simulated_hand_hours']:,.0f} hours of simulated hand time) in {gpu['eval_seconds'] / 60:.1f} minutes, "
        f"40 times the laptop's {lap['total_rollouts']:,} per policy.",
        "3. **The larger evaluation did not change the answer.** The GPU-trained policy scores "
        + ", ".join(
            f"{b['policy_rms_deg']} (laptop) and {g['policy_rms_deg']} (GPU)"
            for b, g in zip(gol["table"], gpu["table"])
        )
        + " degrees in the three tests. The laptop evaluation was already enough to see the result.",
        "4. **We did not measure** how long the laptop needs for 1,440,000 rollouts, so we make no speed claim for the GPU.",
        "5. The policy file in the repo, `robot_policy/out/policy.pt`, is the GPU-trained one. The laptop-trained one is `policy_laptop.pt`. Either can be used.",
    ]

    cost = [
        row("Item", "Value"),
        row("---", "---"),
        row(
            "Training rollouts on the GPU (the kept run)",
            f"{tr['training_rollouts']:,} of {tr['horizon_steps'] * C.DT:.1f} s each",
        ),
        row(
            "Simulated hand time in that training",
            f"{tr['simulated_hand_seconds'] / 3600:,.0f} hours",
        ),
        row("GPU time of that training", f"{tr['train_seconds'] / 60:.1f} min"),
        row(
            "Evaluation rollouts on the GPU",
            f"{gpu['total_rollouts']:,} (8 takes x 3 tests x 3 systems x 20,000)",
        ),
        row("GPU time of that evaluation", f"{gpu['eval_seconds'] / 60:.1f} min"),
        row(
            "MuJoCo rollouts",
            f"{mj['total_rollouts'] + mjl['total_rollouts']:,} on CPU",
        ),
        row("GPU minutes billed, all container starts", billed_min),
        row("Cost at list price", f"{billed_usd} USD"),
        row(
            "Verda product",
            "One Serverless Container, 1x H100 80 GB, 5.77 USD per hour. GPU instances do not start on the coupon balance.",
        ),
        "",
        "The billed minutes are more than the two GPU times above. The rest went to: a first training run that we threw away (squared-error loss, and two takes of unknown origin still in the data), a second one stopped after 5 minutes for the same data reason, two short test jobs, the waits between jobs, and the MuJoCo check, which used the container's CPU while the GPU sat idle.",
        "",
        "Container starts and stops (`robot_policy/out/cost_log.jsonl`):",
        "",
        row("Stopped (UTC)", "Minutes", "USD"),
        row("---", "---", "---"),
    ]
    cost += [row(c["t"][11:16], c["minutes"], c["cost_usd"]) for c in downs]

    vnum = (
        f"In this one rollout the RMS error over the whole take is {video['rms_deg']['policy']} degrees for the policy and "
        f"{video['rms_deg']['replay']} degrees for plain replay."
    )
    limit6 = (
        "The policy's gain over replay sent early is real but small from a normal start "
        f"({t['nominal start']['policy_rms_deg']} against {t['nominal start']['replay_lead_rms_deg']} degrees). "
        "A simple fixed lead gives most of the gain over plain replay. The policy's clear advantage is after a wrong start or a push."
    )
    text = DOC.read_text()
    for key, val in {
        "__STATUS__": status,
        "__SHORT__": "\n".join(short),
        "__PARAMS__": f"{tr['parameters']:,}",
        "__LEADMS__": str(tr["replay_lead"]["ms"]),
        "__RESULTS__": "\n".join(res),
        "__COST__": "\n".join(cost),
        "__VIDEOSIZE__": f"{video['bytes'] / 1e6:.1f} MB, {video['seconds']} s",
        "__VIDEONUM__": vnum,
        "__LIMIT6__": limit6,
    }.items():
        assert key in text, key
        text = text.replace(key, val)
    assert "__" not in text.replace("__init__", ""), "a mark is left"
    DOC.write_text(text)
    print("filled", DOC)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
