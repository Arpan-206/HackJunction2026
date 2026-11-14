"""Per-wearer flat and fist calibration, read from the files Szymon's backend already stores.

Why: a flat hand does not read zero on the real gloves (index about 37 deg,
little 59 to 79, thumb about 70; STATUS.md), and the offsets differ per wearer
and per glove. Raw angles from two hands are not comparable. Each flexion angle
is therefore re-measured from the wearer's own flat pose and scaled by their
own flat-to-fist range:

    calibrated = clip((raw - flat) / (fist - flat), lo, hi) * full

`full` is the nominal flat-to-fist span (`[hand] curl_full_deg`, thumb
`curl_full_thumb_deg`), so calibrated angles stay in degrees and the scorer's
`perfect_deg` and `wrong_deg` keep their meaning: 0 is this wearer's flat,
`full` is this wearer's fist. Spread angles are left as they are (the backend
stores no spread range). A joint whose range is below `min_range_deg` is left
raw, so nothing divides by zero (the backend does the same).

There is no second calibration format. The backend writes, under its data dir
(`backend/data` by default, `DATA_DIR` in its settings):

- `calibrations/<id>.json`: `Calibration` (backend/app/schemas/records.py),
  `{id, side, flat: {finger: [a, b, c]}, fist: {...}, created_at}`, radians,
  from `POST /calibrations` (backend/app/services/calibration.py). A phase not
  yet captured is all zeros.
- `glove_calibrations/<id>.json`: `WearerCalibration`
  (backend/app/schemas/rig.py), `{id, wearer, created_at, neutral: [{side,
  offsets: {finger: [a, b, c]}, ...}], range_calibration_ids: {side: id},
  ...}`, from `/gloves/calibrate` (backend/app/services/rig/calibration.py).

The triples are this core's own angles as `core/compat.py` sends them on
`/ws/gloves` (route B carries them into the backend through
`tools/ingest_bridge.py`): thumb `[cmc stand-in, thumb_mcp, thumb_ip]`, every
other finger `[mcp, pip, dip]`. So the stored numbers map back onto the 18
angles exactly, and `compat.py` keeps sending raw angles (`angles_raw`) so a
new capture is never taken on already calibrated values.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import hand as H

log = logging.getLogger("geppetto.calibration")

# (finger, index in the backend triple, slot in the core's 18 angles)
TRIPLE_SLOTS: list[tuple[str, int, int]] = [("thumb", 1, 0), ("thumb", 2, 1)] + [
    (f, j, H.FLEXION_SLOTS[f][j])
    for f in ("index", "middle", "ring", "little")
    for j in range(3)
]
FLEX_SLOTS = np.array([s for _, _, s in TRIPLE_SLOTS])


def triples_to_angles(triples: dict) -> np.ndarray:
    """Backend `{finger: [a, b, c]}` radians to an (18,) degree vector; spread slots are 0."""
    out = np.zeros(H.N_ANGLES)
    for f, j, slot in TRIPLE_SLOTS:
        out[slot] = float(np.degrees(float(triples[f][j])))
    return out


def angles_to_triples(angles: np.ndarray, thumb_cmc_rad: float = 0.0) -> dict:
    """(18,) degrees to the backend `{finger: [a, b, c]}` radians, as compat.py sends them."""
    a = np.radians(np.asarray(angles, dtype=float))
    out = {"thumb": [round(float(thumb_cmc_rad), 4), 0.0, 0.0]}
    for f in ("index", "middle", "ring", "little"):
        out[f] = [0.0, 0.0, 0.0]
    for f, j, slot in TRIPLE_SLOTS:
        out[f][j] = round(float(a[slot]), 4)
    return out


def _phase_present(triples: dict | None) -> bool:
    return bool(triples) and any(abs(float(v)) > 0 for t in triples.values() for v in t)


@dataclass
class HandCalibration:
    """One hand's flat and fist angles in degrees, and how to map raw angles through them."""

    side: str
    flat: np.ndarray  # (18,) degrees
    fist: np.ndarray  # (18,) degrees
    full: np.ndarray  # (18,) nominal span in degrees, per slot
    min_range_deg: float = 2.9
    lo: float = 0.0
    hi: float = 1.0
    origin: dict = field(default_factory=dict)

    @property
    def usable(self) -> np.ndarray:
        mask = np.zeros(H.N_ANGLES, dtype=bool)
        mask[FLEX_SLOTS] = True
        return mask & ((self.fist - self.flat) > self.min_range_deg)

    def apply(self, angles: np.ndarray) -> np.ndarray:
        a = np.asarray(angles, dtype=float)
        use = self.usable
        span = np.where(use, self.fist - self.flat, 1.0)
        norm = np.clip((a - self.flat) / span, self.lo, self.hi)
        return np.where(use, norm * self.full, a)

    def summary(self) -> dict:
        """Small dict for /health and logs."""
        return {
            **self.origin,
            "usable_joints": int(self.usable.sum()),
            "flat_deg": {
                f: round(float(np.mean(self.flat[H.FLEXION_SLOTS[f]])), 1)
                for f in H.FINGERS
            },
            "range_deg": {
                f: round(float(np.mean((self.fist - self.flat)[H.FLEXION_SLOTS[f]])), 1)
                for f in H.FINGERS
            },
        }


def nominal_full(hand_cfg) -> np.ndarray:
    full = np.zeros(H.N_ANGLES)
    for f in H.FINGERS:
        full[H.FLEXION_SLOTS[f]] = float(
            hand_cfg.curl_full_thumb_deg if f == "thumb" else hand_cfg.curl_full_deg
        )
    return full


def make_hand_calibration(
    side: str,
    flat_triples: dict,
    fist_triples: dict | None,
    cal_cfg,
    hand_cfg,
    origin: dict,
) -> HandCalibration:
    """Build from backend triples. Without a fist the range is the nominal span (origin says so)."""
    full = nominal_full(hand_cfg)
    flat = triples_to_angles(flat_triples)
    if _phase_present(fist_triples):
        fist = triples_to_angles(fist_triples)
        origin = {**origin, "range": "measured"}
    else:
        fist = flat + full
        origin = {**origin, "range": "nominal"}
    return HandCalibration(
        side=side,
        flat=flat,
        fist=fist,
        full=full,
        min_range_deg=float(cal_cfg.min_range_deg),
        lo=float(cal_cfg.clip_low),
        hi=float(cal_cfg.clip_high),
        origin=origin,
    )


def _read_dir(d: Path) -> list[dict]:
    out = []
    if not d.is_dir():
        return out
    for p in d.glob("*.json"):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, ValueError) as e:
            log.warning("skipping unreadable calibration file %s: %s", p, e)
    return out


def load_hand(
    data_dir: Path, side: str, wearer: str, cal_cfg, hand_cfg
) -> HandCalibration | None:
    """The calibration to use for one hand, or None.

    With a wearer name: that wearer's newest `glove_calibrations` record; its
    `range_calibration_ids[side]` gives flat and fist, and its neutral offsets
    stand in for flat when the range has no flat phase. Without a name: the
    newest `calibrations` record for the side with a flat phase (the backend's
    own `CalibrationService.latest`).
    """
    data_dir = Path(data_dir)
    ranges = {
        r.get("id"): r for r in _read_dir(data_dir / "calibrations") if r.get("id")
    }
    if wearer:
        records = [
            r
            for r in _read_dir(data_dir / "glove_calibrations")
            if str(r.get("wearer", "")).casefold() == wearer.casefold()
        ]
        if not records:
            log.warning("no glove calibration for wearer %r in %s", wearer, data_dir)
            return None
        rec = max(records, key=lambda r: str(r.get("created_at", "")))
        rid = (rec.get("range_calibration_ids") or {}).get(side)
        rng = ranges.get(rid) if rid else None
        neutral = next(
            (n for n in rec.get("neutral") or [] if n.get("side") == side), None
        )
        flat = rng.get("flat") if rng and _phase_present(rng.get("flat")) else None
        if flat is None and neutral is not None:
            flat = neutral.get("offsets")
        if not _phase_present(flat):
            log.warning(
                "wearer %r has no flat pose for the %s hand (record %s)",
                wearer,
                side,
                rec.get("id"),
            )
            return None
        origin = {
            "wearer": rec.get("wearer"),
            "wearer_calibration_id": rec.get("id"),
            "range_calibration_id": rid if rng else None,
            "created_at": (rng or rec).get("created_at"),
        }
        return make_hand_calibration(
            side, flat, rng.get("fist") if rng else None, cal_cfg, hand_cfg, origin
        )
    cands = [
        r
        for r in ranges.values()
        if r.get("side") == side and _phase_present(r.get("flat"))
    ]
    if not cands:
        return None
    rng = max(cands, key=lambda r: str(r.get("created_at", "")))
    origin = {
        "wearer": None,
        "range_calibration_id": rng.get("id"),
        "created_at": rng.get("created_at"),
    }
    return make_hand_calibration(
        side, rng["flat"], rng.get("fist"), cal_cfg, hand_cfg, origin
    )


class Calibrations:
    """The calibration per side for the live session; reloaded on the `calibrate` command."""

    def __init__(self, cfg) -> None:
        self.cfg = cfg
        self.by_side: dict[str, HandCalibration | None] = {"left": None, "right": None}

    @property
    def section(self):
        return self.cfg.get("calibration") or {}

    @property
    def enabled(self) -> bool:
        return bool(self.section.get("enabled", False))

    def data_dir(self) -> Path:
        d = Path(str(self.section.get("data_dir", "backend/data")))
        if not d.is_absolute():
            d = Path(str(self.cfg.get("_root", "."))) / d
        return d

    def wearer(self, side: str) -> str:
        s = self.section
        return str(s.get(f"{side}_wearer") or s.get("wearer") or "")

    def reload(self) -> dict[str, dict | None]:
        if not self.enabled:
            self.by_side = {"left": None, "right": None}
            return self.status()
        d = self.data_dir()
        for side in ("left", "right"):
            self.by_side[side] = load_hand(
                d, side, self.wearer(side), self.cfg.calibration, self.cfg.hand
            )
            if self.by_side[side] is not None:
                log.info(
                    "%s hand calibrated from %s: %s",
                    side,
                    d,
                    self.by_side[side].summary(),
                )
            else:
                log.info("%s hand: no calibration found in %s, raw angles", side, d)
        return self.status()

    def status(self) -> dict[str, dict | None]:
        return {
            s: (None if c is None else c.summary()) for s, c in self.by_side.items()
        }

    def apply(self, hand: H.HandState) -> H.HandState:
        """Replace hand.angles by calibrated angles (raw kept in angles_raw) and refresh curl."""
        cal = self.by_side.get(hand.side)
        if cal is None or hand.source != "glove":
            return hand
        # idempotent: a held pose handed in twice is calibrated from its raw angles once
        if hand.angles_raw is None:
            hand.angles_raw = np.asarray(hand.angles, dtype=float).copy()
        hand.angles = cal.apply(hand.angles_raw)
        hand.curl = H.curl_from_angles(
            hand.angles, self.cfg.hand.curl_full_deg, self.cfg.hand.curl_full_thumb_deg
        )
        return hand
