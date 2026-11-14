# 09. Rokoko Studio streaming, Command API and Device SDK (verified)

Researched 13 Nov 2026. Everything marked VERIFIED comes from Rokoko's own docs or plugin source (linked). Everything marked ASSUMPTION or UNKNOWN has not been confirmed against real gloves and is listed again at the end.

## 1. Custom Streaming JSON (Studio -> our backend over UDP)

Source of truth: the [Custom Streaming article](https://support.rokoko.com/hc/en-us/articles/4410416376977-Custom-Streaming) and its attachments [Json_v3.txt](https://support.rokoko.com/hc/en-us/article_attachments/41280345093777) and [Json_v4.txt](https://support.rokoko.com/hc/en-us/article_attachments/50030847458577). Cross-checked with the Unity plugin's [JsonLiveSerializerV3.cs](https://github.com/Rokoko/rokoko-studio-live-unity/blob/master/Assets/Rokoko/Scripts/Core/JsonLiveSerializerV3.cs) and the Blender plugin's [live_data_manager.py](https://github.com/Rokoko/rokoko-studio-live-blender/blob/master/core/live_data_manager.py).

**Plan:** Custom Streaming is marked Plus, Pro and Enterprise.

### Transport (VERIFIED)
- UDP, one complete JSON frame per datagram, no length prefix or header. Default port 14043 (Unity `UDPReceiver.receivePortNumber = 14043`, buffer 65000 bytes; Blender reads up to 81920).
- Four selectable formats: "JSON v3", "JSON v3 (LZ4)", "JSON v4", "JSON v4 (LZ4)". LZ4 payloads are LZ4 **frame** format and start with `04 22 4D 18`. Plain JSON is ASCII. Blender simply tries `lz4.frame.decompress` and falls back to plain JSON.
- Target frame rate is in the payload (`fps`, 60 in the examples). The live rate Studio actually achieves is not documented. Smartgloves II output 83.33 Hz to the SDK ([SDK reference](https://sdk.rokoko.com/reference/products/smartgloves/)); Studio re-times to its own rate.

### Coordinate system (VERIFIED, v4 spec note 2)
Left-handed, Y up, Z forward, metres. Quaternions are `{x, y, z, w}` objects. **Every joint rotation and position is WORLD space**, in v3 and v4 alike. The v4 `parent` index only describes the hierarchy; do not compose it. The Unity plugin confirms this: it reads `rotation` as `worldRotation`. So the local bend of a joint is `conj(parent_world) * child_world`.

### Detecting v3 against v4 (VERIFIED, v4 spec note 1)
The `version` field is useless: v3 frames say `3`, v4 frames say `"3,0"`. Use the payload: v3 fills `scene.actors` and leaves `scene.newtons` empty; v4 fills `scene.newtons` and leaves `scene.actors` empty. Both keys are always present. (Blender also notes that a Studio 1 "JSON v2.5" stream reports version 3 but carries `trackers`; ignore.)

### v3 shape (VERIFIED)
```json
{
  "version": 3, "fps": 60,
  "scene": {
    "timestamp": 0,
    "actors": [{
      "name": "Actor 01", "color": {"r": 255, "g": 128, "b": 0},
      "meta": {"hasGloves": true, "hasLeftGlove": true, "hasRightGlove": true, "hasBody": true, "hasFace": false},
      "dimensions": {"totalHeight": 1.75, "hipHeight": 0.94},
      "body": {
        "leftHand":          {"position": {"x": -0.3, "y": 1.1, "z": 0.25}, "rotation": {"x": 0.04, "y": 0.26, "z": 0.01, "w": 0.97}},
        "leftIndexProximal": {"position": {"x": -0.015, "y": 1.1, "z": 0.3}, "rotation": {"x": 0.25, "y": 0.25, "z": 0.07, "w": 0.93}},
        "leftIndexMedial":   {"position": {"...": 0}, "rotation": {"...": 0}},
        "leftIndexDistal":   {"position": {"...": 0}, "rotation": {"...": 0}},
        "leftIndexTip":      {"position": {"...": 0}, "rotation": {"...": 0}}
      }
    }],
    "props": []
  }
}
```
Key names (from the `BodyFrame` class in the Unity plugin): `hip spine chest neck head`, `{left|right}Shoulder|UpperArm|LowerArm|Hand`, legs, and for each hand and finger `{left|right}{Thumb|Index|Middle|Ring|Little}{Proximal|Medial|Distal|Tip}`. **The thumb has Proximal, Medial, Distal, Tip in v3** (no Metacarpal). Joint names are camelCase and case-sensitive; our mapper lower-cases them.
Real v3 example JSON with all 60 or so keys: [backend/tests/fixtures/v3_fist.json](../backend/tests/fixtures/v3_fist.json) (constructed from the schema, not captured).

### v4 shape (VERIFIED)
```json
{
  "version": "3,0", "fps": 60,
  "scene": {
    "timestamp": 0, "actors": [],
    "newtons": [{
      "name": "Newton 01", "color": [255, 128, 0],
      "meta": {"hasHands": true, "hasLeftHand": true, "hasRightHand": true, "hasBody": true, "hasFace": false},
      "dimensions": {"totalHeight": 1.75, "hipHeight": 0.94},
      "joints": [
        {"name": "Hips", "parent": -1, "position": {"x": 0, "y": 0.94, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0, "w": 1}},
        {"name": "LeftFinger2Proximal", "parent": 41, "position": {"...": 0}, "rotation": {"...": 0}}
      ]
    }],
    "props": [], "characters": []
  }
}
```
- `joints` is a flat list, order not guaranteed; match by name.
- The Newton rig has 76 bones. Per hand: `{Left|Right}Hand`, then for finger N = 1..5 (1 thumb, 2 index, 3 middle, 4 ring, 5 little): `{Left|Right}FingerN{Metacarpal, Proximal, Medial, Distal, Tip}`. **The thumb (Finger1) has no Medial**, so it is Metacarpal, Proximal, Distal, Tip.
- `meta` uses `hasHands/hasLeftHand/hasRightHand` where v3 uses `hasGloves/hasLeftGlove/hasRightGlove`.
- v4 `color` is an int array, v3 `color` is an `{r,g,b}` object.
- Our fixture: [backend/tests/fixtures/v4_fist.json](../backend/tests/fixtures/v4_fist.json).

### Mapping to our HandFrame (done in `rokoko_mapper.py`)
Contract: `flexion[finger] = [MCP, PIP, DIP]`, thumb `[CMC, MCP, IP]`, radians, 0 straight, positive curled.

| Finger | v3 chain after `{side}Hand` | v4 chain after `{Side}Hand` |
|---|---|---|
| index to little | Proximal, Medial, Distal | FingerN Proximal, Medial, Distal |
| thumb | Proximal, Medial, Distal | Finger1 Metacarpal, Proximal, Distal |

Joint i bend = angle of `conj(parent_world) * joint_world`, where the parent of the first joint is the hand. For v4 the fixed Metacarpal of fingers 2..5 is skipped (the bend is taken against the hand) so v3 and v4 give the same numbers; a test asserts this.

### Which axis is flexion? (UNKNOWN, must be probed)
Rokoko documents neither the rest orientation of the finger joints nor which local axis they flex about. The Unity plugin has a `RotationSpace.Offset` mode that applies per-bone T-pose offsets, which tells us the rest rotations are not identity relative to a generic rig. We therefore **cannot** state "flexion is local X". The mapper uses `ROKOKO_FLEX_AXIS = 0` (x) and `ROKOKO_FLEX_SIGN = +1` in `backend/app/constants.py`, which is an ASSUMPTION, and uses the total rotation angle with the sign taken from that axis.
On site, run `uv run python scripts/probe_flexion.py` (flat hand, then fist): it prints the real rotation axis per joint in the parent frame. Put the dominant axis index and sign into the two constants. If the three joints of a finger disagree, or fingers differ, tell us; the mapper then needs per-finger axes. Rest-pose offset is not subtracted in code; the app's own flat/fist calibration (`POST /calibrations`, per-joint) absorbs it for scoring.
Studio's own calibration (Command API `calibrate`, below) should be done before probing so the rest pose is the T-pose or "arms down" reference.

### Gotchas (VERIFIED unless noted)
- Version field cannot distinguish v3 and v4 (above).
- World space everywhere; do not compose parents.
- A `body` or `joints` section exists even for actors without gloves; check `meta.hasLeftGlove/hasRightGlove` (v3) or `hasLeftHand/hasRightHand` (v4). The mapper does.
- Positions of fingers are body-relative. Without the Coil Pro there is no absolute hand position ([SDK reference](https://sdk.rokoko.com/reference/products/smartgloves/): "The hub has no position"), so `wrist_pos` stays null.
- Studio JSON has no velocities, IMU or per-sensor data; only solved pose ([research/03](03_track_and_limits.md)).
- Windows Firewall silently drops inbound UDP for new Python/uvicorn executables; see docs/HARDWARE_INTEGRATION.md.
- ASSUMPTION: when both gloves are on one actor, a single datagram carries both hands. Two actors: the mapper takes the first actor that has a given side.
- A full v4 frame is about 10 to 15 KB plain, well under the 64 KB UDP limit. If Studio runs on another machine, a switch with a small MTU fragments it; prefer LZ4 or wired LAN.
- The Studio free trial gives Plus or Pro for 7 days once per account ([research/01](01_hardware_feasibility.md)).

## 2. Studio Command API (control, not data)

[Docs](https://support.rokoko.com/hc/en-us/articles/9738087323025-Rokoko-Studio-Command-API) and [examples repo](https://github.com/Rokoko/studio-command-api-examples). **Plan: Pro and Enterprise** per the article (the pricing page also lists it under Pro). Whether it works on Plus or the trial is UNKNOWN; response code 18 `NOT_SUPPORTED_IN_SUBSCRIPTION_PLAN` is what you would see if not.

- HTTP POST to `http://{studio-ip}:14053/{v1|v2}/{apiKey}/{command}`, JSON body. Port and key are set in Studio settings; defaults 14053 and `1234`. A scene must be open.
- Reply: `{description, response_code, startTime, parameters}`; `response_code` 0 = OK, 1 `NO_CALIBRATEABLE_ACTORS`, 3 `CALIBRATION_ALREADY_ONGOING`, 4/5 recording state, 13 `NO_ACTOR_FOUND_BY_DEVICE_ID`, 14 `NO_LIVE_DEVICES`, 15 `NO_PAIRED_LIVE_DEVICES`, 18 plan not supported.
- Commands (version in brackets, as used by Rokoko's own examples):
  - `calibrate` [v1]: `{device_id?, countdown_delay?, skip_suit?, skip_gloves?, use_custom_pose?, pose?: tpose | straight-arms-down | straight-arms-forward}`.
  - `recording/start` and `recording/stop` [v1]: `{filename?, time?, frame_rate?, back_to_live?}`.
  - `livestream` [v2]: `{enabled: bool}` (from `LiveStreamExample.py`; not in the article text).
  - `info` [v2]: `{devices_info, clips_info}`. `resetactor` [v2]: `{device_id}`. `tracker` [v2] (drift correction). `pose` [v2]: `{name, mode, space}` returns a skeleton pose over HTTP (from `PoseExample.py`, UNVERIFIED semantics, could be a polling alternative to UDP).
- Our client: `backend/app/services/gloves/rokoko_command.py` (`StudioCommandClient`, async httpx, tested with a mock transport). No route uses it yet. Useful hooks: a "Calibrate gloves" button calling `calibrate(countdown_s=3, pose="straight-arms-down")`, and mirroring a lesson recording into Studio as a backup.
- The article also mentions "UDP trigger messages" (Studio notifies a UDP listener when a recording starts or stops): example [ReceiveRecordingMessages.py](https://github.com/Rokoko/studio-command-api-examples/blob/master/TriggerMessages/ReceiveRecordingMessages.py). Not used.

## 3. Rokoko Device SDK (bypasses Studio)

[sdk.rokoko.com](https://sdk.rokoko.com/). Verified facts:
- A local driver plus two TCP protocols: RCSP (commands) and RGMP (binary motion data). "Any language that can open a TCP/IP connection"; Python examples ship in `$ROKOKO_SDK_HOME/examples` (RCSP client, RGMP streaming client, pure-Python hand solver, pinch detector, LED colour, button click, firmware update, a React web viewer via a `rkk-ws-bridge`). Windows, macOS, Linux x64 and Linux Arm64. Official [ROS 2 bridge](https://github.com/Rokoko/rokoko-ros2-bridge).
- Devices: Smartgloves I, II, Smartsuit Pro II. USB data streaming on Smartgloves II only; WiFi otherwise. Up to 83 Hz per glove.
- Data: raw gyro, accelerometer, magnetometer, quaternion orientation per sensor, 3D positions for EMF-tracked sensors (Coil Pro). Solver `rkk-hand-solver` gives a 26-joint hand in about 0.09 ms. Latency about 20 ms WiFi, 19 ms USB.
- **Licence: paid, by quote.** "Request SDK access and our team will send you a quote for the development licence and support." The install flow needs a Rokoko ID account whose Team has an SDK Licence tile. Nothing public mentions hackathon or academic keys. Whether Junction teams get one is UNKNOWN: ask the Rokoko mentors on day one.
- Without a licence this repo keeps `rokoko_sdk.py` as a 501 stub (the SDK driver licence is not ours to bundle). If a key appears, the cheapest path is to run the SDK's own Python hand solver, wrap its 26-joint output in the same `HandFrame` mapper, and add it as a source.

## 4. Smartgloves II specifics (VERIFIED)
- Per glove: 5 finger sensors (back of the middle segment of each finger, proximal segment of the thumb), 1 arm sensor on the forearm, 1 hub on the back of the hand (EMF transmitter, IMU, magnetometer on Gloves II). Seven sensors; Rokoko quotes 39 DOF output (45 with Coil Pro). [SDK reference](https://sdk.rokoko.com/reference/products/smartgloves/), [datasheet](https://sdk.rokoko.com/datasheets/Smartgloves_II_Technical_Specifications_v1.0.0_External.pdf).
- IMU 250 Hz internal, 83.33 Hz output. No haptics ([robotics FAQ](https://www.rokoko.com/use-cases/robotics), quoted in research/01). LED and button only.
- Only one flexion sensor per finger, so DIP and PIP of a finger are solved (inferred) by Studio, not measured independently. Treat per-joint flexion as plausible, per-finger total as the trustworthy signal; the scorer already compares total flexion per finger.
- Reaches Studio over WiFi (USB for setup and firmware). Studio Legacy is not supported; use the new Studio. Firmware 2.3.0+ does not work with Legacy.
- Gloves need a hub magnetometer init and Studio calibration after power-up before heading is reliable (`is_heading_reliable` in the SDK).

## 5. Open unknowns (need a glove and Studio to settle)
1. The real flexion axis and sign per joint, and the rest-pose offsets (use `scripts/probe_flexion.py`).
2. Whether the Studio live rate really is 60 Hz or 83 Hz, and the measured end-to-end latency.
3. Whether the Command API works on Plus or the trial.
4. Whether one glove per actor, or two actors from one pair, is possible in Studio (research/03 section 2).
5. Whether Junction gives out SDK licences.
6. Exact v3 behaviour when a glove drops out mid-stream (do joints freeze or disappear?). The mapper treats a missing joint as zero bend and a missing hand as no hand.
