"""hand_blobs (the gloved-hand finder lane hand-root consumes) on the REAL clip
captures/bench-gloves-1.gdrec.gz (not in git; skipped where missing), plus orientation."""

from pathlib import Path

import numpy as np
import pytest

from core.camera.depth_track import (
    HandBlobSides,
    hand_blobs,
    rotate_upright,
    upright_turns,
)
from core.camera.fake_depth import FakeDepthScene
from core.camera.gdrec import frames
from core.camera.geppetto_depth import parse_packet

CANDIDATES = [
    Path(__file__).parent.parent / "captures" / "bench-gloves-1.gdrec.gz",
    Path("/Users/arpanpandey/Code/Junction/repo/captures/bench-gloves-1.gdrec.gz"),
]
CLIP = next((p for p in CANDIDATES if p.exists()), None)


def test_upright_turns_on_the_fake_landscape_phone():
    f = parse_packet(FakeDepthScene().packet(0), 0)
    assert upright_turns(f) == 0  # landscape, world up is image up
    img = np.zeros((2, 3, 3), np.uint8)
    assert rotate_upright(img, 1).shape == (3, 2, 3)


@pytest.mark.skipif(
    CLIP is None, reason="captures/bench-gloves-1.gdrec.gz not on this machine"
)
def test_hand_blobs_on_bench_gloves_1():
    sides = HandBlobSides()
    counts = [0, 0, 0]
    turns = set()
    for k, f in enumerate(frames(CLIP)):
        if k % 3:
            continue
        b = sides.update(hand_blobs(f))
        turns.add(upright_turns(f))
        counts[min(2, len(b))] += 1
        for x in b:
            assert x.mask.shape == f.depth.shape and x.area_px == int(x.mask.sum())
            assert 0.0 <= x.centre_uv[0] <= 1.0 and 0.0 <= x.centre_uv[1] <= 1.0
            assert 0.01 <= x.height_m <= 0.28 and x.side_hint in ("left", "right")
            assert abs(float(np.linalg.norm(x.axis_world)) - 1.0) < 1e-6
        if len(b) == 2:
            assert {b[0].side_hint, b[1].side_hint} == {"left", "right"}
    n = sum(counts)
    assert turns == {1}  # the upright phone streams turned by 90 degrees
    assert counts[2] / n > 0.3 and (counts[1] + counts[2]) / n > 0.7, (
        counts
    )  # 0.41 and 0.78 on Sat 14 Nov
