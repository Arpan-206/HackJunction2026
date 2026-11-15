"""How much of the bench in front of the phone is hidden: by the laptop screen or by the view.

    python -m tools.hand_root_occlusion captures/bench-gloves-1.gdrec.gz

Per sampled frame, in the bench frame (table plane y = 0, distances on the table from the
point under the camera, along the camera's viewing direction):
- fov_m: where the image's lowest row meets the table if nothing were in the way.
- surface_m: the nearest pixel that sees a low surface (under 3 cm: the table or the
  laptop deck and keys), in the middle third of the image width.
- hidden_m = surface_m - fov_m: the band the screen (or anything above the table) hides
  beyond what the field of view hides anyway.
- screen: pixels 10 to 35 cm above the table and within 30 cm of the camera foot (the
  screen's back and top edge), as a fraction of the image.
The image is turned upright first (the phone streams its sensor image); "lowest row" is
in the upright image.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from core.camera.depth_track import (
    ARKIT_TO_OPENCV,
    DepthTracker,
    TrackerConfig,
    app_table,
    backproject,
    fit_table,
)
from core.camera.gdrec import frames
from core.camera.hand_root import unrotate_points, upright_rotation


def main(argv=None) -> int:
    path = Path((argv or sys.argv[1:])[0])
    out = []
    dt = DepthTracker(TrackerConfig())
    for n, f in enumerate(frames(path)):
        if n % 25:
            continue
        p, valid, w = backproject(f)
        if not w:
            continue
        Tcv = np.asarray(f.transform) @ ARKIT_TO_OPENCV
        cam, fwd = Tcv[:3, 3], Tcv[:3, 2]
        tab = app_table(f, cam, True)
        if tab is None:
            conf = f.confidence.reshape(-1)
            hi = valid & (conf >= 2) & (np.linalg.norm(p - cam, axis=1) < 2)
            tab = fit_table(p[hi], cam, np.array([0.0, 1.0, 0.0]), dt.cfg, dt.rng)
        if tab is None:
            continue
        nrm = tab.normal
        foot = cam - ((cam - tab.point) @ nrm) * nrm
        f2 = fwd - (fwd @ nrm) * nrm
        f2 /= np.linalg.norm(f2)
        H, W = f.depth.shape
        rot = upright_rotation(f.transform)
        h = tab.height(p).reshape(H, W)
        along = ((p - foot) @ f2).reshape(H, W)
        ok = valid.reshape(H, W) & (f.confidence >= 1)
        h_r, a_r, ok_r = (
            np.rot90(x, -rot) for x in (h, along, ok)
        )  # upright: rot quarter turns clockwise
        Hr, Wr = h_r.shape
        mid = slice(Wr // 3, 2 * Wr // 3)
        low = ok_r[:, mid] & (h_r[:, mid] < 0.03) & (h_r[:, mid] > -0.03)
        surface = float(np.percentile(a_r[:, mid][low], 2)) if low.sum() > 50 else None
        # the lowest upright row's ray hitting the table plane
        K = f.depth_intrinsics()
        rows = []
        for u in np.linspace(1 / 3, 2 / 3, 16):
            su, sv = unrotate_points(np.array([[u, 0.999]]), rot)[
                0
            ]  # upright bottom row, sensor pixel
            d = np.array(
                [(su * W - K[0, 2]) / K[0, 0], (sv * H - K[1, 2]) / K[1, 1], 1.0]
            )
            dw = Tcv[:3, :3] @ d
            den = dw @ nrm
            if den >= -1e-6:
                continue
            s = -((cam - tab.point) @ nrm) / den
            rows.append((cam + s * dw - foot) @ f2)
        fov = float(np.median(rows)) if rows else None
        scr = ok & (h > 0.10) & (h < 0.35) & (np.abs(along) < 0.30)
        out.append(
            {
                "frame": n,
                "camera_height_m": round(tab.camera_height_m, 3),
                "table": tab.source,
                "fov_m": None if fov is None else round(fov, 3),
                "surface_m": None if surface is None else round(surface, 3),
                "screen_fraction": round(float(scr.mean()), 3),
            }
        )
    keys = ("camera_height_m", "fov_m", "surface_m", "screen_fraction")
    med = {
        k: round(float(np.median([o[k] for o in out if o[k] is not None])), 3)
        for k in keys
    }
    med["hidden_m"] = round(med["surface_m"] - med["fov_m"], 3)
    print(
        json.dumps(
            {"recording": str(path), "frames_sampled": len(out), "median": med},
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
