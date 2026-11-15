# STATUS: hand-root lane

Branch `hand-root`, worktree `.claude/worktrees/hand-root`, made from `main` at 5079703 (Sat 14 Nov, 20:02).

## What it does

The gloves give joint angles and the wrist orientation. They give no position, so the 3D hand stayed in one place. The hand root moves the glove wrist with the phone on the riser (LiDAR depth plus colour).

- The glove keeps the angles and the orientation. Only `HandState.wrist_p` changes.
- No new wire field. On `/ws` the hand's `wrist.p` moves and `anchor` reads `"camera"` (live) or `"held"` (lost, holding or easing back). The compat `/ws/gloves` hand then sends `wrist_pos`. With no fix, everything is as before: `anchor` `"rest"`, `wrist_pos` `null`.
- The frontend hand follows `wrist_pos` when it is present (`frontend/src/three/Hand.tsx`).

## How to run

| What | Command |
|---|---|
| Live, phone over the cable (iproxy on 7700) | `python -m core --fake --root --depth-host 127.0.0.1:7700` |
| Live, real gloves | `python -m core --root --solver HOST:12277 --rcsp HOST:45451` |
| Same flag in config | `config.toml` `[camera] root_tracking = true` (default `false`) |
| Check a clip | `python -m tools.hand_root_check captures/bench-gloves-1.gdrec.gz --out logs/hand_root/x [--gloves right]` |
| Count left and right swaps | `python -m tools.hand_root_swaps logs/hand_root/x/track.csv` |
| What the screen hides | `python -m tools.hand_root_occlusion captures/bench-gloves-1.gdrec.gz` |
| Watch a running core | `python -m tools.hand_root_watch --port 8765 --seconds 10` |
| Set the ring LED marker colours (parked) | `python -m core.camera.hand_root_led --host 127.0.0.1 --port 45451` |
| Tests | `python -m pytest -q tests/test_root_fuse.py tests/test_root_gloved.py` |

`--root` turns on `--depth` too. The hand root shares the depth step's phone connection, because the phone serves one client at a time. The MediaPipe model must be at `models/hand_landmarker.task` (`python -m tools.fetch_models`).

## How it works

| Step | File | What |
|---|---|---|
| Bench frame | `core/camera/hand_root.py` | Table plane from the app, else a RANSAC fit. Frozen once found. Re-anchored when the phone moves and then stays still for 1 s. |
| Gloved hands | `core/camera/hand_root_blobs.py` | Depth blobs nearer than the body and 2 to 60 cm above the table. Wrist = blob points 14 to 20 cm back from the tip along the long axis. |
| Ring LED | `core/camera/hand_root_led.py` | Small bright saturated blobs with a dark hole near a blob. Side by marker hue, when the marker colours are set. |
| Bare hands | `core/camera/hand_root.py` | MediaPipe on the upright colour frame (turned by gravity), grey plus CLAHE (a local contrast boost). Depth at the wrist and two knuckles. |
| Core world | `core/camera/hand_root.py` | `origin = "lock"`: the first fix lands on `[rest_pose]`, later motion is relative. One Euro filter per track. |
| Fusion | `core/root_fuse.py` | Rate cap 1.5 m/s, jump gate (15 cm needs 3 frames in a row), hold 2 s, ease back to the glove's rest over 1.5 s. |

Left and right:

| Case | Rule |
|---|---|
| Ring LED with a marker colour | It names its hand. If only one ring shows, the other blob is the other hand. |
| Two gloves, no ring | Smaller core x is the left hand. The phone faces the person (`camera_yaw_deg = 180`). |
| One glove active | That glove's ring wins. Else the darker blob (glove beats skin). Else the nearest to the last wrist. Else hold, never switch. |
| MediaPipe label | Used only for one fix with two gloves. `swap_handedness = false`: on the riser, "Right" was the person's right hand. |

The number of hands to track comes from the glove hands the session has (`Session.hands` entries with source `"glove"`). The lesson format has no one-hand or two-hand field today (`core/recorder.py` Lesson has `master_hand` only), so the active gloves decide.

## Results on the recorded clips

All clips are read-only in the main checkout `captures/`. Simulated glove hands; the real gloves were not connected to this Mac. Times are with four clips processed in parallel, so they are pessimistic.

| Clip | Hands | Frames | Clip fps | Any hand found | All gloves found | Left/right swaps | Still jitter (fused) | Tracker ms p50 / p95 |
|---|---|---|---|---|---|---|---|---|
| bench-gloves-1 (both gloves, riser) | both | 787 | 19.7 | 86.5% | 52.4% | 5 (at 8 to 13 s, hands together at the chest) | 9.9 mm (left, 7 windows) | 39 / 147 |
| bench-onehand-1 (right glove, bare left passes) | right | 841 | 21.0 | 97.1% | 97.1% | 0 track jumps to the bare hand | no still window | 36 / 132 |
| bench-riser-1 (gloves, no app plane) | both | 421 | 14.0 | 99.5% | 84.6% | 14 | 8.3 mm | 40 / 163 |
| bench-stand-1 (bare hand, stand) | right | 1200 | 30.0 | 80.3% | 80.3% | 0 | 5.4 mm (11 windows) | 32 / 119 |

Alone on one clip, the tracker takes about 13 to 18 ms a frame (60 fps or more), so it keeps up with the phone's 30 fps.

"Still jitter" is the median standard deviation of the fused wrist over 1 s windows where the hand moved less than 1 cm per frame. The lidar lane measured 4.6 mm p50 on its own blob finder.

The one-hand clip check: 12 of 12 sampled frames by eye show the right-glove fix on the glove, never on the bare arm (the frame sheet is not in the repository: it showed people at the venue). The fuser held 10 times for ambiguity instead of switching.

MediaPipe alone (before the depth-first change) found far less:

| Clip | MediaPipe only, first try | Upright plus CLAHE, threshold 0.3 |
|---|---|---|
| bench-stand-1 (bare hand) | 12% of frames | 46% of frames |
| bench-riser-1 (gloves) | 12% | 31 to 34% |

## Live test against the phone

`python -m core --fake --root --depth-host 127.0.0.1:7700`, phone on the riser, 15 s, 20:47.

| Measure | Result |
|---|---|
| Phone frame rate | 29.9 fps, 0 bad packets |
| Table | app plane, camera 0.42 m above it |
| `/ws` frames with the wrist moved by the camera (left, right) | 99%, 99% |
| `/ws/gloves` hands with `wrist_pos` set | 99%, 99% |
| Wrist range seen (right), metres | x -0.17 to 0.15, y 0.09 to 0.33, z -0.35 to -0.05 |

Screenshots: `docs/hand_root/debug_live_strip.png` (the debug view, three moments). The middle shot of each strip came out empty, also on the replay. I think that is the headless renderer, but I did not prove it.

## Camera height and the screen

| Clip | Table source | Camera height above the table |
|---|---|---|
| bench-riser-1 | own RANSAC fit (no app plane) | 0.425 m (0.412 m on the first frame) |
| bench-gloves-1 | app plane | 0.429 m |
| live | app plane | 0.42 m |

The camera is about 0.43 m above the table, not 0.30 m.

The screen hides nothing beyond the field of view. The lowest image row meets the table 0.18 m in front of the point under the camera. The nearest surface the depth sees (the laptop keys) is also at 0.18 m (0.187 m on bench-riser-1). So the first 18 cm in front of the phone are out of view, and the screen hides 0 to 2 mm more. The laptop's keyboard and everything in front of it are visible.

## Ring LEDs as they are

The rings are visible only when the back of the hand faces the phone. Both glow pink, the same hue as the venue light and the fingertips (`docs/hand_root/ring_leds_as_they_are.png`). So they give no left or right today. The ring finder found ring-shaped spots on 31% of blob fixes (bench-gloves-1) and 36% (bench-onehand-1), but without marker colours these are not proven to be the hubs. Identity came from x order and the one-glove rules.

## Flag off equals flag on with no hand

`tests/test_root_fuse.py::test_flag_on_with_no_hand_in_view_equals_flag_off` replays 20 s of the real right glove's wrist quaternions (`tests/fixtures/depth/glove_yaw_right_1320s.npz`) through a learn-mode session. The hand root reads an empty table with the real MediaPipe model. Every frame, every message and every compat hand is identical to the run without the hand root, the score included.

## Written but untested

| Item | Why untested |
|---|---|
| Ring LED marker colours (left green, right amber) | PARKED: the gloves were on another machine, not this Mac. Command: `python -m core.camera.hand_root_led --host 127.0.0.1 --port 45451`. |
| Ring side by hue | Tested on synthetic rings only. |
| Real gloves and the hand root together | No gloves on this Mac. Live test used `--fake` gloves. |
| `origin = "bench"` | Not run on a clip. |
| Lidar's `hand_blobs` (branch `lidar`, 10c9421) | Not merged here. `find_blobs` switches to it by import once it is on main. Same fields as agreed. |

## Known limits

- Hands that touch merge into one blob, so one hand is lost (both found 52% on bench-gloves-1).
- A glove flat on the keys (within 2 cm of the deck) is missed.
- Hands in the lap behind the laptop are out of view: no hand found in 13.5% of bench-gloves-1 frames.
- The swaps on bench-gloves-1 happen when the hands come together at the chest.
- MediaPipe on a gloved hand is weak. The depth path carries the gloves.
- Two bare hands at once: not tested.

## For a human to do next

1. Set the LED marker colours when the gloves are on this Mac. Then record a clip and check `rings_on_blobs` and the sides.
2. Apply the `core/rcsp.py` patch below, so the core does not repaint the rings with its status colours while the hand root uses them.
3. Merge the `lidar` branch, then rerun `tools/hand_root_check` on bench-gloves-1 to compare the two blob finders.
4. Optional: add a `hands` field ("one" or "two") to the lesson, and pass it to `RootFuser` as the number of hands.

## Patches for files outside this lane

`core/rcsp.py` (glove owner): keep the marker colours while the hand root is on. In `GloveControl._set`, before `LED_COLOURS[state]`:

```python
    async def _set(self, side: str, state: str) -> None:
        markers = getattr(self.session, "led_markers", None)   # set by __main__ with --root and markers on
        for did, sd in self.side_of.items():
            if sd == side:
                rgb = markers[side] if markers and state == "idle" else LED_COLOURS[state]
                try:
                    await self.client.set_color_led(did, rgb)
                except RcspError as e:
                    log.debug("SetColorLed failed: %s", e)
```

and in `core/__main__.py`, after the hand root is attached: `core.session.led_markers = MARKER_RGB` (from `core.camera.hand_root_led`). Status flashes (passed, recording) still show; the ring returns to its marker colour when idle.

## Files in this lane

New: `core/camera/hand_root.py`, `core/camera/hand_root_blobs.py`, `core/camera/hand_root_led.py`, `core/root_fuse.py`, `tests/test_root_fuse.py`, `tests/test_root_gloved.py`, `tools/hand_root_check.py`, `tools/hand_root_swaps.py`, `tools/hand_root_occlusion.py`, `tools/hand_root_watch.py`, `docs/hand_root/`.

Changed (additive):

| File | Change |
|---|---|
| `core/session.py` | `self.root = None`; in `tick`, `self.root.apply(self.hands, t)` after the depth step. 5 lines. |
| `core/__main__.py` | `--root` flag; attaches `HandRootLive` on the depth step's source. |
| `config.toml` | `[camera] root_tracking = false`; new `[camera.root]` section. |
| `frontend/src/three/Hand.tsx` | `followWristPos` default `'auto'`: follow `wrist_pos` when present, offset from the core rest pose at 12 units per metre. |
| `frontend/src/three/smoothing.ts` | Snap on the first position after none. |
| `docs/DEPTH_STREAM.md` | "Hand root" section. |

Not touched: `core/camera/depth_track.py`, `depth_live.py`, `geppetto_depth.py`, `tools/depth_check.py`, `SPEC.md`, `docs/CONTRACT.md`.

Checks run before the last commit: core suite 232 passed (20:55), frontend lint, 359 vitest tests and build passed.

## Stabilisation pass (Sat 22:35 to 23:00)

The live test at 22:21 showed a jumpy hand that left the view. This pass fixes that on the recorded clips. It is not yet tested live: the computer restarted before the live check.

What changed:

- Newest frame only: the live path already keeps one frame. It now logs the delay from phone capture to the frame message every 5 s (`delay_ms_p50`, `delay_ms_p95` in the status).
- Work box: the fused wrist is clamped to 45 x 25 x 30 cm (x, y, z) in the core world (`fuse_box_centre`, `fuse_box_half`). `Hand.tsx` clamps the offset to the same half sizes.
- Jump gate: a fix more than 8 cm from the last good one is held back until 5 fixes in a row agree (`fuse_jump_m`, `fuse_jump_frames`).
- One Euro filter on the fused wrist (`fuse_one_euro_min_cutoff` 1.0, `fuse_one_euro_beta` 2.0). The tracker's own filter is off, so the position is filtered once. The 1.5 m/s ceiling stays: without it the one-hand clip has 9 to 12 jumps a minute, with it 3.
- Two hands keep the blob nearer their last good position, so crossing hands do not swap.
- Motion scale 0.6 about the lock anchor (`motion_scale`). Height comes from the table: core y = `floor_y_m` + 0.6 x height above the table.
- Axis test `tests/test_root_axes.py`: a synthetic riser camera, landscape and portrait. Hand right, toward the camera and up move the 3D hand the same three ways.

Results (`tools.hand_root_check`, a jump is a step over 8 cm between frames):

| Clip | Hand | Jumps per minute before | Jumps per minute after | Inside the box before | Inside the box after | Live rate before | Live rate after |
|---|---|---|---|---|---|---|---|
| bench-gloves-1 | left | 28.5 | 0.0 | 86.4% | 100% | 63.0% | 67.2% |
| bench-gloves-1 | right | 34.5 | 1.5 | 59.1% | 100% | 78.9% | 66.5% |
| bench-onehand-1 | right | 52.5 | 3.0 | 78.6% | 100% | 96.3% | 93.0% |

Not measured: the delay on the clips (the check tool has no render clock). The live log line reports it; the 22:21 run had a 700 ms old depth frame while the test suites starved the core.

Checks after the pass: core suite 280 passed, 1 skipped (22:52); frontend 537 vitest tests passed (22:43).

Verdict: clearly better on the clips. The flag stays off by default until a live check with both gloves and the phone confirms it.

## Delay per stage (Sat 23:00 to 23:30)

Not tested with the phone: no hardware was attached after the restart.

How to read it live: the core logs `hand root stages (ms)` every 5 s and serves `GET /debug/delay`. In the browser, set localStorage `apprentice.delayProbe` to `1` (or to the core's base URL when the viewer runs on another machine) and call `window.__handDelay.report()`.

| Stage | Median (ms) | Worst (ms) | Measured on |
|---|---|---|---|
| Phone capture to arrival on the Mac, above the fastest frame | 681 to 860 | 1678 to 2802 | the two gloved recordings from 20:22 and 20:26 |
| Arrival to processing done | 21 | 77 | replay of bench-gloves-1 through the live path |
| Processing done to the core tick | 11 | 29 | same replay |
| Core tick to the socket write | 8 | 13 | same replay |
| Core tick to received in the browser (bridge and backend included) | 9 | 1518 (page load) | same replay, headless Chrome on the core's machine |
| Received to drawn | 11 | 145 | same replay, headless Chrome |

The biggest stage is the first one: phone to Mac. The phone made a frame every 33 ms, but frames reached the Mac every 38 to 43 ms, at 4 MB a second, and the delay stood at 0.5 to 1.6 s. The absolute value is unknown because the two clocks differ; the number is the excess over the fastest frame. The recordings ran with the gzip recorder in the reader thread (19 ms a packet) on a loaded machine, so the live value may be lower. The live log line now shows it.

Changes for delay:

- `GeppettoDepthCamera`: the reader thread keeps only the newest raw packet; decoding waits for `read()`.
- `/ws/gloves` clients queue two frames at most (was 64).
- Wrist filter presets, `fuse_preset` in `[camera.root]`: "steady" (default; beta 2, derivative cutoff 1 Hz, the stabilisation-pass value) and "fast" (beta 6, cutoff 2 Hz). Numbers for "fast": Simulated 12 cm reach: lag 165 ms to 130 ms. Clips: jumps a minute 0.0, 1.5, 3.0 become 1.5, 3.0, 4.5; still jitter 6.7 mm to 8.0 mm at worst.
- Frontend: the wrist position blend is 15 ms (was 45 ms).
- Prediction along the velocity (`fuse_lead_max_ms`) is written and off: it cuts the lag to 55 ms but overshoots a stop by 3 to 5 cm.

If the first stage is still large with the phone: shrink the packet in the app (208 KB now: depth 98 KB, confidence 49 KB, JPEG about 60 KB) and send the phone's wall clock so the stage is measured in absolute terms. Both need an app rebuild.

Viewer on another machine: `tick_to_received` then includes the clock difference of the two machines. The probe marks this with `viewer_on_core_machine: false`.

Checks: core suite 281 passed, 1 skipped on the final values (23:45); frontend lint, 537 tests, build.

## Live measurements with both gloves and the phone (Sat 14 Nov 23:23, Sun 15 Nov 06:24)

Measured on the live stack: both Rokoko gloves over USB, the iPhone on the riser over the cable, the core started with
`--root --depth-host 127.0.0.1:7700`, wrist filter preset "steady". Source: `GET /debug/delay` on the core and the
core's own log line `hand root stages (ms)`. The rebuilt phone app (with the listener fix) was installed at 23:22.

| Stage | Median, 14 Nov 23:23 (ms) | Worst (ms) | Median, 15 Nov 06:24 (ms) | Worst (ms) |
|---|---|---|---|---|
| Phone capture to arrival on the Mac, above the fastest frame | 19 | 24 | 17 | 24 |
| Arrival to processing done | 17 | 46 | 18 | 36 |
| Processing done to the core tick | 13 | 37 | 14 | 30 |
| Core tick to the socket write | 5 | 7 | 4 | 14 |
| Sum of the measured stages | 54 | 114 | 53 | 104 |

The first stage was 681 to 860 ms on the evening recordings (section "Delay per stage"). The difference is the reader
that keeps only the newest packet, and a machine with no test suite running beside the core.

Other live facts: phone depth 30 frames a second, table plane found, camera 0.43 to 0.45 m above it; gloves 83.3 frames
a second from the driver, 30 a second at the core and at the backend; the wrist position reaches the backend's glove
stream in 97 to 100 % of frames while the phone sees the hand. Not measured: the two browser stages on a real session,
and the first stage in absolute terms (the phone and the Mac have different clocks).
