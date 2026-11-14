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

The one-hand clip check: 12 of 12 sampled frames by eye show the right-glove fix on the glove, never on the bare arm (`docs/hand_root/onehand_frames.jpg`). The fuser held 10 times for ambiguity instead of switching.

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
