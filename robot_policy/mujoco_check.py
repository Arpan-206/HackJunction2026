"""Second check and the video: the trained policy on the Dex3-1 in MuJoCo, a physics engine it never trained in.

    uv run python mujoco_check.py eval [--rollouts 40]     # numbers: out/results_mujoco.json
    uv run python mujoco_check.py video                    # out/policy_demo.mp4

The training simulator (common.physics_step) treats each joint alone. MuJoCo builds the whole hand from the URDF
(models/robots/dex3_1/dex3_1_r.urdf): the link masses and inertias, the joint axes and limits, gravity, and the
forces one moving link puts on the next. If the policy still beats replay here, it did not just learn a quirk of
our own simulator.

What this model has: rigid links, gravity, coupled dynamics, joint limits, position servos with the URDF effort
limits, rotor inertia and friction as assumptions (the URDF gives neither). What it does not have: contact (the
URDF's meshes are not in the repo, so links cannot touch each other or an object), the palm's motion (it is fixed
in the air), cables, backlash and motor heat. The capsules in the video are drawn from the joint positions; they are
not the real shape of the hand.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import mujoco
import numpy as np
import torch

import common as C

URDF = C.LANE.parent / "models" / "robots" / "dex3_1" / "dex3_1_r.urdf"
ARMATURE = 1.0e-4  # rotor and gearbox inertia at the joint, kg m2: an assumption, the URDF does not give it
DAMPING = 0.01
FRICTION = 0.01
PHYSICS_DT = 0.001
DELAY_STEPS = 1


def _floats(s: str | None, n: int = 3) -> list[float]:
    return [float(x) for x in (s or " ".join(["0"] * n)).split()]


def build_xml(ghost: bool = False) -> tuple[str, list[str]]:
    """The URDF as a MuJoCo model with a fixed palm, capsule shapes and one position servo per joint.

    With `ghost` a second, see-through hand is added for the video; it shows the reference pose.
    """
    root = ET.parse(URDF).getroot()
    links = {link.get("name"): link for link in root.findall("link")}
    joints = [j for j in root.findall("joint") if j.get("type") == "revolute"]
    children: dict[str, list] = {}
    for j in joints:
        children.setdefault(j.find("parent").get("link"), []).append(j)
    rt = C.Retarget.load()
    order = list(rt.joints)

    def inertial(link) -> str:
        i = link.find("inertial")
        if i is None:
            return ""
        o = i.find("origin")
        m = i.find("mass").get("value")
        t = i.find("inertia")
        full = " ".join(t.get(k) for k in ("ixx", "iyy", "izz", "ixy", "ixz", "iyz"))
        return f'<inertial pos="{o.get("xyz")}" mass="{m}" fullinertia="{full}"/>'

    def tip(link_name: str) -> list[float]:
        kids = children.get(link_name, [])
        if kids:
            return _floats(kids[0].find("origin").get("xyz"))
        com = _floats(links[link_name].find("inertial").find("origin").get("xyz"))
        return [2.0 * c for c in com]

    def body(link_name: str, prefix: str, rgba: str, dynamic: bool) -> str:
        out = ""
        for j in children.get(link_name, []):
            child = j.find("child").get("link")
            o = j.find("origin")
            lim = j.find("limit")
            name = prefix + j.get("name")
            end = tip(child)
            extra = (f'armature="{ARMATURE}" damping="{DAMPING}" frictionloss="{FRICTION}"' if dynamic else 'armature="1" damping="1000"')
            out += (
                f'<body name="{prefix}{child}" pos="{o.get("xyz")}" euler="{o.get("rpy", "0 0 0")}">'
                f'<joint name="{name}" type="hinge" axis="{j.find("axis").get("xyz")}" limited="true" '
                f'range="{lim.get("lower")} {lim.get("upper")}" {extra}/>'
                f"{inertial(links[child])}"
                f'<geom name="{prefix}g_{child}" type="capsule" size="0.0085" fromto="0 0 0 {end[0]} {end[1]} {end[2]}" rgba="{rgba}"/>'
                f"{body(child, prefix, rgba, dynamic)}</body>"
            )
        return out

    def hand(prefix: str, rgba: str, dynamic: bool, gravcomp: str = "") -> str:
        palm = "right_hand_palm_link"
        return (
            f'<body name="{prefix}{palm}" pos="0 0 0.25" euler="0 0 0" {gravcomp}>'
            f"{inertial(links[palm])}"
            + ("" if prefix else f'<geom name="g_palm" type="box" size="0.036 0.012 0.036" pos="0.045 0 0" rgba="{rgba}"/>')
            + f"{body(palm, prefix, rgba, dynamic)}</body>"
        )

    acts = ""
    for n, eff in zip(order, C.EFFORT):
        j = next(x for x in joints if x.get("name") == n)
        lim = j.find("limit")
        acts += (f'<position name="a_{n}" joint="{n}" kp="{C.KP_NOMINAL}" kv="{C.KD_NOMINAL}" '
                 f'forcerange="{-eff} {eff}" ctrlrange="{lim.get("lower")} {lim.get("upper")}"/>')
    xml = f"""<mujoco model="dex3_1_right_standalone">
  <compiler angle="radian" autolimits="true"/>
  <option timestep="{PHYSICS_DT}" gravity="0 0 -9.81" integrator="implicitfast"/>
  <default><geom contype="0" conaffinity="0" density="0"/></default>
  <visual><global offwidth="1280" offheight="960"/><quality shadowsize="2048"/><headlight ambient="0.45 0.45 0.45" diffuse="0.6 0.6 0.6"/></visual>
  <asset><texture type="skybox" builtin="flat" rgb1="0.96 0.93 0.87" rgb2="0.96 0.93 0.87" width="64" height="64"/>
    <texture name="grid" type="2d" builtin="checker" rgb1="0.93 0.90 0.84" rgb2="0.89 0.86 0.79" width="256" height="256"/>
    <material name="grid" texture="grid" texrepeat="6 6" reflectance="0.05"/></asset>
  <worldbody>
    <light pos="0.1 -0.3 0.9" dir="0 0.3 -1" diffuse="0.5 0.5 0.5"/>
    <geom name="bench" type="plane" size="0.6 0.6 0.01" pos="0 0 0.12" material="grid"/>
    {hand("", "0.42 0.30 0.20 1", True)}
    {hand("ghost_", "0.75 0.60 0.18 0.30", False, 'gravcomp="1"') if ghost else ""}
  </worldbody>
  <actuator>{acts}</actuator>
</mujoco>"""
    return xml, order


class Hand:
    """N independent MuJoCo hands stepped at the control rate, with the same command delay as the training simulator."""

    def __init__(self, n: int, rng: np.random.Generator | None = None) -> None:
        """With `rng`, every hand gets its own servo gains, rotor inertia, friction and command delay, drawn from the
        same ranges as in training (common.SimParams.sample). Without it, every hand has the nominal values."""
        xml, self.order = build_xml()
        self.model = mujoco.MjModel.from_xml_string(xml)
        self.qadr = np.array([self.model.joint(j).qposadr[0] for j in self.order])
        self.dadr = np.array([self.model.joint(j).dofadr[0] for j in self.order])
        self.n = n
        self.substeps = int(round(C.DT / PHYSICS_DT))
        self.models, self.delay = [], np.full(n, DELAY_STEPS)
        for i in range(n):
            m = copy.copy(self.model)
            if rng is not None:
                kp = rng.uniform(1.0, 2.2) * rng.uniform(0.9, 1.1, size=m.nu)
                kd = rng.uniform(0.06, 0.16) * rng.uniform(0.9, 1.1, size=m.nu)
                m.actuator_gainprm[:, 0] = kp
                m.actuator_biasprm[:, 1] = -kp
                m.actuator_biasprm[:, 2] = -kd
                m.dof_armature[self.dadr] = ARMATURE * rng.uniform(0.3, 3.0, size=len(self.dadr))
                m.dof_damping[self.dadr] = rng.uniform(0.002, 0.03, size=len(self.dadr))
                m.dof_frictionloss[self.dadr] = rng.uniform(0.0, 0.04, size=len(self.dadr))
                self.delay[i] = rng.integers(0, 3)
            self.models.append(m)
        self.datas = [mujoco.MjData(m) for m in self.models]

    def reset(self, q0: np.ndarray) -> None:
        for m, d, q in zip(self.models, self.datas, q0):
            mujoco.mj_resetData(m, d)
            d.qpos[self.qadr] = q
            d.ctrl[:] = q
            mujoco.mj_forward(m, d)
        self.queue = [q0.copy() for _ in range(3)]

    def state(self) -> tuple[np.ndarray, np.ndarray]:
        return (np.stack([d.qpos[self.qadr] for d in self.datas]), np.stack([d.qvel[self.dadr] for d in self.datas]))

    def step(self, cmd: np.ndarray, push: np.ndarray) -> None:
        self.queue = [cmd] + self.queue[:2]
        for i, (m, d, p) in enumerate(zip(self.models, self.datas, push)):
            d.ctrl[:] = self.queue[self.delay[i]][i]
            d.qfrc_applied[:] = 0.0
            d.qfrc_applied[self.dadr] = p
            mujoco.mj_step(m, d, self.substeps)

    def joint_inertia(self) -> list[float]:
        """The inertia MuJoCo sees at each joint in the open pose (link inertia plus the assumed rotor term)."""
        d = mujoco.MjData(self.model)
        mujoco.mj_forward(self.model, d)
        out = []
        for i in self.dadr:
            e, res = np.zeros(self.model.nv), np.zeros(self.model.nv)
            e[i] = 1.0
            mujoco.mj_mulM(self.model, d, res, e)
            out.append(float(res[i]))
        return out


def load_policy(name: str = "policy.pt") -> tuple[C.Policy, dict]:
    ck = torch.load(C.OUT / name, map_location="cpu")
    p = C.Policy()
    p.load_state_dict(ck["state"])
    p.eval()
    return p, ck["meta"]


def lead(ref: np.ndarray, steps: int) -> np.ndarray:
    return ref if steps <= 0 else np.concatenate([ref[steps:], np.repeat(ref[-1:], steps, axis=0)], axis=0)


def make_pushes(rng: np.random.Generator, n: int, steps: int, k: int) -> np.ndarray:
    """[n, steps, 7] torques: k pushes per rollout, each on 1 to 3 joints, 0.4 to 1.5 N m for 0.1 to 0.4 s."""
    out = np.zeros((n, steps, C.N_J))
    for i in range(n):
        for _ in range(k):
            s = int(rng.integers(25, max(26, steps - 30)))
            dur = int(rng.integers(5, 21))
            joints = rng.choice(C.N_J, size=int(rng.integers(1, 4)), replace=False)
            for j in joints:
                out[i, s : s + dur, j] = rng.uniform(0.4, 1.5) * rng.choice([-1, 1])
    return out


@torch.no_grad()
def run(hand: Hand, policy: C.Policy | None, ref_pad: np.ndarray, cmd_ref: np.ndarray, q0: np.ndarray, pushes: np.ndarray,
        steps: int, lower: np.ndarray, upper: np.ndarray, record: list | None = None,
        noise: np.random.Generator | None = None) -> np.ndarray:
    """One batch of rollouts in MuJoCo. `ref_pad` is what the policy sees; `cmd_ref` is what plain replay sends."""
    hand.reset(q0)
    half = torch.tensor((upper - lower) / 2, dtype=torch.float32)
    last = torch.zeros((hand.n, C.ACTION_HISTORY, C.N_J))
    qs = []
    for t in range(steps):
        if policy is None:
            cmd = np.repeat(cmd_ref[None, t], hand.n, axis=0)
        else:
            q, qd = hand.state()
            if noise is not None:
                q = q + noise.normal(0.0, 0.005, size=q.shape)
                qd = qd + noise.normal(0.0, 0.05, size=qd.shape)
            window = torch.tensor(ref_pad[t : t + C.LOOKAHEAD + 1], dtype=torch.float32)[None].expand(hand.n, -1, -1)
            act = policy(C.observe(torch.tensor(q, dtype=torch.float32), torch.tensor(qd, dtype=torch.float32), window, last, half))
            cmd = np.clip(ref_pad[t][None] + act.numpy(), lower, upper)
            last = torch.cat([act[:, None], last[:, :-1]], dim=1)
        hand.step(cmd, pushes[:, t])
        q, _ = hand.state()
        qs.append(q)
        if record is not None:
            record.append(q[0].copy())
    return np.stack(qs, axis=1)


def rms(e: np.ndarray) -> float:
    return math.degrees(math.sqrt(float((e**2).mean())))


def evaluate(a) -> int:
    policy, meta = load_policy(a.policy)
    rt = C.Retarget.load()
    takes = C.load_takes()
    lower, upper = rt.lower, rt.upper
    lead_steps = int(meta.get("replay_lead", {}).get("steps", 0))
    hand = Hand(a.rollouts, np.random.default_rng(a.seed))
    print("joint inertia in MuJoCo, kg m2:", [f"{x:.2e}" for x in hand.joint_inertia()], "; training nominal:", C.INERTIA)
    conditions = ("nominal start", "random start", "pushed")
    sq = {c: {"policy": 0.0, "replay": 0.0, "replay_lead": 0.0, "n": 0, "wins": 0, "wins_lead": 0, "rollouts": 0} for c in conditions}
    t0, rows = time.time(), []
    for ti, tid in enumerate(C.HELD_OUT):
        ref = C.real_reference(takes[tid], rt)
        steps = len(ref) - 1
        pad = np.concatenate([ref, np.repeat(ref[-1:], C.LOOKAHEAD + 1, axis=0)], axis=0)
        target = ref[1 : steps + 1][None]
        row = {"take": tid}
        for ci, cond in enumerate(conditions):
            rng = np.random.default_rng(100 * ti + ci)
            q0 = (rng.uniform(lower, upper, size=(a.rollouts, C.N_J)) if cond == "random start"
                  else np.repeat(ref[:1], a.rollouts, axis=0))
            pushes = make_pushes(rng, a.rollouts, steps, 3) if cond == "pushed" else np.zeros((a.rollouts, steps, C.N_J))
            ep = run(hand, policy, pad, pad, q0, pushes, steps, lower, upper, noise=np.random.default_rng(9 + ti)) - target
            er = run(hand, None, pad, pad, q0, pushes, steps, lower, upper) - target
            el = run(hand, None, pad, lead(pad, lead_steps), q0, pushes, steps, lower, upper) - target
            s = sq[cond]
            for k, e in (("policy", ep), ("replay", er), ("replay_lead", el)):
                s[k] += float((e**2).sum())
            s["n"] += ep.size
            s["rollouts"] += a.rollouts
            s["wins"] += int(((ep**2).mean(axis=(1, 2)) < (er**2).mean(axis=(1, 2))).sum())
            s["wins_lead"] += int(((ep**2).mean(axis=(1, 2)) < (el**2).mean(axis=(1, 2))).sum())
            row[cond] = {"policy_rms_deg": round(rms(ep), 2), "replay_rms_deg": round(rms(er), 2), "replay_lead_rms_deg": round(rms(el), 2)}
        rows.append(row)
        print(row, flush=True)
    table = [{"condition": c, "rollouts_each": s["rollouts"],
              **{f"{k}_rms_deg": round(math.degrees(math.sqrt(s[k] / s["n"])), 2) for k in ("policy", "replay", "replay_lead")},
              "policy_better_share": round(s["wins"] / s["rollouts"], 4),
              "policy_better_than_lead_share": round(s["wins_lead"] / s["rollouts"], 4)} for c, s in sq.items()]
    result = {"engine": f"MuJoCo {mujoco.__version__}", "rollouts_per_take_per_condition": a.rollouts,
              "total_rollouts": 3 * 3 * len(C.HELD_OUT) * a.rollouts, "seconds": round(time.time() - t0, 1),
              "replay_lead_steps": lead_steps, "joint_inertia_kg_m2": hand.joint_inertia(),
              "per_rollout_values": "each rollout has its own hand: kp 1.0 to 2.2, kd 0.06 to 0.16 (10 % more per joint), "
                                    "rotor inertia 0.3 to 3 times 1e-4 kg m2, damping 0.002 to 0.03, dry friction 0 to 0.04 N m, "
                                    "command delay 0, 20 or 40 ms; sensor noise 0.3 deg and 0.05 rad/s on what the policy reads",
              "table": table, "per_take": rows}
    result["policy_file"] = a.policy
    (C.OUT / ("results_mujoco.json" if not a.tag else f"results_mujoco_{a.tag}.json")).write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps(table, indent=1))
    return 0


def video(a) -> int:
    import imageio.v2 as imageio
    from PIL import Image, ImageDraw, ImageFont

    policy, meta = load_policy()
    rt = C.Retarget.load()
    takes = C.load_takes()
    lower, upper = rt.lower, rt.upper
    ref = C.real_reference(takes[C.DEMO_TAKE], rt)
    steps = len(ref) - 1
    pad = np.concatenate([ref, np.repeat(ref[-1:], C.LOOKAHEAD + 1, axis=0)], axis=0)
    # The same test for both hands: a wrong starting pose, then two pushes at fixed times.
    rng = np.random.default_rng(a.seed)
    q0 = rng.uniform(lower, upper, size=(1, C.N_J))
    pushes = np.zeros((1, steps, C.N_J))
    events = [(int(4.0 / C.DT), int(0.35 / C.DT), {3: 1.3, 4: 1.2}), (int(8.5 / C.DT), int(0.35 / C.DT), {5: -1.3, 1: 1.2, 2: -1.0})]
    for s, dur, tq in events:
        for j, v in tq.items():
            pushes[0, s : s + dur, j] = v
    hand = Hand(1)
    traj = {}
    for name, pol in (("policy", policy), ("replay", None)):
        rec: list = []
        run(hand, pol, pad, pad, q0, pushes, steps, lower, upper, record=rec)
        traj[name] = np.stack(rec)
    err = {k: np.degrees(np.sqrt(((v - ref[1 : steps + 1]) ** 2).mean(axis=1))) for k, v in traj.items()}

    xml, order = build_xml(ghost=True)
    model = mujoco.MjModel.from_xml_string(xml)
    data = mujoco.MjData(model)
    qadr = np.array([model.joint(j).qposadr[0] for j in order])
    gadr = np.array([model.joint("ghost_" + j).qposadr[0] for j in order])
    link_of = [model.joint(j).bodyid[0] for j in order]
    geom_of = [[g for g in range(model.ngeom) if model.geom_bodyid[g] == b] for b in link_of]
    base_rgba = model.geom_rgba.copy()
    W = H = 544
    renderer = mujoco.Renderer(model, H, W)
    cam = mujoco.MjvCamera()
    cam.lookat[:] = [0.075, 0.035, 0.25]
    cam.distance, cam.azimuth, cam.elevation = a.distance, a.azimuth, a.elevation

    def font(size: int):
        for p in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
        return ImageFont.load_default()

    f_big, f_small = font(22), font(16)

    def frame(name: str, t: int) -> Image.Image:
        data.qpos[qadr] = traj[name][t]
        data.qpos[gadr] = ref[t + 1]
        model.geom_rgba[:] = base_rgba
        pushed = np.nonzero(pushes[0, t])[0]
        for j in pushed:
            for g in geom_of[j]:
                model.geom_rgba[g] = [0.80, 0.22, 0.12, 1.0]
        mujoco.mj_forward(model, data)
        renderer.update_scene(data, camera=cam)
        img = Image.fromarray(renderer.render()).convert("RGBA")
        d = ImageDraw.Draw(img, "RGBA")
        d.rectangle((0, 0, W, 66), fill=(246, 238, 222, 215))
        d.rectangle((0, H - 70, W, H), fill=(246, 238, 222, 215))
        title = "Policy (reads the hand, sends its own commands)" if name == "policy" else "Plain replay (recorded targets, sent as they are)"
        d.text((14, 10), title, fill=(40, 28, 18), font=f_small)
        d.text((14, 34), f"error now {err[name][t]:4.1f} deg", fill=(40, 28, 18), font=f_big)
        if len(pushed):
            d.text((14, H - 62), "PUSH", fill=(190, 50, 25), font=f_big)
        elif t < 30:
            d.text((14, H - 62), "wrong start pose", fill=(190, 50, 25), font=f_big)
        d.text((14, H - 30), f"t = {t * C.DT:4.1f} s   gold: the expert's take (held out)", fill=(40, 28, 18), font=f_small)
        return img.convert("RGB")

    out = C.OUT / "policy_demo.mp4"
    with imageio.get_writer(out, fps=25, codec="libx264", quality=7, macro_block_size=16) as w:
        for t in range(0, steps, 2):
            both = Image.new("RGB", (2 * W, H))
            both.paste(frame("replay", t), (0, 0))
            both.paste(frame("policy", t), (W, 0))
            w.append_data(np.asarray(both))
    summary = {"take": C.DEMO_TAKE, "seconds": round(steps * C.DT, 1), "start": "random pose inside the joint limits",
               "pushes": [{"at_s": s * C.DT, "for_s": dur * C.DT, "torque_nm_by_joint": {order[j]: v for j, v in tq.items()}} for s, dur, tq in events],
               "rms_deg": {k: round(float(np.sqrt((v**2).mean())), 2) for k, v in err.items()},
               "file": str(out.relative_to(C.LANE)), "bytes": out.stat().st_size, "engine": f"MuJoCo {mujoco.__version__}"}
    (C.OUT / "video.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(json.dumps(summary, indent=1))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("eval")
    e.add_argument("--rollouts", type=int, default=40)
    e.add_argument("--seed", type=int, default=0)
    e.add_argument("--policy", default="policy.pt", help="a file in out/")
    e.add_argument("--tag", default="")
    v = sub.add_parser("video")
    v.add_argument("--seed", type=int, default=3)
    v.add_argument("--distance", type=float, default=0.42)
    v.add_argument("--azimuth", type=float, default=115.0)
    v.add_argument("--elevation", type=float, default=-40.0)
    a = ap.parse_args()
    torch.set_num_threads(2)
    return evaluate(a) if a.cmd == "eval" else video(a)


if __name__ == "__main__":
    raise SystemExit(main())
