"""Piano posture prior: expert joint ranges from FurElise, and the checker.

Knowledge source: FurElise (CC BY-NC 4.0), 3D hand joints of 15 elite
pianists from marker motion capture, with the key presses recorded by the
piano. Converted to the core's 18 angle features by core.hand.angle_features
(our own feature code) after mapping the dataset's 21 joints onto the 26
OpenXR joints (``furelise_to_openxr``).

Scale. The core scores calibrated angles: 0 is the wearer's flat hand and
90 (thumb 60) the wearer's fist. Motion capture gives anatomical angles.
``to_calibrated`` rescales each flexion joint by the normal active range
of motion (AAOS: finger MCP 90, PIP 100, DIP 70; thumb MCP 50, IP 80), so
an anatomical fist reads 90 (thumb 60), as the calibration makes it.
Spread angles are not calibrated in the core and are kept as they are.
That rescale is an assumption, not a measurement on our gloves.

Pressing. FurElise gives which of the 88 keys is down per frame, not
which hand pressed it. The left hand is taken as pressing when a key is
down within KEY_REACH keys of where the left hand sits, and where it sits
is a per-piece straight-line fit of the lowest held key against the
hand's position along the keyboard (``press_mask``). The fit's correlation
is reported per piece.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .. import hand as H
from ..scorer import finger_errors

RANGES_FILE = Path(__file__).resolve().parent / "models" / "piano_ranges.json"

# FurElise joint order: 0 wrist; thumb 1-4 (CMC, MCP, IP, tip); then index,
# middle, ring, little 5-8, 9-12, 13-16, 17-20 (MCP, PIP, DIP, tip).
FE_FINGER = {"index": 5, "middle": 9, "ring": 13, "little": 17}

# Normal active flexion range, degrees (American Academy of Orthopaedic
# Surgeons norms): finger MCP 90, PIP 100, DIP 70; thumb MCP 50, IP 80.
AAOS_FIST = np.array([50, 80] + [90, 100, 70] * 4 + [0, 0, 0, 0], dtype=float)
CAL_FULL = np.array([60, 60] + [90, 90, 90] * 4 + [0, 0, 0, 0], dtype=float)
KEY_REACH = 7  # keys either side of the hand's fitted centre
DOWNSAMPLE = 6  # 59.94 fps -> about 10 fps


def furelise_to_openxr(j21: np.ndarray) -> np.ndarray:
    """(..., 21, 3) FurElise joints to (..., 26, 3) in the core's OpenXR order.

    The four finger metacarpal joints are not in the dataset; they are put
    at the wrist, so the metacarpal bone runs wrist to knuckle, which is the
    direction the core's MCP angle uses. Palm is the wrist-to-middle-knuckle
    midpoint.
    """
    j = np.asarray(j21, dtype=float)
    out = np.zeros(j.shape[:-2] + (26, 3))
    wrist = j[..., 0, :]
    out[..., 1, :] = wrist
    out[..., 0, :] = 0.5 * (wrist + j[..., 9, :])
    for k in range(4):  # thumb metacarpal(CMC), proximal(MCP), distal(IP), tip
        out[..., 2 + k, :] = j[..., 1 + k, :]
    for f, b in FE_FINGER.items():
        base = H.FINGER_BASE[f]
        out[..., base, :] = wrist
        for k in range(4):
            out[..., base + 1 + k, :] = j[..., b + k, :]
    return out


def angles_of(j21: np.ndarray) -> np.ndarray:
    """(N, 21, 3) -> (N, 18) anatomical degrees with the core's angle_features."""
    xr = furelise_to_openxr(j21)
    return np.stack([H.angle_features(x) for x in xr])


def to_calibrated(anat: np.ndarray) -> np.ndarray:
    a = np.array(anat, dtype=float, copy=True)
    flex = CAL_FULL > 0
    a[..., flex] = a[..., flex] / AAOS_FIST[flex] * CAL_FULL[flex]
    return a


def keyboard_axis(j21: np.ndarray) -> int:
    """The world axis the wrist moves along most: along the keyboard."""
    return int(np.argmax(np.var(j21[:, 0, :], axis=0)))


def press_mask(j21: np.ndarray, pressed: np.ndarray) -> tuple[np.ndarray, float]:
    """(N,) bool: the left hand holds a key down; and the fit's correlation."""
    n = len(j21)
    # Some pieces store key presses at a multiple of the motion rate (piece
    # 000: twice): resample to the motion frames by nearest index.
    src = np.minimum(
        np.round(np.arange(n) * len(pressed) / n).astype(int), len(pressed) - 1
    )
    pressed = pressed[src]
    down = pressed > 0.5
    any_down = down.any(axis=1)
    if any_down.sum() < 50:
        return np.zeros(n, dtype=bool), float("nan")
    lowest = np.argmax(down, axis=1).astype(float)
    best = None
    for ax in range(3):  # the axis along the keyboard fits the lowest key best
        xs_, ks_ = j21[any_down, 9, ax], lowest[any_down]
        r_ = float(np.corrcoef(xs_, ks_)[0, 1])
        if np.isfinite(r_) and (best is None or abs(r_) > abs(best[1])):
            best = (ax, r_)
    ax, r = best if best else (keyboard_axis(j21), float("nan"))
    x = j21[:, 9, ax]  # middle knuckle
    xs, ks = x[any_down], lowest[any_down]
    beta, alpha = np.polyfit(xs, ks, 1)
    centre = alpha + beta * x
    keys = np.arange(pressed.shape[1])[None, :]
    near = np.abs(keys - centre[:, None]) <= KEY_REACH
    return (down & near).any(axis=1), r


@dataclass
class PieceFeatures:
    piece_id: str
    subject_id: int
    angles_cal: np.ndarray  # (M, 18) calibrated-scale degrees, downsampled
    pressing: np.ndarray  # (M,) bool
    fit_r: float
    bytes_read: int


def piece_features(
    piece_id: str, subject_id: int, j21: np.ndarray, pressed: np.ndarray, nbytes: int
) -> PieceFeatures:
    mask, r = press_mask(j21, pressed)
    n = len(mask)
    idx = np.arange(0, n, DOWNSAMPLE)
    good = np.isfinite(j21[idx]).all(axis=(1, 2))
    idx = idx[good]
    ang = to_calibrated(angles_of(j21[idx]))
    return PieceFeatures(piece_id, subject_id, ang, mask[idx], r, nbytes)


PCTS = (5, 25, 50, 75, 95)


def ranges_from(angles: np.ndarray) -> dict:
    q = np.percentile(angles, PCTS, axis=0)
    return {
        name: {f"p{p}": round(float(q[i, j]), 1) for i, p in enumerate(PCTS)}
        for j, name in enumerate(H.ANGLE_NAMES)
    }


def suggested_tolerances(angles: np.ndarray) -> dict:
    """Per finger: expert frames scored against the expert median posture with the scorer's finger_errors.

    Suggested perfect_deg is the median error, wrong_deg 1.5 times the 90th
    percentile: the rule STATUS.md uses for the glove slot.
    """
    med = np.median(angles, axis=0)
    errs = {f: [] for f in H.FINGERS}
    for a in angles:
        e, _, _ = finger_errors(a, med)
        for f in H.FINGERS:
            errs[f].append(e[f])
    out = {}
    for f in H.FINGERS:
        v = np.array(errs[f])
        out[f] = {
            "median_err": round(float(np.median(v)), 1),
            "p90_err": round(float(np.percentile(v, 90)), 1),
            "perfect_deg": round(float(np.median(v)), 1),
            "wrong_deg": round(float(1.5 * np.percentile(v, 90)), 1),
        }
    return out


# ---------------------------------------------------------------------------
# The checker
# ---------------------------------------------------------------------------

FINGER_WORD = {
    "thumb": "thumb",
    "index": "index",
    "middle": "middle",
    "ring": "ring",
    "little": "little",
}
JOINT_WORD = {
    "mcp": "knuckle",
    "pip": "middle joint",
    "dip": "end joint",
    "ip": "end joint",
}


def joint_phrase(name: str) -> str:
    if name.startswith("spread_"):
        a, b = name[len("spread_") :].split("_")
        return f"gap between {a} and {b}"
    f, j = name.split("_")
    return f"{FINGER_WORD[f]} {JOINT_WORD[j]}"


@dataclass
class PianoRanges:
    lo: np.ndarray  # (18,)
    hi: np.ndarray  # (18,)
    lo_press: np.ndarray | None
    hi_press: np.ndarray | None
    lo_free: np.ndarray | None
    hi_free: np.ndarray | None
    band: tuple[int, int]

    @classmethod
    def load(
        cls, path: Path = RANGES_FILE, band: tuple[int, int] = (5, 95)
    ) -> PianoRanges:
        d = json.loads(path.read_text(encoding="utf-8"))

        def pick(key: str) -> tuple[np.ndarray, np.ndarray] | tuple[None, None]:
            r = d.get(key)
            if not r:
                return None, None
            lo = np.array([r[n][f"p{band[0]}"] for n in H.ANGLE_NAMES])
            hi = np.array([r[n][f"p{band[1]}"] for n in H.ANGLE_NAMES])
            return lo, hi

        lo, hi = pick("all")
        lp, hp = pick("pressing")
        lf, hf = pick("not_pressing")
        return cls(lo, hi, lp, hp, lf, hf, band)

    def check(
        self,
        angles: np.ndarray,
        pressing: bool | None = None,
        slot_weights: np.ndarray | None = None,
    ) -> list[dict]:
        """Joints outside the expert band, worst first.

        Each item: joint (ANGLE_NAMES), value, lo, hi, by_deg (how far
        outside), direction: "flatter" or "more_curled" for flexion,
        "narrower" or "wider" for spread. slot_weights 0 skips a joint the
        calibration marked unusable.
        """
        lo, hi = self.lo, self.hi
        if pressing is True and self.lo_press is not None:
            lo, hi = self.lo_press, self.hi_press
        elif pressing is False and self.lo_free is not None:
            lo, hi = self.lo_free, self.hi_free
        a = np.asarray(angles, dtype=float)
        out = []
        for j, name in enumerate(H.ANGLE_NAMES):
            if slot_weights is not None and slot_weights[j] == 0:
                continue
            spread = name.startswith("spread_")
            if a[j] < lo[j]:
                d = "narrower" if spread else "flatter"
                by = lo[j] - a[j]
            elif a[j] > hi[j]:
                d = "wider" if spread else "more_curled"
                by = a[j] - hi[j]
            else:
                continue
            out.append(
                {
                    "joint": name,
                    "value": round(float(a[j]), 1),
                    "lo": round(float(lo[j]), 1),
                    "hi": round(float(hi[j]), 1),
                    "by_deg": round(float(by), 1),
                    "direction": d,
                }
            )
        out.sort(key=lambda x: -x["by_deg"])
        return out


def describe(item: dict) -> str:
    """'index knuckle flatter than the expert range (by 12 deg)'."""
    words = {
        "flatter": "flatter",
        "more_curled": "more curled",
        "narrower": "narrower",
        "wider": "wider",
    }
    return f"{joint_phrase(item['joint'])} {words[item['direction']]} than the expert range (by {item['by_deg']:.0f} deg)"
