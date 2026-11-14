"""ASL fingerspelling letter recogniser on the core's 18 calibrated angles.

Knowledge source: our own generator only. Each letter's target is the
shadows lane's ``fs_<letter>`` curl spec (backend/app/data/moves.json),
played on the core's synthetic hand (core.hand.synth_hand). Training
examples are that target pushed through a model of a real wearer:

1. pose variation: each finger curl moves by N(0, CURL_SD), the fan by
   N(0, SPREAD_FAN_SD) degrees;
2. a wearer: the flat angle and flat-to-fist span of one real calibration
   record in backend/data/calibrations (only records that hold a usable
   range, see ``wearer_records``), so raw = flat + target / full * span;
3. sensor noise on raw angles, per finger (SENSOR_SD, from the STATUS.md
   time-aligned left against right medians);
4. the core's own calibration (core.calibration.HandCalibration.apply)
   built from a re-measured flat and fist (CAL_FLAT_SD, CAL_FIST_SD), so
   the clip at flat and fist and the gain cap act as on the real gloves.

Nothing from logs/live is used: the real captures are the test set.

J and Z are motion letters: they are excluded from the classes. A J
reads as its handshape, I; a Z reads as its own pointing shape's nearest
static letter. Their motion is the move-step scorer's job (DTW), not this
model's. Letters whose targets are identical in the 18 angles (the wrist
turn of P and Q is not in them, H/U/V differ only in spread or wrist) are
merged into one class such as "H/U/V", and the merge is reported.

The model is a linear discriminant (one shared covariance, a mean per
class): 18 x 18 numbers plus 18 per class, saved as JSON.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .. import hand as H
from ..calibration import FLEX_SLOTS, HandCalibration, _phase_present, triples_to_angles

ROOT = Path(__file__).resolve().parents[2]
MOVES_FILE = ROOT / "backend" / "app" / "data" / "moves.json"
CAL_DIR_DEFAULT = Path("/Users/arpanpandey/Code/Junction/repo/backend/data/calibrations")
MODEL_FILE = Path(__file__).resolve().parent / "models" / "asl_lda.json"
DATA_DIR = Path(__file__).resolve().parent / "data"

MOTION_LETTERS = ("j", "z")
CURL_SD = 0.08
SPREAD_FAN_SD = 3.0
# Per finger raw-angle sensor noise, degrees: STATUS.md time-aligned raw
# medians (thumb 3 to 7, index 5 to 18, middle 4 to 19, ring 6 to 21,
# little 5 to 19) are differences of two hands, so one hand's sd is about
# median / (0.674 * sqrt 2). Typical medians give these.
SENSOR_SD = {"thumb": 4.0, "index": 6.0, "middle": 7.0, "ring": 14.0, "little": 8.0}
SPREAD_SD = 4.0
SPREAD_OFFSET_SD = 4.0
CAL_FLAT_SD = 3.0
CAL_FIST_SD = 6.0
MIN_RANGE_DEG = 2.9
MAX_GAIN = 2.0
FULL = 90.0
FULL_THUMB = 60.0


def full_vec() -> np.ndarray:
    full = np.zeros(H.N_ANGLES)
    for f in H.FINGERS:
        full[H.FLEXION_SLOTS[f]] = FULL_THUMB if f == "thumb" else FULL
    return full


def letter_curls(moves_file: Path = MOVES_FILE) -> dict[str, dict[str, float]]:
    """Static handshape curls per letter from the fs_ moves. Motion letters excluded."""
    data = json.loads(moves_file.read_text(encoding="utf-8"))
    moves = data if isinstance(data, list) else data.get("moves", data)
    out: dict[str, dict[str, float]] = {}
    for m in moves:
        mid = str(m.get("id", ""))
        if not mid.startswith("fs_") or len(mid) != 4:
            continue
        letter = mid[3]
        if letter in MOTION_LETTERS:
            continue
        motion = m["default_motion"]
        pose = motion.get("pose") or motion["keys"][0]["pose"]
        out[letter] = {f: float(pose.get(f, 0.0)) for f in H.FINGERS}
    return dict(sorted(out.items()))


def target_angles(curl: dict[str, float], spread_deg: float = 0.0) -> np.ndarray:
    return H.synth_hand("right", curl=curl, spread_deg=spread_deg).angles.copy()


def letter_groups(curls: dict[str, dict[str, float]], tol_deg: float = 0.5) -> list[list[str]]:
    """Letters whose 18-angle targets are the same, merged in alphabet order."""
    groups: list[list[str]] = []
    reps: list[np.ndarray] = []
    for letter, c in curls.items():
        a = target_angles(c)
        for g, r in zip(groups, reps):
            if np.max(np.abs(a - r)) < tol_deg:
                g.append(letter)
                break
        else:
            groups.append([letter])
            reps.append(a)
    return groups


@dataclass
class Wearer:
    record_id: str
    side: str
    created_at: str
    flat: np.ndarray  # (18,) degrees, spread slots 0
    span: np.ndarray  # (18,) degrees, spread slots 0


def wearer_records(cal_dir: Path = CAL_DIR_DEFAULT) -> list[Wearer]:
    """Real calibration records with a usable range on the four long fingers.

    Kept: both phases present, the three joints of a finger not all equal
    (records with one number per finger are a different, older capture
    path), and a median long-finger span of at least 30 degrees. Records
    with zero or negative spans (a fist taken before the flat, or a loose
    glove) are dropped; STATUS.md describes those captures.
    """
    out = []
    for p in sorted(cal_dir.glob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        if not (_phase_present(d.get("flat")) and _phase_present(d.get("fist"))):
            continue
        flat = triples_to_angles(d["flat"])
        fist = triples_to_angles(d["fist"])
        long_slots = [s for f in ("index", "middle", "ring", "little") for s in H.FLEXION_SLOTS[f]]
        if all(len(set(np.round(flat[H.FLEXION_SLOTS[f]], 3))) == 1 for f in ("index", "middle", "ring", "little")):
            continue
        span = fist - flat
        if np.median(span[long_slots]) < 30.0:
            continue
        out.append(Wearer(d["id"], d["side"], d["created_at"], flat, span))
    return out


def simulate(
    curl: dict[str, float],
    wearer: Wearer | None,
    rng: np.random.Generator,
    n: int,
) -> np.ndarray:
    """(n, 18) calibrated angles of a wearer holding this handshape.

    wearer None: an ideal glove (calibration is the identity), pose and
    sensor noise only.
    """
    full = full_vec()
    out = np.zeros((n, H.N_ANGLES))
    sd = np.zeros(H.N_ANGLES)
    for f in H.FINGERS:
        sd[H.FLEXION_SLOTS[f]] = SENSOR_SD[f]
    sd[list(H.SPREAD_SLOTS)] = SPREAD_SD
    spread_slots = list(H.SPREAD_SLOTS)
    for i in range(n):
        c = {f: float(np.clip(v + rng.normal(0, CURL_SD), 0.0, 1.0)) for f, v in curl.items()}
        a = target_angles(c, spread_deg=float(rng.normal(0, SPREAD_FAN_SD)))
        if wearer is None:
            raw = a + rng.normal(0, sd)
            raw[FLEX_SLOTS] = np.clip(raw[FLEX_SLOTS], 0.0, full[FLEX_SLOTS])
            out[i] = raw
            continue
        span_true = np.where(wearer.span > MIN_RANGE_DEG, wearer.span, 10.0)
        raw = a.copy()
        raw[FLEX_SLOTS] = wearer.flat[FLEX_SLOTS] + a[FLEX_SLOTS] / full[FLEX_SLOTS] * span_true[FLEX_SLOTS]
        raw[spread_slots] += rng.normal(0, SPREAD_OFFSET_SD)
        raw = raw + rng.normal(0, sd)
        flat_m = wearer.flat + rng.normal(0, CAL_FLAT_SD, H.N_ANGLES)
        fist_m = wearer.flat + wearer.span + rng.normal(0, CAL_FIST_SD, H.N_ANGLES)
        cal = HandCalibration(
            side=wearer.side,
            flat=flat_m,
            fist=fist_m,
            full=full,
            min_range_deg=MIN_RANGE_DEG,
            lo=0.0,
            hi=1.0,
            max_gain=MAX_GAIN,
        )
        out[i] = cal.apply(raw)
    return out


@dataclass
class Dataset:
    X: np.ndarray  # (N, 18)
    y: np.ndarray  # (N,) class index
    letter: np.ndarray  # (N,) letter string
    source: np.ndarray  # (N,) provenance tag per example
    classes: list[str]  # class names, e.g. "a", "h/u/v"


def build_dataset(
    wearers: list[Wearer],
    n_per: int,
    seed: int,
    include_ideal: bool = True,
    curls: dict[str, dict[str, float]] | None = None,
) -> Dataset:
    curls = curls or letter_curls()
    groups = letter_groups(curls)
    classes = ["/".join(g) for g in groups]
    cls_of = {letter: k for k, g in enumerate(groups) for letter in g}
    rng = np.random.default_rng(seed)
    xs, ys, ls, ss = [], [], [], []
    pool: list[Wearer | None] = list(wearers) + ([None] if include_ideal else [])
    for letter, c in curls.items():
        for w in pool:
            k = max(1, n_per // len(pool))
            xs.append(simulate(c, w, rng, k))
            ys += [cls_of[letter]] * k
            ls += [letter] * k
            tag = f"generator:core.priors.asl.simulate:fs_{letter}:" + (
                f"calibration:{w.record_id}" if w else "calibration:ideal"
            )
            ss += [tag] * k
    return Dataset(np.vstack(xs), np.array(ys), np.array(ls), np.array(ss), classes)


@dataclass
class LetterModel:
    classes: list[str]
    means: np.ndarray  # (K, 18)
    prec: np.ndarray  # (18, 18) shared precision
    log_prior: np.ndarray  # (K,)

    @classmethod
    def fit(cls, ds: Dataset, ridge: float = 4.0) -> LetterModel:
        K = len(ds.classes)
        means = np.stack([ds.X[ds.y == k].mean(axis=0) for k in range(K)])
        resid = ds.X - means[ds.y]
        cov = resid.T @ resid / max(1, len(ds.X) - K) + ridge * np.eye(H.N_ANGLES)
        prior = np.bincount(ds.y, minlength=K) / len(ds.y)
        return cls(ds.classes, means, np.linalg.inv(cov), np.log(prior))

    def log_scores(self, X: np.ndarray) -> np.ndarray:
        X = np.atleast_2d(X)
        a = X @ self.prec @ self.means.T
        b = 0.5 * np.einsum("kd,de,ke->k", self.means, self.prec, self.means)
        return a - b + self.log_prior

    def proba(self, X: np.ndarray) -> np.ndarray:
        s = self.log_scores(X)
        s = s - s.max(axis=1, keepdims=True)
        e = np.exp(s)
        return e / e.sum(axis=1, keepdims=True)

    def predict(self, X: np.ndarray) -> np.ndarray:
        return np.argmax(self.log_scores(X), axis=1)

    def top2(self, angles: np.ndarray) -> list[tuple[str, float]]:
        p = self.proba(np.asarray(angles, dtype=float))[0]
        idx = np.argsort(p)[::-1][:2]
        return [(self.classes[i], round(float(p[i]), 3)) for i in idx]

    def class_of_letter(self, letter: str) -> int | None:
        for k, c in enumerate(self.classes):
            if letter.lower() in c.split("/"):
                return k
        return None

    def to_json(self) -> dict:
        return {
            "kind": "lda",
            "classes": self.classes,
            "means": np.round(self.means, 4).tolist(),
            "prec": np.round(self.prec, 8).tolist(),
            "log_prior": np.round(self.log_prior, 6).tolist(),
            "features": H.ANGLE_NAMES,
            "excluded": list(MOTION_LETTERS),
        }

    @classmethod
    def from_json(cls, d: dict) -> LetterModel:
        return cls(d["classes"], np.array(d["means"]), np.array(d["prec"]), np.array(d["log_prior"]))

    def save(self, path: Path = MODEL_FILE, extra: dict | None = None) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({**self.to_json(), **(extra or {})}, indent=1) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: Path = MODEL_FILE) -> LetterModel:
        return cls.from_json(json.loads(path.read_text(encoding="utf-8")))


def confusion(model: LetterModel, ds: Dataset) -> np.ndarray:
    K = len(model.classes)
    m = np.zeros((K, K), dtype=int)
    for t, p in zip(ds.y, model.predict(ds.X)):
        m[t, p] += 1
    return m


def split_wearers(wearers: list[Wearer]) -> tuple[list[Wearer], list[Wearer]]:
    """Hold out whole calibration sessions: records taken in the same minute are one session.

    The test wearers are the session taken last; the rest train.
    """
    sessions: dict[str, list[Wearer]] = {}
    for w in wearers:
        sessions.setdefault(w.created_at[:16], []).append(w)
    keys = sorted(sessions)
    test = sessions[keys[-1]] if len(keys) > 1 else []
    train = [w for k in keys[:-1] for w in sessions[k]] if len(keys) > 1 else list(wearers)
    return train, test
