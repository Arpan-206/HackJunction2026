"""The depth step on the second REAL clip, captures/bench-riser-1.gdrec.gz (not in git).

Phone on a riser behind the laptop screen, facing the person; the app sent no plane, so
our own fit carries the table. Spans in tests/fixtures/depth/bench_riser_1_spans.json.
Skipped where the clip is missing.
"""

import json
from pathlib import Path

import numpy as np
import pytest

from core.camera.depth_track import DepthTracker
from core.camera.gdrec import frames
from tools.depth_check import span_label

HERE = Path(__file__).parent
SPANS = HERE / "fixtures" / "depth" / "bench_riser_1_spans.json"
CANDIDATES = [HERE.parent / "captures" / "bench-riser-1.gdrec.gz",
              Path("/Users/arpanpandey/Code/Junction/repo/captures/bench-riser-1.gdrec.gz")]
CLIP = next((p for p in CANDIDATES if p.exists()), None)


@pytest.mark.skipif(CLIP is None, reason="captures/bench-riser-1.gdrec.gz not on this machine")
def test_riser_table_from_own_fit_and_arm_gate():
    spans = json.loads(SPANS.read_text())["spans"]
    tr = DepthTracker()
    heights, reach, chest, ok = [], [0, 0], [0, 0], 0
    for k, f in enumerate(frames(CLIP)):
        o = tr.process(f)
        assert f.plane is None                     # the app never found the table from up there
        assert o.table is not None and o.table.source == "fit"
        heights.append(o.table.camera_height_m)
        lab = span_label(spans, k)
        if lab == "glove":
            reach[0] += 1
            reach[1] += int(o.arm_found)
        elif lab == "glove_at_chest":
            chest[0] += 1
            chest[1] += int(o.arm_found)
        ok += int(o.forearm_ok)
    h = np.array(heights)
    # measured, not assumed: 0.424 m median (the deck and the table in front of it agree within ~1.5 cm)
    assert 0.40 < np.median(h) < 0.45 and h.std() < 0.02
    assert reach[1] / reach[0] > 0.6                # the reaching glove is found (0.74 on Sat 14 Nov)
    assert chest[1] == 0                            # hands held at the chest are not arms on the table
    assert ok == 0                                  # but no blob here is long and clear enough to move the yaw
