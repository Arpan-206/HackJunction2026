"""Glove hub ring LEDs as markers in the phone's colour frame: a precise point and the side.

Two parts:
- set_marker_colours(): the Rokoko SDK LED command (RCSP SetColorLed, core/rcsp.py) that
  gives the left and right ring two clearly different colours. PARKED on Sat 14 Nov: the
  gloves were connected to another machine, not this Mac. Run it with the Rokoko driver
  on this Mac: python -m core.camera.hand_root_led --host 127.0.0.1 --port 45451.
  The core's GloveControl repaints the rings with its status colours (idle blue); while
  the hand root uses markers, its update_leds must leave them (patch in STATUS-hand-root.md).
- find_rings(): small, bright, saturated blobs with a dark hole (the ring) in the colour
  frame, near a depth blob. Detected by brightness, saturation and shape, not by the
  scene colour, because the venue light is strongly purple. With marker hues set, each
  ring is labelled by the nearest hue; without them it has no side.

Measured on captures/bench-gloves-1.gdrec.gz (LEDs as they were, both pink like the
venue light): see STATUS-hand-root.md. The rings show only when the back of the hand
faces the phone.
"""
from __future__ import annotations

import argparse
import asyncio
import colorsys
import sys
from dataclasses import dataclass

import numpy as np

# Marker colours: far from the venue's purple and pink and from each other.
MARKER_RGB = {"left": (0, 255, 0), "right": (255, 140, 0)}   # green, amber


def hue_cv(rgb: tuple[int, int, int]) -> float:
    """OpenCV hue (0 to 180) of an RGB colour."""
    h, _, _ = colorsys.rgb_to_hsv(*(c / 255.0 for c in rgb))
    return h * 180.0


@dataclass
class Ring:
    uv: tuple[float, float]      # normalised, colour frame as streamed
    area_px: int
    hue: float                   # OpenCV hue 0..180
    side: str | None             # by marker hue, None without marker hues
    hole: bool                   # a dark centre was found (ring shape)


@dataclass
class LedConfig:
    min_v: int = 200
    min_s: int = 90
    min_px: int = 6
    max_px: int = 900
    hue_tol: float = 14.0
    marker_hues: dict | None = None     # side -> OpenCV hue; None until the colours are set
    require_hole: bool = True


def find_rings(bgr: np.ndarray, near: np.ndarray | None = None, cfg: LedConfig | None = None) -> list[Ring]:
    """Rings in the colour frame. near: bool mask at any resolution; rings outside it are ignored."""
    import cv2
    cfg = cfg or LedConfig()
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    bright = ((hsv[..., 2] >= cfg.min_v) & (hsv[..., 1] >= cfg.min_s)).astype(np.uint8)
    if near is not None:
        m = cv2.resize(near.astype(np.uint8), (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_NEAREST)
        m = cv2.dilate(m, np.ones((15, 15), np.uint8))
        bright &= m
    contours, hier = cv2.findContours(bright, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    out: list[Ring] = []
    if hier is None:
        return out
    H, W = bgr.shape[:2]
    for i, c in enumerate(contours):
        if hier[0][i][3] != -1:          # a hole, not an outer contour
            continue
        area = int(cv2.contourArea(c))
        if area < cfg.min_px or area > cfg.max_px:
            continue
        hole = hier[0][i][2] != -1
        if cfg.require_hole and not hole:
            continue
        x, y, w, h = cv2.boundingRect(c)
        if max(w, h) > 3 * max(1, min(w, h)):   # a streak or an edge, not a ring
            continue
        mask = np.zeros((H, W), np.uint8)
        cv2.drawContours(mask, [c], -1, 1, -1)
        hue = float(np.median(hsv[..., 0][mask.astype(bool) & bright.astype(bool)]))
        side = None
        if cfg.marker_hues:
            d = {s: min(abs(hue - h0), 180 - abs(hue - h0)) for s, h0 in cfg.marker_hues.items()}
            s = min(d, key=d.get)
            side = s if d[s] <= cfg.hue_tol else None
        out.append(Ring(uv=((x + w / 2) / W, (y + h / 2) / H), area_px=area, hue=hue, side=side, hole=hole))
    return out


async def set_marker_colours(host: str, port: int, colours: dict | None = None) -> dict:
    """Paint each glove's ring its side's marker colour through RCSP. {device_id: side}."""
    from ..rcsp import RcspClient
    colours = colours or MARKER_RGB
    client = RcspClient(host, port)
    await client.start()
    await asyncio.wait_for(client.connected.wait(), 5.0)
    done = {}
    try:
        for d in await client.list_devices():
            did = int(d.get("DeviceId", -1))
            if did < 0:
                continue
            info = await client.get_device_info(did)
            is_left = (info.get("Smartgloves") or {}).get("IsLeft", info.get("IsLeft"))
            if is_left is None:
                continue
            side = "left" if is_left else "right"
            await client.set_color_led(did, colours[side])
            done[did] = side
    finally:
        await client.stop()
    return done


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Set the glove ring LEDs to the hand root marker colours")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=45451)
    a = ap.parse_args(argv)
    print(asyncio.run(set_marker_colours(a.host, a.port)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
