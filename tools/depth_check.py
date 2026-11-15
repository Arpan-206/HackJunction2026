"""One-command check of a GeppettoDepth recording (.gdrec or .gdrec.gz) with the core's depth tracker.

    python -m tools.depth_check captures/bench-3.gdrec.gz
    python -m tools.depth_check FILE [--out logs/depth/NAME] [--images 8] [--every 1] [--camera-yaw 180]

Prints, and writes to <out>/summary.json:
- the table plane: the app's plane (how often present, camera height above it) and our
  RANSAC fit, how far they disagree in degrees and mm, and how steady the height is;
- the blob-found fraction (anything above the table), the hand-found fraction (a blob with
  an arm's shape), forearm_ok and hand_depth fractions;
- forearm direction stability: frame-to-frame yaw change and spread while found;
- latency per frame: tracker time, arrival interval on the Mac, and the jitter of
  arrival minus the phone's own timestamp (the absolute latency is not measurable
  from one clock pair, its spread is).
Images go to <out>/ (default logs/depth/<time>/): for a few frames, the colour image with
the arm (green), the no-depth patch (red), the table (blue tint) and the forearm arrow,
plus the colour-mapped depth and confidence. frames.csv has one row per frame.

Run it on the fake recordings first (python -m core.camera.fake_depth --record ...) so
you know what good output looks like; the fake is not real data.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.camera.depth_track import (
    ARKIT_TO_OPENCV,
    DepthTracker,
    TrackerConfig,
    wrap_deg,
)
from core.camera.gdrec import read_note, read_recording
from core.camera.geppetto_depth import PREFIX, colour_depth, parse_header, parse_packet
from core.config import REPO_ROOT, load_config


def _q(a, ps):
    return [round(float(x), 3) for x in np.percentile(a, ps)] if len(a) else None


def project_world(frame, P: np.ndarray) -> np.ndarray | None:
    """World points (n,3) to colour-image pixels (n,2), or None without a camera transform."""
    if frame.transform is None:
        return None
    Tcv = np.asarray(frame.transform, dtype=float) @ ARKIT_TO_OPENCV
    Rc, tc = Tcv[:3, :3], Tcv[:3, 3]
    pc = (P - tc) @ Rc
    if (pc[:, 2] <= 1e-6).any():
        return None
    uv = pc[:, :2] / pc[:, 2:3]
    return uv * [frame.K[0, 0], frame.K[1, 1]] + [frame.K[0, 2], frame.K[1, 2]]


def overlay(frame, obs) -> np.ndarray:
    import cv2

    img = frame.bgr.copy()
    W, H = img.shape[1], img.shape[0]

    def up(m):
        return cv2.resize(
            m.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST
        ).astype(bool)

    if obs.masks:
        t, a, d = up(obs.masks["table"]), up(obs.masks["arm"]), up(obs.masks["dark"])
        img[t] = (0.7 * img[t] + 0.3 * np.array([200, 120, 40])).astype(np.uint8)
        img[a] = (0.4 * img[a] + 0.6 * np.array([90, 200, 60])).astype(np.uint8)
        img[d] = (0.4 * img[d] + 0.6 * np.array([40, 40, 220])).astype(np.uint8)
    if (
        obs.dir_bench is not None
        and obs.entry_bench is not None
        and obs.bench_R is not None
        and obs.in_world
    ):
        e = obs.entry_bench + np.array([0.0, 0.06, 0.0])
        pts = np.stack([e, e + 0.2 * obs.dir_bench])
        world = pts @ obs.bench_R + obs.bench_origin
        uv = project_world(frame, world)
        if uv is not None:
            p0, p1 = (int(uv[0, 0]), int(uv[0, 1])), (int(uv[1, 0]), int(uv[1, 1]))
            cv2.arrowedLine(
                img,
                p0,
                p1,
                (60, 220, 60) if obs.forearm_ok else (40, 180, 230),
                3,
                tipLength=0.15,
            )
    txt = (
        f"#{obs.frame_id} table {obs.table.source if obs.table else '-'} arm {int(obs.arm_found)} "
        f"yaw {obs.forearm_yaw_deg if obs.forearm_yaw_deg is not None else '-'} "
        f"hand_depth {int(obs.hand_depth)} {obs.process_ms:.0f} ms"
    )
    cv2.putText(img, txt, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3)
    cv2.putText(img, txt, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
    return img


def span_label(spans: list[dict], k: int) -> str:
    for sp in spans:
        if sp["from"] <= k <= sp["to"]:
            return sp["label"]
    return "unlabelled"


def span_scores(spans: list[dict], indices: list[int], found: list[bool]) -> dict:
    """Found rate per label; for "no_arm" that rate is the false-accept rate."""
    out: dict = {}
    for lab in sorted({sp["label"] for sp in spans} | {"unlabelled"}):
        ks = [f for k, f in zip(indices, found) if span_label(spans, k) == lab]
        if ks:
            out[lab] = {
                "frames": len(ks),
                "found": int(sum(ks)),
                "rate": round(sum(ks) / len(ks), 3),
            }
    na = [k for k, f in zip(indices, found) if f and span_label(spans, k) == "no_arm"]
    out["false_accept_frames"] = na[:50]
    return out


def check(
    path: Path,
    out: Path,
    n_images: int = 8,
    every: int = 1,
    tracker_cfg: TrackerConfig | None = None,
    spans: list[dict] | None = None,
    colour=None,
) -> dict:
    """colour: a core.camera.depth_colour.ColourHands, or None for depth only."""
    import cv2

    out.mkdir(parents=True, exist_ok=True)
    tr = DepthTracker(tracker_cfg)
    rows, obs_all, idx_all, col_all = [], [], [], []
    arrivals, stream_ts, tracking = [], [], []
    packets = list(read_recording(path))
    picks = (
        set(
            np.linspace(0, max(0, len(packets) - 1), min(n_images, len(packets)))
            .astype(int)
            .tolist()
        )
        if packets
        else set()
    )
    frames_seen = 0
    for k, (arrival_us, pkt) in enumerate(packets):
        if k % every:
            continue
        f = parse_packet(pkt, arrival_us)
        if f is None:
            rows.append({"index": k, "bad": 1})
            continue
        h = parse_header(memoryview(pkt)[PREFIX.size :])
        tracking.append(h.tracking if h else -1)
        frames_seen += 1
        arrivals.append(arrival_us)
        stream_ts.append(f.stream_t)
        want_img = k in picks
        o = tr.process(f, want_masks=want_img)
        obs_all.append(o)
        idx_all.append(k)
        if colour is not None:
            co = colour.confirm(colour.detect(f), f, o)
            col_all.append(co)
            ch = co.confirmed
            if want_img and ch is not None and ch.mask is not None:
                o.masks["arm"] = o.masks.get("arm", np.zeros_like(ch.mask)) | ch.mask
        rows.append(
            {
                "index": k,
                "frame_id": f.frame_id,
                "arrival_us": arrival_us,
                "stream_t": round(f.stream_t, 4),
                "process_ms": round(o.process_ms, 2),
                "plane_from_app": int(f.plane is not None),
                "table": o.table.source if o.table else "",
                "camera_height_m": round(o.table.camera_height_m, 4) if o.table else "",
                "fit_height_m": round(o.table_fit.camera_height_m, 4)
                if o.table_fit
                else "",
                "agree_deg": o.agree_deg if o.agree_deg is not None else "",
                "agree_mm": o.agree_mm if o.agree_mm is not None else "",
                "blob": int(o.blob_found),
                "arm": int(o.arm_found),
                "label": span_label(spans, k) if spans else "",
                "shape_len_m": o.shape.get("length_m", ""),
                "shape_taper": o.shape.get("taper", ""),
                "shape_wmax_m": o.shape.get("wmax_m", ""),
                "shape_h95_m": o.shape.get("h95_m", ""),
                "width_m": round(o.width_m, 3),
                "cyl_radius_m": round(o.cyl_radius_m, 4)
                if o.cyl_radius_m is not None
                else "",
                "cyl_rms_mm": round(o.cyl_rms_m * 1000, 2)
                if o.cyl_rms_m is not None
                else "",
                "axis_tilt_deg": round(o.axis_tilt_deg, 1)
                if o.axis_tilt_deg is not None
                else "",
                "forearm_ok": int(o.forearm_ok),
                "hand_depth": int(o.hand_depth),
                "yaw_deg": o.forearm_yaw_deg if o.forearm_yaw_deg is not None else "",
                "elongation": round(o.elongation, 2),
                "blob_px": o.blob_px,
                "dark_px": o.dark_px,
                "entry": o.entry,
                "bad": 0,
            }
        )
        if want_img:
            cv2.imwrite(str(out / f"frame_{k:05d}_overlay.jpg"), overlay(f, o))
            if f.depth is not None:
                cv2.imwrite(
                    str(out / f"frame_{k:05d}_depth.png"),
                    cv2.resize(
                        colour_depth(f.depth),
                        (512, 384),
                        interpolation=cv2.INTER_NEAREST,
                    ),
                )
            if f.confidence is not None:
                cv2.imwrite(
                    str(out / f"frame_{k:05d}_confidence.png"),
                    cv2.resize(
                        (f.confidence.astype(np.uint16) * 127)
                        .clip(0, 255)
                        .astype(np.uint8),
                        (512, 384),
                        interpolation=cv2.INTER_NEAREST,
                    ),
                )
    with open(out / "frames.csv", "w", newline="") as fh:
        keys = sorted({k for r in rows for k in r})
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)

    n = len(obs_all)
    found = [o for o in obs_all if o.arm_found]
    ok = [o for o in obs_all if o.forearm_ok]
    yaws = np.array([o.forearm_yaw_deg for o in ok], dtype=float)
    ok_ids = [i for i, o in enumerate(obs_all) if o.forearm_ok]
    steps = np.array(
        [
            abs(wrap_deg(obs_all[b].forearm_yaw_deg - obs_all[a].forearm_yaw_deg))
            for a, b in zip(ok_ids, ok_ids[1:])
            if b == a + 1
        ]
    )
    app_h = np.array(
        [
            o.table.camera_height_m
            for o in obs_all
            if o.table is not None and o.table.source == "app"
        ]
    )
    fit_h = np.array(
        [o.table_fit.camera_height_m for o in obs_all if o.table_fit is not None]
    )
    fit_n = np.array([o.table_fit.normal for o in obs_all if o.table_fit is not None])
    in_world = any(o.in_world for o in obs_all)
    agree_deg = np.array([o.agree_deg for o in obs_all if o.agree_deg is not None])
    agree_mm = np.array([o.agree_mm for o in obs_all if o.agree_mm is not None])
    proc = np.array([o.process_ms for o in obs_all])
    arr = np.array(arrivals, dtype=np.int64)
    gaps_ms = np.diff(arr) / 1000.0 if len(arr) > 1 else np.array([])
    skew = (arr / 1e6 - np.array(stream_ts)) if len(arr) else np.array([])
    skew_ms = (skew - skew.min()) * 1000.0 if len(skew) else skew
    yaw_circ_std = None
    if len(yaws):
        r = np.radians(yaws)
        R = math.hypot(np.cos(r).mean(), np.sin(r).mean())
        yaw_circ_std = round(
            math.degrees(math.sqrt(max(0.0, -2 * math.log(max(R, 1e-12))))), 2
        )
    summary = {
        "file": str(path),
        "note": read_note(path),
        "out": str(out),
        "frames": n,
        "bad_packets": sum(r.get("bad", 0) for r in rows),
        "tracking_normal_fraction": round(float(np.mean(np.array(tracking) == 2)), 3)
        if tracking
        else None,
        "points_in": "world (ARKit, gravity up)"
        if in_world
        else "camera (no transform)",
        "table": {
            "app_plane_fraction": round(
                float(
                    np.mean(
                        [
                            o.table is not None and o.table.source == "app"
                            for o in obs_all
                        ]
                    )
                ),
                3,
            )
            if n
            else None,
            "found_fraction": round(
                float(np.mean([o.table is not None for o in obs_all])), 3
            )
            if n
            else None,
            "camera_height_app_m": {
                "median": _q(app_h, [50])[0] if len(app_h) else None,
                "std_mm": round(float(app_h.std() * 1000), 2) if len(app_h) else None,
            },
            "camera_height_fit_m": {
                "median": _q(fit_h, [50])[0] if len(fit_h) else None,
                "std_mm": round(float(fit_h.std() * 1000), 2) if len(fit_h) else None,
            },
            "fit_normal_median": [round(float(x), 4) for x in np.median(fit_n, axis=0)]
            if len(fit_n)
            else None,
            "fit_tilt_from_up_deg": round(
                math.degrees(
                    math.acos(
                        min(
                            1.0,
                            abs(
                                float(np.median(fit_n, axis=0)[1])
                                / max(
                                    1e-9,
                                    float(np.linalg.norm(np.median(fit_n, axis=0))),
                                )
                            ),
                        )
                    )
                ),
                2,
            )
            if len(fit_n) and in_world
            else None,
            "fit_inliers_median": round(
                float(np.median([o.table_fit.inliers for o in obs_all if o.table_fit])),
                3,
            )
            if len(fit_h)
            else None,
            "fit_rms_mm_median": round(
                float(
                    np.median([o.table_fit.rms_m for o in obs_all if o.table_fit])
                    * 1000
                ),
                2,
            )
            if len(fit_h)
            else None,
            "app_vs_fit_deg": {
                "median": _q(agree_deg, [50])[0] if len(agree_deg) else None,
                "p95": _q(agree_deg, [95])[0] if len(agree_deg) else None,
            },
            "app_vs_fit_mm": {
                "median": _q(agree_mm, [50])[0] if len(agree_mm) else None,
                "p95": _q(np.abs(agree_mm), [95])[0] if len(agree_mm) else None,
            },
        },
        "hand": {
            "blob_fraction": round(float(np.mean([o.blob_found for o in obs_all])), 3)
            if n
            else None,
            "found_fraction": round(len(found) / n, 3) if n else None,
            "width_m_median": round(
                float(np.median([o.width_m for o in obs_all if o.blob_found])), 3
            )
            if any(o.blob_found for o in obs_all)
            else None,
            "cylinder_radius_m_median": round(
                float(
                    np.median(
                        [o.cyl_radius_m for o in obs_all if o.cyl_radius_m is not None]
                    )
                ),
                4,
            )
            if any(o.cyl_radius_m is not None for o in obs_all)
            else None,
            "forearm_ok_fraction": round(len(ok) / n, 3) if n else None,
            "hand_depth_fraction_when_found": round(
                float(np.mean([o.hand_depth for o in found])), 3
            )
            if found
            else None,
            "entry_sides": {
                s: sum(o.entry == s for o in found)
                for s in ("top", "bottom", "left", "right", "")
            }
            if found
            else {},
        },
        "forearm_yaw": {
            "frames": len(yaws),
            "circular_std_deg": yaw_circ_std,
            "range_deg": round(
                float(np.ptp(np.degrees(np.unwrap(np.radians(yaws))))), 2
            )
            if len(yaws)
            else None,
            "step_abs_deg_median": _q(steps, [50])[0] if len(steps) else None,
            "step_abs_deg_p95": _q(steps, [95])[0] if len(steps) else None,
            "elongation_median": round(float(np.median([o.elongation for o in ok])), 2)
            if ok
            else None,
        },
        "latency": {
            "process_ms": {
                "mean": round(float(proc.mean()), 2) if n else None,
                "p95": _q(proc, [95])[0] if n else None,
                "max": round(float(proc.max()), 2) if n else None,
            },
            "arrival_interval_ms": {
                "median": _q(gaps_ms, [50])[0] if len(gaps_ms) else None,
                "p95": _q(gaps_ms, [95])[0] if len(gaps_ms) else None,
                "max": round(float(gaps_ms.max()), 1) if len(gaps_ms) else None,
            },
            "fps": round(1000.0 / float(np.median(gaps_ms)), 1)
            if len(gaps_ms)
            else None,
            "arrival_minus_phone_jitter_ms": {
                "p50": _q(skew_ms, [50])[0] if len(skew_ms) else None,
                "p95": _q(skew_ms, [95])[0] if len(skew_ms) else None,
            },
        },
    }
    if colour is not None:
        cf = [c.confirmed is not None for c in col_all]
        prop = [len(c.hands) > 0 for c in col_all]
        cms = np.array([c.ms for c in col_all])
        cy = [c.confirmed.yaw_deg for c in col_all if c.confirmed is not None]
        steps_c = []
        for a, b in zip(col_all, col_all[1:]):
            if a.confirmed is not None and b.confirmed is not None:
                steps_c.append(abs(wrap_deg(b.confirmed.yaw_deg - a.confirmed.yaw_deg)))
        reasons: dict = {}
        for c in col_all:
            for h in c.hands:
                reasons[h.reason] = reasons.get(h.reason, 0) + 1
        both = [
            o.forearm_yaw_deg
            for o, c in zip(obs_all, col_all)
            if o.arm_found and c.confirmed is not None and o.forearm_yaw_deg is not None
        ]
        dis = [
            abs(wrap_deg(o.forearm_yaw_deg - c.confirmed.yaw_deg))
            for o, c in zip(obs_all, col_all)
            if o.arm_found and c.confirmed is not None and o.forearm_yaw_deg is not None
        ]
        summary["colour"] = {
            "proposed_fraction": round(float(np.mean(prop)), 3) if prop else None,
            "confirmed_fraction": round(float(np.mean(cf)), 3) if cf else None,
            "reasons": reasons,
            "ms": {"mean": round(float(cms.mean()), 1), "p95": _q(cms, [95])[0]}
            if len(cms)
            else None,
            "hand_yaw_step_abs_deg": {
                "median": _q(np.array(steps_c), [50])[0] if steps_c else None,
                "p95": _q(np.array(steps_c), [95])[0] if steps_c else None,
            },
            "hand_yaw_frames": len(cy),
            "forearm_vs_hand_yaw_deg": {
                "frames": len(both),
                "median": _q(np.array(dis), [50])[0] if dis else None,
            },
        }
        for c, r in zip(col_all, [r for r in rows if not r.get("bad")]):
            r["colour"] = int(c.confirmed is not None)
            r["colour_yaw_deg"] = c.confirmed.yaw_deg if c.confirmed is not None else ""
        with open(out / "frames.csv", "w", newline="") as fh:
            keys = sorted({k for r in rows for k in r})
            w = csv.DictWriter(fh, fieldnames=keys)
            w.writeheader()
            w.writerows(rows)
    if spans:
        summary["spans"] = span_scores(spans, idx_all, [o.arm_found for o in obs_all])
        if colour is not None:
            cf = [c.confirmed is not None for c in col_all]
            summary["spans_colour_and_depth"] = span_scores(spans, idx_all, cf)
            summary["spans_either"] = span_scores(
                spans,
                idx_all,
                [a or b for a, b in zip(cf, [o.arm_found for o in obs_all])],
            )
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("recording", type=Path)
    ap.add_argument("--out", type=Path, help="default logs/depth/<time>-<name>/")
    ap.add_argument("--images", type=int, default=8)
    ap.add_argument("--every", type=int, default=1, help="process every Nth packet")
    ap.add_argument(
        "--config",
        default=None,
        help="config.toml with [camera.depth] (default: the repo's)",
    )
    ap.add_argument(
        "--camera-yaw",
        type=float,
        default=None,
        help="override [camera.depth] camera_yaw_deg",
    )
    ap.add_argument(
        "--spans",
        type=Path,
        help="hand-marked spans (JSON, as tests/fixtures/depth/bench_stand_1_spans.json): "
        "adds the found rate per label and the false accepts on no_arm spans",
    )
    ap.add_argument(
        "--gate", choices=["shape", "cylinder"], help="override [camera.depth] gate"
    )
    ap.add_argument(
        "--colour",
        action="store_true",
        help="also run colour proposes, depth confirms (MediaPipe)",
    )
    a = ap.parse_args()
    cfg = load_config(a.config)
    tcfg = TrackerConfig.from_section(
        cfg.camera.get("depth") if "depth" in cfg.camera else None
    )
    if a.camera_yaw is not None:
        tcfg.camera_yaw_deg = a.camera_yaw
    name = a.recording.name.split(".")[0]
    out = a.out or (
        REPO_ROOT / "logs" / "depth" / f"{time.strftime('%Y%m%d-%H%M%S')}-{name}"
    )
    if a.gate:
        tcfg.gate = a.gate
    spans = json.loads(a.spans.read_text())["spans"] if a.spans else None
    colour = None
    if a.colour:
        from core.camera.depth_colour import ColourConfig, ColourHands

        colour = ColourHands(
            ColourConfig.from_section(
                cfg.camera.get("depth") if "depth" in cfg.camera else None
            )
        )
    s = check(a.recording, out, a.images, a.every, tcfg, spans, colour)
    print(json.dumps(s, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
