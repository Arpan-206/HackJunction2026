"""Count left and right swaps in a hand root track.csv (from tools/hand_root_check.py).

A swap: in two frames at most 0.2 s apart where both hands were found, the new left is
nearer the old right than the old left (and the new right nearer the old left), by more
than 3 cm each. Prints the count and the times.

    python -m tools.hand_root_swaps logs/hand_root/bench-gloves-1/track.csv
"""
from __future__ import annotations

import csv
import sys

import numpy as np


def swaps(path: str) -> list[float]:
    by_t: dict[float, dict] = {}
    for r in csv.DictReader(open(path)):
        by_t.setdefault(float(r["t_s"]), {})[r["side"]] = np.array([float(r["bx"]), float(r["by"]), float(r["bz"])])
    ts = sorted(t for t, d in by_t.items() if "left" in d and "right" in d)
    out = []
    for a, b in zip(ts, ts[1:]):
        if b - a > 0.2:
            continue
        L0, R0, L1, R1 = by_t[a]["left"], by_t[a]["right"], by_t[b]["left"], by_t[b]["right"]
        if (np.linalg.norm(L1 - R0) + 0.03 < np.linalg.norm(L1 - L0)
                and np.linalg.norm(R1 - L0) + 0.03 < np.linalg.norm(R1 - R0)):
            out.append(b)
    return out


if __name__ == "__main__":
    s = swaps(sys.argv[1])
    print(len(s), [round(t, 2) for t in s])
