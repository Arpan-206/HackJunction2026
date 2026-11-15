"""Gloved hands from depth first: blobs nearer than the body and above the work surface.

INTERIM. The lidar lane owns the real blob finder, hand_blobs() in
core/camera/depth_track.py (interface agreed by FIELDS message, Sat 14 Nov 20:50).
hand_blobs() here keeps the same signature and fields so hand_root.py can switch to the
lidar version by import (find_blobs() below prefers it when it exists).

Steps, per frame (depth resolution, 256x192):
1. Back-project every pixel to the ARKit world; height above the table plane.
2. Body distance: the median camera distance of the pixels 0.15 to 0.6 m above the table
   (the torso fills most of them from the riser).
3. Candidates: confident depth, 2 cm to 60 cm above the table, at least body_margin_m
   nearer the camera than the body, and further than min_range_m (the laptop screen's back).
4. Connected components; hand-sized ones (min_px to max_px) are kept, largest first.
5. Each blob's long axis (PCA on the table plane), pointed toward the camera (fingers
   point at the laptop and the phone). The wrist is the blob's median point between 14
   and 20 cm back from the tip, or the far end of a short blob. ARKit depth is too smooth
   for fingers; the fingers come from the gloves.
6. darkness: 1 minus the mean colour brightness inside the mask (black gloves near 1,
   skin lower), so a glove beats a bare hand.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .depth import DepthFrame
from .depth_track import Table, backproject, camera_pose


@dataclass
class HandBlob:
    centre_world: np.ndarray  # (3,) ARKit world, the wrist estimate (see step 5)
    centre_uv: tuple[float, float]  # normalised, colour frame as streamed
    axis_world: np.ndarray | None  # (3,) unit, toward the fingers
    height_m: float
    area_px: int
    mask: np.ndarray  # bool, depth resolution
    darkness: float
    side_hint: str | None = None
    tip_world: np.ndarray | None = None


@dataclass
class BlobConfig:
    min_confidence: int = 1
    band_min_m: float = 0.02
    band_max_m: float = 0.60
    body_band_min_m: float = 0.15
    body_margin_m: float = 0.08
    min_range_m: float = 0.15
    max_range_m: float = 1.0
    min_px: int = 150
    max_px: int = 12000
    wrist_back_m: tuple = (0.14, 0.20)


def hand_blobs(
    frame: DepthFrame,
    table: Table | None = None,
    max_n: int = 2,
    cfg: BlobConfig | None = None,
) -> list[HandBlob]:
    import cv2

    cfg = cfg or BlobConfig()
    if frame.depth is None or table is None:
        return []
    H, W = frame.depth.shape
    p, valid, in_world = backproject(frame)
    if not in_world:
        return []
    cam, _ = camera_pose(frame, True)
    conf = (
        frame.confidence.reshape(-1)
        if frame.confidence is not None
        else np.full(H * W, 2, np.uint8)
    )
    ok = valid & (conf >= cfg.min_confidence)
    dist = np.linalg.norm(p - cam, axis=1)
    h = table.height(p)
    body_px = ok & (h >= cfg.body_band_min_m) & (h <= cfg.band_max_m) & (dist <= 2.0)
    body = float(np.median(dist[body_px])) if body_px.sum() > 200 else cfg.max_range_m
    cand = (
        ok
        & (h >= cfg.band_min_m)
        & (h <= cfg.band_max_m)
        & (dist >= cfg.min_range_m)
        & (dist <= min(cfg.max_range_m, body - cfg.body_margin_m))
    )
    img = cv2.morphologyEx(
        cand.reshape(H, W).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)
    )
    n, lab, stats, _ = cv2.connectedComponentsWithStats(img, connectivity=8)
    order = sorted(range(1, n), key=lambda k: -stats[k, cv2.CC_STAT_AREA])
    grey = cv2.cvtColor(frame.bgr, cv2.COLOR_BGR2GRAY)
    small = (
        cv2.resize(grey, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
        / 255.0
    )
    out: list[HandBlob] = []
    up = table.normal
    for k in order:
        area = int(stats[k, cv2.CC_STAT_AREA])
        if area < cfg.min_px or area > cfg.max_px:
            continue
        m = lab == k
        idx = np.flatnonzero(m.reshape(-1))
        q = p[idx]
        flat = q - np.outer((q - table.point) @ up, up)  # on the table plane
        c = flat.mean(axis=0)
        axis = None
        wrist = np.median(q, axis=0)
        tip = None
        if len(q) >= 30:
            _, _, vt = np.linalg.svd(flat - c, full_matrices=False)
            a = vt[0]
            to_cam = cam - c
            if a @ to_cam < 0:
                a = -a
            s = (flat - c) @ a
            tip_s = float(np.percentile(s, 98))
            lo, hi = tip_s - cfg.wrist_back_m[1], tip_s - cfg.wrist_back_m[0]
            sel = (s >= lo) & (s <= hi)
            if sel.sum() >= 10:
                wrist = np.median(q[sel], axis=0)
            else:
                wrist = np.median(q[s <= np.percentile(s, 10)], axis=0)
            axis = a / np.linalg.norm(a)
            tip = q[int(np.argmax(s))]
        ys, xs = np.divmod(idx, W)
        # the pixel nearest the wrist point, for the colour frame position
        j = int(np.argmin(np.linalg.norm(q - wrist, axis=1)))
        uv = ((xs[j] + 0.5) / W, (ys[j] + 0.5) / H)
        out.append(
            HandBlob(
                centre_world=wrist,
                centre_uv=uv,
                axis_world=axis,
                height_m=float(table.height(wrist[None])[0]),
                area_px=area,
                mask=m,
                darkness=float(1.0 - small[m].mean()),
                tip_world=tip,
            )
        )
        if len(out) >= max_n:
            break
    return out


def find_blobs(
    frame: DepthFrame, table: Table | None, max_n: int = 2
) -> tuple[list, str]:
    """The lidar lane's hand_blobs when it exists, else the interim one here. (blobs, which)."""
    try:
        from .depth_track import (
            hand_blobs as lidar_hand_blobs,  # type: ignore[attr-defined]
        )
    except ImportError:
        return hand_blobs(frame, table, max_n), "interim"
    return lidar_hand_blobs(frame, table, max_n), "lidar"
