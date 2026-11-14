# Depth stream for the frontend: `/ws/depth` and `frame.depth`

For the frontend owner. Nothing here is verified on real depth yet. Every number below comes from the fake bench scene (`core/camera/fake_depth.py`).

## When it exists

The core sends depth only when it runs with the depth step on:

```
python -m core --depth                                  # reads the phone, [camera.geppetto_depth]
python -m core --fake --depth --depth-fake              # fake gloves and a fake depth scene, no phone
python -m core.camera.fake_depth --port 7711 --dark-hand   # a fake phone on a port ...
python -m core --fake --depth --depth-host 127.0.0.1:7711  # ... read over TCP like the real one
```

With the step off, the core sends no `/ws/depth` messages and the frame has no `depth` key. Treat both as optional.

## `/ws/depth`: the point cloud

Open `ws://<core>:8765/ws/depth`. The core sends one `depth` message about 10 times a second (`[camera.depth] cloud_hz`). It ignores anything you send. The schema is `schema/depth.json`, also served at `GET /schema/depth.json`.

| Field | Meaning |
| --- | --- |
| `frame` | `"bench"`: metres, y up from the table top, x and z turned to the core world (z toward the person), origin at the table plane's centre. `"camera"` only when no table is found |
| `n` | number of points, about 2000 |
| `points` | flat `[x0, y0, z0, x1, ...]`, length `3n` |
| `labels` | one per point: 0 other, 1 table, 2 arm (forearm, and the hand when it has depth), 3 dark patch next to the arm (a hand with no depth, for example black gloves) |
| `rgb` | flat `[r, g, b, ...]` from the phone's colour image, 0 to 255, length `3n` |
| `table` | `found`, `source` (`"app"` = the phone's plane, `"fit"` = ours), `camera_height_m`, `agree_deg` and `agree_mm` (app plane against our fit) |
| `arm` | `found`, `hand_depth`, `forearm_ok`, `yaw_deg`, `dir` (unit vector, elbow to fingers, bench frame), `entry` (where the arm crosses the image border, bench frame), `length_m`, `elongation` |
| `correction` | `side`, `correction_deg`, `locked`, `applied`, `glove_yaw_deg` |
| `process_ms` | tracker time for this frame |

One message is about 84 KB of JSON. At 10 Hz that is about 0.8 MB/s, fine on localhost.

### Drawing it

- Use a `THREE.Points` with a `BufferGeometry`. Allocate `Float32Array(3 * 2048)` once for positions and once for colours. Copy `points` in on each message, set `geometry.setDrawRange(0, n)` and mark the attributes for update.
- The bench frame matches the core world's axes. If the hands sit on the same bench, draw the cloud in the hands' scene. The origin is the table plane's centre, not marker 9, so expect an offset until a shared calibration exists.
- Colour by label, or by `rgb`. Respect the theme rules: gold only for mastery, vermilion only for corrections, malachite for correct. A neutral palette for labels is safest, for example table in warm grey, arm in a muted teal and the dark patch in a dull red-brown.
- Draw `arm.dir` from `arm.entry` as a short arrow, a few centimetres above the table.
- `tools/depth_view.html` (served at `GET /depth`) is a reference with a plain 2D canvas: orbit by dragging, zoom with the wheel.

## `frame.depth`: the block on `/ws`

Each `frame` gains a `depth` object when the step is on (`schema/depth.json` `$defs/block`):

```json
{"side": "right", "connected": true, "frame_id": 393, "age_ms": 94.1, "table": true, "hand": true,
 "hand_depth": false, "forearm_yaw_deg": 9.3, "forearm_ok": true, "glove_yaw_deg": 9.3,
 "correction_deg": 6.58, "locked": true, "applied": true}
```

- `hand` means an arm-shaped blob above the table, not a full hand.
- `applied` means the glove hand's wrist in this frame is already turned by `correction_deg`. Draw `hands` as they come; do not apply it again.
- A small status line is enough for the UI, for example "Depth: table, arm, yaw corrected by 6.6 deg". Keep it out of the learner's way. It is a debugging aid, not product copy.
- `frame.json` itself is not changed. Its top level allows extra keys, so the block validates. A patch to list it in `frame.json` is in `STATUS-lidar.md`.

## Hand root: the wrist moves in 3D

The gloves give joint angles and the wrist orientation, but no position. The hand root moves the glove wrist with the phone. It is off by default. Turn it on with `python -m core --root` (this also turns on the depth step) or `[camera] root_tracking = true`. Settings are in `[camera.root]`.

- No new wire field. The core changes the glove hand's `wrist.p` on `/ws` and sets `anchor` to `"camera"` (live fix) or `"held"` (tracking lost, holding or easing back). The compat `/ws/gloves` hand then sends `wrist_pos` in metres. With no fix, `anchor` stays `"rest"` and `wrist_pos` stays `null`, exactly as before.
- The frontend hand (`frontend/src/three/Hand.tsx`) follows `wrist_pos` whenever it is present. The offset is from the core's rest pose for that side, at 12 scene units per metre. Pass `followWristPos={false}` to keep a hand fixed in a scene that needs it.
- Gloved hands: depth blobs first (the black gloves return solid depth), with the glove's ring LED for identity when its colour is set. Bare hands: MediaPipe on the colour frame, turned upright by gravity. Code: `core/camera/hand_root.py`, `hand_root_blobs.py`, `hand_root_led.py`, `core/root_fuse.py`.
- Numbers, limits and what is unverified: `STATUS-hand-root.md`. Check a clip with `python -m tools.hand_root_check <clip>.gdrec.gz`.
