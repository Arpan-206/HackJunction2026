# STATUS: lane lidar

**Update Sat 14 Nov, 20:45: first real clips.** The section "Follow-up: real clips" below holds the results on three real recordings: `bench-stand-1` (bare hand, hand-marked spans), `bench-riser-1` (riser behind the laptop, no app plane) and `bench-gloves-1` (both gloved hands). Everything after that section is the earlier write-up, tested on the fake scene only.

**Still unverified:**
- the yaw correction with real gloves and real depth at the same time: no glove data reached this Mac;
- two arms at once for the arm gate and the yaw: the corrector still serves one side;
- the dark-glove outline from colour: not built;
- the LED markers: lane hand-root's part, and the LEDs could not be set tonight.

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

## Follow-up: real clips (Sat 14 Nov, 19:40 to 20:45)

Branch `lidar`, merged with the main checkout's local main first (a fast-forward, no conflicts). All clips are read-only in the main checkout's `captures/`, not in git; the tests that use them skip where the files are missing.

### Commands

| Command | What it does |
| --- | --- |
| `python -m tools.depth_check CLIP --spans tests/fixtures/depth/bench_stand_1_spans.json` | Adds the found rate per hand-marked label and the false accepts on no-arm spans |
| `python -m tools.depth_check CLIP --gate cylinder` | The first gate, for before-and-after comparisons |
| `python -m tools.depth_check CLIP --colour` | Adds colour proposes, depth confirms (MediaPipe), scored on the same spans |
| `python -m tools.hand_blob_check captures/bench-gloves-1.gdrec.gz` | Gloved hands: both-hands rate, swaps, jitter, plane check, upright overlays |

### 1. Arm gate: "shape" replaces "cylinder"

On `bench-stand-1` the first gate accepted a tall object at the image edge as an arm in 59% of no-arm frames. The new default gate, `gate = "shape"` in `[camera.depth]`, scores the 4 largest blobs. An arm must:
- enter from the edge (6 px margin);
- be 12 to 26 cm long;
- widen from a wrist toward the hand (taper 1.3 or more);
- be 5 to 15 cm wide at the hand;
- reach at most 15 cm above the table (95th percentile);
- cover at least 1200 depth pixels;
- pass in at least 3 of the last 5 frames.

Spans were marked by hand from colour contact sheets in `tests/fixtures/depth/bench_stand_1_spans.json`. The clip is not what its note says: hands are in view for most of the 40 s, and frames 976 to 1135 show a black Smartglove.

| `bench-stand-1`, every frame | Arm found (706) | Glove found (160) | False accepts in no-arm (202) |
| --- | --- | --- | --- |
| cylinder gate (before) | 41.5% | 6.9% | 59.4% (120 frames) |
| shape gate (after) | 35.1% | 0.0% | **0.0%** |
| colour plus depth (MediaPipe, off by default) | 22.0% | 0.0% | 0.0% |
| shape or colour plus depth | 51.3% | 0.0% | 0.0% |

The same edit fixed an old bug: the entry search dropped a lone entry once a direction was remembered.

### 2. Safe yaw correction

| Rule | Where |
| --- | --- |
| The glove yaw changes only from a confirmed, long arm: shape gate passed, elongation 1.8 or more | `forearm_ok` in `depth_track.py` |
| Rate cap: at most 3 deg/s, whatever the depth says | `max_rate_deg_s = 3.0` in `[camera.depth]` |
| Arm lost: the last good correction is held, not reset | `YawCorrector`; `test_correction_holds_when_the_arm_is_lost` |
| Flag on, no arm in view: scores, hands, ghost and events match flag off frame by frame | `tests/test_depth_safety.py`, on the real no-arm frames 0 to 165 of `bench-stand-1` |

### 3. Flat hand in the 3D view

Points with high confidence, 4 mm or more above the table, are no longer labelled table in the cloud. The plane fit RMS on the stand clip is 1.2 to 2 mm. Points joined to a confirmed arm are labelled arm. The yaw never reads this band (`cloud_fine_band_m`). Limit: on `bench-stand-1` a flat hand mostly stays within 4 mm of the plane, so depth lifts only its edge. The colour mask lifts the whole hand, but only with `colour_confirm` on.

### 4. Colour proposes, depth confirms (`core/camera/depth_colour.py`)

How it works:
- MediaPipe proposes hands on the phone's JPEG; it uses no colour thresholds.
- Depth confirms: the palm landmarks, read at the nearest valid depth in a 5x5 window, must lie 1 cm below to 20 cm above the table.
- Wrist to middle knuckle must measure 3 to 15 cm. That vector gives a hand yaw.

Why it is off: it costs 44 ms a frame (p95 86 ms), more than the 33 ms a frame of 30 fps allows. The flag is `colour_confirm = false` in `[camera.depth]`, so the live step does not use it yet; only `depth_check --colour` does. On the frames where both colour and depth found the arm, the hand yaw differs from the forearm yaw by a median of 17 deg. The wrist bends, so the two are not the same quantity.

Not done by the time box:
- the dark-glove outline from colour (MediaPipe finds no glove in either clip);
- the colour step in the live step's own thread.

### 5. Riser position (`bench-riser-1`, no app plane in any frame)

| Item | Result |
| --- | --- |
| Working surface | our fit, 0.424 m below the lens (std 12 mm), 1.6 deg from level. Measured, not the 0.30 m first stated |
| Surface heights below the lens | one dominant peak at 0.43 m. No second peak 1 to 5 cm lower, so the keyboard deck and the table in front of it agree within about 1.5 cm here |
| Area hidden by the screen | none of the table in front of the laptop. The surface is visible from 0.18 m ahead of the lens (horizontally) onward; that edge is set by the bottom of the field of view. The screen top could not be measured in depth (too near or no valid readings), so this is an upper bound on what it hides: the back of the keyboard deck only |
| Arm gate (spans in `tests/fixtures/depth/bench_riser_1_spans.json`) | gloved hand reaching over the keyboard: cylinder 10.5% before, shape 74.4% after. Hands held at the chest: 0% both |
| Yaw | no frame feeds the yaw: the reaching blob is never long enough (median elongation 1.4). Safe, but no yaw correction from this position until hand directions come from the gloved-hand blobs |
| Mirroring | the person faces the phone, so their right hand is on the image's left. Sides come from the bench x position (`camera_yaw_deg = 180`), not the image |

### 6. Gloved hands from depth (`hand_blobs`, for lane hand-root)

Interface, agreed by FIELDS with hand-root: `hand_blobs(frame, table=None, max_n=2) -> list[HandBlob]` in `core/camera/depth_track.py`, largest first. Fields: `centre_world`, `centre_uv`, `axis_world`, `height_m`, `area_px`, `mask`, `darkness`. My extras: `side_hint`, `area_m2`, `elongation`, `range_m`, `centre_bench`.

How it works:
- Points: confident depth, 1 to 28 cm above the work surface, at least 6 cm nearer to the lens than the body's main distance. The body distance is the strongest range peak among points 8 cm or more up.
- Blobs: hand-sized, 0.004 to 0.08 m2.
- Direction: the long axis, pointing away from the body.
- Fingers: none. Fingers come from the gloves.
- `HandBlobSides` keeps left and right across frames.
- Orientation: `upright_turns(frame)` gives the upright rotation from gravity (1 on every frame of this clip), and `rotate_upright` applies it. `hand_blob_check` writes its images upright.

| `bench-gloves-1` (787 frames) | Result |
| --- | --- |
| Hands found | both 40.7%, one 37.4%, none 22.0% (hands in the lap behind the laptop count as none, correctly) |
| Left and right swaps | 31 (46 without `HandBlobSides`), over 114 track starts |
| Position jitter | 4.6 mm p50, 27 mm p95 (centre minus its 5-frame mean); step 8.5 mm p50, 51 mm p95 |
| Plane | app plane in 100% of frames, 0.43 m below the lens; our fit is 0.43 m too, 2.1 deg and 1.9 mm apart: the same surface |
| Speed | 14 to 17 ms a frame for the finder (p95 27 to 36 ms on a loaded Mac). The recording itself runs at 23.3 fps by median interval |

Known faults:
- a glove lying flat on the keys (within 1 cm of the deck) is missed;
- two touching hands merge into one blob;
- a hand's own forearm can count as the second blob, which inflates "both" and the swaps;
- the face was taken for a hand until `hand_h_max_m = 0.28`.

### Before and after, every row of the summary table

"Before" is the code of the first write-up (cylinder gate). "After" is the current default. Times are wall clock on a Mac with a load average of 9 to 31 from other lanes. On a quieter run the CPU time per frame was 20 ms (stand) and 26 ms (riser).

| Recording | Arm found, before | Arm found, after | Forearm ok (feeds yaw), after | Hand depth when found, before / after | Yaw step p50 / p95, after | Tracker mean / p95, after |
| --- | --- | --- | --- | --- | --- | --- |
| fake, skin hand | 97.7% | 6.0% | 6.0% | 95.9% / 100% | 0.10 / 0.29 deg | 37 / 76 ms |
| fake, dark hand | 94.7% | 0.0% | 0.0% | 0% / none | none | 24 / 41 ms |
| fake, no app plane | 96.7% | 6.0% | 6.0% | 95.9% / 100% | 0.11 / 0.33 deg | 31 / 54 ms |
| real `bench-3` (no arm in view) | 16.3% (all false) | **0.0%** | 0.0% | 0% / none | none | 28 / 51 ms |
| real `bench-stand-1` | 28.3% (first run, includes the bottle) | 21.1% (arm spans 35.1%, no-arm 0%) | 20.0% | 0% / 0% | 0.99 / 6.5 deg | 48 / 93 ms |
| real `bench-riser-1` | 2.1% (reach span 10.5%) | 15.2% (reach span 74.4%) | 0.0% | 11.1% / 1.6% | none | 53 / 114 ms |

Table rows do not change with the gate:

| Recording | Table | Camera height (app, fit) | App against fit |
| --- | --- | --- | --- |
| fake skin and dark | app plane | 0.140 m, 0.140 m | 0.2 deg, 0.1 mm |
| fake no plane | own fit | none, 0.140 m | none |
| `bench-3` | app plane | 0.175 m, 0.175 m (std 52 mm) | 4.0 deg, 14.7 mm |
| `bench-stand-1` | app plane | 0.136 m, 0.138 m (std 17 mm) | 1.6 deg, 2.3 mm |
| `bench-riser-1` | own fit only | none, 0.424 m (std 12 mm) | none |
| `bench-gloves-1` | app plane | 0.43 m, 0.43 m (std 9 mm) | 2.1 deg, 1.9 mm |

The fake scene fails the shape gate: its arm is a perfect cylinder with no wrist taper. Its dark hand is the forearm alone. The fake tests therefore pin `gate = "cylinder"` (`tests/test_depth.py`, `tests/test_depth_glove_replay.py`). Their earlier numbers (direction RMS 0.3 deg, drift test 2.6 deg left of 21.6) still hold under that gate. Under the shape gate they say nothing.

### What a human must do next (real clips)

1. Record a bare-hand clip from the riser with an empty-table span. That allows false accepts to be measured there; `bench-riser-1` has none.
2. Decide the yaw source at the riser. The forearm is rarely visible there. The `hand_blobs` axis or the glove LEDs (lane hand-root) are the candidates.
3. To try colour live, set `colour_confirm = true`. It still needs a thread in `depth_live.py`, which is not written.
4. The slot-kit test `test_depth_step_against_fake_phone` failed once under a load average of about 25: the fake phone delivered 15.9 fps, below its minimum. It passed on rerun. It is not caused by this lane.

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
