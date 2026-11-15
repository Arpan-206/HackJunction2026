"""The arm gate on the first REAL depth clip, captures/bench-stand-1.gdrec.gz (98 MB, not in git).

Spans were marked by hand in tests/fixtures/depth/bench_stand_1_spans.json. The clip lives
in the main checkout's captures/; the test is skipped where it is missing.
"""

import json
from pathlib import Path

import pytest

from core.camera.depth_track import DepthTracker
from core.camera.gdrec import frames
from tools.depth_check import span_label

HERE = Path(__file__).parent
SPANS = HERE / "fixtures" / "depth" / "bench_stand_1_spans.json"
CANDIDATES = [
    HERE.parent / "captures" / "bench-stand-1.gdrec.gz",
    Path("/Users/arpanpandey/Code/Junction/repo/captures/bench-stand-1.gdrec.gz"),
]
CLIP = next((p for p in CANDIDATES if p.exists()), None)


@pytest.mark.skipif(
    CLIP is None, reason="captures/bench-stand-1.gdrec.gz not on this machine"
)
def test_shape_gate_on_bench_stand_1():
    spans = json.loads(SPANS.read_text())["spans"]
    tr = DepthTracker()  # the default gate, "shape"
    seen = {"arm": [0, 0], "no_arm": [0, 0]}
    false_accepts = []
    for k, f in enumerate(frames(CLIP)):
        lab = span_label(spans, k)
        o = tr.process(f)
        if lab in seen:
            seen[lab][0] += 1
            seen[lab][1] += int(o.arm_found)
            if lab == "no_arm" and o.arm_found:
                false_accepts.append(k)
    assert false_accepts == []  # the bottle and the equipment are never an arm
    assert seen["no_arm"][0] > 150
    assert seen["arm"][1] / seen["arm"][0] > 0.3, seen  # measured 0.35 on Sat 14 Nov
