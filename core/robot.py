"""Robot hand output: retarget the 18 angle features to a robot hand's joint targets.

The robot's joint names and limits come from URDF files named in config.toml
([robot]), never from code. Each robot joint is a weighted sum of angle
features plus an offset, in radians, clamped to the URDF limits. The config
table also says which human finger each joint belongs to, which gives the
per-finger fidelity score and the list of human fingers the robot lacks.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import hand as H

SOURCES = ["master", "learner", "lesson", "off"]


@dataclass(frozen=True)
class RobotJoint:
    name: str
    type: str
    lower: float
    upper: float
    axis: tuple[float, float, float]
    parent: str
    child: str

    @property
    def range(self) -> float:
        return max(1e-9, self.upper - self.lower)


@dataclass
class RobotModel:
    name: str
    path: Path
    joints: dict[str, RobotJoint] = field(default_factory=dict)

    @classmethod
    def from_urdf(cls, path: str | Path) -> "RobotModel":
        path = Path(path)
        root = ET.parse(path).getroot()
        model = cls(name=root.get("name", path.stem), path=path)
        for j in root.findall("joint"):
            jtype = j.get("type", "revolute")
            if jtype not in ("revolute", "prismatic", "continuous"):
                continue
            lim = j.find("limit")
            lower = float(lim.get("lower", "-3.14159")) if lim is not None else -np.pi
            upper = float(lim.get("upper", "3.14159")) if lim is not None else np.pi
            ax = j.find("axis")
            axis = tuple(float(x) for x in (ax.get("xyz", "0 0 1").split() if ax is not None else ("0", "0", "1")))
            parent = j.find("parent").get("link", "") if j.find("parent") is not None else ""
            child = j.find("child").get("link", "") if j.find("child") is not None else ""
            model.joints[j.get("name")] = RobotJoint(j.get("name"), jtype, lower, upper, axis, parent, child)
        if not model.joints:
            raise ValueError(f"{path}: no movable joints found")
        return model


@dataclass
class RetargetEntry:
    key: str
    finger: str
    offset_deg: float
    weights: dict[str, float]
    sign_left: float | None
    sign_right: float | None


@dataclass
class RobotTargets:
    model: str
    hand: str
    q: dict[str, float]
    q_norm: dict[str, float]
    fidelity: dict[str, float]
    missing: list[str]

    def to_message(self, source: str, angles_from: str) -> dict:
        return {
            "model": self.model, "source": source, "hand": self.hand, "angles_from": angles_from,
            "q": {k: round(float(v), 5) for k, v in self.q.items()},
            "q_norm": {k: round(float(v), 3) for k, v in self.q_norm.items()},
            "fidelity": {f: round(float(v), 3) for f, v in self.fidelity.items()},
            "missing": list(self.missing),
        }


class Retargeter:
    """Angle features (degrees) -> joint targets for the left or right robot hand."""

    def __init__(self, robot_cfg, root: Path | None = None) -> None:
        self.cfg = robot_cfg
        root = Path(root) if root else Path(".")
        self.models = {
            "left": RobotModel.from_urdf(root / robot_cfg.urdf_left),
            "right": RobotModel.from_urdf(root / robot_cfg.urdf_right),
        }
        self.model_name = str(robot_cfg.model)
        self.joint_name = str(robot_cfg.joint_name)
        self.entries: list[RetargetEntry] = []
        angle_index = {n: i for i, n in enumerate(H.ANGLE_NAMES)}
        for key, e in dict(robot_cfg.retarget).items():
            weights = {str(a): float(w) for a, w in dict(e.weights).items()}
            for a in weights:
                if a not in angle_index:
                    raise ValueError(f"[robot.retarget.{key}] unknown angle feature {a!r}; known: {H.ANGLE_NAMES}")
            finger = str(e.finger)
            if finger not in H.FINGERS:
                raise ValueError(f"[robot.retarget.{key}] finger must be one of {H.FINGERS}")
            self.entries.append(RetargetEntry(str(key), finger, float(e.get("offset_deg", 0.0)), weights,
                                              e.get("sign_left"), e.get("sign_right")))
        for side, model in self.models.items():
            for e in self.entries:
                name = self.joint_name.format(side=side, key=e.key)
                if name not in model.joints:
                    raise ValueError(f"joint {name!r} is not in {model.path.name}; it has {sorted(model.joints)}")
        self.fingers = sorted({e.finger for e in self.entries}, key=H.FINGERS.index)
        self.missing = [f for f in H.FINGERS if f not in self.fingers]
        self.human_dofs = {f: int(v) for f, v in dict(robot_cfg.human_dofs).items()}
        self._angle_index = angle_index

    def joint_names(self, side: str) -> list[str]:
        return [self.joint_name.format(side=side, key=e.key) for e in self.entries]

    @staticmethod
    def _auto_sign(j: RobotJoint) -> float:
        """The side of the limit range with the larger magnitude is the flexion direction."""
        return 1.0 if abs(j.upper) >= abs(j.lower) else -1.0

    def targets(self, angles: np.ndarray, side: str) -> RobotTargets:
        a = np.asarray(angles, dtype=float)
        model = self.models[side]
        q: dict[str, float] = {}
        qn: dict[str, float] = {}
        loss: dict[str, list[float]] = {f: [] for f in self.fingers}
        for e in self.entries:
            name = self.joint_name.format(side=side, key=e.key)
            j = model.joints[name]
            deg = e.offset_deg + sum(w * a[self._angle_index[an]] for an, w in e.weights.items())
            sign = e.sign_left if side == "left" else e.sign_right
            sign = self._auto_sign(j) if sign is None else float(sign)
            raw = sign * np.radians(deg)
            val = float(np.clip(raw, j.lower, j.upper))
            q[name] = val
            qn[name] = float((val - j.lower) / j.range)
            loss[e.finger].append(abs(raw - val) / j.range)
        fidelity = {}
        for f in self.fingers:
            n_robot = sum(1 for e in self.entries if e.finger == f)
            coverage = min(1.0, n_robot / max(1, self.human_dofs.get(f, 3)))
            clip = float(np.mean(loss[f])) if loss[f] else 0.0
            fidelity[f] = float(np.clip(coverage * (1.0 - clip), 0.0, 1.0))
        return RobotTargets(self.model_name, side, q, qn, fidelity, list(self.missing))

    def describe(self) -> dict:
        return {"model": self.model_name, "fingers": list(self.fingers), "missing": list(self.missing),
                "joints": {side: self.joint_names(side) for side in ("left", "right")},
                "limits": {side: {n: [self.models[side].joints[n].lower, self.models[side].joints[n].upper]
                                  for n in self.joint_names(side)} for side in ("left", "right")},
                "urdf": {side: str(self.models[side].path.name) for side in ("left", "right")}}
