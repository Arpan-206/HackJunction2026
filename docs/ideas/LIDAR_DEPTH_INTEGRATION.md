# LiDAR depth integration survey (Sat 14 Nov 2026)

How the iPhone LiDAR depth work on main can feed the Geppetto frontend and backend. The `core/`, `ios/`, `schema/`, `tools/` and `config.toml` files are Arpan's: we read their output, we do not edit them.

## 1. Summary

- All depth work is on main. `origin/lidar` and `origin/arkit-app` are fully merged.
- iPhone app: `ios/GeppettoDepth` (Swift, ARKit) streams to the Mac over TCP port 7700.
- Core: `python -m core --depth` runs a depth step (table, forearm yaw, glove yaw drift correction) and serves `ws://<core>:8765/ws/depth`.
- Nothing is verified on real depth yet. All results come from a fake scene; the one real recording has no arm in view.
- No hand position exists yet. The core gives the forearm direction and the point where the arm enters the image, not a wrist or hand position. `wrist_pos` on `/ws/gloves` stays `null`.
- Nothing in `frontend/` or `backend/` consumes depth today.

## 2. The iPhone side (`ios/`)

- Swift app: `ios/GeppettoDepth/GeppettoDepth/` (`DepthStreamer.swift`, `PacketEncoder.swift`, `FrameServer.swift`, `ContentView.swift`). Bundle id `fi.junction.geppetto.depth`, iOS 16+, landscape right only.
- Docs: `ios/README.md`, `ios/PROTOCOL.md` (wire format), `ios/STATUS-arkit-app.md`.
- Mac tools: `ios/mac/forward.sh` (iproxy USB forward), `record.py`, `replay.py`, `fake_sender.py`.
- Measured: iPhone 16 Pro over USB at 29.8 fps with no gaps.
- Config: `[camera.geppetto_depth] host` is the phone's WiFi address on main. Over USB, set `host = "127.0.0.1"` and run `ios/mac/forward.sh` first.
- Transport: TCP, phone port 7700, one client, at most 30 fps, about 190 KB per frame. A frame is dropped if the last one is still sending.
- It sends depth, confidence, a colour JPEG, camera intrinsics, camera pose and the table plane. It sends no hand pose.

Packet (GDP1):

```
prefix:  "GDP1" (4 bytes) | u32 payload_len           (little-endian)
header (216 bytes):
  u16 version=1 | u16 flags (bit0 plane valid, bit1 confidence present) | u32 frame_id
  f64 timestamp (ARFrame.timestamp, phone uptime s)
  u16 depth_w=256, depth_h=192 | u16 jpeg_w=640, jpeg_h=480 | u16 K_w=1920, K_h=1440
  u32 depth_bytes | u32 conf_bytes | u32 jpeg_bytes
  f32x9  K (intrinsics, row-major, full camera image pixels)
  f32x16 camera-to-world 4x4 (ARKit axes: x right, y up, z toward viewer)
  f32x16 table plane-to-world 4x4 (plane y = normal up)
  f32x2  plane extent (m, along plane x, z)
  u8 tracking state (0 n/a, 1 limited, 2 normal) | 3 reserved
blobs: depth f16 metres (0/NaN = none) | confidence u8 0/1/2 | JPEG
world frame: gravity aligned, y up, origin where the AR session started
```

Recordings are `.gdrec(.gz)`: each record is a u64 arrival time in microseconds followed by the raw packet.

## 3. What the core does with it

Files in `core/camera/`: `depth.py`, `geppetto_depth.py` (reader), `gdrec.py`, `gdp_server.py` (phone stand-in), `depth_track.py` (tracker and `YawCorrector`), `depth_live.py` (`DepthTracking`, `FakeDepthSource`), `fake_depth.py` (fake phone).

Per frame, in its own thread so the 30 Hz tick never waits:

1. Back-project depth into the gravity-up world.
2. Take the table from the app's plane, with a RANSAC fit as a check or fallback.
3. Find the arm blob: points 1.2 to 35 cm above the table, within 1 m of the camera.
4. Find where the arm crosses the image border.
5. Fit a cylinder to the first 15 cm of arm; its axis is the forearm yaw.
6. Shape gates decide whether the blob is an arm.
7. Black gloves return no depth, giving `hand_depth = false` and label 3 "dark patch" points.

Yaw correction: every tick `Session.tick` calls `depth.apply(hands, t)`. For the right hand only, the glove's `wrist_q` is turned about world up by `correction_deg`. It learns the offset for 2 s, then removes drift with `tau_s = 1.5`, clamped at 60 degrees. The corrected `wrist_q` already flows into `/ws` frames and `/ws/gloves` `wrist_quat`, so our side must not apply it again.

Config: `[camera] depth_enabled = false`; tuning in `[camera.depth]` (`camera_yaw_deg = 180`, `cloud_hz = 10`, `cloud_points = 2000`, `reference = "lock"`, `side = "right"`).

Commands (repo root, `.venv`):

```
python -m core --depth                                       # real phone at [camera.geppetto_depth]
python -m core --fake --depth --depth-fake                   # fake gloves + in-process fake depth scene
python -m core.camera.fake_depth --port 7711 [--dark-hand] [--no-plane]   # fake phone over TCP
python -m core --fake --depth --depth-host 127.0.0.1:7711
python -m core.camera.fake_depth --record logs/depth/fake.gdrec.gz --seconds 10 [--dark-hand]
python -m tools.depth_check FILE.gdrec.gz    # summary, overlays, frames.csv, summary.json in logs/depth/<time>/
ios/mac/forward.sh ; python -m ios.mac.record captures/arm-bare.gdrec.gz --seconds 20 --note "arm, bare"
```

Endpoints: `GET /depth` (viewer, `tools/depth_view.html`), `GET /health` (`depth` key), `GET /schema/depth.json`, `ws://<core>:8765/ws/depth` (send only).

`/ws/depth` message (`schema/depth.json`), about 10 Hz, about 84 KB of JSON, about 2000 points:

```json
{
  "v": 1, "type": "depth", "t": 123456789, "frame_id": 393,
  "frame": "bench",
  "n": 2000,
  "points": [0.01, 0.0, 0.12, "..."],
  "labels": [1, 1, 2, 3, "..."],
  "rgb": [120, 110, 98, "..."],
  "table": {"found": true, "source": "app", "camera_height_m": 0.14, "agree_deg": 0.2, "agree_mm": 0.1},
  "arm": {"found": true, "hand_depth": false, "forearm_ok": true, "yaw_deg": 9.3,
          "dir": ["ux", "uy", "uz"], "entry": ["x", 0.0, "z"], "length_m": 0.21, "elongation": 3.1},
  "correction": {"side": "right", "correction_deg": 6.58, "locked": true, "applied": true, "glove_yaw_deg": 9.3},
  "process_ms": 7.2
}
```

- `frame: "bench"`: metres, y up from the table top, x and z turned to match the core world (z toward the person). The origin is the centre of the table plane, not our stage anchor. `"camera"` (OpenCV frame) is used only when no table is found.
- `labels`: 0 other, 1 table, 2 arm, 3 dark patch.
- `arm.dir`: unit vector from elbow to fingers. `arm.entry`: where the arm crosses the image border, on the table (y = 0). `arm.length_m`: how far the blob extends along `dir` from `entry`.
- Yaw: 0 means the fingers point away from the person.

`frame.depth` block on core `/ws` (present only with `--depth`):

```json
{"side": "right", "connected": true, "frame_id": 393, "age_ms": 94.1, "table": true, "hand": true,
 "hand_depth": false, "forearm_yaw_deg": 9.3, "forearm_ok": true, "glove_yaw_deg": 9.3,
 "correction_deg": 6.58, "locked": true, "applied": true}
```

Frontend guidance from `docs/DEPTH_STREAM.md`: draw the cloud with `THREE.Points` and a preallocated `Float32Array(3*2048)`, treat the stream and the block as optional, draw `arm.dir` from `arm.entry` as an arrow, use neutral label colours (gold is for mastery, vermilion for corrections), and keep status to one line such as "Depth: table, arm, yaw corrected by 6.6 deg".

Caveats: `camera_yaw_deg = 180` (phone facing the person across the bench) is unchecked; right hand only; `age_ms` about 94 ms includes webcam latency. See also `STATUS-lidar.md` and the older, unbuilt proposal `docs/ideas/IPHONE_LIDAR.md`.

## 4. How depth could feed our app

| Use | Exists today | Missing |
| --- | --- | --- |
| Hand position on the 3D stage (over the table, not a fixed anchor) | `/ws/depth` `arm.entry`, `arm.dir`, `arm.length_m`, label 2 and 3 points in the bench frame. Far end of the arm is about `entry + dir * length_m` (near the wrist with black gloves), or the label 3 centroid is the hand. `Hand.tsx` has `followWristPos`; `smoothing.ts` and `playback.ts` carry `wrist_pos` | Core does not set `wrist_p` from depth, so `/ws/gloves` `wrist_pos` is null. No bench-to-stage calibration. Untested on a real arm |
| Forearm yaw correction | Already applied in the core to `wrist_q`, so it reaches `/ws/gloves` `wrist_quat` | Only a status line, which needs `/ws` `frame.depth` or `/health`; `/ws/gloves` has no depth key |
| Expert takes store wrist position for ghost placement | `GloveFrame.wrist_pos` (backend) and `HandFrame.wrist_pos` (frontend) exist and are stored with takes | Always null today. Needs a position source and a placement rule (relative to the table, or to the learner's start) |
| Scoring position as well as finger angles | Nothing; `scoring.py` scores flexion only | Position in takes and live frames, a tolerance in cm, weights. Wait for measured accuracy |
| Robot teleop target position | Nothing; `/ws/robot` carries Dex3-1 hand joints only | Arm or wrist targets and an arm model. Out of scope for the hand twin |

## 5. Branches not in main

| Branch | Ahead | State | Our side |
| --- | --- | --- | --- |
| coach-tune | 14 (4 own, plus replay-demo and thumb-align) | Tuned coach model, `COACH_MODEL=tuned` off by default; parked at the Verda VM start | `backend/app/services/llm/tuned.py`, `registry.py`, `core/config.py`, `constants.py`, `.env.example`; overlaps our `constants.py` |
| replay-demo | 5 | Capture replay through the stack, REPLAY badge, held-pose lessons; works | `frontend/src/main.tsx`, `vite.config.ts`, `features/shared/replay/*`, `e2e/replay-walk.mjs`; no overlap with our changed files |
| thumb-align | 3 | Preview thumb scaled by 0.8 like the scorer; done | `three/motion.ts`, `mock/synth.ts`, tests; no overlap |
| typing, weights, worktree-export | 2, 6, 1 | Already on main (patch equivalent) | none |
| all other Arpan branches | 0 | Fully merged | none |
| robot-extras-wip (Szymon) | 10 | Robot screen WIP; probably superseded by HEAD's `useRobotStream.ts` and `mock/robot.ts` | 38 frontend files |

## 6. Merge hotspots with main

Merge base `3dacdbb`; main has 81 commits since, touching 116 frontend, backend and contract files. Biggest conflicts: `backend/app/services/scoring.py` with `frontend/src/mock/scoring.ts` and the coach files (main's step weights against our takes and per-finger tolerance changes), then `frontend/src/api/types.ts`, `frontend/src/mock/router.ts` and `docs/CONTRACT.md`. Also expect conflicts in `backend/app/constants.py`, the backend schemas, `lesson_generator.py`, `App.tsx`, `RoleSelect.tsx`, `DevPanel.tsx`, `TrainingRoom.tsx`, `catalogue.ts`, `skills.css`, `localLessons.ts`, `LessonEditor.tsx`, `features/master/lib.ts`, `mock/seed.ts`, `mock/data/moves.json`, package files and the e2e walks.

## 7. Integration plan, smallest first

1. Merge main into `frontend-updates`, resolve the hotspots, then take thumb-align and replay-demo.
2. Dev panel depth status line from `GET /health` `depth` (or `/ws` `frame.depth`): table, arm, `correction_deg`, locked. Hidden when absent.
3. `useCoreDepth` hook on `ws://<host>:8765/ws/depth` (same pattern as `useRobotStream`), types in `frontend/src/api/` mirroring `schema/depth.json`, and a mock `/ws/depth` that replays a canned message. For a live fake stream: `python -m core --fake --depth --depth-fake`.
4. Debug depth layer on the 3D stage: `THREE.Points` in neutral colours plus the `arm.dir` arrow, with a manual offset or "place table here" calibration from bench to stage coordinates.
5. Experimental derived wrist position behind a flag (`entry + dir * length_m`, or the label 3 centroid when `hand_depth` is false), fed to `Hand.tsx` `followWristPos` with smoothing. Only after a real arm recording exists.
6. Ask Arpan for core-side position: set `wrist_p` and `anchor = "camera"` from depth so `/ws/gloves` `wrist_pos` is filled, plus a depth key on `/ws/gloves`. A request, not a patch to his files.
7. Once `wrist_pos` is real: takes store it with no schema change, the ghost is placed relative to the table, and an optional position term is added to `scoring.py` and `mock/scoring.ts` after accuracy is measured.
8. Robot arm or wrist targets: out of scope until there is an arm model.
