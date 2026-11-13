"""Lessons on disk: lesson.json (people read it) and trace.npz (the scorer reads it)."""
from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from . import geom
from . import hand as H

LESSON_SCHEMA = "geppetto.lesson/1"


@dataclass
class Step:
    index: int
    name: str
    kind: str                       # hold | move
    t0_us: int
    t1_us: int
    key_t_us: int
    key_angles: np.ndarray          # (18,)
    key_joints: np.ndarray          # (26, 3) wrist frame (see DECISIONS D13)
    key_wrist_q: np.ndarray         # (4,) world orientation at the key moment
    weights: dict[str, float]
    hold_ms: int
    note: str | None = None
    frame: str | None = None
    named_by: str = "auto"

    @property
    def duration_us(self) -> int:
        return max(0, self.t1_us - self.t0_us)

    def to_json(self) -> dict:
        return {
            "index": self.index, "name": self.name, "note": self.note, "kind": self.kind,
            "t0_us": int(self.t0_us), "t1_us": int(self.t1_us), "key_t_us": int(self.key_t_us),
            "key_angles": [round(float(x), 2) for x in self.key_angles],
            "key_joints": np.round(self.key_joints, 4).tolist(),
            "key_wrist_q": [round(float(x), 5) for x in self.key_wrist_q],
            "weights": {f: float(self.weights.get(f, 1.0)) for f in H.FINGERS},
            "hold_ms": int(self.hold_ms), "frame": self.frame, "named_by": self.named_by,
        }

    @classmethod
    def from_json(cls, d: dict) -> "Step":
        return cls(
            index=d["index"], name=d["name"], note=d.get("note"), kind=d["kind"],
            t0_us=d["t0_us"], t1_us=d["t1_us"], key_t_us=d["key_t_us"],
            key_angles=np.asarray(d["key_angles"], dtype=float),
            key_joints=np.asarray(d["key_joints"], dtype=float),
            key_wrist_q=np.asarray(d.get("key_wrist_q", geom.IDENTITY_Q), dtype=float),
            weights=dict(d["weights"]), hold_ms=d["hold_ms"], frame=d.get("frame"),
            named_by=d.get("named_by", "auto"),
        )


@dataclass
class Trace:
    t_us: np.ndarray        # (N,) int64, since recording start
    angles: np.ndarray      # (N, 18) float32
    joints: np.ndarray      # (N, 26, 3) float32 wrist-relative, xr_base
    wrist_p: np.ndarray     # (N, 3) float32, NaN when the camera had no fix
    wrist_q: np.ndarray     # (N, 4) float32
    step: np.ndarray        # (N,) int16
    _local: np.ndarray | None = field(default=None, repr=False)

    def __len__(self) -> int:
        return int(self.t_us.shape[0])

    def joints_local(self) -> np.ndarray:
        """Wrist-frame joints, computed once from joints and wrist_q."""
        if self._local is None:
            out = np.empty_like(self.joints, dtype=float)
            for i in range(len(self)):
                out[i] = geom.rotate_inv(self.wrist_q[i], self.joints[i])
            self._local = out
        return self._local

    def index_at(self, t_us: int) -> int:
        """Index of the sample at or just before t_us, clamped."""
        i = int(np.searchsorted(self.t_us, t_us, side="right")) - 1
        return int(np.clip(i, 0, len(self) - 1))

    def window(self, t0_us: int, t1_us: int) -> slice:
        a = int(np.searchsorted(self.t_us, t0_us, side="left"))
        b = int(np.searchsorted(self.t_us, t1_us, side="right"))
        return slice(a, max(b, a + 1))

    def save(self, path: Path) -> None:
        np.savez_compressed(path, t_us=self.t_us.astype(np.int64), angles=self.angles.astype(np.float32),
                            joints=self.joints.astype(np.float32), wrist_p=self.wrist_p.astype(np.float32),
                            wrist_q=self.wrist_q.astype(np.float32), step=self.step.astype(np.int16))

    @classmethod
    def load(cls, path: Path) -> "Trace":
        z = np.load(path)
        return cls(t_us=z["t_us"].astype(np.int64), angles=z["angles"].astype(float), joints=z["joints"].astype(float),
                   wrist_p=z["wrist_p"].astype(float), wrist_q=z["wrist_q"].astype(float), step=z["step"].astype(int))


@dataclass
class Lesson:
    id: str
    title: str
    task: str
    task_config: dict
    created: str
    master_name: str
    master_hand: str
    source: str
    rate_hz: float
    duration_us: int
    steps: list[Step]
    trace: Trace | None = None
    dir: Path | None = None

    def to_json(self) -> dict:
        return {
            "schema": LESSON_SCHEMA, "id": self.id, "title": self.title, "task": self.task,
            "task_config": self.task_config, "created": self.created,
            "master": {"name": self.master_name, "hand": self.master_hand},
            "source": self.source, "rate_hz": float(self.rate_hz), "duration_us": int(self.duration_us),
            "steps": [s.to_json() for s in self.steps],
        }

    def summary(self) -> dict:
        return {"id": self.id, "title": self.title, "task": self.task, "created": self.created,
                "steps_total": len(self.steps), "source": self.source, "duration_us": int(self.duration_us)}

    @classmethod
    def from_json(cls, d: dict, trace: Trace | None = None, dir: Path | None = None) -> "Lesson":
        return cls(id=d["id"], title=d["title"], task=d["task"], task_config=d.get("task_config", {}),
                   created=d["created"], master_name=d["master"]["name"], master_hand=d["master"]["hand"],
                   source=d["source"], rate_hz=d["rate_hz"], duration_us=d["duration_us"],
                   steps=[Step.from_json(s) for s in d["steps"]], trace=trace, dir=dir)

    def save(self, lessons_dir: Path, keyframes: bool = True) -> Path:
        d = Path(lessons_dir) / self.id
        d.mkdir(parents=True, exist_ok=True)
        (d / "frames").mkdir(exist_ok=True)
        if keyframes:
            for s in self.steps:
                if s.frame is None:
                    try:
                        render_keyframe(s, self.master_hand, d / "frames" / f"step_{s.index:02d}.jpg")
                        s.frame = f"frames/step_{s.index:02d}.jpg"
                    except Exception as e:   # a missing OpenCV must never block a save
                        import logging
                        logging.getLogger("geppetto.recorder").warning("keyframe not rendered: %s", e)
        (d / "lesson.json").write_text(json.dumps(self.to_json(), indent=2))
        if self.trace is not None:
            self.trace.save(d / "trace.npz")
        self.dir = d
        return d

    @classmethod
    def load(cls, lesson_dir: Path, with_trace: bool = True) -> "Lesson":
        lesson_dir = Path(lesson_dir)
        d = json.loads((lesson_dir / "lesson.json").read_text())
        trace = None
        tp = lesson_dir / "trace.npz"
        if with_trace and tp.exists():
            trace = Trace.load(tp)
        return cls.from_json(d, trace=trace, dir=lesson_dir)

    # Reference lookups used by the scorer and the ghost.
    def angles_at(self, t_us: int) -> np.ndarray:
        if self.trace is None:
            raise ValueError("lesson has no trace")
        return self.trace.angles[self.trace.index_at(t_us)]

    def joints_local_at(self, t_us: int) -> np.ndarray:
        if self.trace is None:
            raise ValueError("lesson has no trace")
        return self.trace.joints_local()[self.trace.index_at(t_us)]

    def wrist_at(self, t_us: int) -> tuple[np.ndarray, np.ndarray]:
        if self.trace is None:
            raise ValueError("lesson has no trace")
        i = self.trace.index_at(t_us)
        return self.trace.wrist_p[i], self.trace.wrist_q[i]


def list_lessons(lessons_dir: Path) -> list[dict]:
    out = []
    lessons_dir = Path(lessons_dir)
    if not lessons_dir.exists():
        return out
    for d in sorted(lessons_dir.iterdir()):
        f = d / "lesson.json"
        if f.exists():
            try:
                out.append(Lesson.from_json(json.loads(f.read_text())).summary())
            except Exception as e:  # a broken folder must not take the server down
                out.append({"id": d.name, "title": f"(unreadable: {e})", "task": "general", "created": "",
                            "steps_total": 0, "source": "glove", "duration_us": 0})
    return out


def delete_lesson(lessons_dir: Path, lesson_id: str) -> bool:
    d = Path(lessons_dir) / lesson_id
    if not (d / "lesson.json").exists():
        return False
    shutil.rmtree(d)
    return True


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:40] or "lesson"


def make_lesson_id(title: str, now: datetime | None = None) -> str:
    now = now or datetime.now().astimezone()
    return f"{now.strftime('%Y%m%d-%H%M')}-{slugify(title)}"


# ---------------------------------------------------------------------------
# Recording
# ---------------------------------------------------------------------------

class Recorder:
    """Collects master samples, then cuts them into steps and writes a Lesson."""

    def __init__(self, record_cfg, hold_ms_default: int) -> None:
        self.cfg = record_cfg
        self.hold_ms_default = int(hold_ms_default)
        self.active = False
        self.title = ""
        self.task = "general"
        self.task_config: dict = {}
        self.master_hand = "right"
        self.master_name = "master"
        self.source = "glove"
        self.t_start_us = 0
        self._t: list[int] = []
        self._angles: list[np.ndarray] = []
        self._joints: list[np.ndarray] = []
        self._wp: list[np.ndarray] = []
        self._wq: list[np.ndarray] = []
        self._marks: list[int] = []

    def start(self, t_us: int, title: str, task: str, task_config: dict, master_hand: str,
              source: str = "glove", master_name: str = "master") -> None:
        self.__init__(self.cfg, self.hold_ms_default)
        self.active = True
        self.title = title or "Untitled"
        self.task, self.task_config = task, dict(task_config or {})
        self.master_hand, self.source, self.master_name = master_hand, source, master_name
        self.t_start_us = int(t_us)

    def add(self, h: H.HandState) -> None:
        if not self.active:
            return
        t = int(h.t_us) - self.t_start_us
        if self._t and t <= self._t[-1]:
            return
        self._t.append(t)
        self._angles.append(np.asarray(h.angles, dtype=float).copy())
        self._joints.append(np.asarray(h.joints_xr_base(), dtype=float))
        self._wp.append(np.asarray(h.wrist_p, dtype=float).copy() if h.anchor != "rest" else np.full(3, np.nan))
        self._wq.append(np.asarray(h.wrist_q, dtype=float).copy())

    def mark(self, t_us: int) -> int:
        """End the current step here. Returns the index of the step just ended."""
        t = int(t_us) - self.t_start_us
        if not self._marks or t > self._marks[-1]:
            self._marks.append(t)
        return len(self._marks) - 1

    @property
    def n_samples(self) -> int:
        return len(self._t)

    def stop(self, t_us: int, save: bool, lesson_id: str | None = None) -> Lesson | None:
        self.active = False
        if not save or len(self._t) < 2:
            return None
        t = np.asarray(self._t, dtype=np.int64)
        trace = Trace(t_us=t, angles=np.stack(self._angles), joints=np.stack(self._joints),
                      wrist_p=np.stack(self._wp), wrist_q=np.stack(self._wq), step=np.zeros(len(t), dtype=np.int16))
        bounds = self._boundaries(trace)
        steps = []
        hold_ms = int(self.task_config.get("hold_ms", self.hold_ms_default))
        static = static_finger_weights(trace.angles, self.cfg.static_finger_deg, self.cfg.static_finger_weight,
                                       self.cfg.default_weights)
        for i, (a, b) in enumerate(bounds):
            steps.append(build_step(trace, i, a, b, self.cfg, hold_ms, static))
            trace.step[trace.window(a, b)] = i
        names = step_names_for_task(self.task, self.task_config, len(steps))
        for s, n in zip(steps, names):
            s.name = n
        created = datetime.now().astimezone()
        lesson = Lesson(
            id=lesson_id or make_lesson_id(self.title, created), title=self.title, task=self.task,
            task_config=self.task_config, created=created.isoformat(timespec="seconds"),
            master_name=self.master_name, master_hand=self.master_hand, source=self.source,
            rate_hz=float(self.cfg.rate_hz), duration_us=int(t[-1]), steps=steps, trace=trace,
        )
        return lesson

    def _boundaries(self, trace: Trace) -> list[tuple[int, int]]:
        end = int(trace.t_us[-1])
        marks = [m for m in self._marks if 0 < m < end]
        if marks:
            edges = [0] + marks + [end]
        else:
            edges = auto_boundaries(trace, self.cfg)
        return [(edges[i], edges[i + 1]) for i in range(len(edges) - 1) if edges[i + 1] > edges[i]]


def angular_speed(trace: Trace) -> np.ndarray:
    """Max over the 18 slots of |d angle / dt| in deg/s, one value per sample."""
    n = len(trace)
    if n < 2:
        return np.zeros(n)
    dt = np.diff(trace.t_us).astype(float) / 1e6
    dt = np.maximum(dt, 1e-4)
    da = np.abs(np.diff(trace.angles, axis=0)).max(axis=1)
    speed = np.concatenate([[0.0], da / dt])
    # light smoothing over 3 samples so one noisy sample does not break a still region
    if n >= 3:
        speed = np.convolve(speed, np.ones(3) / 3, mode="same")
    return speed


def still_regions(trace: Trace, still_deg_s: float, min_ms: float) -> list[tuple[int, int]]:
    """(start_idx, end_idx) of regions where all angles move slower than still_deg_s for >= min_ms."""
    speed = angular_speed(trace)
    still = speed < still_deg_s
    regions = []
    i, n = 0, len(trace)
    while i < n:
        if still[i]:
            j = i
            while j + 1 < n and still[j + 1]:
                j += 1
            if trace.t_us[j] - trace.t_us[i] >= min_ms * 1000:
                regions.append((i, j))
            i = j + 1
        else:
            i += 1
    return regions


def auto_boundaries(trace: Trace, cfg) -> list[int]:
    """Cut between consecutive still regions, halfway through the motion between them."""
    end = int(trace.t_us[-1])
    regions = still_regions(trace, cfg.still_deg_s, cfg.still_min_ms)
    if len(regions) < 2:
        return [0, end]
    edges = [0]
    for (a0, a1), (b0, b1) in zip(regions, regions[1:]):
        cut = int((trace.t_us[a1] + trace.t_us[b0]) // 2)
        if cut > edges[-1]:
            edges.append(cut)
    edges.append(end)
    return edges


def static_finger_weights(angles: np.ndarray, static_deg: float, static_weight: float, defaults) -> dict[str, float]:
    out = {}
    for f in H.FINGERS:
        slots = H.FLEXION_SLOTS[f]
        rng = float(np.ptp(angles[:, slots], axis=0).max()) if len(angles) else 0.0
        base = float(defaults.get(f, 1.0)) if isinstance(defaults, dict) else 1.0
        out[f] = base * (float(static_weight) if rng < static_deg else 1.0)
    return out


def stillest_window(trace: Trace, a_us: int, b_us: int, window_ms: float) -> tuple[int, int]:
    """Indices (i0, i1) of the stillest `window_ms` inside [a_us, b_us]."""
    sl = trace.window(a_us, b_us)
    idx = np.arange(sl.start, sl.stop)
    if len(idx) == 0:
        i = trace.index_at(a_us)
        return i, i
    speed = angular_speed(trace)[sl]
    w_us = window_ms * 1000
    best, best_cost = (idx[0], idx[0]), np.inf
    t = trace.t_us[sl]
    j = 0
    cum = np.concatenate([[0.0], np.cumsum(speed)])
    for i in range(len(idx)):
        while j < len(idx) - 1 and t[j] - t[i] < w_us:
            j += 1
        cost = (cum[j + 1] - cum[i]) / max(1, j + 1 - i)
        if cost < best_cost:
            best_cost, best = cost, (idx[i], idx[j])
    return best


def build_step(trace: Trace, index: int, a_us: int, b_us: int, cfg, hold_ms: int, weights: dict) -> Step:
    i0, i1 = stillest_window(trace, a_us, b_us, cfg.key_window_ms)
    key_angles = trace.angles[i0:i1 + 1].mean(axis=0)
    ic = (i0 + i1) // 2
    sl = trace.window(a_us, b_us)
    speed = angular_speed(trace)[sl]
    still_frac = float(np.mean(speed < cfg.still_deg_s)) if len(speed) else 1.0
    kind = "hold" if still_frac >= cfg.hold_fraction else "move"
    return Step(
        index=index, name=f"Step {index + 1}", kind=kind, t0_us=int(a_us), t1_us=int(b_us),
        key_t_us=int(trace.t_us[ic]), key_angles=key_angles, key_joints=trace.joints_local()[ic],
        key_wrist_q=trace.wrist_q[ic], weights=dict(weights), hold_ms=int(hold_ms), named_by="auto",
    )


def step_names_for_task(task: str, task_config: dict, n: int) -> list[str]:
    names = [f"Step {i + 1}" for i in range(n)]
    if task == "chords":
        chords = list(task_config.get("chords", []))
        for i in range(min(n, len(chords))):
            names[i] = str(chords[i])
    return names


def digest_step(step: Step) -> dict:
    """Words, not numbers: what a coach model would get about a step."""
    curl = H.curl_from_angles(step.key_angles, 90.0, 60.0)
    words = {}
    for f, c in curl.items():
        words[f] = "straight" if c < 0.25 else "half bent" if c < 0.6 else "curled"
    return {"index": step.index, "kind": step.kind, "duration_ms": step.duration_us // 1000,
            "pose": ", ".join(f"{f} {w}" for f, w in words.items())}


# ---------------------------------------------------------------------------
# Keyframe sketches for the codex (glove recordings have no camera image)
# ---------------------------------------------------------------------------

_CHAINS = [[1, 2, 3, 4, 5], [1, 6, 7, 8, 9, 10], [1, 11, 12, 13, 14, 15], [1, 16, 17, 18, 19, 20], [1, 21, 22, 23, 24, 25]]


def render_keyframe(step: Step, side: str, out: Path, size: int = 320) -> Path:
    """Draw the step's key pose (wrist frame) as a small sepia sketch: front view left, top view right."""
    import cv2
    img = np.full((size, size * 2, 3), (235, 240, 245), np.uint8)
    J = np.asarray(step.key_joints, dtype=float)
    scale = size * 2.2
    def view(top: bool):
        ox = size * (1.5 if top else 0.5)
        pts = []
        for p in J:
            x = ox + p[0] * scale
            y = (size * 0.5 + p[2] * scale) if top else (size * 0.65 - p[1] * scale)
            pts.append((int(round(x)), int(round(y))))
        for chain in _CHAINS:
            for a, b in zip(chain, chain[1:]):
                cv2.line(img, pts[a], pts[b], (60, 90, 140), 3, cv2.LINE_AA)
        for a, b in zip([1, 6, 11, 16, 21, 1], [6, 11, 16, 21, 1, 6]):
            cv2.line(img, pts[a], pts[b], (120, 140, 170), 2, cv2.LINE_AA)
        for i, p in enumerate(pts):
            cv2.circle(img, p, 5 if i == 1 else 3, (40, 60, 110), -1, cv2.LINE_AA)
    view(False)
    view(True)
    cv2.putText(img, f"{step.index + 1}. {step.name} ({side}, {step.kind})", (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (40, 50, 70), 1, cv2.LINE_AA)
    cv2.putText(img, "front", (10, size - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1, cv2.LINE_AA)
    cv2.putText(img, "top", (size + 10, size - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1, cv2.LINE_AA)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    return out
