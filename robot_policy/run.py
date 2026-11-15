"""Train the policy and evaluate it against plain replay, both in the batched simulator.

    uv run python run.py train [--envs 4096] [--iters 1500] [--variations 200]
    uv run python run.py eval  [--rollouts 2000]

Training data: generated variations of the training takes only (other timing, sensor noise, another hand size; see
common.variation). The real takes in common.HELD_OUT are never read by `train`. `eval` runs only on those held-out
real takes, with no change to them.

Training method: the simulator is written in torch, so the tracking error at the end of a rollout can be
differentiated back through the physics to the policy's weights (analytic policy gradient, also called
backpropagation through time). No reward shaping and no exploration noise are needed.
"""

from __future__ import annotations

import argparse
import json
import math
import time

import common as C
import numpy as np
import torch


def sample_windows(pool, lengths, b, horizon, gen, device):
    """Random windows of horizon + LOOKAHEAD + 1 steps from the pool of generated references."""
    idx = torch.randint(0, pool.shape[0], (b,), generator=gen)
    start = (torch.rand((b,), generator=gen) * (lengths[idx] - 1).clamp(min=1)).long()
    steps = torch.arange(horizon + C.LOOKAHEAD + 1)
    t = (start[:, None] + steps[None, :]).clamp(max=pool.shape[1] - 1)
    return pool[idx[:, None].to(device), t.to(device)]


def start_pose(ref0, lower, upper, gen, random_share: float):
    """Start on the reference with a small error, or anywhere inside the joint limits."""
    b = ref0.shape[0]
    device = ref0.device
    near = ref0 + 0.02 * torch.randn(ref0.shape, generator=gen).to(device)
    anywhere = lower + (upper - lower) * torch.rand(ref0.shape, generator=gen).to(
        device
    )
    pick = (torch.rand((b, 1), generator=gen) < random_share).float().to(device)
    return torch.maximum(
        torch.minimum(pick * anywhere + (1 - pick) * near, upper), lower
    )


def lead(ref: torch.Tensor, steps: int) -> torch.Tensor:
    """The reference sent `steps` control periods early (the last pose is held at the end)."""
    if steps <= 0:
        return ref
    return torch.cat([ref[:, steps:], ref[:, -1:].expand(-1, steps, -1)], dim=1)


@torch.no_grad()
def best_lead(
    pool, lengths, lower, upper, gen, device, horizon: int = 150, b: int = 2048
) -> dict:
    """A stronger open-loop baseline: replay sent early by a fixed time, the time chosen on the training variations.

    It answers the fair question "does the policy do more than cancel the servo's lag?".
    """
    ref = sample_windows(pool, lengths, b, horizon, gen, device)
    params = C.SimParams.sample(b, gen, device)
    q0 = start_pose(ref[:, 0], lower, upper, gen, random_share=0.0)
    none = C.Pushes.none(b, device)
    rms = {}
    for k in range(C.LOOKAHEAD + 1):
        q = C.rollout(None, lead(ref, k), lower, upper, params, none, q0, gen, horizon)
        rms[k] = C_deg(q - ref[:, 1 : horizon + 1])
    k = min(rms, key=rms.get)
    return {
        "steps": k,
        "ms": round(k * C.DT * 1000),
        "rms_deg_by_steps": {str(i): round(v, 3) for i, v in rms.items()},
    }


def train(a) -> int:
    device = C.pick_device()
    gen = torch.Generator().manual_seed(a.seed)
    rng = np.random.default_rng(a.seed)
    rt = C.Retarget.load()
    takes = C.load_takes()
    sources = [k for k in takes if k not in C.HELD_OUT]
    assert not set(sources) & set(C.HELD_OUT)
    t0 = time.time()
    refs = [
        C.variation(takes[k], rt, rng) for k in sources for _ in range(a.variations)
    ]
    pool, lengths = C.pack(refs)
    pool = pool.to(device)
    lower, upper = C.limits(rt, device)
    print(
        f"device {device}; {len(sources)} training takes, {len(refs)} generated variations, "
        f"{sum(len(r) for r in refs) * C.DT / 60:.0f} min of reference, built in {time.time() - t0:.0f} s",
        flush=True,
    )

    policy = C.Policy().to(device)
    opt = torch.optim.Adam(policy.parameters(), lr=a.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(
        opt, a.iters, eta_min=a.lr * 0.05
    )
    log, t_train = [], time.time()
    for it in range(a.iters):
        ref = sample_windows(pool, lengths, a.envs, a.horizon, gen, device)
        params = C.SimParams.sample(a.envs, gen, device)
        pushes = C.Pushes.sample(
            a.envs, a.horizon, gen, device, k=1, share=0.5, first_step=2
        )
        q0 = start_pose(ref[:, 0], lower, upper, gen, random_share=0.4)
        q, u = C.rollout(
            policy, ref, lower, upper, params, pushes, q0, gen, a.horizon, record=True
        )
        target = ref[:, 1 : a.horizon + 1]
        err = q - target
        track = (err**2).mean()
        # "huber": the squared error up to 3 degrees, then linear. The large errors of a wrong start or a push then
        # do not drown the small errors of normal tracking.
        fit = (
            torch.nn.functional.huber_loss(q, target, delta=a.huber_deg * math.pi / 180)
            if a.loss == "huber"
            else track
        )
        # a smooth command: the correction may not jump from one period to the next
        jerk = (
            ((u[:, 1:] - u[:, :-1]) - (ref[:, 1 : a.horizon] - ref[:, : a.horizon - 1]))
            ** 2
        ).mean()
        loss = fit + a.smooth * jerk * (0.1 if a.loss == "huber" else 1.0)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(policy.parameters(), 1.0)
        opt.step()
        sched.step()
        if it % a.log_every == 0 or it == a.iters - 1:
            with torch.no_grad():
                base = C.rollout(
                    None, ref, lower, upper, params, pushes, q0, gen, a.horizon
                )
                rms_p = math.degrees(math.sqrt(track.item()))
                rms_r = math.degrees(math.sqrt(((base - target) ** 2).mean().item()))
            log.append(
                {
                    "iter": it,
                    "policy_rms_deg": round(rms_p, 3),
                    "replay_rms_deg": round(rms_r, 3),
                    "seconds": round(time.time() - t_train, 1),
                }
            )
            print(log[-1], flush=True)
    seconds = time.time() - t_train
    lead_info = best_lead(pool, lengths, lower, upper, gen, device)
    print(
        "replay with a fixed lead, chosen on the training variations:",
        lead_info,
        flush=True,
    )
    C.OUT.mkdir(parents=True, exist_ok=True)
    meta = {
        "device": str(device),
        "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "envs": a.envs,
        "iters": a.iters,
        "horizon_steps": a.horizon,
        "variations_per_take": a.variations,
        "training_takes": sources,
        "held_out_takes": list(C.HELD_OUT),
        "generated_references": len(refs),
        "training_rollouts": a.envs * a.iters,
        "simulated_hand_seconds": a.envs * a.iters * a.horizon * C.DT,
        "train_seconds": round(seconds, 1),
        "loss": a.loss,
        "data_seconds": round(t_train - t0, 1),
        "seed": a.seed,
        "parameters": sum(p.numel() for p in policy.parameters()),
        "replay_lead": lead_info,
        "log": log,
    }
    torch.save({"state": policy.state_dict(), "meta": meta}, C.OUT / "policy.pt")
    (C.OUT / "train.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(
        f"trained in {seconds:.0f} s: {a.envs * a.iters} rollouts of {a.horizon * C.DT:.1f} s",
        flush=True,
    )
    return 0


def rms_deg(err: torch.Tensor, mask: torch.Tensor | None = None) -> float:
    sq = err**2
    if mask is not None:
        return math.degrees(
            math.sqrt(
                (sq * mask).sum().item()
                / max(
                    1.0,
                    mask.sum().item() * (sq.shape[-1] if mask.shape[-1] == 1 else 1),
                )
            )
        )
    return math.degrees(math.sqrt(sq.mean().item()))


def settle_time(err: torch.Tensor, tol_rad: float) -> torch.Tensor:
    """Per rollout: the first time after which every joint stays within the tolerance for 0.2 s (seconds)."""
    ok = (err.abs().amax(dim=2) < tol_rad).float()  # [B, T]
    win = 10
    run = (
        torch.nn.functional.avg_pool1d(ok[:, None, :], win, stride=1).squeeze(1)
        >= 0.999
    )
    never = torch.full((ok.shape[0],), ok.shape[1], device=ok.device, dtype=torch.long)
    first = torch.where(run.any(dim=1), run.float().argmax(dim=1), never)
    return first.float() * C.DT


@torch.no_grad()
def evaluate(a) -> int:
    device = C.pick_device()
    rt = C.Retarget.load()
    takes = C.load_takes()
    ck = torch.load(C.OUT / a.policy, map_location=device)
    policy = C.Policy().to(device)
    policy.load_state_dict(ck["state"])
    policy.eval()
    lower, upper = C.limits(rt, device)
    conditions = ("nominal start", "random start", "pushed")
    acc = {
        c: {
            "policy_sq": 0.0,
            "replay_sq": 0.0,
            "lead_sq": 0.0,
            "n": 0,
            "wins": 0,
            "wins_lead": 0,
            "rollouts": 0,
            "extra": {},
        }
        for c in conditions
    }
    lead_steps = int(ck["meta"].get("replay_lead", {}).get("steps", 0))
    per_take, t0, total_rollouts, sim_seconds = [], time.time(), 0, 0.0
    for ti, tid in enumerate(C.HELD_OUT):
        ref_np = C.real_reference(takes[tid], rt)
        steps = len(ref_np) - 1
        ref1, _ = C.pack([ref_np])
        ref = ref1.to(device).expand(a.rollouts, -1, -1)
        target = ref[:, 1 : steps + 1]
        row = {"take": tid, "seconds": round(steps * C.DT, 1)}
        for ci, cond in enumerate(conditions):
            gen = torch.Generator().manual_seed(1000 * (ti + 1) + ci)
            params = C.SimParams.sample(a.rollouts, gen, device)
            q0 = start_pose(
                ref[:, 0],
                lower,
                upper,
                gen,
                random_share=1.0 if cond == "random start" else 0.0,
            )
            pushes = (
                C.Pushes.sample(
                    a.rollouts, steps, gen, device, k=3, share=1.0, first_step=25
                )
                if cond == "pushed"
                else C.Pushes.none(a.rollouts, device)
            )
            gen_p = torch.Generator().manual_seed(77 + ti)
            qp = C.rollout(policy, ref, lower, upper, params, pushes, q0, gen_p, steps)
            qr = C.rollout(None, ref, lower, upper, params, pushes, q0, gen_p, steps)
            ql = C.rollout(
                None,
                lead(ref, lead_steps),
                lower,
                upper,
                params,
                pushes,
                q0,
                gen_p,
                steps,
            )
            ep, er, el = qp - target, qr - target, ql - target
            s = acc[cond]
            s["policy_sq"] += (ep**2).sum().item()
            s["replay_sq"] += (er**2).sum().item()
            s["lead_sq"] += (el**2).sum().item()
            s["wins_lead"] += int(
                ((ep**2).mean(dim=(1, 2)) < (el**2).mean(dim=(1, 2))).sum().item()
            )
            s["n"] += ep.numel()
            s["wins"] += int(
                ((ep**2).mean(dim=(1, 2)) < (er**2).mean(dim=(1, 2))).sum().item()
            )
            s["rollouts"] += a.rollouts
            x = s["extra"]
            if cond == "random start":
                tp, tr = (
                    settle_time(ep, math.radians(5)),
                    settle_time(er, math.radians(5)),
                )
                x.setdefault("settle_policy", []).append(tp.cpu())
                x.setdefault("settle_replay", []).append(tr.cpu())
                x.setdefault("settle_lead", []).append(
                    settle_time(el, math.radians(5)).cpu()
                )
            if cond == "pushed":
                # the window from each push start to 0.5 s after its end
                tt = torch.arange(steps, device=device)[None, None, :]
                win = (
                    (
                        (tt >= pushes.start[:, :, None])
                        & (tt < pushes.stop[:, :, None] + 25)
                    )
                    .any(dim=1)
                    .float()[:, :, None]
                )
                x["win_policy_sq"] = (
                    x.get("win_policy_sq", 0.0) + ((ep**2) * win).sum().item()
                )
                x["win_replay_sq"] = (
                    x.get("win_replay_sq", 0.0) + ((er**2) * win).sum().item()
                )
                x["win_lead_sq"] = (
                    x.get("win_lead_sq", 0.0) + ((el**2) * win).sum().item()
                )
                x["win_n"] = x.get("win_n", 0.0) + win.sum().item() * C.N_J
                x.setdefault("peak_policy", []).append(
                    (ep.abs() * win).amax(dim=(1, 2)).cpu()
                )
                x.setdefault("peak_replay", []).append(
                    (er.abs() * win).amax(dim=(1, 2)).cpu()
                )
            row[cond] = {
                "policy_rms_deg": round(C_deg(ep), 2),
                "replay_rms_deg": round(C_deg(er), 2),
                "replay_lead_rms_deg": round(C_deg(el), 2),
            }
            total_rollouts += 3 * a.rollouts
            sim_seconds += 3 * a.rollouts * steps * C.DT
        per_take.append(row)
        print(row, flush=True)
    wall = time.time() - t0
    table = []
    for cond in conditions:
        s = acc[cond]
        r = {
            "condition": cond,
            "rollouts_each": s["rollouts"],
            "policy_rms_deg": round(
                math.degrees(math.sqrt(s["policy_sq"] / s["n"])), 2
            ),
            "replay_rms_deg": round(
                math.degrees(math.sqrt(s["replay_sq"] / s["n"])), 2
            ),
            "replay_lead_rms_deg": round(
                math.degrees(math.sqrt(s["lead_sq"] / s["n"])), 2
            ),
            "policy_better_share": round(s["wins"] / s["rollouts"], 4),
            "policy_better_than_lead_share": round(s["wins_lead"] / s["rollouts"], 4),
        }
        x = s["extra"]
        if cond == "random start":
            tp, tr = torch.cat(x["settle_policy"]), torch.cat(x["settle_replay"])
            r["median_time_to_within_5_deg_s"] = {
                "policy": round(tp.median().item(), 2),
                "replay": round(tr.median().item(), 2),
                "replay_lead": round(torch.cat(x["settle_lead"]).median().item(), 2),
            }
        if cond == "pushed":
            r["rms_during_and_0.5s_after_push_deg"] = {
                "policy": round(
                    math.degrees(math.sqrt(x["win_policy_sq"] / x["win_n"])), 2
                ),
                "replay": round(
                    math.degrees(math.sqrt(x["win_replay_sq"] / x["win_n"])), 2
                ),
                "replay_lead": round(
                    math.degrees(math.sqrt(x["win_lead_sq"] / x["win_n"])), 2
                ),
            }
            r["median_peak_error_in_push_window_deg"] = {
                "policy": round(
                    math.degrees(torch.cat(x["peak_policy"]).median().item()), 1
                ),
                "replay": round(
                    math.degrees(torch.cat(x["peak_replay"]).median().item()), 1
                ),
            }
        table.append(r)
    result = {
        "device": str(device),
        "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "policy_file": a.policy,
        "held_out_takes": list(C.HELD_OUT),
        "rollouts_per_take_per_condition": a.rollouts,
        "systems": 3,
        "replay_lead_steps": lead_steps,
        "total_rollouts": total_rollouts,
        "simulated_hand_hours": round(sim_seconds / 3600, 1),
        "eval_seconds": round(wall, 1),
        "table": table,
        "per_take": per_take,
        "training": ck["meta"],
    }
    name = "results.json" if a.tag == "" else f"results_{a.tag}.json"
    (C.OUT / name).write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps(table, indent=1))
    print(
        f"{total_rollouts} rollouts, {sim_seconds / 3600:.1f} simulated hand hours, {wall:.0f} s on {device}"
    )
    return 0


def C_deg(err: torch.Tensor) -> float:
    return math.degrees(math.sqrt((err**2).mean().item()))


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train")
    t.add_argument("--envs", type=int, default=4096)
    t.add_argument("--iters", type=int, default=1500)
    t.add_argument("--horizon", type=int, default=60)
    t.add_argument("--variations", type=int, default=200)
    t.add_argument("--lr", type=float, default=1e-3)
    t.add_argument("--smooth", type=float, default=0.2)
    t.add_argument("--loss", choices=["mse", "huber"], default="huber")
    t.add_argument("--huber-deg", type=float, default=3.0)
    t.add_argument("--seed", type=int, default=0)
    t.add_argument("--log-every", type=int, default=50)
    e = sub.add_parser("eval")
    e.add_argument("--rollouts", type=int, default=2000)
    e.add_argument("--tag", default="")
    e.add_argument("--policy", default="policy.pt", help="a file in out/")
    a = ap.parse_args()
    torch.manual_seed(0)
    return train(a) if a.cmd == "train" else evaluate(a)


if __name__ == "__main__":
    raise SystemExit(main())
