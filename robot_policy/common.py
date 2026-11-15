"""Shared pieces of the robot policy work: data, variations, the batched simulator and the policy.

Everything here is standalone: numpy and torch only, no import from core/, backend/ or frontend/.

Words used in this folder:
- take: one real recording of the expert's gloved hand (18 angle features over time).
- retarget: the fixed map from the 18 angle features to the 7 joint targets of the Dex3-1 hand (core/robot.py),
  exported as a matrix by prepare.py.
- reference: the joint targets over time that the hand must follow.
- replay: the baseline. The reference is sent to the joint servos as it is, with no look at the hand's state.
- policy: a small neural network that reads the hand's state and the next part of the reference, and sends its own
  joint commands.
- rollout: one simulated run of one hand from start to end.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

LANE = Path(__file__).resolve().parent
OUT = LANE / "out"
DATA = OUT / "data"

CONTROL_HZ = 50.0
DT = 1.0 / CONTROL_HZ
SUBSTEPS = 20  # physics step 1 ms
LOOKAHEAD = 8  # the policy sees the reference up to 160 ms ahead
N_J = 7
RESIDUAL_LIMIT = 0.7  # rad: the furthest a policy command may sit from the reference
ACTION_HISTORY = 2

# Real takes that are never used to make training data, in any form. The first is the lesson of the video.
HELD_OUT = (
    "9c90d77fabdb-right",  # surgical grips, scalpel pencil step: 13.7 s, hold, move, move; every joint moves
    "f09f617ee76d-right",  # crochet, hold step: the four takes made at 13:34
    "016a1da374c1-right",
    "a4de6f1e3ba8-right",
    "1754a2f74d3d-right",
    "2da6252cc125-right",  # piano, hand position step: two takes from the evening session
    "7a4d1c8fb139-right",
    "88955f73ea1c-right",  # table tennis, shakehand grip: the longest take, 18.5 s
)
DEMO_TAKE = HELD_OUT[0]


# ---- data ------------------------------------------------------------------------------------------------------------


@dataclass
class Retarget:
    joints: list[str]
    W: np.ndarray
    offset_deg: np.ndarray
    sign: np.ndarray
    lower: np.ndarray
    upper: np.ndarray
    angle_names: list[str]

    @classmethod
    def load(cls, path: Path = DATA / "retarget.json") -> "Retarget":
        m = json.loads(path.read_text())
        return cls(m["joints"], np.asarray(m["W"]), np.asarray(m["offset_deg"]), np.asarray(m["sign"]),
                   np.asarray(m["lower"]), np.asarray(m["upper"]), m["angle_names"])

    def __call__(self, angles_deg: np.ndarray) -> np.ndarray:
        raw = self.sign * np.radians(self.offset_deg + angles_deg @ self.W.T)
        return np.clip(raw, self.lower, self.upper)


def load_takes(path: Path = DATA / "takes.npz") -> dict[str, dict]:
    z = np.load(path)
    ids = sorted({k.split("/")[0] for k in z.files})
    return {i: {"t": z[f"{i}/t"].astype(np.float64), "angles": z[f"{i}/angles"].astype(np.float64)} for i in ids}


def resample(t: np.ndarray, x: np.ndarray, hz: float = CONTROL_HZ) -> np.ndarray:
    """Linear resampling of a recording to the control rate."""
    n = max(2, int(math.floor(t[-1] * hz)) + 1)
    tt = np.arange(n) / hz
    return np.stack([np.interp(tt, t, x[:, k]) for k in range(x.shape[1])], axis=1)


def real_reference(take: dict, rt: Retarget) -> np.ndarray:
    """A real take as the joint reference at the control rate, with no change at all."""
    return rt(resample(take["t"], take["angles"]))


def _smooth_noise(rng: np.random.Generator, n: int, dims: int, period_s: float) -> np.ndarray:
    """Slow random curves in -1..1: a few sines of random phase."""
    tt = np.arange(n)[:, None] * DT
    out = np.zeros((n, dims))
    for k in range(3):
        f = (k + 1) / period_s * rng.uniform(0.6, 1.4, size=(1, dims))
        out += rng.uniform(0.3, 1.0, size=(1, dims)) * np.sin(2 * np.pi * f * tt + rng.uniform(0, 2 * np.pi, size=(1, dims)))
    return out / 2.0


FLEX_GROUPS = {"thumb": [0, 1], "index": [2, 3, 4], "middle": [5, 6, 7], "ring": [8, 9, 10], "little": [11, 12, 13]}


def variation(take: dict, rt: Retarget, rng: np.random.Generator) -> np.ndarray:
    """One generated variation of a take: other timing, sensor noise and another hand size. Returns joint targets.

    - Timing: a whole-take speed from 0.6 to 1.6 and a slow local stretch of up to 25 %.
    - Noise: white noise up to 1.5 degrees and a slow drift up to 4 degrees on every angle feature.
    - Hand size: a glove on a larger or smaller hand reads another range. Each finger's flexion gets a gain from
      0.8 to 1.2 and an offset up to 6 degrees; the spreads get a gain from 0.8 to 1.2.
    """
    t, a = take["t"], take["angles"]
    speed = rng.uniform(0.6, 1.6)
    n = max(LOOKAHEAD + 4, int(t[-1] / speed * CONTROL_HZ))
    u = np.linspace(0.0, 1.0, n)
    warp = u + 0.25 * rng.uniform(0, 1) * np.sin(2 * np.pi * rng.uniform(0.5, 2.0) * u + rng.uniform(0, 2 * np.pi)) / (2 * np.pi * 2.0)
    warp = np.maximum.accumulate(np.clip(warp, 0.0, 1.0))
    src = warp / max(warp[-1], 1e-9) * t[-1]
    x = np.stack([np.interp(src, t, a[:, k]) for k in range(a.shape[1])], axis=1)
    for idx in FLEX_GROUPS.values():
        x[:, idx] = x[:, idx] * rng.uniform(0.8, 1.2) + rng.uniform(-6.0, 6.0)
    x[:, 14:] = x[:, 14:] * rng.uniform(0.8, 1.2)
    x += rng.uniform(0.0, 1.5) * rng.standard_normal(x.shape)
    x += rng.uniform(0.0, 4.0) * _smooth_noise(rng, n, x.shape[1], period_s=3.0)
    return rt(x)


def pack(refs: list[np.ndarray]) -> tuple[torch.Tensor, torch.Tensor]:
    """References of different lengths as one array; after its end a reference holds its last pose."""
    n = max(len(r) for r in refs) + LOOKAHEAD + 1
    out = np.zeros((len(refs), n, N_J), dtype=np.float32)
    for i, r in enumerate(refs):
        out[i, : len(r)] = r
        out[i, len(r):] = r[-1]
    return torch.from_numpy(out), torch.tensor([len(r) for r in refs])


# ---- the simulated hand ----------------------------------------------------------------------------------------------
# Joint order (config.toml [robot.retarget]): thumb_0, thumb_1, thumb_2, index_0, index_1, middle_0, middle_1.
# Effort and velocity limits are the URDF's (models/robots/dex3_1/dex3_1_r.urdf).
EFFORT = (2.45, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4)
VEL_LIMIT = (3.14, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0)
# Inertia about each joint axis in kg m2: what MuJoCo computes from the URDF links in the open pose (mujoco_check.py
# prints it: 1.23e-4, 2.96e-4, 1.18e-4, ...) with a rotor and gearbox term of 1e-4 that the URDF does not give. The
# rotor term is an assumption, so every rollout draws its inertia from 0.5 to 2.5 times these values.
INERTIA = (1.3e-4, 3.0e-4, 1.2e-4, 3.0e-4, 1.2e-4, 3.0e-4, 1.2e-4)
# Servo gains. Unitree's Dex3-1 example code uses kp 1.5 and kd 0.1 as far as we know; we could not check this
# against a real hand, so every rollout draws its own gains around these values.
KP_NOMINAL, KD_NOMINAL = 1.5, 0.1


@dataclass
class SimParams:
    """One set of physical values per rollout (each a [B, 7] or [B, 1] tensor)."""

    kp: torch.Tensor
    kd: torch.Tensor
    inertia: torch.Tensor
    viscous: torch.Tensor
    coulomb: torch.Tensor
    bias: torch.Tensor
    delay: torch.Tensor  # control steps of command delay, 0, 1 or 2

    @classmethod
    def sample(cls, b: int, gen: torch.Generator, device, nominal: bool = False) -> "SimParams":
        def u(lo, hi, shape=(b, N_J)):
            return (torch.rand(shape, generator=gen) * (hi - lo) + lo).to(device)

        base_i = torch.tensor(INERTIA, device=device)
        if nominal:
            one = torch.ones((b, N_J), device=device)
            return cls(one * KP_NOMINAL, one * KD_NOMINAL, one * base_i, one * 0.01, one * 0.01, one * 0.0,
                       torch.ones((b, 1), device=device, dtype=torch.long))
        return cls(
            kp=u(1.0, 2.2, (b, 1)).expand(b, N_J) * u(0.9, 1.1),
            kd=u(0.06, 0.16, (b, 1)).expand(b, N_J) * u(0.9, 1.1),
            inertia=base_i * u(0.5, 2.5),
            viscous=u(0.002, 0.03),
            coulomb=u(0.0, 0.04),
            bias=u(-0.04, 0.04),  # gravity and cable load, as a constant torque
            delay=torch.randint(0, 3, (b, 1), generator=gen).to(device),
        )


def physics_step(q, qd, u, p: SimParams, ext, lower, upper, effort, vel_limit):
    """One control period (20 ms) of the joint dynamics, in 1 ms steps.

    Each joint: inertia * acceleration = motor torque - viscous friction - dry friction + bias + push.
    The motor is a position servo: torque = kp * (command - angle) - kd * speed, limited to the URDF effort.
    Damping is integrated implicitly, which keeps the 1 ms step stable for the small finger inertias.
    The model has no contact, no coupling between joints and no gravity term (the bias torque stands for it).
    """
    h = DT / SUBSTEPS
    for _ in range(SUBSTEPS):
        tau_free = p.kp * (u - q) - p.kd * qd
        sat = (tau_free.abs() > effort).float()
        tau_sat = torch.clamp(tau_free, -effort, effort)
        # Dry friction acts in the forward pass only: its slope near zero speed is so steep that it would make the
        # gradient through many steps explode.
        other = ext + p.bias - p.coulomb * torch.tanh(qd.detach() / 0.05)
        # unsaturated: kp term explicit, kd and viscous implicit; saturated: constant motor torque, viscous implicit
        num_free = qd + h / p.inertia * (p.kp * (u - q) + other)
        den_free = 1.0 + h * (p.kd + p.viscous) / p.inertia
        num_sat = qd + h / p.inertia * (tau_sat + other)
        den_sat = 1.0 + h * p.viscous / p.inertia
        qd = (1 - sat) * (num_free / den_free) + sat * (num_sat / den_sat)
        qd = torch.maximum(torch.minimum(qd, vel_limit), -vel_limit)
        q = q + h * qd
        # joint limits: a hard stop that also removes the speed into the stop
        below, above = (q < lower).float(), (q > upper).float()
        q = torch.maximum(torch.minimum(q, upper), lower)
        qd = qd * (1 - below * (qd < 0).float()) * (1 - above * (qd > 0).float())
    return q, qd


# ---- the policy ------------------------------------------------------------------------------------------------------

OBS_DIM = N_J * (2 + (LOOKAHEAD + 1) + ACTION_HISTORY)


class Policy(torch.nn.Module):
    """A small network: 3 hidden layers of 128. It adds a bounded correction to the reference command."""

    def __init__(self, hidden: int = 128) -> None:
        super().__init__()
        self.net = torch.nn.Sequential(
            torch.nn.Linear(OBS_DIM, hidden), torch.nn.ELU(),
            torch.nn.Linear(hidden, hidden), torch.nn.ELU(),
            torch.nn.Linear(hidden, hidden), torch.nn.ELU(),
            torch.nn.Linear(hidden, N_J),
        )
        with torch.no_grad():
            self.net[-1].weight.mul_(0.01)
            self.net[-1].bias.zero_()

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        return RESIDUAL_LIMIT * torch.tanh(self.net(obs))


def observe(q_meas, qd_meas, ref_window, last_actions, half_range):
    """What the policy reads: the measured angles and speeds, the reference now and up to 160 ms ahead (as the
    distance from the measured angle), and its own last two corrections."""
    rel = (ref_window - q_meas[:, None, :]) / half_range
    return torch.cat([q_meas / half_range, qd_meas / 10.0, rel.flatten(1), last_actions.flatten(1) / RESIDUAL_LIMIT], dim=1)


@dataclass
class Pushes:
    """Pushes for a batch: a torque on some joints between two control steps. Up to `k` pushes per rollout."""

    start: torch.Tensor  # [B, k] control step
    stop: torch.Tensor  # [B, k]
    torque: torch.Tensor  # [B, k, 7]

    @classmethod
    def none(cls, b: int, device) -> "Pushes":
        z = torch.zeros((b, 1), device=device, dtype=torch.long)
        return cls(z, z, torch.zeros((b, 1, N_J), device=device))

    @classmethod
    def sample(cls, b: int, horizon: int, gen: torch.Generator, device, k: int = 1, share: float = 1.0,
               first_step: int = 5) -> "Pushes":
        """Each push: 1 to 3 joints, 0.4 to 1.5 N m (the motors give at most 1.4 on six of the joints), 0.1 to 0.4 s."""
        start = torch.randint(first_step, max(first_step + 1, horizon - 10), (b, k), generator=gen)
        dur = torch.randint(5, 21, (b, k), generator=gen)
        mag = (torch.rand((b, k, N_J), generator=gen) * 1.1 + 0.4) * torch.sign(torch.rand((b, k, N_J), generator=gen) - 0.5)
        n_joints = torch.randint(1, 4, (b, k, 1), generator=gen)
        rank = torch.rand((b, k, N_J), generator=gen).argsort(dim=-1).argsort(dim=-1)
        mask = (rank < n_joints).float()
        on = (torch.rand((b, k, 1), generator=gen) < share).float()
        return cls(start.to(device), (start + dur).to(device), (mag * mask * on).to(device))

    def at(self, step: int) -> torch.Tensor:
        active = ((step >= self.start) & (step < self.stop)).float()
        return (self.torque * active[:, :, None]).sum(1)


def rollout(policy, ref, lower, upper, params: SimParams, pushes: Pushes, q0, gen, steps: int, obs_noise=(0.005, 0.05),
            record: bool = False):
    """Run `steps` control periods for a batch. `ref` is [B, steps + LOOKAHEAD + 1, 7]. `policy=None` is plain replay.

    Returns the angles [B, steps, 7] after each period (and the commands when `record`). With a policy the graph is
    kept, so the caller can train through the simulator.
    """
    device = ref.device
    b = ref.shape[0]
    half_range = (upper - lower) / 2
    effort = torch.tensor(EFFORT, device=device)
    vel_limit = torch.tensor(VEL_LIMIT, device=device)
    q, qd = q0, torch.zeros_like(q0)
    last = torch.zeros((b, ACTION_HISTORY, N_J), device=device)
    queue = [ref[:, 0].clone() for _ in range(3)]  # commands still on their way to the motors
    qs, us = [], []
    for t in range(steps):
        target = ref[:, t]
        if policy is None:
            cmd = target
        else:
            nq = torch.randn(q.shape, generator=gen).to(device) * obs_noise[0]
            nv = torch.randn(q.shape, generator=gen).to(device) * obs_noise[1]
            act = policy(observe(q + nq, qd + nv, ref[:, t : t + LOOKAHEAD + 1], last, half_range))
            cmd = torch.maximum(torch.minimum(target + act, upper), lower)
            last = torch.cat([act[:, None], last[:, :-1]], dim=1)
        queue = [cmd] + queue[:2]
        stacked = torch.stack(queue, dim=1)  # [B, 3, 7]: delay 0, 1, 2
        u = stacked.gather(1, params.delay[:, :, None].expand(b, 1, N_J)).squeeze(1)
        q, qd = physics_step(q, qd, u, params, pushes.at(t), lower, upper, effort, vel_limit)
        qs.append(q)
        if record:
            us.append(u)
    out = torch.stack(qs, dim=1)
    return (out, torch.stack(us, dim=1)) if record else out


def limits(rt: Retarget, device) -> tuple[torch.Tensor, torch.Tensor]:
    return (torch.tensor(rt.lower, dtype=torch.float32, device=device), torch.tensor(rt.upper, dtype=torch.float32, device=device))


def pick_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")
