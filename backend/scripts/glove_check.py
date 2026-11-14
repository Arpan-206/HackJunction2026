"""Guided check of the real Rokoko Smartgloves II. Reports only, never edits config.

    cd backend
    uv run python scripts/glove_check.py            # both hands
    uv run python scripts/glove_check.py --hand left

Needs the Rokoko driver (12276, RCSP 45451) and rkk-hand-solver (12277) running. You are asked to hold the hand flat
for 3 s, make a fist for 3 s, then open it for 3 s. For each finger it prints how far the finger sensor rotated and
how the solver's local joint rotated (axis and sign), then PASS or FAIL per finger:

- PASS needs the finger sensor to rotate more than 60 degrees in the fist (thumb: 20 degrees), return below 25 degrees
  after opening, and the solver flexion to be about a single local axis with a consistent sign.
- The measured axis and sign are printed next to ROKOKO_FLEX_AXIS / ROKOKO_FLEX_SIGN from app/constants.py. They
  are never changed here. Measured sign is for the solver's joints_local quaternions (x, y, z, w), which are not the
  Studio JSON rotations that app/services/gloves/rokoko_mapper.py reads, so a difference is information, not a bug.

Exit code 0 when every checked finger passes, 1 otherwise, 2 when the driver cannot be reached.
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import constants as c
from tests.rgmp_reader import Capture, angle_between_deg

from tests import glove_live as live

FINGERS = ["thumb", "index", "middle", "ring", "little"]
FINGER_NUM = {f: i + 1 for i, f in enumerate(FINGERS)}
HOLD_S = 3.0
SETTLE_S = 1.0  # first second of each pose is thrown away while the hand gets there


def countdown(text: str) -> None:
    print(f"\n>>> {text}")
    for n in (3, 2, 1):
        print(f"    starting in {n}...", end="\r", flush=True)
        time.sleep(1)
    print("    HOLD            ")


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def mean_quat(qs):
    ref = qs[0]
    acc = [0.0] * 4
    for q in qs:
        s = 1 if sum(a * b for a, b in zip(q, ref)) >= 0 else -1
        for i in range(4):
            acc[i] += s * q[i]
    n = math.sqrt(sum(v * v for v in acc))
    return tuple(v / n for v in acc)


def rotvec_deg(q):
    if q[3] < 0:
        q = tuple(-v for v in q)
    s = math.sqrt(sum(v * v for v in q[:3]))
    if s < 1e-9:
        return (0.0, 0.0, 0.0)
    k = 2 * math.atan2(s, q[3]) / s
    return tuple(math.degrees(v * k) for v in q[:3])


def pose_window(
    cap: Capture,
    dev: int,
    group: int,
    measure: str,
    target: str,
    t_from: float,
    t_to: float,
):
    ser = cap.series(dev, group, measure, target)
    t0 = ser[0][0]
    return [v for ts, v in ser if t_from <= (ts - t0) / 1e6 < t_to]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hand", choices=["left", "right", "both"], default="both")
    args = ap.parse_args()

    if not (
        live.port_open(live.RGMP_PORT)
        and live.port_open(live.RCSP_PORT)
        and live.port_open(live.SOLVER_PORT)
    ):
        print(
            "Cannot reach the Rokoko driver (12276, RCSP 45451) and solver (12277). Start rokoko-sdk.exe first."
        )
        return 2

    phases = [
        ("flat", "Hold BOTH hands FLAT, fingers straight, palms down"),
        ("fist", "Make a FIST with both hands"),
        ("open", "OPEN both hands flat again"),
    ]
    recs = {}
    with live.StreamSubscription():
        for name, text in phases:
            countdown(text)
            recs[name] = live.record_both(HOLD_S + SETTLE_S)

    results: dict[str, dict[str, dict]] = {}
    driver_cap = {k: r[0].capture() for k, r in recs.items()}
    solver_cap = {k: r[1].capture() for k, r in recs.items()}
    hands = {
        d["device_info"]["hand"]: dev
        for dev, d in driver_cap["flat"].definitions.items()
    }
    for hand, dev in hands.items():
        if args.hand not in ("both", hand):
            continue
        results[hand] = {}
        for f in FINGERS:
            tgt = f"{f}_finger_sensor"

            def q_of(phase: str):
                w = pose_window(
                    driver_cap[phase],
                    dev,
                    0,
                    "TRANSFORM",
                    tgt,
                    SETTLE_S,
                    HOLD_S + SETTLE_S,
                )
                return mean_quat([v[3:7] for v in w])

            flat, fist, opened = q_of("flat"), q_of("fist"), q_of("open")
            sensor_fist, sensor_open = (
                angle_between_deg(fist, flat),
                angle_between_deg(opened, flat),
            )

            joint_rot = []
            for joint in ("proximal", "medial", "distal"):
                if f == "thumb" and joint == "medial":
                    continue
                frame = f"{hand}_finger{FINGER_NUM[f]}_{joint}"
                try:
                    qf = mean_quat(
                        [
                            v
                            for v in pose_window(
                                solver_cap["flat"],
                                dev,
                                0,
                                "ORIENTATION",
                                frame,
                                SETTLE_S,
                                9,
                            )
                        ]
                    )
                    qx = mean_quat(
                        [
                            v
                            for v in pose_window(
                                solver_cap["fist"],
                                dev,
                                0,
                                "ORIENTATION",
                                frame,
                                SETTLE_S,
                                9,
                            )
                        ]
                    )
                except (StopIteration, ValueError, IndexError):
                    continue
                joint_rot.append(rotvec_deg(qmul((-qf[0], -qf[1], -qf[2], qf[3]), qx)))
            total = (
                [sum(r[i] for r in joint_rot) for i in range(3)]
                if joint_rot
                else [0.0, 0.0, 0.0]
            )
            axis = max(range(3), key=lambda i: abs(total[i]))
            sign = 1.0 if total[axis] >= 0 else -1.0
            purity = abs(total[axis]) / (sum(abs(v) for v in total) or 1)
            need = 20 if f == "thumb" else 60
            ok = (
                sensor_fist > need
                and sensor_open < 25
                and purity > 0.6
                and abs(total[axis]) > 15
            )
            results[hand][f] = dict(
                fist=sensor_fist,
                open=sensor_open,
                axis=axis,
                sign=sign,
                purity=purity,
                total=total,
                ok=ok,
            )

    print("\n=== result (angles in degrees) ===")
    all_ok = True
    for hand, rows in results.items():
        print(f"\n{hand} glove")
        print(
            f"  {'finger':7s} {'sensor fist':>11s} {'sensor open':>11s}  solver local axis/sign  verdict"
        )
        for f, r in rows.items():
            all_ok &= r["ok"]
            print(
                f"  {f:7s} {r['fist']:11.0f} {r['open']:11.0f}  axis {'xyz'[r['axis']]} sign {r['sign']:+.0f} "
                f"(x,y,z = {r['total'][0]:.0f}, {r['total'][1]:.0f}, {r['total'][2]:.0f})  {'PASS' if r['ok'] else 'FAIL'}"
            )
    axes = {
        r["axis"]
        for rows in results.values()
        for f, r in rows.items()
        if f != "thumb" and r["ok"]
    }
    signs = {
        r["sign"]
        for rows in results.values()
        for f, r in rows.items()
        if f != "thumb" and r["ok"]
    }
    if axes and signs:
        print(
            f"\nMeasured flexion in the solver local frame: axis {sorted('xyz'[a] for a in axes)}, "
            f"sign {sorted(signs)} (non-thumb fingers)"
        )
        print(
            f"Config says: ROKOKO_FLEX_AXIS={c.ROKOKO_FLEX_AXIS} ROKOKO_FLEX_SIGN={c.ROKOKO_FLEX_SIGN} (not changed)"
        )
    print("\nOVERALL:", "PASS" if all_ok else "FAIL")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
