"""Live view of the phone's colour, depth and confidence streams in a browser.

    python -m tools.depth_live_view [--host 127.0.0.1] [--port 7700] [--http 8790] [--usb]

Opens http://localhost:8790 with four images refreshed about ten times a second:
an overlay (colour with the depth map blended in, strongest where confidence is high), the colour frame, the depth map (blue 0.2 m to red 1.5 m, dim where confidence is
low) and the confidence map, plus the frame rate and the table plane height. With
--usb it starts iproxy itself. One client at a time on the phone, so stop the core's
--depth run first.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.camera.geppetto_depth import GeppettoDepthCamera

PAGE = """<!doctype html><title>Geppetto depth live</title>
<style>body{margin:0;background:#1b1b1b;color:#eee;font:16px system-ui}
.row{display:flex;flex-wrap:wrap;gap:8px;padding:8px}figure{margin:0}img{display:block;max-width:100%;background:#000}
figcaption{padding:4px 2px;color:#bbb}#s{padding:8px 12px;font-family:ui-monospace,monospace;white-space:pre}</style>
<div id=s>connecting</div>
<div class=row>
<figure><img id=overlay width=960 height=720><figcaption>overlay: colour with the depth map blended in, strongest where confidence is high</figcaption></figure>
</div><div class=row>
<figure><img id=rgb width=640 height=480><figcaption>colour 640x480</figcaption></figure>
<figure><img id=depth width=640 height=480><figcaption>depth, blue 0.2 m to red 1.5 m, dim = low confidence</figcaption></figure>
<figure><img id=conf width=320 height=240><figcaption>confidence: black low, grey medium, white high</figcaption></figure>
</div>
<script>
const ids=['overlay','rgb','depth','conf'];let busy=false;
async function tick(){if(busy)return;busy=true;try{const t=Date.now();
for(const id of ids){const img=document.getElementById(id);await new Promise(r=>{img.onload=r;img.onerror=r;img.src='/'+id+'.jpg?t='+t});}
const s=await (await fetch('/status.json')).json();document.getElementById('s').textContent=
`frame ${s.frame_id}  ${s.fps} fps from the phone  table ${s.plane_below_camera_m==null?'not sent':s.plane_below_camera_m+' m below the camera'}  depth median ${s.depth_median_m} m  confidence high ${s.conf_high_pct}%  ${s.error||''}`;
}catch(e){document.getElementById('s').textContent='waiting for the phone: '+e}busy=false}
setInterval(tick,100);
</script>"""

LUT = cv2.applyColorMap(
    np.arange(256, dtype=np.uint8).reshape(1, 256), cv2.COLORMAP_TURBO
)[0]


class State:
    def __init__(self, cam):
        self.cam = cam
        self.lock = threading.Lock()

    def render(self):
        f = self.cam.read()
        if f is None:
            return None
        d = f.depth
        n = np.clip((d - 0.2) / 1.3, 0, 1)
        n[~np.isfinite(d) | (d <= 0)] = 0
        img = LUT[(n * 255).astype(np.uint8)]
        if f.confidence is not None:
            img = np.where(
                (f.confidence == 0)[..., None], (img * 0.35).astype(np.uint8), img
            )
        depth_img = cv2.resize(img, (640, 480), interpolation=cv2.INTER_NEAREST)
        # overlay: colour under a depth tint; the tint is strongest where the confidence is high
        tint = cv2.resize(
            LUT[(n * 255).astype(np.uint8)],
            (f.bgr.shape[1], f.bgr.shape[0]),
            interpolation=cv2.INTER_LINEAR,
        )
        if f.confidence is not None:
            alpha = cv2.resize(
                (f.confidence.astype(np.float32) / 2.0),
                (f.bgr.shape[1], f.bgr.shape[0]),
                interpolation=cv2.INTER_LINEAR,
            )
            alpha = (0.15 + 0.5 * alpha)[..., None]
        else:
            alpha = np.full(f.bgr.shape[:2] + (1,), 0.5, np.float32)
        overlay = (
            f.bgr.astype(np.float32) * (1 - alpha) + tint.astype(np.float32) * alpha
        ).astype(np.uint8)
        conf_img = (
            None
            if f.confidence is None
            else cv2.resize(
                (f.confidence.astype(np.uint16) * 127).clip(0, 255).astype(np.uint8),
                (320, 240),
                interpolation=cv2.INTER_NEAREST,
            )
        )
        plane = None
        if f.plane is not None and f.transform is not None:
            plane = round(float(f.transform[1, 3] - f.plane[1, 3]), 3)
        ok = np.isfinite(d) & (d > 0)
        status = {
            "frame_id": f.frame_id,
            "fps": self.cam.status().get("fps"),
            "plane_below_camera_m": plane,
            "depth_median_m": round(float(np.median(d[ok])), 3) if ok.any() else None,
            "conf_high_pct": None
            if f.confidence is None
            else round(float((f.confidence == 2).mean() * 100), 1),
            "error": self.cam.status().get("error"),
        }
        return f.bgr, depth_img, conf_img, status, overlay


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7700)
    ap.add_argument("--http", type=int, default=8790)
    ap.add_argument("--usb", action="store_true", help="start iproxy for the cable")
    a = ap.parse_args()
    proxy = None
    if a.usb:
        proxy = subprocess.Popen(
            ["iproxy", f"{a.port}:{a.port}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(0.5)
    cam = GeppettoDepthCamera(a.host, a.port)
    cam.start()
    st = State(cam)
    cache = {"t": 0.0, "v": None}

    def current():
        now = time.monotonic()
        if now - cache["t"] > 0.05 or cache["v"] is None:
            with st.lock:
                cache["v"] = st.render()
                cache["t"] = now
        return cache["v"]

    class H(BaseHTTPRequestHandler):
        def log_message(self, *args):  # quiet
            pass

        def send(self, code, ctype, body):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/":
                return self.send(200, "text/html; charset=utf-8", PAGE.encode())
            v = current()
            if path == "/status.json":
                body = json.dumps(
                    v[3]
                    if v
                    else {
                        "frame_id": None,
                        "fps": None,
                        "error": cam.status().get("error") or "no frame yet",
                    }
                ).encode()
                return self.send(200, "application/json", body)
            if v is None:
                return self.send(503, "text/plain", b"no frame yet")
            bgr, depth_img, conf_img, _, overlay = v
            pick = {
                "/rgb.jpg": bgr,
                "/depth.jpg": depth_img,
                "/conf.jpg": conf_img,
                "/overlay.jpg": overlay,
            }.get(path)
            if pick is None:
                return self.send(404, "text/plain", b"not found")
            ok, jpg = cv2.imencode(".jpg", pick, [cv2.IMWRITE_JPEG_QUALITY, 80])
            return self.send(200, "image/jpeg", jpg.tobytes())

    srv = ThreadingHTTPServer(("127.0.0.1", a.http), H)
    print(
        f"live view on http://localhost:{a.http}  (phone {a.host}:{a.port}{', usb' if a.usb else ''})",
        flush=True,
    )
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        cam.stop()
        if proxy:
            proxy.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
