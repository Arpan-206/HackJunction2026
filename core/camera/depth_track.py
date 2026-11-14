"""Depth tracking on one DepthFrame: the table plane, the arm blob, the forearm direction.

Nothing here has run on real depth yet (STATUS-lidar.md). It is built and tested on the
fake bench scene (core/camera/fake_depth.py) and parsed on the hall recordings.

Steps, per frame:
1. Back-project every depth pixel with the depth intrinsics. With the phone's camera
   transform the points are in the ARKit world (gravity up); without it they stay in the
   OpenCV camera frame.
2. Table plane. The app's plane (largest horizontal plane, its y axis is the normal) is
   used when present. A RANSAC fit on high-confidence points runs every frame as a check
   (and as the plane when the app sends none); the two are compared in degrees and mm.
3. Arm blob. Points above the table in a height band, with a confidence mask, within a
   range of the camera, cleaned and split into connected components in the image. The
   largest component that is big enough is the arm (forearm plus hand when the hand
   returns depth).
4. Forearm direction. Where the blob touches the image border is where the arm enters
   the frame. The blob points within forearm_len_m of that entry, projected onto the
   table, give the long axis (PCA). It points from the entry toward the blob's centre,
   so from the elbow toward the fingers.
5. Yaw. The forearm direction becomes a yaw in the core's convention (core/rgmp.py
   _yaw_of: atan2(-x, -z), 0 = pointing away from the person) in a bench frame: y the
   table normal, -z the camera's first viewing direction on the table, then turned by
   camera_yaw_deg (180 when the phone faces the person across the bench).

The dark-hand case (black gloves, no hand depth) needs no special path: the hand pixels
carry confidence 0, so the blob is the forearm alone, and the direction still comes out.
hand_depth says whether the blob looks like more than a forearm.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import numpy as np

from .depth import DepthFrame

ARKIT_TO_OPENCV = np.diag([1.0, -1.0, -1.0, 1.0])

LABEL_OTHER, LABEL_TABLE, LABEL_ARM, LABEL_DARK = 0, 1, 2, 3


@dataclass
class TrackerConfig:
    """[camera.depth] in config.toml. Units: metres, degrees, pixels at the depth resolution."""

    min_confidence: int = 1          # arm pixels need at least this (0 low, 1 medium, 2 high)
    band_min_m: float = 0.012        # an arm point is this far above the table at least
    band_max_m: float = 0.35         # and at most this
    max_range_m: float = 1.0         # ignore points farther than this from the camera
    min_blob_px: int = 150           # smallest arm blob
    forearm_len_m: float = 0.15      # the stretch from the entry used for the direction
    min_elongation: float = 1.8      # sqrt of the PCA eigenvalue ratio, below this the direction is unsure
    min_forearm_points: int = 40
    ransac_iters: int = 60
    ransac_tol_m: float = 0.006
    ransac_points: int = 2500
    max_tilt_deg: float = 25.0       # with gravity known, the fitted table normal is this close to up
    table_band_m: float = 0.01       # cloud points this close to the table are labelled table
    camera_yaw_deg: float = 180.0    # core yaw of the camera's viewing direction on the table
    cloud_points: int = 2000
    dark_min_px: int = 120           # a conf-0 patch at least this big at the arm's far end means a dark hand
    cylinder: bool = True            # refine the direction with a 3D cylinder fit (see _cylinder_axis)
    # Shape gates: a blob is an arm only if its forearm stretch is arm-wide and, with the
    # cylinder fit on, fits a cylinder of arm radius. They reject bags and boxes on the bench.
    arm_width_min_m: float = 0.01        # the visible half of a 7 cm arm measures 2 to 5 cm here
    arm_width_max_m: float = 0.16
    arm_radius_min_m: float = 0.015
    arm_radius_max_m: float = 0.07
    cylinder_max_rms_m: float = 0.012
    require_entry: bool = True           # an arm comes from outside the view, so it crosses the image border
    entry_margin_px: int = 6             # "touches the border" means within this many depth pixels of it
    # Arm gate. "shape" (default since the first real clip, captures/bench-stand-1): every blob is
    # scored and an arm must enter from the edge, be long enough but not too long, widen from a
    # wrist toward the hand (taper) and stay low over the table. "cylinder" is the first gate
    # (radius, residual, tilt), which accepted a tall object at the edge of that clip.
    gate: str = "shape"
    arm_len_min_m: float = 0.12
    arm_len_max_m: float = 0.26
    arm_min_px: int = 1200               # a hand 30 to 50 cm from the phone covers thousands of depth pixels
    arm_confirm_frames: int = 3          # the gate must pass now and in this many of the last arm_confirm_window frames
    arm_confirm_window: int = 5
    # 3D view only, never the yaw: a flat hand lies within millimetres of the table. The plane
    # fit RMS on the first real clip is 1.2 mm, so high-confidence points this far above the
    # table stop counting as table, and those joined to a confirmed arm count as arm.
    cloud_fine_band_m: float = 0.004          # (a one-frame flicker of a bottle is not an arm)
    arm_taper_min: float = 1.3           # widest slice in the far half / narrowest in the near half
    arm_wmax_min_m: float = 0.05         # the hand's width
    arm_wmax_max_m: float = 0.15
    arm_h95_max_m: float = 0.15          # 95th percentile height above the table
    arm_max_tilt_deg: float = 40.0       # the cylinder axis lies along the table, not standing up from it

    @classmethod
    def from_section(cls, sec) -> "TrackerConfig":
        c = cls()
        if sec is None:
            return c
        for k in c.__dataclass_fields__:
            if k in sec:
                setattr(c, k, type(getattr(c, k))(sec[k]))
        return c


@dataclass
class Table:
    point: np.ndarray        # (3,) on the plane, world (or camera) frame
    normal: np.ndarray       # (3,) unit, pointing to the camera's side
    source: str              # "app" or "fit"
    inliers: float = 0.0     # fraction of sampled points within ransac_tol_m (fit only)
    rms_m: float = 0.0
    camera_height_m: float = 0.0

    def height(self, p: np.ndarray) -> np.ndarray:
        return (p - self.point) @ self.normal


@dataclass
class DepthObs:
    """What one depth frame says. Directions and points are in the bench frame (see module doc)."""

    t_us: int
    frame_id: int
    table: Table | None = None
    table_fit: Table | None = None
    agree_deg: float | None = None       # angle between app and fitted normals
    agree_mm: float | None = None        # distance of the app plane's centre from the fitted plane
    blob_found: bool = False             # something stands above the table
    arm_found: bool = False              # and it has an arm's shape (the gates in TrackerConfig)
    width_m: float = 0.0
    cyl_radius_m: float | None = None
    cyl_rms_m: float | None = None
    axis_tilt_deg: float | None = None   # the cylinder axis's angle above the table
    shape: dict = field(default_factory=dict)  # shape-gate features of the chosen (or largest) blob
    fine_px: int = 0                     # cloud only: pixels in the fine band joined to the arm
    hand_depth: bool = False
    forearm_yaw_deg: float | None = None
    forearm_ok: bool = False             # direction good enough to correct a glove with
    elongation: float = 0.0
    forearm_points: int = 0
    blob_px: int = 0
    dark_px: int = 0
    entry: str = ""                      # which image border the arm crosses: top, bottom, left, right, or ""
    length_m: float = 0.0
    dir_bench: np.ndarray | None = None  # (3,) unit forearm direction, bench frame
    entry_bench: np.ndarray | None = None
    process_ms: float = 0.0
    cloud: dict | None = None            # points (n,3) bench frame, labels (n,), rgb (n,3)
    bench_R: np.ndarray | None = None    # rows: bench axes in the points' frame
    bench_origin: np.ndarray | None = None
    in_world: bool = False
    masks: dict = field(default_factory=dict)  # arm, dark, table, valid at depth resolution (for images)


def wrap_deg(a: float) -> float:
    return (a + 180.0) % 360.0 - 180.0


def yaw_of_dir(v: np.ndarray) -> float:
    """Core yaw (degrees) of a direction in a y-up frame: atan2(-x, -z), as core/rgmp.py _yaw_of."""
    return math.degrees(math.atan2(-float(v[0]), -float(v[2])))


def rot_y(deg: float) -> np.ndarray:
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def backproject(frame: DepthFrame) -> tuple[np.ndarray, np.ndarray, bool]:
    """(points (H*W, 3), valid (H*W,), in_world). World when the frame has a camera transform."""
    d = frame.depth
    H, W = d.shape
    K = frame.depth_intrinsics()
    v, u = np.mgrid[0:H, 0:W]
    z = d.reshape(-1).astype(np.float64)
    valid = np.isfinite(z) & (z > 0)
    z = np.where(valid, z, 0.0)
    x = (u.reshape(-1) + 0.5 - K[0, 2]) / K[0, 0] * z
    y = (v.reshape(-1) + 0.5 - K[1, 2]) / K[1, 1] * z
    p = np.stack([x, y, z], -1)
    T = frame.transform
    if T is not None and not np.allclose(T, np.eye(4)):
        Tcv = np.asarray(T, dtype=float) @ ARKIT_TO_OPENCV
        p = p @ Tcv[:3, :3].T + Tcv[:3, 3]
        return p, valid, True
    return p, valid, False


def camera_pose(frame: DepthFrame, in_world: bool) -> tuple[np.ndarray, np.ndarray]:
    """Camera centre and viewing direction (OpenCV +z) in the points' frame."""
    if in_world:
        Tcv = np.asarray(frame.transform, dtype=float) @ ARKIT_TO_OPENCV
        return Tcv[:3, 3].copy(), Tcv[:3, 2].copy()
    return np.zeros(3), np.array([0.0, 0.0, 1.0])


def fit_plane_svd(p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    c = p.mean(axis=0)
    _, _, vt = np.linalg.svd(p - c, full_matrices=False)
    return c, vt[2]


def fit_table(p: np.ndarray, cam: np.ndarray, up: np.ndarray | None, cfg: TrackerConfig,
              rng: np.random.Generator) -> Table | None:
    """RANSAC plane on the given points (already confidence-masked). up: gravity, if known."""
    n_all = len(p)
    if n_all < 50:
        return None
    if n_all > cfg.ransac_points:
        p = p[rng.choice(n_all, cfg.ransac_points, replace=False)]
    n = len(p)
    cos_tilt = math.cos(math.radians(cfg.max_tilt_deg))
    best, best_cnt = None, 0
    idx = rng.integers(0, n, size=(cfg.ransac_iters, 3))
    for i0, i1, i2 in idx:
        a, b, c = p[i0], p[i1], p[i2]
        nn = np.cross(b - a, c - a)
        ln = np.linalg.norm(nn)
        if ln < 1e-9:
            continue
        nn /= ln
        if up is not None and abs(nn @ up) < cos_tilt:
            continue
        cnt = int((np.abs((p - a) @ nn) < cfg.ransac_tol_m).sum())
        if cnt > best_cnt:
            best, best_cnt = (a, nn), cnt
    if best is None or best_cnt < 30:
        return None
    a, nn = best
    inl = np.abs((p - a) @ nn) < cfg.ransac_tol_m
    c, nrm = fit_plane_svd(p[inl])
    if nrm @ (cam - c) < 0:
        nrm = -nrm
    res = (p[inl] - c) @ nrm
    t = Table(point=c, normal=nrm, source="fit", inliers=float(inl.mean()), rms_m=float(np.sqrt((res ** 2).mean())))
    t.camera_height_m = float((cam - c) @ nrm)
    return t


def app_table(frame: DepthFrame, cam: np.ndarray, in_world: bool) -> Table | None:
    if frame.plane is None or not in_world:
        return None
    P = np.asarray(frame.plane, dtype=float)
    point, normal = P[:3, 3].copy(), P[:3, 1] / max(1e-9, np.linalg.norm(P[:3, 1]))
    if normal @ (cam - point) < 0:
        normal = -normal
    t = Table(point=point, normal=normal, source="app")
    t.camera_height_m = float((cam - point) @ normal)
    return t


class DepthTracker:
    """Runs the steps in the module doc on each frame. Keeps the bench frame between frames."""

    def __init__(self, cfg: TrackerConfig | None = None, seed: int = 0) -> None:
        self.cfg = cfg or TrackerConfig()
        self.rng = np.random.default_rng(seed)
        self.ref_fwd: np.ndarray | None = None   # camera's first viewing direction on the table (world)
        self._ref_in_world: bool | None = None
        self.last_dir: np.ndarray | None = None
        self._recent: list[bool] = []
        self.frames = 0

    # -- bench frame -----------------------------------------------------------
    def bench_axes(self, table: Table, cam_fwd: np.ndarray, in_world: bool) -> np.ndarray:
        """3x3 rows X, Y, Z of the bench frame (core orientation) in the points' frame."""
        n = table.normal
        if self.ref_fwd is None or self._ref_in_world != in_world or not in_world:
            f = cam_fwd - (cam_fwd @ n) * n
            if np.linalg.norm(f) < 1e-6:
                f = np.cross(n, [1.0, 0.0, 0.0])
            self.ref_fwd = f / np.linalg.norm(f)
            self._ref_in_world = in_world
        f = self.ref_fwd - (self.ref_fwd @ n) * n
        f /= np.linalg.norm(f)
        X = np.cross(f, n)
        Z = -f
        R = np.stack([X, n, Z])                  # H frame: -Z = camera forward
        return rot_y(self.cfg.camera_yaw_deg) @ R  # turn to the core's world orientation

    # -- main ------------------------------------------------------------------
    def process(self, frame: DepthFrame, want_cloud: bool = False, want_masks: bool = False) -> DepthObs:
        import cv2
        t0 = time.perf_counter()
        cfg = self.cfg
        obs = DepthObs(t_us=frame.t_us, frame_id=frame.frame_id)
        self.frames += 1
        if frame.depth is None:
            obs.process_ms = (time.perf_counter() - t0) * 1000
            return obs
        H, W = frame.depth.shape
        p, valid, in_world = backproject(frame)
        cam, cam_fwd = camera_pose(frame, in_world)
        conf = frame.confidence.reshape(-1) if frame.confidence is not None else np.full(H * W, 2, np.uint8)
        dist = np.linalg.norm(p - cam, axis=1)
        near = valid & (dist <= cfg.max_range_m * 2.0)

        up = np.array([0.0, 1.0, 0.0]) if in_world else None
        hi = near & (conf >= 2)
        fit = fit_table(p[hi], cam, up, cfg, self.rng)
        app = app_table(frame, cam, in_world)
        obs.table_fit = fit
        obs.table = app or fit
        if app is not None and fit is not None:
            obs.agree_deg = round(math.degrees(math.acos(min(1.0, abs(float(app.normal @ fit.normal))))), 2)
            obs.agree_mm = round(float(fit.height(app.point[None])[0]) * 1000, 1)
        table = obs.table
        if table is None:
            obs.process_ms = (time.perf_counter() - t0) * 1000
            return obs

        h = table.height(p)
        arm = valid & (conf >= cfg.min_confidence) & (h >= cfg.band_min_m) & (h <= cfg.band_max_m) \
            & (dist <= cfg.max_range_m)
        arm_img = arm.reshape(H, W).astype(np.uint8)
        arm_img = cv2.morphologyEx(arm_img, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n_lab, lab, stats, _ = cv2.connectedComponentsWithStats(arm_img, connectivity=8)
        R = self.bench_axes(table, cam_fwd, in_world)
        obs.bench_R, obs.bench_origin, obs.in_world = R, table.point, in_world
        rel = p - table.point
        blob = None
        self._shape_pass = False
        order = [k for k in np.argsort(-stats[1:, cv2.CC_STAT_AREA]) + 1 if stats[k, cv2.CC_STAT_AREA] >= cfg.min_blob_px]
        if order:
            blob = lab == order[0]               # the largest, shown even when it is not an arm
            if cfg.gate == "shape":
                best = None
                for k in order:
                    sh = self._shape(lab == k, rel, R, H, W)
                    if k == order[0]:
                        obs.shape = sh
                    if sh["pass"]:
                        best = (k, sh)
                        break                    # the largest blob that passes
                if best is not None:
                    blob = lab == best[0]
                    obs.shape = best[1]
                    self._shape_pass = True
        dark_img = np.zeros((H, W), bool)
        if blob is not None:
            obs.blob_found = True
            obs.blob_px = int(blob.sum())
            self._forearm(obs, blob, rel, R, H, W, dist, R @ (cam - table.point))
            dark_img = self._dark_patch(obs, blob, conf.reshape(H, W), valid.reshape(H, W), h.reshape(H, W))
        else:
            self._push_pass(False)
        if want_cloud:
            cloud_arm = None
            if blob is not None and obs.arm_found:
                # the arm plus the fine band joined to it: fingers flat on the table (view only)
                fine = (valid & (conf >= 2) & (h >= cfg.cloud_fine_band_m) & (h <= cfg.band_max_m)
                        & (dist <= cfg.max_range_m)).reshape(H, W)
                n_f, lab_f = cv2.connectedComponents((fine | blob).astype(np.uint8), connectivity=8)
                ids = np.unique(lab_f[blob])
                cloud_arm = np.isin(lab_f, ids[ids > 0])
                obs.fine_px = int(cloud_arm.sum() - blob.sum())
            obs.cloud = self._cloud(frame, rel @ R.T, valid & (dist <= cfg.max_range_m * 1.5), h,
                                    None if cloud_arm is None else cloud_arm.reshape(-1), dark_img.reshape(-1),
                                    conf)
        if want_masks:
            obs.masks = {"arm": blob if blob is not None else np.zeros((H, W), bool), "dark": dark_img,
                         "table": (valid & (np.abs(h) < cfg.table_band_m)).reshape(H, W),
                         "valid": valid.reshape(H, W)}
        obs.process_ms = (time.perf_counter() - t0) * 1000
        return obs

    def _push_pass(self, passed: bool) -> None:
        self._recent.append(bool(passed))
        del self._recent[:-max(1, self.cfg.arm_confirm_window)]

    def _border(self, H: int, W: int) -> np.ndarray:
        m = max(1, int(self.cfg.entry_margin_px))
        border = np.zeros((H, W), bool)
        border[:m, :] = border[-m:, :] = True
        border[:, :m] = border[:, -m:] = True
        return border

    def _shape(self, bm: np.ndarray, rel: np.ndarray, R: np.ndarray, H: int, W: int) -> dict:
        """Shape features of one blob for the "shape" gate, in the bench frame."""
        cfg = self.cfg
        out = {"pass": False, "entry": False, "length_m": 0.0, "taper": 0.0, "wmax_m": 0.0, "h95_m": 0.0}
        flat = bm.reshape(-1)
        q = rel[flat] @ R.T
        xz, hh = q[:, [0, 2]], q[:, 1]
        out["h95_m"] = round(float(np.percentile(hh, 95)), 4)
        edge = (bm & self._border(H, W)).reshape(-1)[flat]
        if edge.sum() < 3:
            return out
        out["entry"] = True
        e = np.median(xz[edge], axis=0)
        ax = xz.mean(axis=0) - e
        if np.linalg.norm(ax) < 1e-6:
            return out
        ax /= np.linalg.norm(ax)
        side = np.array([-ax[1], ax[0]])
        s, lat = (xz - e) @ ax, (xz - e) @ side
        L = float(np.percentile(s, 98))
        ws = []
        for b in np.arange(0.0, L, 0.01):
            m = (s >= b) & (s < b + 0.01)
            if m.sum() >= 4:
                lo, hi = np.percentile(lat[m], [5, 95])
                ws.append(hi - lo)
        if len(ws) < 4:
            return out
        ws = np.array(ws)
        half = len(ws) // 2
        out["length_m"] = round(L, 3)
        out["taper"] = round(float(ws[half:].max() / max(ws[:half].min(), 1e-3)), 2)
        out["wmax_m"] = round(float(ws.max()), 3)
        out["pass"] = bool(int(bm.sum()) >= cfg.arm_min_px and cfg.arm_len_min_m <= L <= cfg.arm_len_max_m and out["taper"] >= cfg.arm_taper_min
                           and cfg.arm_wmax_min_m <= out["wmax_m"] <= cfg.arm_wmax_max_m
                           and out["h95_m"] <= cfg.arm_h95_max_m)
        return out

    def _forearm(self, obs: DepthObs, blob: np.ndarray, rel: np.ndarray, R: np.ndarray, H: int, W: int,
                 dist: np.ndarray, cam_bench: np.ndarray) -> None:
        import cv2
        cfg = self.cfg
        flat = blob.reshape(-1)
        q = rel[flat] @ R.T                 # bench frame
        xz = q[:, [0, 2]]
        centre = xz.mean(axis=0)
        border = self._border(H, W)
        m_px = max(1, int(cfg.entry_margin_px))
        edge = blob & border
        entry = None
        if edge.sum() >= 3:
            # The arm may touch the border in several places (fingers can leave the image too).
            # Each contiguous run of border contact is a candidate; the arm comes from the person,
            # so take the run farthest from the camera, and keep with the last direction if it flips.
            n_runs, runs = cv2.connectedComponents(cv2.dilate(edge.astype(np.uint8), np.ones((3, 3), np.uint8)) & edge.astype(np.uint8), connectivity=8)
            runs_flat = runs.reshape(-1)[flat]
            dist_blob = dist[flat]
            best, best_score = None, -math.inf
            for r in range(1, n_runs):
                m = runs_flat == r
                if m.sum() < 3:
                    continue
                e = np.median(xz[m], axis=0)
                score = float(np.median(dist_blob[m]))
                if self.last_dir is not None:
                    v = centre - e
                    if np.linalg.norm(v) > 1e-6 and (v / np.linalg.norm(v)) @ self.last_dir[[0, 2]] < -0.3:
                        score -= 10.0
                if score > best_score:
                    best, best_score = (e, m), score
            if best is not None:
                entry = best[0]
                vv, uu = np.nonzero(runs == (np.bincount(runs_flat[best[1]]).argmax()))
                sides = {"top": (vv < m_px).sum(), "bottom": (vv >= H - m_px).sum(), "left": (uu < m_px).sum(),
                         "right": (uu >= W - m_px).sum()}
                obs.entry = max(sides, key=sides.get)
        if entry is not None:
            sel = np.linalg.norm(xz - entry, axis=1) <= cfg.forearm_len_m
        else:
            sel = np.ones(len(xz), bool)
        pts = xz[sel]
        obs.forearm_points = int(len(pts))
        if len(pts) < 5:
            return
        c = pts.mean(axis=0)
        cov = np.cov((pts - c).T)
        w, V = np.linalg.eigh(cov)
        axis = V[:, 1]
        axis_pca = axis.copy()
        obs.elongation = float(math.sqrt(max(w[1], 1e-12) / max(w[0], 1e-12)))
        obs.width_m = float(math.sqrt(12.0 * max(w[0], 0.0)))   # full width of a uniform band
        if cfg.cylinder:
            d3 = self._cylinder_axis(q[sel], axis, cam_bench, obs)
            if d3 is not None:
                obs.axis_tilt_deg = float(math.degrees(math.atan2(abs(d3[1]), np.hypot(d3[0], d3[2]))))
            if d3 is not None and np.hypot(d3[0], d3[2]) > 1e-6:
                a2 = np.array([d3[0], d3[2]]) / np.hypot(d3[0], d3[2])
                axis = a2 if a2 @ axis >= 0 else -a2
        if entry is not None:
            if (centre - entry) @ axis < 0:
                axis = -axis
        elif self.last_dir is not None:
            if axis @ self.last_dir[[0, 2]] < 0:
                axis = -axis
        else:
            # no entry seen and no history: the arm reaches from the person, so it points to the camera,
            # which is bench +z turned back by camera_yaw_deg
            toward_cam = (rot_y(self.cfg.camera_yaw_deg) @ np.array([0.0, 0.0, 1.0]))[[0, 2]]
            if axis @ toward_cam < 0:
                axis = -axis
        d = np.array([axis[0], 0.0, axis[1]])
        obs.dir_bench = d
        obs.entry_bench = None if entry is None else np.array([entry[0], 0.0, entry[1]])
        proj = (xz - (entry if entry is not None else c)) @ axis
        obs.length_m = float(np.percentile(proj, 98) - min(0.0, float(np.percentile(proj, 2))))
        obs.forearm_yaw_deg = round(yaw_of_dir(d), 2)
        if cfg.gate == "shape":
            if cfg.cylinder and not (obs.cyl_rms_m is not None and obs.cyl_rms_m <= cfg.cylinder_max_rms_m
                                     and obs.cyl_radius_m is not None
                                     and cfg.arm_radius_min_m <= obs.cyl_radius_m <= cfg.arm_radius_max_m):
                # a flat hand is no cylinder: keep the plain axis for it
                a = axis_pca if (entry is None or (centre - entry) @ axis_pca >= 0) else -axis_pca
                d = np.array([a[0], 0.0, a[1]])
                obs.dir_bench = d
                obs.forearm_yaw_deg = round(yaw_of_dir(d), 2)
            passed = bool(self._shape_pass and entry is not None)
            self._push_pass(passed)
            obs.shape["recent"] = int(sum(self._recent))
            obs.arm_found = passed and sum(self._recent) >= max(1, cfg.arm_confirm_frames)
            obs.forearm_ok = obs.arm_found and obs.forearm_points >= cfg.min_forearm_points
            if obs.forearm_ok:
                self.last_dir = obs.dir_bench
            return
        arm_like = cfg.arm_width_min_m <= obs.width_m <= cfg.arm_width_max_m
        if cfg.require_entry:
            arm_like = arm_like and entry is not None
        if cfg.cylinder:
            arm_like = arm_like and obs.cyl_radius_m is not None \
                and cfg.arm_radius_min_m <= obs.cyl_radius_m <= cfg.arm_radius_max_m \
                and obs.cyl_rms_m is not None and obs.cyl_rms_m <= cfg.cylinder_max_rms_m \
                and obs.axis_tilt_deg is not None and obs.axis_tilt_deg <= cfg.arm_max_tilt_deg
        obs.arm_found = bool(arm_like)
        obs.forearm_ok = obs.arm_found and obs.elongation >= cfg.min_elongation \
            and obs.forearm_points >= cfg.min_forearm_points
        if obs.forearm_ok:
            self.last_dir = d

    def _cylinder_axis(self, P: np.ndarray, axis_xz: np.ndarray, cam: np.ndarray,
                       obs: DepthObs | None = None) -> np.ndarray | None:
        """Fit a cylinder to the forearm's 3D points (bench frame); its axis direction, or None.

        The camera sees only the near half of the arm, and from a different angle along it,
        so any line through the visible points leans: about 5 degrees at 5 to 15 degrees of
        yaw on the fake scene, even without noise. A cylinder fit puts the axis behind the
        visible surface, where it is. Gauss-Newton on (direction, offset, radius), numeric
        Jacobian, about ten steps on at most 400 points.
        """
        if len(P) < 30:
            return None
        if len(P) > 400:
            P = P[np.linspace(0, len(P) - 1, 400).astype(int)]
        d0 = np.array([axis_xz[0], 0.0, axis_xz[1]])
        d0 /= np.linalg.norm(d0)
        c0 = P.mean(axis=0)
        u = np.cross(d0, [0.0, 1.0, 0.0])
        u /= np.linalg.norm(u)
        v = np.cross(u, d0)
        away = c0 - cam
        away -= (away @ d0) * d0
        if np.linalg.norm(away) > 1e-6:
            away /= np.linalg.norm(away)
        r0 = 0.035
        start = c0 + r0 * away

        def unpack(x):
            d = d0 + x[0] * u + x[1] * v
            d /= np.linalg.norm(d)
            c = start + x[2] * u + x[3] * v
            return d, c, x[4]

        def resid(x):
            d, c, r = unpack(x)
            w = P - c
            return np.linalg.norm(np.cross(w, d), axis=1) - r

        x = np.array([0.0, 0.0, 0.0, 0.0, r0])
        for _ in range(12):
            f = resid(x)
            J = np.empty((len(f), 5))
            for k in range(5):
                dx = np.zeros(5)
                dx[k] = 1e-5
                J[:, k] = (resid(x + dx) - f) / 1e-5
            step, *_ = np.linalg.lstsq(J.T @ J + 1e-6 * np.eye(5), -J.T @ f, rcond=None)
            x = x + step
            if np.abs(step).max() < 1e-6:
                break
        d, c, r = unpack(x)
        if not np.isfinite(d).all() or not np.isfinite(r):
            return None
        if obs is not None:
            obs.cyl_radius_m = float(abs(r))
            obs.cyl_rms_m = float(np.sqrt(np.mean(resid(x) ** 2)))
        return d

    def _dark_patch(self, obs: DepthObs, blob: np.ndarray, conf: np.ndarray, valid: np.ndarray,
                    h: np.ndarray) -> np.ndarray:
        """Low-confidence pixels touching the arm blob and not part of the table: a hand with no depth."""
        import cv2
        low = valid & (conf == 0) & ~blob & (h > -0.02)
        # thin low-confidence bands follow every depth edge; a dark hand is a thick patch
        low = cv2.morphologyEx(low.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)).astype(bool)
        if not low.any():
            obs.hand_depth = True
            return np.zeros_like(blob)
        n, lab = cv2.connectedComponents(low.astype(np.uint8), connectivity=8)
        grown = cv2.dilate(blob.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
        touching = np.unique(lab[grown & low])
        touching = touching[touching > 0]
        dark = np.isin(lab, touching) if len(touching) else np.zeros_like(blob)
        obs.dark_px = int(dark.sum())
        obs.hand_depth = obs.dark_px < self.cfg.dark_min_px
        return dark

    def _cloud(self, frame: DepthFrame, q: np.ndarray, keep: np.ndarray, h: np.ndarray,
               blob: np.ndarray | None, dark: np.ndarray, conf: np.ndarray | None = None) -> dict:
        import cv2
        idx = np.nonzero(keep)[0]
        n_target = self.cfg.cloud_points
        if blob is not None:
            arm_idx = np.nonzero(blob & keep)[0]
            rest = np.setdiff1d(idx, arm_idx, assume_unique=True)
            n_arm = min(len(arm_idx), n_target // 2)
            pick = np.concatenate([
                arm_idx[np.linspace(0, len(arm_idx) - 1, n_arm).astype(int)] if n_arm else arm_idx[:0],
                rest[np.linspace(0, len(rest) - 1, min(len(rest), n_target - n_arm)).astype(int)] if len(rest) else rest,
            ])
        else:
            pick = idx[np.linspace(0, len(idx) - 1, min(len(idx), n_target)).astype(int)] if len(idx) else idx
        labels = np.full(len(pick), LABEL_OTHER, np.uint8)
        labels[np.abs(h[pick]) < self.cfg.table_band_m] = LABEL_TABLE
        if conf is not None:   # sure points a few millimetres up are not table (a flat hand)
            up = (h[pick] >= self.cfg.cloud_fine_band_m) & (conf[pick] >= 2)
            labels[up & (labels == LABEL_TABLE)] = LABEL_OTHER
        if blob is not None:
            labels[blob[pick]] = LABEL_ARM
        labels[dark[pick]] = LABEL_DARK
        H, W = frame.depth.shape
        small = cv2.resize(frame.bgr, (W, H), interpolation=cv2.INTER_AREA).reshape(-1, 3)
        rgb = small[pick][:, ::-1]
        return {"points": q[pick], "labels": labels, "rgb": rgb}


@dataclass
class YawCorrectorConfig:
    """[camera.depth] keys for the correction."""

    side: str = "right"               # the glove whose forearm the phone sees
    reference: str = "lock"           # "lock": learn the depth-glove offset first, then remove drift from it;
                                      # "table": trust camera_yaw_deg and correct to the absolute bench yaw
    lock_s: float = 2.0               # how long to average before the lock
    lock_min_samples: int = 20
    tau_s: float = 1.5                # time constant of the slow offset (SPEC: 2 percent a frame at 30 Hz)
    outlier_deg: float = 25.0         # a sample this far from the current correction is skipped,
    outlier_run: int = 45             # unless this many in a row agree it is real (about 1.5 s)
    max_correction_deg: float = 60.0
    max_rate_deg_s: float = 3.0       # the offset never moves faster than this, whatever the depth says
    stale_ms: float = 300.0           # depth older than this does not update the correction

    @classmethod
    def from_section(cls, sec) -> "YawCorrectorConfig":
        c = cls()
        if sec is None:
            return c
        for k in c.__dataclass_fields__:
            if k in sec:
                setattr(c, k, type(getattr(c, k))(sec[k]))
        return c


def circ_mean_deg(a) -> float:
    r = np.radians(np.asarray(a, dtype=float))
    return math.degrees(math.atan2(np.sin(r).mean(), np.cos(r).mean()))


class YawCorrector:
    """Slow yaw offset for one glove from the depth forearm yaw. Pure: no threads, no clock."""

    def __init__(self, cfg: YawCorrectorConfig | None = None) -> None:
        self.cfg = cfg or YawCorrectorConfig()
        self.offset_deg = 0.0
        self.ref_deg: float | None = 0.0 if self.cfg.reference == "table" else None
        self._lock: list[tuple[int, float]] = []
        self.last_us: int | None = None
        self.updates = 0
        self.outliers = 0
        self._run = 0
        self.last_target: float | None = None

    @property
    def locked(self) -> bool:
        return self.ref_deg is not None

    def reset(self) -> None:
        self.__init__(self.cfg)

    def update(self, t_us: int, glove_yaw_deg: float, depth_yaw_deg: float) -> bool:
        """Feed one paired sample (glove yaw before correction). True if the offset moved."""
        diff = wrap_deg(depth_yaw_deg - glove_yaw_deg)
        if self.ref_deg is None:
            self._lock.append((t_us, diff))
            span = (self._lock[-1][0] - self._lock[0][0]) / 1e6
            if span >= self.cfg.lock_s and len(self._lock) >= self.cfg.lock_min_samples:
                self.ref_deg = circ_mean_deg([d for _, d in self._lock])
                self._lock = []
                self.last_us = t_us
            return False
        target = wrap_deg(diff - self.ref_deg)
        self.last_target = target
        err = wrap_deg(target - self.offset_deg)
        if abs(err) > self.cfg.outlier_deg:
            self.outliers += 1
            self._run += 1
            if self._run < self.cfg.outlier_run:
                self.last_us = t_us
                return False
        else:
            self._run = 0
        dt = 0.0 if self.last_us is None else max(0.0, min(0.2, (t_us - self.last_us) / 1e6))
        self.last_us = t_us
        k = 1.0 - math.exp(-dt / max(1e-3, self.cfg.tau_s))
        step = k * err
        cap = max(0.0, self.cfg.max_rate_deg_s) * dt
        step = float(np.clip(step, -cap, cap))
        self.offset_deg = float(np.clip(self.offset_deg + step, -self.cfg.max_correction_deg,
                                        self.cfg.max_correction_deg))
        self.updates += 1
        return True
