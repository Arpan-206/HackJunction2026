# Hardware integration: connecting real gloves and your own pipeline

For whoever wires the Rokoko Smartgloves II or an ML/positioning pipeline into the Apprentice app. Background and sources: [research/09_rokoko.md](../research/09_rokoko.md). Shared data shapes: [CONTRACT.md](CONTRACT.md).

## 1. Architecture

```
 Smartgloves II (L+R)                                      your ML / positioning pipeline
   |  WiFi (not USB)                                          |  HTTP or WebSocket (section 5)
   v                                                          v
 Rokoko Studio (Windows/macOS)                         +------------------+
   Livestreaming > Custom > UDP, JSON v3/v4 (+LZ4)     | ExternalSource   |  gloves/external.py
   |  UDP :14043, 1 JSON frame per datagram            +------------------+
   v                                                          |
 +--------------------+      +------------------+             |
 | RokokoUdpSource    |----->| rokoko_mapper    |             |
 | gloves/rokoko_udp  |      | v3/v4 -> HandFrame|            |
 +--------------------+      +------------------+             |
            |  GloveFrame (raw)                               |
            +-----------------------+-------------------------+
                                    v
                           GloveManager (gloves/manager.py)
                           One Euro smoothing (+ deadband)
                                    |
                 +------------------+-------------------+
                 v                                      v
         WS /ws/gloves  ~60 Hz                    recorder sink (/api/recordings)
                 |
                 v
   Frontend (useGloveStream.ts): 3D hands, live coach, scoring via /api/score
```
Only one source feeds the pipeline at a time: `simulator`, `rokoko_udp`, `rokoko_sdk` (501 stub, needs a paid SDK licence) or `external`.

## 2. Setup with real gloves, step by step

Prerequisites: new Rokoko Studio (not Legacy), a plan with Custom Streaming (Plus/Pro/Enterprise; a 7-day trial exists), gloves on firmware current enough for Studio, a router both laptop and gloves can use (bring your own; venue WiFi is unreliable).

1. **Pair and calibrate in Studio.** Connect the gloves over WiFi, pair them with an actor profile (drag onto the actor or "Pair with live input"), run the Studio calibration (or the Command API `calibrate`, see research/09). Confirm the 3D fingers move in Studio first.
2. **Studio streaming settings.** Livestreaming panel, Custom Streaming, cogwheel. In the receiver: protocol **UDP**, format **JSON v3** or **JSON v4** (plain is simplest; the "(LZ4)" variants need `uv sync --extra rokoko`), IP **127.0.0.1** if Studio runs on the same laptop as the backend, otherwise the backend laptop's LAN IP, port **14043**. Tick "Include connection", exit settings, click **Activate**; the viewport shows a green outline.
3. **Windows firewall** (only needed when Studio is on another machine; loopback is not filtered). Admin PowerShell:
   `New-NetFirewallRule -DisplayName "Rokoko UDP 14043" -Direction Inbound -Protocol UDP -LocalPort 14043 -Action Allow`
   Set the network profile to Private; Public profiles block it by default. Allow `python.exe`/`uvicorn` if Windows prompts.
4. **Start the backend:** `cd backend && uv run uvicorn app.main:app --reload --port 8000` (add `--extra rokoko` to `uv run` for LZ4). Optional: set `GLOVE_SOURCE=rokoko_udp` in `backend/.env` so it starts on real gloves.
5. **Start the frontend:** `cd frontend && npm run dev`, open `http://localhost:5173/?dev=1`.
6. **Switch the source.** In the dev panel pick `rokoko_udp`, or: `curl -X POST localhost:8000/api/dev/state -H "content-type: application/json" -d "{\"glove_source\":\"rokoko_udp\"}"`. `GET /api/dev/state` shows `glove_source` and the smoothing settings (`min_cutoff`, `beta`, `enabled`). If the UDP port is busy you get a 409 and the backend stays on the previous source.
7. **Calibrate the finger axis once** (see 4): `cd backend && uv run python scripts/probe_flexion.py`.
8. **Calibrate in the app** (flat then fist, `POST /api/calibrations`); scoring normalises per joint with it, which also absorbs rest-pose offsets.

### Testing the whole pipeline without gloves
```
cd backend
uv run uvicorn app.main:app --port 8000          # terminal 1
uv run python scripts/replay_udp.py              # terminal 2: v3 sweep at 60 Hz to 127.0.0.1:14043, loops
uv run python scripts/replay_udp.py --format v4 --lz4   # needs --extra rokoko
```
Then switch the source to `rokoko_udp` as in step 6. The fixtures in `backend/tests/fixtures/` are constructed from the documented schema, not captured from real gloves; the flex axis they assume is the same as the code's default, so they cannot prove the axis. Record real frames by pointing `replay_udp.py --file` at a `.jsonl` you saved from a socket.

## 3. The contract the frontend consumes

`/ws/gloves` sends JSON text frames at about 60 Hz, after smoothing. Units: seconds, radians, metres, snake_case keys.

```json
{
  "t": 12.3417,
  "source": "rokoko_udp",
  "hands": [{
    "side": "right",
    "wrist_quat": [0.0, 0.26, 0.0, 0.97],
    "wrist_pos": null,
    "flexion": {
      "thumb":  [0.5, 0.6, 0.7],
      "index":  [0.9, 1.45, 0.9],
      "middle": [0.0, 0.0, 0.0],
      "ring":   [0.0, 0.0, 0.0],
      "little": [0.0, 0.0, 0.0]
    },
    "spread": {"thumb": 0, "index": 0, "middle": 0, "ring": 0, "little": 0}
  }]
}
```
- `flexion[finger]` is `[MCP, PIP, DIP]` (thumb `[CMC, MCP, IP]`) in radians: 0 straight, positive curled. All five fingers are required per hand. The mapper clamps to [-0.5, 2.2] rad.
- `wrist_quat` is `[x, y, z, w]`, hand orientation in world space (Studio world: left-handed, Y up, Z forward). `wrist_pos` is metres or `null`; only a webcam fusion or a Coil Pro can fill it.
- `hands` has 0, 1 or 2 entries; a missing hand just is not listed. `source` is `simulator | rokoko_udp | rokoko_sdk | replay`.
- The client may send `{"type":"set_motion","motion":{...}}` on this socket to drive the simulator; other messages are ignored.

## 4. Per-joint flexion from Studio rotations, and the axis question
Studio streams world-space rotations; `rokoko_mapper.py` takes `conj(parent) * child` for each joint and reads the bend about `ROKOKO_FLEX_AXIS` with sign `ROKOKO_FLEX_SIGN` in `backend/app/constants.py`. The axis is unverified: Rokoko does not document it. `scripts/probe_flexion.py` prints the measured axis per joint; copy the result into those two constants and restart. Details and the joint-name tables are in research/09.

## 5. Feeding results from your own pipeline (external source)

Use this when your code computes the hand pose itself (webcam, glove ML, a recorded dataset) and you want the real frontend to show it, coach on it and score it.

This exists and is wired up: `POST /api/ingest/frames` and `WS /ws/ingest` (code in `backend/app/services/gloves/external.py`, routes in `backend/app/api/routes/ingest.py`). Per call or message it accepts:
- a frame: `{"t": 1.2, "hands": [HandFrame, ...]}` (`t` optional, defaults to seconds since the source started)
- a single hand: `{"side": "right", "flexion": {...}}` (`wrist_quat` defaults to identity)
- a batch: `{"frames": [frame, ...]}` (max 600; HTTP and WS both)

Units are radians and metres as in `docs/CONTRACT.md`; `flexion` maps each finger to `[knuckle, middle, tip]`. Frames pass through the same smoothing as hardware frames (turn it off in `/api/dev/state` if your pipeline already smooths), reach `/ws/gloves` as `source: "replay"`, and are captured by recordings.

Errors: HTTP 409 when the active source is not `external` (switch it with `POST /api/dev/state {"glove_source": "external"}`, or add `?activate=1` to the ingest call), 422 for an invalid frame. Over WS each failure is answered with `{"type": "error", "status", "detail"}` and the socket stays open; successes are silent.

Python client (`pip install websockets`), pushing a bending index finger at 60 Hz:
```python
import asyncio, json, math, websockets

async def main():
    async with websockets.connect("ws://localhost:8000/ws/ingest?activate=1") as ws:
        for i in range(600):
            c = 0.5 + 0.5 * math.sin(i / 20)
            flex = {f: [0, 0, 0] for f in ("thumb", "index", "middle", "ring", "little")}
            flex["index"] = [0.9 * c, 1.1 * c, 0.6 * c]
            await ws.send(json.dumps({"side": "right", "flexion": flex}))
            await asyncio.sleep(1 / 60)

asyncio.run(main())
```
Read errors with `await ws.recv()` if you want them; for one-off pushes use `httpx.post("http://localhost:8000/api/ingest/frames?activate=1", json=hand)`. A pipeline that only has Rokoko-style packets can instead send them to UDP 14043 (same format as Studio, v3 or v4).

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend returns 409 "Cannot listen on UDP port 14043" | Another app holds the port (Studio's own receiver, Unity/Blender plugin, a second backend) | Close it, or change `ROKOKO_UDP_PORT` and the Studio receiver port together |
| Dev panel stays on `simulator` after choosing `rokoko_udp` | Port busy (see above); the manager restores the previous source | Read the toast or the 409 detail |
| `rokoko_udp` selected but the hands never move | No datagrams arriving: Studio not Activated, Include connection unticked, wrong IP, firewall, public network profile | Green outline in Studio; section 2 steps 2 and 3; test with `replay_udp.py` to prove the backend side |
| Hands move in the replay but not from Studio | Studio targets a different IP or port; or Studio and backend on different machines and loopback IP used | Use the backend laptop's LAN IP in Studio |
| Log: "Unrecognised Rokoko frame (top-level keys ...)" | Format is not v3 or v4 (for example v2) or a Custom plugin format | Select JSON v3 or v4 in the Studio receiver |
| Log: "Rokoko actor with no joints" | The gloves are not paired to an actor, or the actor has no body/hands | Pair in Studio's actor profile |
| 503 mentioning LZ4 | An "(LZ4)" format is selected but `lz4` is not installed | `uv sync --extra rokoko` or choose plain JSON |
| One hand missing | `hasLeftGlove/hasRightGlove` (v3) or `hasLeftHand/hasRightHand` (v4) is false; glove not connected | Check glove power and WiFi in Studio |
| Fingers curl the wrong way, or bend is tiny or huge | Wrong `ROKOKO_FLEX_AXIS` or sign (unverified default x, +1) | Run `scripts/probe_flexion.py`, update the two constants |
| Fingers jitter or lag | Smoothing mismatch; WiFi jitter | Tune `min_cutoff` and `beta` in the dev panel; 5 GHz channels 36 to 48; own router |
| Hand yaw drifts or is wrong | Hub magnetometer not converged, no Studio calibration | Re-run Studio calibration, keep away from metal and magnets |
| Frontend shows "closed" status | Backend not on :8000 or proxy not running | Start backend; `npm run dev` proxies `/ws` to :8000 |
| `POST /api/ingest/frames` 400 "not active" | Source is not `external` | Switch with `/api/dev/state` first |
| Scores look wrong on real gloves but fine on simulator | Calibration missing; rest pose offset | Do the flat/fist calibration in the app |

## Proving the gloves and their connections work (Smartgloves II over the Rokoko Device SDK)

This is the USB path: `rokoko-sdk.exe` (RGMP 127.0.0.1:12276, RCSP 45451) and `rkk-hand-solver` (RGMP 12277), not Studio.

Offline, always on (no hardware): `cd backend; uv run pytest -q tests/test_glove_rgmp_replay.py`. It replays trimmed real captures from `backend/tests/fixtures/rgmp/` (about 330 KB, rebuilt by `scripts/make_rgmp_fixture.py`) and checks device ids and hands, 49 streams per glove, frame rate against the definition, unit quaternions, monotonic time without gaps, status flags decoded by bit name, finger isolation in scripted poses, and the solver's flexion direction.

Live, opt-in (gloves plugged in, driver and solver running, Studio closed, gloves resting on a table):

```
cd backend
set GLOVES_LIVE=1            (PowerShell: $env:GLOVES_LIVE=1)
uv run pytest -m hardware -v -s
```

It checks the three ports, the RCSP device list (both gloves, sides match RGMP), definitions within 3 s, at least 90 percent of the expected rate per glove for 5 s, frame lag under 100 ms, no `coil_pro` dependency, no `Rokoko Studio.exe`, and low gyro noise while still. Without `GLOVES_LIVE=1` the tests are skipped.

Guided check: `uv run python scripts/glove_check.py` asks for flat hands, a fist, then open hands, and prints per finger sensor rotation, the solver's local flexion axis and sign, and PASS or FAIL. It only reports; it never edits `constants.py`.

Findings from the real gloves (firmware 3.4.0, driver 1.9.7):

- The driver sends RGMP definitions as soon as a client connects, but no data frames until some RCSP client has sent `SubscribeToData` for the device, and it stops when that client disconnects. A plain RGMP reader sees nothing otherwise. The live tests hold their own subscription.
- Each glove has two groups at 83.3 Hz each (`default` 31 streams, `emf_only` 18 streams, 49 in all). Device clocks are the device boot clock, not the host clock. RCSP has no battery command in this driver version.
- The driver's `arm_sensor` transform in `default` is relative to `coil_pro`; finger sensors are relative to `hub`. Nothing in `backend/app` uses `coil_pro`.
- Solver `joints_local` (quaternion x, y, z, w): a fist rotates every finger joint about local +X by a negative angle on both hands (medial about -60 to -90 degrees, proximal about -55 to -90 with some Y and Z). So the flexion axis is X (index 0, matching `ROKOKO_FLEX_AXIS`) and the sign in that frame is negative. This is the solver's frame, not the Studio JSON frame that `rokoko_mapper.py` reads, so `ROKOKO_FLEX_SIGN` itself is still unverified for Studio. In `joints_openxr` a fist moves every fingertip toward the wrist (+Z) and toward the palm (-Y), as it should.
- The solver spreads one finger's flexion over its joints unevenly (an isolated left index shows almost only on the medial joint, an isolated right little reaches only about -40 degrees proximal while its sensor turns 100 degrees). Use the sum over joints, not one joint.
