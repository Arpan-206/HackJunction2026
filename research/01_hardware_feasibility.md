# 01 Hardware and data feasibility (Junction 2026)

Date checked: 13 Nov 2026. Everything below is from public docs unless marked ESTIMATE or GUESS.

## Verdict: FEASIBLE WITH CAVEATS

The core loop works: record a master with the gloves, store finger and hand rotations, compare a learner live against it, and buzz fingertips when they differ. The caveats:

1. Live data needs a paid Rokoko plan (or the free 7-day trial) or an SDK licence.
2. Without the Coil Pro (about 3,000 EUR) there is no hand position in space. Expect finger angles and hand orientation only. Design lessons around finger and hand shape, not "move your hand to this point".
3. The laptop must run Rokoko Studio (Windows/macOS only), so the Uno Q is optional, not essential.

## Recommendation up top

- Use **Rokoko Studio (new) with Custom Streaming (UDP JSON)** into a Python process on a laptop. Do the comparison there.
- Use **one ESP32 per hand as a haptic band**, driven over WiFi UDP (or ESP-NOW via a second ESP32 plugged into the laptop).
- Use the **Uno Q as the "lesson station"** (status UI, LED matrix, local web page). Keep the critical path off it.
- Start the **7-day free Plus/Pro trial on the day the hackathon starts**, and ask Rokoko staff at Junction about a hackathon voucher or SDK key.

## 1. Rokoko Smartgloves data

### What is captured
- Per glove: 5 finger sensors, 1 hub (back of hand, holds the EMF transmitter), 1 arm sensor on the forearm. Finger sensors sit on the middle segment of each finger and the proximal segment of the thumb. ([SDK Smartgloves page](https://sdk.rokoko.com/reference/products/smartgloves/))
- Sensing is IMU plus EMF (electromagnetic field) fusion. Gloves II also has a magnetometer on the hub for heading. EMF removes finger drift; IMU gives fast rotation. ([Tech overview](https://sdk.rokoko.com/guides/tech-overview-emf-imu/), [firmware 2.0.11 notes](https://support.rokoko.com/hc/en-us/articles/4418128740113-Smartgloves-firmware-v2-0-11))
- Rokoko lists 39 DOF output pose (45 with Coil Pro) and 7 sensors per glove. ([Robotics page](https://www.rokoko.com/use-cases/robotics))
- Studio solves this onto a skeleton with finger joints. JSON v3 uses names like `leftIndexProximal`; JSON v4 uses `LeftFinger2Proximal` and adds finger tip joints. ([Custom Streaming](https://support.rokoko.com/hc/en-us/articles/4410416376977-Custom-Streaming))

### Position in space
- **Without Coil Pro: no absolute position.** The hub "has no position, so this is an orientation only" ([SDK](https://sdk.rokoko.com/reference/products/smartgloves/)). Fingers are placed relative to the hub and wrist.
- With Coil Pro: arm sensor pose relative to the coil, about 2 m radius (store page). Gloves must be connected for it to work. ([Coil Pro store](https://eu.store.rokoko.com/products/coil-pro)) Not realistic unless Rokoko lends one.
- Treat wrist/hub orientation as the only hand-pose signal.

### Rate, accuracy, latency
- Gloves II: 250 Hz internal IMU sampling, 83.33 Hz pose output. Older FAQ for Gloves I: 400 Hz internal, 100 Hz to Studio. ([Robotics page](https://www.rokoko.com/use-cases/robotics), [FAQ](https://support.rokoko.com/hc/en-us/articles/20912004920593-Rokoko-Smartgloves-FAQs))
- Rotational dynamic accuracy +/- 1 degree (vendor claim). ([FAQ](https://support.rokoko.com/hc/en-us/articles/20912004920593-Rokoko-Smartgloves-FAQs))
- Latency, SDK path: about 20 ms over WiFi on average (with jitter), 19 ms over USB, motion to SDK output. Rokoko's robotics page quotes about 12 ms processing via USB. ([SDK home](https://sdk.rokoko.com/), [Robotics page](https://www.rokoko.com/use-cases/robotics))
- Latency through Studio Live is not published. ESTIMATE 30 to 60 ms from motion to UDP packet.
- Drift: finger drift is largely removed by EMF. Hub heading drift is corrected by the magnetometer on Gloves II (needs a hub rotation init, away from metal). Check which generation we own.
- Gloves reach Studio over **WiFi only** (USB is for setup and firmware). Bring our own travel router; do not rely on venue WiFi. For 5 GHz use channels 36 to 48. ([FAQ](https://support.rokoko.com/hc/en-us/articles/20912004920593-Rokoko-Smartgloves-FAQs), [firmware notes](https://support.rokoko.com/hc/en-us/articles/4418128740113-Smartgloves-firmware-v2-0-11))

### Getting data out live: three routes

**A. Studio Live Custom Streaming (recommended).**
- In Studio: Livestreaming panel, Custom, protocol UDP, data format JSON v3 or v4 (plain or LZ4). Default port **14043**. One JSON frame per UDP datagram, no header. ([Custom Streaming](https://support.rokoko.com/hc/en-us/articles/4410416376977-Custom-Streaming))
- Left-handed, Y up, Z forward, metres, quaternions x,y,z,w (same page).
- Needs a paid plan: that page is marked Plus/Pro/Enterprise. One free 7-day trial of Plus or Pro per account, claimed by creating a new team. ([Trial](https://support.rokoko.com/hc/en-us/articles/4410424273169-How-can-I-access-the-free-14-day-trial-of-Studio-Plus-and-Face-capture))
- Minimal Python receiver to copy: [Zhengro/rokoko_data_forwarding](https://github.com/Zhengro/rokoko_data_forwarding/blob/master/scripts/custom_streaming_udp.py). It uses plain `socket` and `json.loads`; written for the suit, so adapt field names. For LZ4 use `lz4.frame` (frames start with bytes `04 22 4D 18`).
- Official receivers with readable source: [Unity](https://github.com/Rokoko/rokoko-studio-live-unity), [Blender](https://github.com/Rokoko/rokoko-studio-live-blender).
- Studio Legacy is no longer supported, and Gloves firmware 2.3.0 and later do not work with it. Use the new Studio. ([Legacy page](https://support.rokoko.com/hc/en-us/articles/4410415520529-Getting-Started-Rokoko-Studio-Legacy-), [fw 2.3.0](https://support.rokoko.com/hc/en-us/articles/22103913523857-Smartgloves-firmware-v2-3-0))

**B. Command API (control, not data).** HTTP on port 14053, default key 1234. Commands: start/stop recording, calibrate, reset actor, scene info, toggle live streaming, playback. Examples: [Rokoko/studio-command-api-examples](https://github.com/Rokoko/studio-command-api-examples), [docs](https://support.rokoko.com/hc/en-us/articles/9738087323025-Rokoko-Studio-Command-API). The pricing page lists "Advanced command API" and "UDP trigger messages" under Pro. Whether basic commands work on Plus is unverified.
- Example: our app presses record with `POST http://127.0.0.1:14053/v1/1234/recording/start`.

**C. Rokoko Device SDK (bypasses Studio).** See section 2.

### Recording and export (for storing lessons)
- Studio exports FBX on all plans (including free), BVH on Plus and up, CSV (body and finger data) on Pro and up. ([Pricing](https://www.rokoko.com/pricing), [Export docs](https://support.rokoko.com/hc/en-us/articles/18877624744721-Rokoko-Studio-Export-options-and-file-formats))
- **Best plan: skip Studio export.** Record the live UDP JSON ourselves into a `.jsonl` file (one frame per line plus receive timestamp). That is the lesson file. No conversion, same shape on the learner side. Let Studio record in parallel as a backup.
- Prices vary by page and billing cycle: Starter free, Plus roughly 20 to 28 USD/month, Pro roughly 50 to 70 USD/month; educator discounts exist. ([Pricing](https://www.rokoko.com/studio/pricing)) Cheap enough to pay one month if the trial is used up.

## 2. Bypassing Studio: possible, but gated

- Rokoko ships an official **Device SDK**: a local "driver" program that finds gloves over USB (Gloves II only) or WiFi and exposes TCP streams: RCSP (commands) and RGMP (binary motion data). Any language with sockets works; Python examples included; runs on Windows, macOS, Linux x64 and **Linux Arm64**. ([SDK home](https://sdk.rokoko.com/), [Getting started](https://support.rokoko.com/hc/en-us/articles/48147584456081-Getting-Started-with-the-Rokoko-SDK), [Quick start](https://sdk.rokoko.com/guides/quick-start/))
- **It needs a paid SDK licence, by quote** ("Request SDK Access"). Treat it as unavailable unless Rokoko at Junction gives us a key. ([SDK home](https://sdk.rokoko.com/))
- If we get it: up to 83 Hz per glove, raw per-sensor orientation plus gyro and accelerometer, and a ready hand solver (26 joints, about 0.09 ms) with a pure-Python version and a pinch-detection example. The Uno Q could then read the gloves directly over WiFi (Arm64 build). ([Hand solving](https://sdk.rokoko.com/guides/hand-solving), [Examples](https://sdk.rokoko.com/examples))
- Raw BLE or WiFi reverse engineering: I found no public protocol and no open-source reader. Gloves talk WiFi/TCP to Studio or the SDK driver only; no BLE data path is documented. Do not spend hackathon time here (absence of evidence, not proof).

## 3. Roles for 2x ESP32 and the Uno Q

### Haptics hardware (fingertip cues)
- Five vibration motors (ERM coin motors or LRA) per hand, one per fingertip, driven by an ESP32.
- The DRV2605L haptic driver has a **fixed I2C address (0x5A)**, so five of them need an I2C multiplexer (TCA9548A). **Direct PWM through a MOSFET or transistor per motor, with a flyback diode, is simpler for 48 hours** and enough for "buzz finger N at intensity X". Use DRV2605L only if you want LRA waveforms. (General hardware knowledge, not from a cited source.)
- The gloves have no haptics of their own ("Do Smartgloves II provide tactile or haptic feedback? No." [Robotics FAQ](https://www.rokoko.com/use-cases/robotics)), so our actuators are an add-on.
- Keep motors and wires away from the finger-back EMF sensors; test early (GUESS on how much they disturb EMF).

### Recommended roles
| Device | Role |
|---|---|
| ESP32 #1 | Haptic band for the learner hand: 5 fingertip motors plus status LED, receives UDP commands over WiFi. |
| ESP32 #2 | Second hand, or a USB-plugged ESP-NOW bridge to the laptop for lower latency, or a wrist LED ring showing the worst finger. |
| Uno Q | Lesson station: Linux side serves a small web UI (lessons, score, progress); LED matrix shows state; MCU drives a buzzer or LEDs via Bridge. Optional UDP receiver. |
| Laptop | Runs Rokoko Studio, compare engine, lesson storage, marketplace backend and web demo. |

### Can the Uno Q do the comparison?
- Hardware: quad-core Cortex-A53 at 2 GHz, 2 or 4 GB RAM, full Debian, Python 3 with numpy and flask. STM32U585 MCU at up to 160 MHz for real-time I/O. ([Arduino docs](https://docs.arduino.cc/hardware/uno-q), [datasheet](https://docs.arduino.cc/resources/datasheets/ABX00162-ABX00173-datasheet.pdf))
- Python on Linux can open a UDP socket and run numpy. Comparing about 30 joint rotations at 83 Hz is trivial for that CPU (ESTIMATE: well under 1 ms per frame).
- MPU to MCU uses **Arduino Bridge**, a MessagePack-RPC layer. MCU side: `Bridge.provide("name", fn)`. Python side: `Bridge.call("name", args)` or `Bridge.notify(...)` (fire and forget). ([User manual](https://docs.arduino.cc/tutorials/uno-q/user-manual), [RouterBridge repo](https://github.com/arduino-libraries/Arduino_RouterBridge), [multi-language guide](https://docs.arduino.cc/tutorials/uno-q/routerbridge-multilanguage)) Bridge latency is not published. ESTIMATE a few ms.
- Caveats: deploy through Arduino App Lab; Python cannot touch GPIO directly (go through the MCU); the RouterBridge README warns that calling `Bridge.call` inside an RPC callback may deadlock; first setup needs a USB-C data link; App Lab network discovery uses mDNS (UDP 5353) which venue networks may block. Prefer the 4 GB variant.
- **But:** Studio runs only on Windows and macOS, so a laptop is in the path anyway unless we get the SDK. So the laptop is the pragmatic compute. The Uno Q is the station and demo prop, and becomes real compute only if the SDK arrives.

### Realistic end-to-end latency (glove motion to fingertip buzz)
All ESTIMATES except the SDK glove figure.

| Stage | Time |
|---|---|
| Glove to Studio (WiFi, fusion) | 20 to 40 ms (SDK figure 20 ms; Studio extra unknown) |
| Studio solve and UDP to our Python (localhost) | 5 to 15 ms |
| Compare in Python (numpy) | 1 to 3 ms |
| UDP to ESP32 over WiFi | 3 to 15 ms (jitter, spikes on busy WiFi) |
| ESP-NOW alternative (via USB ESP32 on laptop) | 2 to 5 ms |
| ERM motor spin-up | 20 to 50 ms |
| **Total** | **about 60 to 130 ms** |

This is fine for slow, posture-based skills (guitar chord shapes, sign language handshapes, knife grip, calligraphy grip, sewing, pottery). It is too slow for fast percussive skills (fast typing, drumming).
- Use time warping (DTW) or a phase tracker rather than strict time alignment, because learners move slower than masters. Compare per-finger angles at the matched phase.

## 4. Key risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Live streaming is paywalled (Plus/Pro) | No live data on Starter | Use the 7-day trial, started at hackathon start; or pay one month of Plus; ask Rokoko staff for a voucher. |
| SDK needs a quote-based licence | No direct data, no Arm64 path | Do not plan on it. Ask Rokoko for a hackathon key as a bonus. |
| Glove WiFi on venue network | Gloves fail to connect, packet loss | Bring our own travel router; static IP for the laptop ([Rokoko guide](https://support.rokoko.com/hc/en-us/articles/47554716752657-Stop-re-configuring-your-Rokoko-devices-how-to-assign-a-static-IP-to-your-computer)); do USB and WiFi setup in the first hours; 5 GHz channels 36 to 48. |
| Only one glove pair | Master and learner cannot be live together | Fine by design: lessons are recorded. Demo = pre-recorded master, live learner. |
| No hand position without Coil Pro | Cannot teach "where" | Scope lessons to finger shape and wrist orientation. |
| Hand size differences | Same pose gives different angles | Compare **joint rotation angles**, not positions. Run a 10 s per-user calibration (flat hand, fist) and normalise each finger to 0..1 of its own range. Store lessons normalised. |
| Hub heading drift or magnetometer init | Wrist yaw wrong | Do the hub rotation init away from metal. Use yaw only relative to session start; weight finger angles more. |
| Studio calibration is a pose ritual | Learner start delay | Trigger it from our app via Command API `calibrate` with a countdown. |
| EMF disturbed by metal and motors | Noisy finger angles | Keep motors and wires off the finger-back sensors; test early. |
| Fragile glove (not washable, cable pins can dislodge) | Broken demo | Mount haptics on a thin liner glove or fingertip straps, not stitched into the Rokoko fabric ([FAQ](https://support.rokoko.com/hc/en-us/articles/20912004920593-Rokoko-Smartgloves-FAQs)). |
| UDP frame size and loss | Dropped frames | Use LZ4 or JSON v4; receive buffer 20 kB or more (the example uses 20000); log dropped frames. |
| Uno Q setup friction | Lost hours | Give it to one person early; keep it off the critical path. |
| Verifying community lessons | Product risk | Automated checks (stable frame rate, no dropouts, plausible joint ranges) plus human review. Not a hardware issue. |

## Recommended architecture (text diagram)

```
 MASTER (record, offline)                      LEARNER (live)
 ------------------------                      -------------------------------
 Smartgloves --WiFi--> Rokoko Studio (laptop)  Smartgloves --WiFi--> Rokoko Studio (laptop)
        | Custom Streaming UDP :14043                 | Custom Streaming UDP :14043
        v                                             v
 recorder.py -> lesson.jsonl (+ metadata)      compare.py (Python, laptop)
        |                                        | loads lesson.jsonl
        v                                        | normalise per user, DTW/phase match
 Marketplace backend (upload, review,            | per-finger error scores
 verify, pay masters) <---- download lesson -----+
                                                 |
                     +---------------------------+---------------------+
                     |                           |                     |
              UDP over WiFi               HTTP/WebSocket          (optional) UDP
                     v                           v                     v
             ESP32 #1 haptic band        Web UI / lesson station   ESP32 #2 / Uno Q
             5x fingertip motors         (Uno Q Linux serves UI;   LED ring / matrix,
             (PWM + MOSFET, or           MCU drives LEDs/buzzer    second hand or
             DRV2605L + mux)             over Bridge)              spare cues

 Control path: web UI -> Command API (HTTP :14053) -> Studio start/stop recording, calibrate
```

Fallback if live streaming is blocked: record in Studio (free, FBX), export, and compare offline. Show the live-feedback demo from a recorded "learner" take. Weaker, but still demonstrable.

## First-hour checklist
1. Create a Rokoko ID now; claim the 7-day trial only when ready to use it.
2. Update glove firmware over USB and configure WiFi on our own router.
3. Turn on Custom Streaming (UDP, JSON v3, port 14043), run the Zhengro receiver, print the finger fields.
4. Build the `.jsonl` recorder and a replay script.
5. Flash the ESP32 with a UDP listener mapping `{finger, intensity}` to PWM. Test from a laptop script before involving gloves.
6. Only then add DTW/phase matching and scoring.

## Confidence
- Rates, ports, plans, SDK gating: high (vendor docs).
- Latency beyond the SDK 20 ms figure: low to medium (estimates).
- Exact JSON v3 field names for glove finger data: medium; verify by printing a live frame.
- Basic Command API on Plus plan: unverified.
