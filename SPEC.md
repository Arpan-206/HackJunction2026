# Geppetto: API and data spec

Nov 13, 2026 · @Arpan Pandey

## Overview

The core service sits between the gloves and the screen, and it is the only place anything is computed. It reads solved hands and camera frames, places each hand in space, records lessons, scores a learner against a master, and asks Gemma for words. The viewer draws what the core sends and sends back button presses.

&#91;embedded content: architecture · 4 inputs, the core, 3 outputs, ports on the arrows\]

The left column is Rokoko's and Apple's software; the core and the viewer are ours. Numbers on the arrows are TCP ports.

| Part | Owner | What it does |
| --- | --- | --- |
| Rokoko driver and hand solver | Hardware and frontend | Rokoko's own binaries. We run them, we do not write them. |
| Viewer (`viewer/`, Three.js) | Hardware and frontend | Renders hands, ghost, codex and task screens from one WebSocket. No maths. |
| Core (`core/`, Python) | Arpan | Fusion, recorder, scorer, session state, the WebSocket server. |
| Gemma service (on Verda) | Arpan | Names lesson steps, writes coaching lines, picks task settings. Never in the frame loop. |

Three rules keep the two halves independent:

1. Every message in this doc lives as a JSON Schema file in `schema/`. If code and schema disagree, the schema wins.
2. The core can run with no gloves and no camera by replaying a recorded file, and the viewer can run with no core by replaying a recorded message log.
3. All positions are metres, all rotations are quaternions in x, y, z, w order, all times are integer microseconds.

## Processes and ports

Five local processes, started in this order, plus Gemma on Verda. Ports 45451, 12276 and 12277 are Rokoko's defaults; 8765 is ours.

| # | Process | Start command | Serves | Runs on |
| --- | --- | --- | --- | --- |
| 1 | Rokoko driver | `rokoko-sdk --auto-stream-usb` | RCSP on 45451 (commands, events), RGMP on 12276 (raw sensors) | Glove laptop |
| 2 | Hand solver | `rkk-hand-solver --no-driver --emit-openxr --listen 0.0.0.0:12277` | RGMP on 12277 (solved 26-joint hands) | Glove laptop |
| 3 | Camera | iPhone as a webcam, or the Record3D app over USB | Frames to the core, no port | Core laptop |
| 4 | Core | `python -m core --config config.toml` | HTTP and WebSocket on 8765 | Core laptop |
| 5 | Viewer | `npm run dev` | Dev server on 5173 | Either |
| 6 | Gemma | OpenAI-compatible chat endpoint | HTTPS | Verda |

The core opens three outbound sockets to the glove laptop: 12277 for solved hands, 45451 for the glove button and LED, and 12276 only when a task needs the raw accelerometer (boxing).

- **Licence, once per machine:** `rokoko signin`, then `rokoko activate`. The SDK needs macOS 14 on Apple silicon, Windows 10 x64, or Ubuntu 22.04.
- **USB streaming is off by default.** Either start the driver with `--auto-stream-usb` or have the core send `SubscribeToData` for each glove.
- **Two laptops:** put both on a phone hotspot, not the venue Wi-Fi. The solver listens on `0.0.0.0` so the core can reach it.
- **Fake mode:** `python -m core --fake` needs none of 1 to 3 and emits moving hands, so the viewer can be built tonight.

## Input A: gloves

The core reads solved hands from port 12277 and never does its own hand solve. The raw gloves send one orientation per finger sensor, not joints; Rokoko's `rkk-hand-solver` turns that into a 26-joint hand and re-serves it as a device with `device_type` `solved_hand`. The Python example solver cannot emit the OpenXR group, so use the binary.

### Solved hands (RGMP, TCP 12277)

All values are little-endian. One connection carries every glove.

| Message | Layout |
| --- | --- |
| Outer header | `<II`: prefix (1 definition, 2 data, 3 disconnect), payload length |
| Definition | UTF-8 JSON: `device_id`, `device_type`, `timestamp_epoch`, `device_info`, `static_data`, `groups[]` |
| Data frame | `<IIQ`: `device_id`, `group_id` (index into `groups`), `timestamp_us`, then every stream of that group packed in definition order |

We read the group `joints_openxr`:

- 26 joints in OpenXR `XrHandJointEXT` order, named in snake case (`palm`, `wrist`, `thumb_metacarpal`, ...).
- Frame `xr_base`: right-handed, Y up, metres. Quaternions are x, y, z, w.
- Wrist-relative: the wrist sits at the origin, so position comes from Input B.
- Pitch and roll are absolute. Yaw is relative to magnetic north with an arbitrary zero each session, so it needs the `calibrate` command.

Reader rules:

1. Parse the definition and build offsets from it. Never hard-code byte offsets. Write the definition JSON to `logs/` on connect.
2. Keep only the newest frame per device. The core samples at its own rate.
3. Use `timestamp_us` (hardware capture time), not arrival time. Map it to the core clock with the smallest `arrival - timestamp_us` seen over the last 5 s.
4. Take left or right from the device's `hand` field.
5. On a disconnect message, or 250 ms of silence, mark the hand `tracked: false` and hold the last pose.

```python
@dataclass
class GloveSample:
    device_id: int
    hand: Literal["left", "right"]
    t_us: int                 # core clock
    joints: np.ndarray        # (26, 3) wrist-relative, xr_base, metres
    rots: np.ndarray          # (26, 4) x, y, z, w
    heading_reliable: bool
```

### Button and LED (RCSP, TCP 45451)

Each message is an 8-byte header and a JSON body: marker `0xDC`, version `1`, header size `8`, type (1 command, 2 ok, 3 error, 4 event), then a little-endian uint32 body length. Commands look like `{"Command": "ListDevices", "TrackId": "1", "Version": 1, "Arguments": {...}}` and every command gets exactly one reply with the same `TrackId`. Events can arrive between a command and its reply.

| We send | Arguments | Why |
| --- | --- | --- |
| `ListDevices` | none | Find the gloves and their `DeviceId` |
| `GetDeviceInfo` | `DeviceId` | `IsLeft` tells us which hand |
| `SubscribeToData` | `DeviceId` | Start USB streaming if the driver flag was not used |
| `DeviceSubscribe` | `DeviceId`, `Publishers: [{Publisher: "DeviceEvents", Topics: ["ButtonPushed"]}]` | Glove button |
| `Subscribe` | `Publishers: [{Publisher: "DeviceEvents", Topics: ["Connected", "Disconnected"]}]` | Hot-plug |
| `SetColorLed` | `DeviceId`, `LedId: "RingLed"`, `Red`, `Green`, `Blue` (0 to 255) | Status light |
| `ReinitAlgo` | `DeviceId` | Recover a glove that has drifted |

A button press arrives as `{"Publisher": "DeviceEvents", "Topic": "ButtonPushed", "EventData": {"DeviceId": 1, "ButtonPushType": "SinglePress"}}`, with `SinglePress`, `DoublePress` or `LongPress`.

### Raw sensors (RGMP, TCP 12276), boxing only

Group `default` at 83.33 Hz carries `PROPER_ACCELERATION` for `hub_imu` and the hub's `STATUS_FLAGS`. Open this socket only when a task needs acceleration peaks.

## Input B: camera and wrist position

A camera tells the core where each wrist is, because the gloves cannot. Start with the iPhone as a plain webcam and a marker on the back of each glove: a marker of known size gives position without any depth sensor. LiDAR depth through Record3D is an upgrade for marker-free tracking, not a requirement.

### Camera adapter

```python
@dataclass
class CameraFrame:
    t_us: int                    # core clock, arrival minus config.camera.latency_us
    bgr: np.ndarray              # (H, W, 3) uint8
    depth: np.ndarray | None     # (H, W) float32 metres, aligned to bgr
    K: np.ndarray                # (3, 3) intrinsics

class Camera(Protocol):
    def read(self) -> CameraFrame | None: ...   # newest frame, never blocks
```

| Adapter | Source | Depth | Intrinsics |
| --- | --- | --- | --- |
| `opencv` | iPhone through Continuity Camera, or any webcam | No | From `config.toml` |
| `record3d` | Record3D app with USB Streaming mode on, `pip install record3d` | Yes | Per frame, from `get_intrinsic_mat()` |
| `file` | A recorded clip | As recorded | As recorded |

### Wrist detectors, tried in this order

| Detector | Needs | Gives |
| --- | --- | --- |
| `marker` | ArUco `DICT_4X4_50`, 30 mm square, id 0 on the left glove and id 1 on the right. Drawn on tape or shown on a phone screen is fine. | Position and orientation, from `solvePnP` with `SOLVEPNP_IPPE_SQUARE` |
| `blob` | Coloured tape on the wrist and a depth frame | Position only: HSV centroid, median depth of the 5 by 5 patch, back-projected with `K` |
| `rest` | Nothing | The fixed pose in `config.rest_pose` for that hand |

```python
@dataclass
class WristObs:
    hand: Literal["left", "right"]
    t_us: int
    p_cam: np.ndarray            # (3,) metres, camera frame
    q_cam: np.ndarray | None     # (4,) x, y, z, w; marker only
    method: Literal["marker", "blob", "rest"]
```

### Fusion, per hand, every output tick

- **Position** comes from the camera. Transform to world with `T_world_cam`, add the fixed `marker_to_wrist` offset, then smooth with a One Euro filter (start at min cutoff 1.5 Hz, beta 0.05).
- **Orientation** comes from the glove wrist joint, rotated by that glove's yaw offset.
- **Fingers** come from the glove, untouched.
- **Camera lost:** hold the last position for 300 ms, then ease to the rest pose over 500 ms. The `anchor` field on the hand says which of `camera`, `held` or `rest` is in use.
- **Yaw drift:** when a marker orientation is available, move the yaw offset 2 percent of the way toward it each frame.

### Two calibrations

| Command | What the person does | What the core stores |
| --- | --- | --- |
| `calibrate_camera` | Lays marker id 9 flat on the bench where the world origin should be | `T_world_cam` |
| `calibrate` | Holds both hands flat, palms down, fingers pointing away, for 1 second | Yaw offset per glove, averaged over the second |

## Data model

One hand model is used everywhere: 26 joints in OpenXR order, in a Y-up world measured in metres. The viewer, the recorder, the scorer and Gemma's summaries all read the same object.

### World frame

Right-handed, Y up, X to the person's right, Z toward the person. This matches Three.js, so the viewer applies no conversion. The origin is wherever marker 9 was placed in `calibrate_camera`, normally the middle of the bench. Units are metres, quaternions are x, y, z, w, times are integer microseconds on the core clock.

### Joint order

| Index | Joint |
| --- | --- |
| 0, 1 | `palm`, `wrist` |
| 2 to 5 | `thumb_metacarpal`, `thumb_proximal`, `thumb_distal`, `thumb_tip` |
| 6 to 10 | `index_metacarpal`, `index_proximal`, `index_intermediate`, `index_distal`, `index_tip` |
| 11 to 15 | `middle_` same five |
| 16 to 20 | `ring_` same five |
| 21 to 25 | `little_` same five |

### The Hand object

```json
{
  "device_id": 3,
  "hand": "right",
  "role": "learner",
  "tracked": true,
  "anchor": "camera",
  "wrist": { "p": [0.12, 0.08, -0.05], "q": [0.0, 0.71, 0.0, 0.71] },
  "joints": [[0.12, 0.08, -0.05], "... 26 world positions ..."],
  "curl": { "thumb": 0.10, "index": 0.82, "middle": 0.75, "ring": 0.31, "little": 0.28 },
  "pinch": { "index": false, "middle": false, "ring": false, "little": false },
  "heading_reliable": true
}
```

| Field | Meaning |
| --- | --- |
| `role` | `master`, `learner` or `free`. Set by the session, not by the glove. |
| `tracked` | False when the glove has been silent for 250 ms. The pose is then the last good one. |
| `anchor` | Where the wrist position came from: `camera`, `held` or `rest`. |
| `joints` | 26 world positions, rounded to 4 decimals. Enough to draw bones as cylinders. |
| `rots` | 26 world quaternions. Sent only if the viewer asks for it in `subscribe`, for a skinned mesh. |
| `curl` | 0 is straight, 1 is fully closed. Mean flexion of the finger's joints divided by 90 degrees (60 for the thumb). |
| `pinch` | Thumb tip to that fingertip. On below 15 mm, off above 30 mm. |

### Angle features

Scoring and recording use 18 joint angles in degrees, not positions. Angles do not change with hand size, wrist pose or handedness, so a left-handed master can be compared with a right-handed learner with no mirroring.

| Slots | What | How |
| --- | --- | --- |
| 0, 1 | Thumb MCP, IP flexion | Angle between consecutive bones along the thumb |
| 2 to 13 | MCP, PIP, DIP flexion for index, middle, ring, little | Angle between consecutive bones: metacarpal to proximal, proximal to intermediate, and so on |
| 14 to 17 | Spread: thumb-index, index-middle, middle-ring, ring-little | Angle between the two fingers' proximal bones |

To draw a ghost of the opposite hand, negate x in the wrist frame before placing it.

## Output: the viewer WebSocket

The viewer opens one socket, `ws://<core-host>:8765/ws`, and gets everything it draws from it as JSON text frames. Every message has the same envelope: `v` (protocol version, 1), `type`, and `t` (core clock, microseconds). The viewer must ignore keys and message types it does not know, so the core can add fields without breaking it.

| `type` | When | Carries |
| --- | --- | --- |
| `hello` | Once, on connect | Joint names, tasks, modes, lesson list, current session |
| `frame` | 30 times a second | Hands, ghost, live score, task state |
| `session` | Whenever it changes | Mode, task, lesson, step, roles, flags |
| `lesson` | When a lesson is loaded or Gemma renames its steps | Lesson metadata and steps, no trace |
| `event` | When something discrete happens | Pinch, button, step passed, note hit, strike |
| `coach` | When there is something to say | One line of text from Gemma or a rule |
| `ack` | In reply to each command | Result or error |

### frame

```json
{
  "v": 1, "type": "frame", "t": 1731533000123456, "seq": 4812,
  "hands": { "left": null, "right": { "...": "Hand object" } },
  "ghost": {
    "right": {
      "joints": ["... 26 world positions ..."],
      "wrist": { "p": [0.12, 0.08, -0.05], "q": [0, 0.71, 0, 0.71] },
      "placement": "on_learner",
      "source": "lesson",
      "lesson_t": 1500000
    }
  },
  "score": {
    "hand": "right",
    "overall": 0.82,
    "fingers": { "thumb": 0.95, "index": 0.41, "middle": 0.90, "ring": 0.88, "little": 0.90 },
    "err_deg": { "thumb": 6, "index": 31, "middle": 9, "ring": 10, "little": 8 },
    "worst": "index",
    "hint": "too_flat",
    "timing_ms": -120,
    "hold_ms": 350,
    "step_progress": 0.7
  },
  "task": {}
}
```

| Field | Meaning |
| --- | --- |
| `hands` | Keyed by physical glove. Either can be `null`. |
| `ghost` | The master pose to draw, keyed by the learner hand it belongs to. Already mirrored and already in world coordinates. |
| `ghost.placement` | `on_learner`: the ghost's wrist is glued to the learner's wrist, for comparing finger shape. `recorded`: the ghost is where the master's hand was, for tasks about movement. |
| `ghost.source` | `lesson` (from a file) or `live` (the master's other glove, in mirror and duel modes). |
| `score` | `null` unless the mode is `learn`, `mirror` or `duel`. All scores run 0 to 1. |
| `score.hint` | `too_flat`, `too_curled`, `too_spread`, `too_closed` or `null`, for the worst finger. |
| `score.timing_ms` | Negative means the learner is early. `null` for hold steps. |
| `task` | Live state for the current task screen. Shapes are in Task configs. |

### session

```json
{
  "v": 1, "type": "session", "t": 1731533000123456,
  "mode": "learn", "task": "chords",
  "lesson_id": "20261114-0112-g-major", "step": 1, "steps_total": 3,
  "roles": { "left": "free", "right": "learner" },
  "recording": false, "calibrated": true,
  "anchor": "marker", "tempo": 1.0, "loop": true, "gemma": "ok"
}
```

Modes: `idle` (live hands only), `record` (master makes a lesson), `learn` (learner follows a stored lesson), `mirror` (master on one glove, learner on the other, live), `duel` (both gloves score against prompts), `playback` (a lesson replays with nobody wearing gloves).

### event

```json
{ "v": 1, "type": "event", "t": 1731533000123456, "name": "step_passed", "hand": "right",
  "data": { "step": 1, "score": 0.91, "attempts": 3, "time_ms": 4200 } }
```

| `name` | `data` |
| --- | --- |
| `pinch_down`, `pinch_up` | `finger` |
| `button` | `press`: `SinglePress`, `DoublePress`, `LongPress` |
| `recording_started`, `step_marked`, `recording_stopped` | `index` for a mark, `lesson_id` on stop |
| `step_started`, `step_passed`, `lesson_complete` | `step`, `score`, `attempts`, `time_ms` |
| `finger_down` | `finger` (piano) |
| `note` | `finger`, `midi`, `verdict`: `good`, `early`, `late`, `wrong_finger`, `miss` |
| `strike` | `kind`, `peak_g`, `verdict` |
| `round_won` | `hand` (duel) |
| `device` | `device_id`, `state`: `connected`, `lost` |
| `calibrated` | `what`: `yaw` or `camera` |

### coach

```json
{ "v": 1, "type": "coach", "t": 1731533000123456, "id": "k-31",
  "kind": "tip", "text": "Curl your ring finger until the tip points at the string.",
  "focus": "ring", "step": 1, "speak": true, "source": "gemma" }
```

`kind` is `tip`, `praise`, `question` or `status`. A `question` also carries `options` (2 or 3 strings), and the viewer answers with the `coach_answer` command. `source` is `gemma` or `rule`; rule lines are the fallback when Gemma is slow. If `speak` is true the viewer reads the text aloud with the browser's `speechSynthesis`.

### What the viewer does with it

1. Draw every non-null hand from `joints`. Grey it out when `tracked` is false.
2. Draw each ghost as the sepia sketch hand.
3. Colour each learner finger from `score.fingers`: green at 0.85 and above, amber between, red below 0.5.
4. Put `coach.text` in the codex margin. Stamp the seal on `step_passed`.
5. Switch task screen when `session.task` changes.

## Control

Commands go up the same WebSocket and each one gets exactly one `ack`. The glove can trigger the common ones by itself, so a demo never needs the keyboard.

```json
{ "v": 1, "type": "cmd", "id": "c-17", "name": "set_mode", "args": { "mode": "learn" } }

{ "v": 1, "type": "ack", "t": 1731533000123456, "id": "c-17", "ok": true, "result": {} }

{ "v": 1, "type": "ack", "t": 1731533000123456, "id": "c-17", "ok": false,
  "error": { "code": "bad_state", "message": "no lesson loaded" } }
```

Error codes: `bad_args`, `bad_state`, `not_found`, `busy`, `device`, `internal`.

### Commands

| `name` | `args` | Effect |
| --- | --- | --- |
| `set_mode` | `mode` | Switch mode. `learn` and `playback` need a loaded lesson. |
| `set_task` | `task`, optional `config` | Switch task screen and scoring rules |
| `set_roles` | `left`, `right` | Say which glove is master and which is learner |
| `calibrate` | none | Capture yaw offsets over the next second |
| `calibrate_camera` | none | Capture `T_world_cam` from marker 9 |
| `record_start` | optional `title` | Begin a recording. Mode must be `record`. |
| `record_mark` | none | End the current step, start the next |
| `record_stop` | `save` (boolean) | Finish. On save, returns `lesson_id` and asks Gemma to name the steps. |
| `lesson_load` | `lesson_id` | Load a lesson; a `lesson` message follows |
| `lesson_delete` | `lesson_id` | Remove it from disk |
| `step_goto`, `step_next`, `step_prev` | `index` for goto | Move within the lesson |
| `set_tempo` | `factor`, 0.25 to 1.5 | Playback speed of the ghost |
| `set_loop` | `on` | Repeat the current step until passed |
| `describe_task` | `text` | Gemma turns a sentence into a task and config, which is then applied |
| `coach_answer` | `id`, `option` | Answer a coach question |
| `subscribe` | `rate_hz` (15 to 60), `rots` (boolean) | Change frame rate, ask for joint rotations |
| `ping` | none | Latency check |

### Glove controls

| Input | In `idle` or `record` | In `learn` or `mirror` |
| --- | --- | --- |
| Button, single press | Start or stop recording | Next step |
| Button, double press | Discard the recording | Previous step |
| Button, long press | Calibrate yaw | Calibrate yaw |
| Thumb to little finger, held 500 ms | Mark a step | Restart the step |

The step mark is a pinch because reaching for the button with the other hand would spoil the pose being recorded. Thumb to little finger is used because tasks rarely need it; change it in `config.control_pinch` if a task does.

### Ring LED

| Colour | Meaning |
| --- | --- |
| Blue | Tracked and idle |
| Red | Recording |
| White flash | Step marked |
| Green for 1 second | Step passed |
| Amber | Busy: calibrating or waiting on Gemma |
| Magenta | Heading not reliable yet; rotate the hand away from metal |

### HTTP on the same port

| Route | Returns |
| --- | --- |
| `GET /health` | `{ ok, gloves: { left, right }, anchor, gemma, uptime_s }` |
| `GET /lessons` | The lesson list from `hello` |
| `GET /lessons/{id}` | `lesson.json` |
| `GET /lessons/{id}/frames/{name}.jpg` | A step keyframe, for the codex |
| `GET /schema/{name}.json` | The JSON Schema for a message type |

## Lesson files

A lesson is a folder under `lessons/`, holding one JSON file a person can read and one array file the scorer reads. Nothing else in the system stores state, so copying the folder copies the lesson.

```
lessons/20261114-0112-g-major/
  lesson.json        metadata and steps
  trace.npz          the recording, as arrays
  frames/step_00.jpg one keyframe per step, for Gemma and the codex
  video.mp4          optional, the whole take
```

### lesson.json

```json
{
  "schema": "geppetto.lesson/1",
  "id": "20261114-0112-g-major",
  "title": "G major chord",
  "task": "chords",
  "task_config": { "instrument": "guitar", "chords": ["G"] },
  "created": "2026-11-14T01:12:33+02:00",
  "master": { "name": "Szymon", "hand": "left" },
  "source": "glove",
  "rate_hz": 83.33,
  "duration_us": 9200000,
  "steps": [
    {
      "index": 0,
      "name": "Ring finger on the high string",
      "note": "Keep the knuckle bent so the string below rings.",
      "kind": "hold",
      "t0_us": 0, "t1_us": 2400000, "key_t_us": 1900000,
      "key_angles": [12, 8, 55, 70, 30, 48, 66, 28, 61, 74, 35, 20, 15, 10, 25, 12, 9, 14],
      "key_joints": ["... 26 wrist-relative positions ..."],
      "weights": { "thumb": 0.5, "index": 1, "middle": 1, "ring": 1, "little": 0.5 },
      "hold_ms": 500,
      "frame": "frames/step_00.jpg",
      "named_by": "gemma"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `source` | `glove`, or `dataset:<name>` for an imported master such as a piano dataset |
| `steps[].kind` | `hold`: reach a pose and keep it. `move`: follow a motion in time. |
| `key_t_us`, `key_angles`, `key_joints` | For a hold step, the moment and pose the learner must match. Picked as the stillest 300 ms in the step. |
| `weights` | How much each finger counts. Fingers that barely move across the lesson get 0.5. |
| `named_by` | `auto` ("Step 1"), `gemma` or `manual` |

### trace.npz

| Array | Shape | Content |
| --- | --- | --- |
| `t_us` | (N,) int64 | Time since the start of the recording |
| `angles` | (N, 18) float32 | The angle features, degrees |
| `joints` | (N, 26, 3) float32 | Wrist-relative positions, `xr_base` |
| `wrist_p` | (N, 3) float32 | World position; NaN where the camera had no fix |
| `wrist_q` | (N, 4) float32 | World orientation |
| `step` | (N,) int16 | Step index of each sample |

Imported masters use the same files. An importer for a piano dataset converts its hand poses to the 26 joints, computes `angles`, and writes `source: "dataset:..."`, so the rest of the system cannot tell the difference.

### Step boundaries

In order of preference: the master's marks while recording; if there were none, cut where all 18 angles change by less than 20 degrees a second for at least 400 ms; if that finds nothing, the lesson is one step.

## Scoring

The score is the difference between the learner's 18 joint angles and the master's, turned into a number per finger. It is plain arithmetic that runs on every frame. Gemma never scores; it only turns the result into words.

### Per frame

1. For each finger, `err_deg` is the weighted mean of the absolute angle differences over that finger's slots. Each spread slot is shared half and half between the two fingers it separates.
2. `score = clamp(1 - (err_deg - 8) / (45 - 8), 0, 1)`. Under 8 degrees counts as perfect, since that is about sensor noise plus normal variation between hands. Over 45 counts as wrong.
3. `overall` is the mean of the finger scores, weighted by the step's `weights`.
4. Smooth everything with an exponential average, time constant 150 ms.
5. `hint` for the worst finger: learner flexion below the master's is `too_flat`, above is `too_curled`; spread above is `too_spread`, below is `too_closed`. Report whichever of flexion or spread is further off.

All of 8, 45, 0.85 and the windows below live in `config.toml`. Expect to tune them on real hands on Saturday morning.

### Per step

| Step kind | Reference pose | Passes when | `step_progress` |
| --- | --- | --- | --- |
| `hold` | `key_angles` | `overall` stays at 0.85 or more for `hold_ms` | Time held so far, as a fraction of `hold_ms` |
| `move` | The master's angles at the ghost's current time. The learner is compared with every master sample within 250 ms either side and gets the best match. | Mean `overall` across the step is 0.75 or more | Fraction of the step the ghost has played |

For a move step, the offset of the best match is `timing_ms`. When the step ends, run dynamic time warping over the whole step once, to find where the largest deviation was for the summary.

### Mirror and duel

- **Mirror:** the reference is the master's live angles from 300 ms ago (`config.mirror_delay_ms`), which allows for the learner's reaction time, with the same 250 ms window.
- **Duel:** both gloves are scored against the same prompt. The first to pass takes the round and the core emits `round_won`.

### Step summary

Built when a step passes, or when the learner has been stuck for 5 seconds. It is logged, and it is the only thing Gemma sees about an attempt. Only fingers under 0.85 are listed.

```json
{
  "task": "chords",
  "lesson": "G major chord",
  "step": { "index": 0, "name": "Ring finger on the high string", "kind": "hold" },
  "attempt": 3, "passed": false,
  "overall": 0.61, "best": 0.72, "history": [0.40, 0.52, 0.61],
  "fingers": {
    "ring": { "score": 0.30, "err_deg": 34, "hint": "too_flat" },
    "index": { "score": 0.80, "err_deg": 15, "hint": null }
  },
  "timing_ms": null, "stuck_s": 6.5
}
```

### Rule lines, used when Gemma is slow or off

| Condition | Line |
| --- | --- |
| `too_flat` | Curl your {finger} finger more. |
| `too_curled` | Straighten your {finger} finger a little. |
| `too_spread` | Bring your {finger} finger in. |
| `too_closed` | Spread your {finger} finger out. |
| Early by 150 ms or more | Slow down, you are ahead of the hand. |
| Late by 150 ms or more | A little faster. |
| Passed | Good. Next step. |

### Later, if there is time

Replace the fixed 8 and 45 with per-slot tolerances learned from data: record every visitor's attempts, and set each slot's dead zone to twice the spread seen across passing attempts. That is an overnight batch job on Verda and makes each lesson fairer the more people try it.

## Gemma

Gemma writes words and picks settings; it never touches a frame. The core makes four kinds of call, each with a fixed JSON reply shape, and falls back to a rule line whenever a call is slow or invalid, so the demo cannot stall on the model.

### Where it runs

Serve a multimodal Gemma yourself on Verda with vLLM, on a serverless container or a GPU instance, which gives an OpenAI-compatible `/v1/chat/completions` endpoint. Verda's hosted per-token Inference API listed Kimi and DeepSeek models when checked, not Gemma, so self-hosting is the route; it also counts for more on the Verda track. The core only knows three settings: `GEMMA_BASE_URL`, `GEMMA_API_KEY`, `GEMMA_MODEL`.

### The four calls

| Call | Trigger | Input | Budget |
| --- | --- | --- | --- |
| `name_steps` | `record_stop` with save | Lesson title and task, a digest per step, one keyframe image per step | 15 s, off the hot path |
| `tip` | A step summary is built | The step summary JSON | 2.5 s, then a rule line |
| `configure` | `describe_task` command | The person's sentence and the list of task config schemas | 5 s |
| `phrase_question` | The core finds two takes of a step that disagree | Two keyframes and the two finger digests | 5 s |

A step digest is words, not numbers, built by the core: duration, which fingers moved most, and the key pose as "index curled, ring half bent, thumb out".

### Reply shapes

Request these with vLLM's JSON-schema structured output, validate against the same schema in `schema/`, retry once, then fall back.

```json
{ "call": "name_steps",
  "title": "G major chord",
  "steps": [ { "index": 0, "name": "Ring finger on the high string", "note": "Keep the knuckle bent so the string below rings." } ] }

{ "call": "tip",
  "text": "Curl your ring finger until the tip points at the string.",
  "focus": "ring", "kind": "tip" }

{ "call": "configure",
  "task": "piano",
  "config": { "hand": "right", "tempo_bpm": 70, "piece": "c-major-scale" } }

{ "call": "phrase_question",
  "text": "You gripped it two ways. Which one should I teach?",
  "options": ["From the side", "From above"] }
```

Limits enforced by the core: `name` up to 6 words, `note` up to 20 words, `text` up to 120 characters, `focus` one of the five fingers or `null`.

### Rules

- **The core decides, Gemma phrases.** The core detects that two takes disagree (any finger more than 25 degrees apart at the key pose). Gemma only words the question. The answer picks which take becomes the step's key pose.
- **One tip at a time.** At most one `tip` call in flight per learner, and at most one tip every 4 seconds. A newer summary replaces a queued one.
- **Every call is logged** to `logs/gemma.jsonl` with prompt, reply, latency and whether the fallback fired. The Gemma and Verda submissions both ask for this evidence.
- **Off switch.** `config.gemma.enabled = false` runs everything on rule lines and `auto` step names.

### Optional fine-tune

A LoRA on a few hundred pairs of step summary and good coaching line, trained on a Verda GPU instance and served through vLLM's LoRA loading, makes the tips sound like a teacher. Do it only after the four calls work with the base model.

## Task configs

A task is a fixed screen in the viewer plus a small config the core and Gemma can fill in. Every task still produces an ordinary lesson with steps, so the recorder, scorer and codex work unchanged. Build `general` and `chords` first; they need no camera.

| Task | Camera needed | What is scored | Viewer screen |
| --- | --- | --- | --- |
| `general` | No | Finger shape per step | Workshop: hand, ghost, codex |
| `chords` | No | One hold step per chord | Hand plus a fretboard diagram |
| `piano` | No for fingering, yes for hand position | Right finger at the right time | Keyboard with keys lighting, ghost above |
| `boxing` | No | Strike kind and timing | Pads that flash in combo order |

### general

Config is `{}` and `frame.task` is `{}`. Steps come from the master's marks.

### chords

```json
{ "instrument": "guitar", "hand": "left", "chords": ["G", "C", "D"], "hold_ms": 800 }
```

`frame.task`: `{ "chord": "G", "next": "C" }`. The master records each chord once; each becomes a hold step named after the chord.

### piano

```json
{ "hand": "right", "tempo_bpm": 70, "piece": "c-major-scale",
  "keyboard": { "lowest_midi": 48, "keys": 25 },
  "notes": [ { "beat": 0, "finger": "thumb", "midi": 60 }, { "beat": 1, "finger": "index", "midi": 62 } ] }
```

```json
{ "beat": 3.25,
  "next": [ { "in_ms": 320, "finger": "index", "midi": 62 } ],
  "down": { "thumb": false, "index": false, "middle": true, "ring": false, "little": false },
  "last": { "finger": "thumb", "midi": 60, "verdict": "good" } }
```

- **Key press:** a finger's knuckle flexion rises faster than 250 degrees a second and ends at least 12 degrees past its resting value. Release when it is back within 6.
- **Verdict:** right finger within 120 ms is `good`; within 300 ms is `early` or `late`; a different finger is `wrong_finger`; nothing is `miss`.
- **Without a camera** the task teaches fingering and rhythm on a table top, and the viewer lights the key the note names. With a camera, wrist x also places the hand along the keyboard.
- **Masters:** recorded by a teammate, or imported from a piano hand-motion dataset through the lesson importer.

### boxing

```json
{ "hand": "right", "combo": ["straight", "hook", "uppercut"], "pace_bpm": 60, "rounds": 3 }
```

`frame.task`: `{ "prompt": "hook", "in_ms": 410, "last": { "kind": "straight", "peak_g": 4.2, "verdict": "good" } }`

- **Strike:** hub acceleration peaks above 3 g while the fist is closed (mean curl above 0.7). This needs the raw stream on 12276.
- **Kind:** from the direction of the peak in world axes: forward is `straight`, sideways is `hook`, upward is `uppercut`. One glove cannot tell a jab from a cross, so they are one kind.

### Duel, on top of any task

With `mode: "duel"`, `frame.task` gains `"duel": { "round": 3, "rounds": 5, "wins": { "left": 1, "right": 1 } }`. Each round shows one step or prompt to both gloves; first to pass wins it.

### Stretch: table tennis

Needs the camera path, since the stroke is wrist travel and not finger shape. A `swing` event with `kind` forehand or backhand, from the direction of wrist travel at the acceleration peak. Do not start it before the four tasks above work.

## Build order and tests

The first thing to finish is the fake server, because it unblocks the viewer tonight; the checkpoint that decides scope is Saturday 12:00, when a learner must be able to pass one hold step against a recorded master. If that works, add tasks. If it does not, drop piano and boxing and fix it.

### Layout

```
schema/      JSON Schema for every message and for lesson.json
core/
  __main__.py   wiring and flags (--fake, --replay, --config)
  rgmp.py       RGMP reader, definition-driven
  rcsp.py       RCSP client: devices, button, LED
  camera/       opencv.py, record3d.py, file.py, wrist.py
  fusion.py     wrist placement, yaw offset, filters
  hand.py       joints to angles, curl, pinch
  recorder.py   write and read lessons
  scorer.py     per-frame and per-step scoring, summaries
  session.py    modes, roles, step state machine
  tasks/        general.py, chords.py, piano.py, boxing.py
  coach.py      Gemma client and rule fallback
  server.py     FastAPI: /ws and the HTTP routes
  fake.py       synthetic hands
tools/
  rgmp_tee.py   record a live RGMP socket to a file, replay it on a port
  ws_log.py     record the viewer socket to a file, replay it
viewer/  lessons/  logs/
```

Python 3.12 with `numpy`, `fastapi`, `uvicorn`, `opencv-contrib-python` (for ArUco), `jsonschema` and `openai`. `record3d` only if depth is used.

### Milestones, Helsinki time

| By | Core delivers | Which proves |
| --- | --- | --- |
| Sat 02:00 | `schema/`, `server.py --fake`, `rgmp.py` printing 26 named joints from a real glove, a 2-minute capture with `rgmp_tee.py` | The viewer can be built without the core. The data model matches the hardware. |
| Sat 10:00 | `hand.py`, `fusion.py` with the rest anchor, live hands in the viewer | End to end, glove to screen |
| Sat 12:00 | Recorder, hold-step scorer, `learn` mode, ghost, rule lines | **Checkpoint:** demo 2 works in `general` |
| Sat 15:00 | Button, LED, pinch control, `chords`, Gemma endpoint with `name_steps` and `tip` | Demo 1 works hands-free |
| Sat 18:00 | Marker anchor, `mirror` mode, `piano` | Demo 3, first half |
| Sat 21:00 | `duel`, then `boxing` if time, visitor attempt logging | Demo 3, second half |
| Sat 23:00 | Freeze. Record the 2-minute video. | Nothing new after this |
| Sun 10:00 | Verda summary posted, Gemma write-up, project set to FINAL | Submission |

### Fake data

- `python -m core --fake` emits two hands with sinusoidal curls, a ghost half a cycle ahead, a score that follows the difference, and a `step_passed` every 8 seconds. It answers every command with a plausible `ack`.
- `python -m core --replay capture.rgmp` runs the real pipeline from a recorded glove session, so scoring can be tuned with nobody wearing gloves.
- `tools/ws_log.py` gives the viewer the same thing from its side.

### Tests that need no hardware

- A flat synthetic hand gives all 14 flexion angles near 0; a synthetic fist gives them near 90.
- A hand and its mirror image give identical angle features.
- Identical learner and master give a score of 1; a 45-degree offset on one finger gives that finger 0.
- The RGMP parser reads the captured file and returns 26 joints per frame.
- Every message the fake server emits validates against `schema/`.

## Verify on the hardware tonight

These are the points the Rokoko docs leave open or that only the real gloves can answer. Each one changes a line of this spec if it comes out differently, so check them before writing much code.

- [ ] The gloves report `device_type` "Smartgloves II". USB streaming, the button and the ring LED exist only on generation II.
- [ ] `rkk-hand-solver --help` shows `--emit-openxr`, `--listen` and `--no-driver`.
- [ ] Dump the solver's stream definition and read off: the stream names inside `joints_openxr`, the data type per joint (expected: 7 floats, position then quaternion), and where the `hand` value sits. The docs do not list these.
- [ ] Whether the solved hand's `device_id` equals the glove's RCSP `DeviceId`. If not, match them by left and right.
- [ ] Whether `timestamp_epoch` is `unix_epoch` or `device_boot` for the solved hand.
- [ ] Whether ports 45451 and 12276 accept connections from another laptop. If not, run the core on the glove laptop.
- [ ] `SetColorLed` on `RingLed` and `ButtonPushed` events both work over USB.
- [ ] Yaw stability on the venue tables. Rokoko measured about 8 degrees of spread over 10 seconds for a held heading; metal tables may be worse. Watch `is_heading_reliable`.
- [ ] Glove dropouts when other teams' gloves are close. Rokoko says up to 5 pairs can work near each other.
- [ ] A 30 mm marker is detected at demo distance under the arena lights. Go to 40 mm if not.
- [ ] The exact Gemma checkpoint id, and whether Verda has a ready vLLM template for it. Ask at Verda's booth.
- [ ] Glove movement to pixels in under 100 ms.

One thing worth taking from the SDK: Rokoko ships a browser hand viewer with a hand mesh, built on Three.js, in `$ROKOKO_SDK_HOME/examples/web/rgmp-ws-bridge-web`. The viewer can borrow its mesh and bone mapping.

## Sources

- Rokoko Device SDK: [overview](https://sdk.rokoko.com/reference/overview/), [RGMP specification](https://sdk.rokoko.com/reference/rgmp/), [RCSP specification](https://sdk.rokoko.com/reference/rcsp/), [Smartgloves reference](https://sdk.rokoko.com/reference/products/smartgloves/), [hand solving](https://sdk.rokoko.com/guides/hand-solving/), [quick start](https://sdk.rokoko.com/guides/quick-start/), [CLI](https://sdk.rokoko.com/guides/cli-usage/)
- Rokoko examples: [RGMP streaming client](https://sdk.rokoko.com/examples/rgmp_stream/), [hand solver](https://sdk.rokoko.com/examples/rgmp_hand_solver/), [pinch detection](https://sdk.rokoko.com/examples/rgmp_pinch_detector/), [button click](https://sdk.rokoko.com/examples/rcsp_button_click/), [set LED colour](https://sdk.rokoko.com/examples/rcsp_set_color_led_example/), [Isaac Lab glove device](https://sdk.rokoko.com/examples/isaac/), [web apps](https://sdk.rokoko.com/examples/web/)
- [Record3D library](https://www.github.com/marek-simonik/record3d)
- Verda: [Inference](https://verda.com/inference), [API changes](https://docs.verda.com/welcome-to-verda/release-notes/verda-api-changes/)
- [PianoMotion10M](https://github.com/agnJason/PianoMotion10M) (CC BY-NC-SA 4.0)
