# STATUS: lane lidar

**Nothing in this lane has been verified on real depth yet.** Every result below comes from the fake bench scene (`core/camera/fake_depth.py`). The only real input is the glove yaw from the live slot, paired with fake depth. The one real depth file with a bench (`captures/bench-3.gdrec.gz`) has no arm in view, so it shows false positives, not tracking.

Branch `lidar`, worktree `.claude/worktrees/lidar`. Written Sat 14 Nov 2026, about 17:15 Helsinki time.

## Terms

| Term | Meaning |
| --- | --- |
| Depth step | The new core stage: it reads depth frames, finds the table and the arm, and corrects the glove yaw |
| Yaw | The turn of the hand about the vertical axis, in the core's convention: 0 means the fingers point away from the person |
| Drift | A slow, wrong change in the glove's yaw reading over time |
| Bench frame | Coordinates on the table: y up from the table top, x and z turned to match the core world |
| Lock | The first seconds, when the corrector learns the fixed offset between the depth yaw and the glove yaw |
| Fake | Synthetic data from `core/camera/fake_depth.py`, not from a phone |

## What works, and how to run it

Python commands run from the repo root with `.venv`. All suites pass: core 158, `ios/mac` 11.

| Item | Command | Result (fakes only) |
| --- | --- | --- |
| Fake phone, served | `python -m core.camera.fake_depth [--port 7700] [--dark-hand] [--no-plane]` | 30 fps, exact GDP1 wire format, about 30 ms to make a frame |
| Fake recording | `python -m core.camera.fake_depth --record logs/depth/fake.gdrec.gz --seconds 10 [--dark-hand]` | 300 frames, about 20 MB |
| Depth step in the core | `python -m core --depth` (phone), `--depth-host HOST:PORT`, `--depth-fake` (in process) | Live check over TCP: 30 fps in, 0 bad packets, 0 schema errors, tick 30 Hz |
| Point cloud | `ws://<core>:8765/ws/depth` | About 9 to 10 messages a second, 2000 labelled points, about 84 KB each |
| Viewer | `http://<core>:8765/depth` (`tools/depth_view.html`) | Script passes `node --check`. Seen by the dispatcher in headless Chrome at 17:02 with `python -m core --fake --depth-fake --port 8799`: the cloud draws with table, arm and grid, and the status lines read frame, table, camera height, arm found, forearm yaw and the correction |
| Check a recording | `python -m tools.depth_check FILE.gdrec.gz` | Prints the summary, writes images, `frames.csv` and `summary.json` to `logs/depth/<time>-<name>/` |
| Glove yaw window | `python -m tools.glove_yaw_window CAPTURE --survey`, then `--start S --seconds D --out X.npz` | Survey of the 1.2 GB hour: 22 s |
| Frontend note | `docs/DEPTH_STREAM.md` | How to read `/ws/depth` and `frame.depth` |

### Tracker accuracy on the fake scene

Arm yaw swept from -25 to +25 degrees, three frames each.

| Forearm direction method | RMS yaw error, dark hand | RMS yaw error, skin hand | Tracker time |
| --- | --- | --- | --- |
| Line through the visible points (PCA) | 2.95 deg | 2.91 deg | 5 to 7 ms |
| 3D cylinder fit (in use) | 0.28 deg | 0.13 deg | 8 to 11 ms |

The line method leans because the camera sees only the near half of the arm. The fake arm is a perfect cylinder, so a real forearm will do worse than 0.3 degrees.

### `tools/depth_check` on 10 s recordings

| Recording | Table | Camera height (app, fit) | App against fit | Arm found | Hand depth when found | Yaw step p50 / p95 | Tracker mean / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fake, skin hand | app plane 100% | 0.140 m, 0.140 m (std 0.8 mm) | 0.19 deg, 0.0 mm | 97.7% | 95.9% | 0.41 / 1.26 deg | 6.7 / 9.6 ms |
| fake, dark hand | app plane 100% | 0.140 m, 0.140 m (std 0.9 mm) | 0.21 deg, 0.1 mm | 94.7% | 0.0% (correct) | 0.37 / 1.17 deg | 7.2 / 9.8 ms |
| fake, no app plane | own fit 100% | none, 0.140 m (std 0.8 mm) | none | 96.7% | 95.9% | 0.42 / 1.20 deg | 10.3 / 13.5 ms |
| **real** `captures/bench-3` | app plane 100% | 0.175 m (std 33 mm), 0.175 m (std 52 mm) | median 4.0 deg, 14.7 mm; p95 58 deg, 156 mm | 16.3% (**all false**: no arm in view) | 0% | not meaningful | 9.0 / 13.2 ms |

Real `bench-3` timing: 30.0 fps, arrival interval p95 33.8 ms (max 86.6 ms), arrival minus phone clock jitter p50 2.4 ms, p95 4.6 ms. Its scene is a crisps bag and a laptop sleeve on a bench under magenta light. The camera height jumps from 0.175 m to 0.11 m near frame 180, so the phone moved or the app switched planes. Before the shape gates, the tracker called an arm in 100% of its frames.

### Glove yaw drift correction: a real glove window with fake depth

Glove: 20 s of the right Smartglove II from the live slot (`logs/live/20261114-131952/solver_12277.rgmp`, from 1320 s; yaw range 31 to 66 deg). The depth scene shows the recorded yaw. The glove fed to the core reads the recorded yaw plus an injected drift that starts at 3 s. The numbers are over the last 5 s.

| Drift rate | Hand | Uncorrected error | Corrected error, mean | Corrected error, max |
| --- | --- | --- | --- | --- |
| 1.5 deg/s | dark | 21.6 deg | 2.58 deg | 2.76 deg |
| 1.5 deg/s | skin | 21.6 deg | 2.31 deg | 2.46 deg |
| 0.5 deg/s | dark | 7.2 deg | 1.13 deg | 1.21 deg |
| 0.5 deg/s | skin | 7.2 deg | 0.86 deg | 0.91 deg |

The rest error is the filter lag: drift rate times `tau_s` (1.5 s). The test is `tests/test_depth_glove_replay.py`; the fixture is `tests/fixtures/depth/glove_yaw_right_1320s.npz` (67 KB). The 20 s raw window is in the main checkout at `logs/depth/solver_right_1320s_20s.rgmp` (untracked, 3.3 MB, replayable with `python -m core --replay`).

## How it works

- **Reader location.** `core/camera/geppetto_depth.py`, `gdrec.py` and `gdp_server.py` now hold the protocol, the recording format and the phone-like server. They were moved with `git mv` from `ios/mac/`. The files `ios/mac/geppetto_depth.py`, `recording.py` and `serve.py` re-export them, so the Mac tools and their tests run unchanged. The core does not import `ios/` at run time.
- **Removed.** `core/camera/record3dstream.py`, `tools/r3d_snapshot.py`, `tests/test_record3dstream.py` and `[camera.record3dstream]`. `save_frame` moved into `core/camera/geppetto_depth.py`, so `python -m ios.mac.replay --snapshot` still works. `core/camera/depth.py` stays the one interface; only its docstring changed.
- **Tracker** (`core/camera/depth_track.py`), per frame:
  1. Back-project the depth into the ARKit world, which has gravity up.
  2. Find the table. Use the app's plane when it is present. A RANSAC fit runs every frame as a check, and as the plane when the app sends none.
  3. Find the arm blob: points 1.2 to 35 cm above the table, confidence 1 or more, within 1 m of the camera.
  4. Find the entry: where the blob crosses the image border, taking the contact farthest from the camera.
  5. Fit a cylinder to the first 15 cm of the arm from the entry. Its axis gives the forearm yaw in the bench frame.
- **Arm shape gates.** A blob counts as an arm only if all of these hold:
  - it crosses the image border;
  - it is 1 to 16 cm wide;
  - its cylinder radius is 1.5 to 7 cm;
  - the cylinder fit residual is 12 mm or less;
  - the cylinder axis tilts at most 40 degrees from the table.
- **Dark hand.** Black gloves give no usable depth: conf 0 and smooth fill. The blob is then the forearm alone, and the yaw still comes out. A thick conf-0 patch at the arm's end sets `hand_depth = false`.
- **Corrector** (`YawCorrector`):
  1. Lock: average the depth-minus-glove yaw for `lock_s` (2 s).
  2. Then pull a yaw offset toward the change from that reference, with time constant `tau_s` (1.5 s). SPEC asks for 2 percent a frame, about 1.65 s.
  3. Skip samples more than 25 deg away, unless 45 in a row agree.
  4. Clamp the offset at 60 deg.
  
  `reference = "table"` instead trusts `camera_yaw_deg` as an absolute bench yaw.
- **Session hook** (additive):
  - `Session.depth` is `None` unless `--depth` is set or `[camera] depth_enabled = true`.
  - When set, `tick` first calls `depth.apply(hands, t)`. This turns the configured glove's `wrist_q` about world up, once per `HandState` object.
  - At the end, `tick` adds `frame["depth"]`.
  - The tracker runs in its own thread, so the 30 Hz tick never waits.
- **Server hook** (additive): `/ws/depth`, `GET /depth`, a `depth` key in `/health`, start and stop in the lifespan. The `depth` message is checked against `schema/depth.json` directly (`schemas.validate("depth", ...)`), because `core/schema.py` `MESSAGE_SCHEMAS` is outside this lane.
- **`--depth`, `--depth-host` and `--depth-fake` on `python -m core`** were added to `core/__main__.py`. The brief asked for the switch. `__main__.py` is not in the lane's list, but the change only adds options and one guarded block.

## Written but untested

- Everything on real depth: the arm blob, the cylinder fit and the gates on a real forearm, sleeve or bare skin; the dark-hand detection on real black gloves; the yaw correction with a real phone and real gloves together.
- The `camera_yaw_deg = 180` assumption: the phone faces the person across the bench. Lock mode does not need it; table mode does.
- The viewer page in a browser (see above).
- The app's plane against our fit on a steady bench. On `bench-3` they disagree (median 4 deg, 15 mm; p95 58 deg, 156 mm), but that scene is cluttered and the phone may have moved.
- `[camera] latency_us = 60000` (set for the webcam) also shifts depth frame times. The frame block's `age_ms` (about 94 ms in the live check) includes it. Measure the real phone latency and give depth its own key if they differ.

## Choices made (no questions asked)

| Choice | Why |
| --- | --- |
| Move the reader into `core/camera/`, with re-export modules in `ios/mac/` | The core must not depend on `ios/`; the Mac tools and tests stay unchanged |
| The fake scene is ray-cast capsules (table, forearm, palm, fingers, thumb) | Exact geometry and depth along the optical axis, as ARKit gives; fast enough to serve at 30 Hz |
| Medium-confidence noise 12 mm, edge and far-range confidence rules | Not measured; 1.8 mm and 59 mm are the measured figures |
| Dark-hand fill: the depth behind the hand, blurred | "Filled, smooth depth with low confidence" (STATUS.md); copying the forearm's edge made a step that ARKit did not show |
| Cylinder fit, not a line | A line through the visible arm leans by up to 6 deg on the fake, even without noise |
| Lock mode is the default | It needs no bench calibration: it removes drift since the lock, and the session's `calibrate` sets yaw 0 anyway |
| One corrected side (`side = "right"`) | One forearm in view for the demo; two arms need an assignment step |
| The frame block is not added to `frame.json` | The brief allows new schemas only; the frame's top level accepts extra keys, so it validates. A patch is below |
| Shape gates tuned only to reject `bench-3` objects and keep the fake arm | No real arm recording exists. The bag still passes in 16% of `bench-3` frames |

## What a human must do next

1. **Record a real bench.** Put the phone on the bench about 14 cm up, tilted about 30 degrees down, facing the person. Bring the forearm in from outside the view. Record 20 s bare-handed, then 20 s with the black gloves: `ios/mac/forward.sh`, then `python -m ios.mac.record captures/arm-bare.gdrec.gz --seconds 20 --note "arm, bare"`.
2. **Run** `python -m tools.depth_check captures/arm-bare.gdrec.gz`. Look at the overlays in `logs/depth/`. Expect found above 90%, yaw step p95 under 3 deg and a cylinder radius of 3 to 5 cm. Tune `[camera.depth]` (gates, `band_min_m`, `forearm_len_m`) if not.
3. **Run it with gloves:** `python -m core --depth --replay <solver capture>`, or live. Watch `frame.depth.correction_deg` and the hand in the viewer. Set `camera_yaw_deg` and try `reference = "table"` only if the bench yaw must be absolute.
4. Decide whether `[camera] depth_enabled` becomes true for the demo.

## Patches for files outside this lane (not applied)

**`ios/PROTOCOL.md` line 3** (the reader moved):

```diff
-The iPhone app `GeppettoDepth` serves this stream. The Mac reads it in `ios/mac/geppetto_depth.py`.
+The iPhone app `GeppettoDepth` serves this stream. The Mac reads it in `core/camera/geppetto_depth.py` (re-exported as `ios/mac/geppetto_depth.py`).
```

**`schema/frame.json`**, optional: list the block. Add under `"properties"`, after `"robot"`:

```json
    "depth": { "$ref": "depth.json#/$defs/block" }
```

**`core/schema.py`**, optional: let `_check` handle depth messages. Add `"depth": "depth",` to `MESSAGE_SCHEMAS`, `{ "$ref": "depth.json" }` to `schema/message.json` `oneOf`, and `"depth"` to the set in `tests/test_schema.py::test_message_types_are_covered`. Then `Core.send_depth_cloud` can call `self._check(msg)`.

**`STATUS.md` lines 8 to 15** (the Record3D paragraph): replace with:

```
**Depth camera (Sat 17:15):** the free Record3DStream path is gone. The core reads
our own app through `core/camera/geppetto_depth.py` (`DepthFrame` in
`core/camera/depth.py`). `python -m core --depth` turns on the depth step: table
plane, forearm yaw and glove yaw drift correction, `/ws/depth` point clouds, viewer
at `/depth`. Off by default. Tested on fakes only; see `STATUS-lidar.md`.
```

**`DECISIONS.md` D26**: append:

```
Update Sat 14 Nov 17:15 (lane lidar): the Record3DStream reader is removed. Our own
app is the one depth source; its reader lives in core/camera/geppetto_depth.py and
ios/mac re-exports it. The depth step (core/camera/depth_track.py, depth_live.py)
corrects glove yaw drift from the forearm direction, slowly, behind --depth.
```
