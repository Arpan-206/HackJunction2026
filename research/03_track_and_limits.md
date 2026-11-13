# 03 Track brief and hard limits (Junction 2026, Rokoko Smartgloves track)

Date checked: 13 Nov 2026. Builds on `01_hardware_feasibility.md` (not repeated here). Anything without a link is marked "(my judgement)".

## TL;DR

- **The 2026 Rokoko challenge brief is not publicly indexed.** hackjunction.com is a JavaScript app that returns only its title to a fetcher, and no search hit (Rokoko news, LinkedIn, press) mentions a Rokoko challenge at Junction. Get the brief, judging and access details from the Rokoko mentors on site (question list below).
- **Two players, one pair: very likely yes.** Each glove is its own device with its own hub, battery and device ID. Through the SDK it is trivially two independent hands. In Studio, splitting one pair across two actors is undocumented; test it in hour one.
- **Fast swings:** Studio Custom Streaming carries only solved pose (position plus rotation), no IMU. The SDK exposes hub and arm gyro and accelerometer, but only at **83.33 Hz** output (the IMU samples at 250 Hz internally). That is enough to detect a stroke and time it to about 6 to 12 ms, but too coarse to measure peak speed precisely.
- **Webcam fusion:** MediaPipe Hands reportedly **fails on black, textureless gloves**. Use MediaPipe Pose wrists, or better, an **ArUco marker on the glove hub** with solvePnP for a 6-DoF wrist pose from a webcam.

## 1. The Junction 2026 Rokoko challenge

### What is confirmed
- Junction 2026 runs 13 to 15 Nov 2026 in Espoo. It advertises 2,000 participants, EUR 100,000 in prizes, AI and agent challenges, and a hardware lab for robotics and embedded projects ([HackerNoon roundup](https://hackernoon.com/12-hackathons-worth-your-fall-and-winter), [Espoo event listing](https://www.espoo.fi/en/events/espooevents:agp767vqb4)).
- Junction format: partner companies set challenges; each challenge has its own winner, and a separate main prize is chosen from finalists. Past editions used the Gavel tool for finalist selection, then expert judges who also read the code repositories; in 2018 the main winner was chosen by peer review ([Wikipedia: Junction](https://en.wikipedia.org/wiki/Junction_(hackathon))).
- Recent main-prize winners: 2024 BREAKDANCE; 2025 WAVELET, a real-time electromagnetic simulation in C++ and OpenGL. In 2025 the main partner was Sensofusion (counter-drone tech), with 291 projects ([Wikipedia](https://en.wikipedia.org/wiki/Junction_(hackathon))). Technically deep, visual, real-time work has won recently.

### What I could not find
- The exact Rokoko brief, judging criteria, challenge prize, and what Rokoko provides (SDK keys, Studio licences, Coil Pro, Smartsuit). Searches of hackjunction.com (`/challenges`, `/junction-2026`, `/challenges/rokoko`) returned an empty JS shell. Searches of Rokoko news, LinkedIn and press found nothing linking Rokoko to Junction.
- I found no previous Rokoko hackathon challenge, on Devpost, GitHub or Rokoko's own site. Rokoko's past competitions are animation challenges and giveaways that require mocap shown in Studio ([Rokoko challenge rules](https://www.rokoko.com/submission-rokoko-animation-challenge), [education giveaway 2026](https://www.rokoko.com/mocap/education-giveaway-2026)), which are not useful precedents for judging.

### What Rokoko currently cares about (signal for judges)
- Rokoko is pushing Smartgloves II into **robotics, teleoperation and robot training data**: a [robotics use-case page](https://www.rokoko.com/use-cases/robotics), a [case study teleoperating robot arms with gloves plus Coil Pro (221 demonstrations)](https://www.rokoko.com/insights/collecting-robot-training-data-with-rokoko-smartgloves), an IROS 2026 presence ([IROS page](https://www.rokoko.com/es/mocap/iros-2026)), a new Device SDK and a fresh Smartgloves II datasheet dated 30 Jun 2026 ([datasheet PDF](https://sdk.rokoko.com/datasheets/Smartgloves_II_Technical_Specifications_v1.0.0_External.pdf)).
- So a demo that shows the gloves as a **developer and real-time input platform** (not only an animation tool) probably lands well with Rokoko judges (my judgement).

### Ask the Rokoko mentors in the first hour
1. The written brief and judging criteria, and whether the Rokoko prize is separate from the main prize.
2. **SDK licence or key for the weekend** (gives raw IMU, USB streaming, hand solver; see section 3).
3. A Studio Plus/Pro voucher, so we do not burn the 7-day trial, or confirmation that the trial is fine.
4. Whether a **Coil Pro** or a second glove pair can be borrowed, even for an hour.
5. Their stance on adding a webcam or other sensors (some sponsors want "pure" use of their kit).
6. Their gyro and accelerometer full-scale ranges (not in the public datasheet).

## 2. Two players with one pair

**Evidence that each glove is independent:**
- SDK: "Each glove is its own RGMP device with its own `device_id`, so a pair of gloves shows up as two devices"; each glove reports its own `hand` field ([SDK Smartgloves reference](https://sdk.rokoko.com/reference/products/smartgloves/)).
- The SDK hand solver "solves every connected glove into a 26-joint hand", one output device per source glove, stateless per frame ([Hand solving](https://sdk.rokoko.com/guides/hand-solving)). Nothing in it needs the partner glove.
- Hardware: each glove has its own hub (EMF transmitter, IMU, magnetometer) on the back of the hand ([SDK reference](https://sdk.rokoko.com/reference/products/smartgloves/)). Setup guides configure them one by one ("repeat for the second glove") and recommend a separate powerbank per glove ([HKU guide](https://bookstack.hku.nl/books/motion-capture-motion-tracking/chapter/rokoko/export/markdown), [HAN medialab guide](https://medialab.han.nl/wp-content/uploads/2024/12/Rokoko-Smarsuit-Pro-Smartgloves-Getting-Started.pdf)).
- Third-party integrations pair "the left and right glove devices" separately to skeletons ([OptiTrack Motive setup](https://docs.optitrack.com/markersets/glove-device-setup/rokoko-smartglove-setup)).

**Unknowns and limits:**
- In Rokoko Studio, inputs are paired to an actor profile by drag and drop or "Pair with live input" ([Actor Profile](https://support.rokoko.com/hc/en-us/articles/13433650381841-Actor-Profile)). Whether Studio lets the left glove go to actor A and the right to actor B is not documented anywhere I found. Test it.
- **It does not matter much for our code** (my judgement): with Custom Streaming we read `leftHand*` and `rightHand*` joints from the JSON and route them to player 1 and player 2 ourselves. One Studio actor wearing both gloves is fine if two people physically wear them. The JSON v4 meta has `hasLeftHand` and `hasRightHand` flags per actor, so one-glove actors are at least representable ([JSON v3/v4 spec attachment](https://support.rokoko.com/hc/en-us/article_attachments/50030847458577)).
- Practical limits (my judgement): both players must do the Studio calibration pose at the same moment if both gloves sit on one actor. Without the Coil Pro, the two hands share no real spatial relationship (Studio places them on one virtual body), so do not show "hands near each other". Heading is magnetometer-referenced to north ([Hand solving](https://sdk.rokoko.com/guides/hand-solving)), so both hands share yaw if both hub inits are done in the same spot.
- Each player gets only one hand, so the game must be one-handed.

## 3. Raw IMU for fast motion (table tennis stroke)

### What each data path gives
| Path | Content | Rate | Source |
|---|---|---|---|
| Studio Custom Streaming (JSON v3/v4) | Per joint: position and rotation only. **No velocity, angular velocity, acceleration or IMU fields.** | Studio frame rate (exact live rate not documented) | [JSON spec attachment](https://support.rokoko.com/hc/en-us/article_attachments/50030847458577) |
| Device SDK (RGMP), `default` group | Per finger and arm sensor: transform to hub, `ANGULAR_VELOCITY`, `PROPER_ACCELERATION`. Hub: orientation to `LTP_NED`, `ANGULAR_VELOCITY`, `PROPER_ACCELERATION`, `MAGNETIC_FIELD` (Gloves II, experimental). | **83.33 Hz (250/3)** | [SDK Smartgloves reference](https://sdk.rokoko.com/reference/products/smartgloves/) |
| Inside the glove | IMU sampled at **250 Hz**, magnetometer 83.33 Hz, output to the device service 83.33 Hz | n/a | [Datasheet IM-01, MG-01, TR-04](https://sdk.rokoko.com/datasheets/Smartgloves_II_Technical_Specifications_v1.0.0_External.pdf) |

- Units: angular velocity in rad/s, acceleration in m/s^2 (proper acceleration includes gravity). Every frame carries `timestamp_us`, the hardware capture time ([RGMP spec](https://sdk.rokoko.com/reference/rgmp/)). No stream group runs at 250 Hz, and nothing documents batching three IMU samples per frame. So **the 250 Hz samples are not exposed; you get 83 Hz.**
- Latency to SDK output: 20 ms over WiFi (average, with jitter), 19 ms over USB. That includes a built-in 6 ms from the 12 ms sample period ([Datasheet TR-05, TR-06](https://sdk.rokoko.com/datasheets/Smartgloves_II_Technical_Specifications_v1.0.0_External.pdf)).
- Gyro and accelerometer full-scale ranges are **not published**.

### Can we detect a table tennis stroke, its speed and timing?
- Stroke physics: elite topspin forehand hitting phase is about 0.1 s, and hand acceleration at ball contact is about 149 m/s^2 (about 15 g). That study used a 100 Hz IMU with a +/-16 g range ([Bankosz and Winiarski 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7238326/)). Racket speed at contact is often quoted at up to about 20 m/s (unverified search snippet, treat as my judgement).
- Wrist IMU stroke detection works at around 100 Hz: published systems reach about 95 to 99 percent detection or classification ([racket-sensor study](https://lida.sport-iat.de/ta/Record/4050074), [wrist IMU plus audio, 100 Hz](https://arxiv.org/pdf/1805.05456.pdf), [smartwatch CNN](https://www.scitepress.org/Papers/2022/108711/108711.pdf)).
- **With the SDK (83 Hz):** about 8 samples across the hitting phase. Enough to (my judgement):
  - detect the stroke reliably (peak in gyro magnitude or a jerk threshold on hub acceleration);
  - time it to about +/-6 ms using `timestamp_us` and peak interpolation;
  - estimate "swing speed" as peak hub angular velocity times an assumed lever arm (forearm plus racket), which gives a rough number for a score, not a measurement;
  - classify forehand or backhand from the gyro axis sign and hub orientation.
- Risks (my judgement): peaks fall between samples, so peak values are underestimated by a variable amount. If the accelerometer range is +/-8 g or +/-16 g, a hard hit can clip it (15 g typical at contact). Integrating acceleration to get linear racket speed will drift; do not try.
- **With Studio only (no SDK):** differentiate the hand or forearm joint quaternion between frames to get angular velocity (my judgement). This works for "a swing happened" and rough timing. Studio's filtering adds smoothing and unknown latency, and without the Coil Pro the joint positions are body-relative, so no linear speed.

## 4. Webcam fusion for 3D wrist position

### Big caveat first
- MediaPipe Hands reportedly **does not detect hands wearing textureless black gloves** ([MediaPipe Google Group thread, Jul 2026](https://groups.google.com/g/mediapipe/c/ahWdzSJpxHw)). Gloved-hand tracking is poor for bare-hand models generally ([Encord, vendor test](https://encord.com/data-labs/hands-at-work-egocentric-hand-pose-tracking/)). The Rokoko glove is dark fabric, so expect trouble (my judgement). Test on day one.

### Options, best first for us
| Option | What you get | Accuracy | Latency | Notes |
|---|---|---|---|---|
| **ArUco/AprilTag marker on the glove hub + calibrated webcam, OpenCV solvePnP** | 6-DoF wrist pose in camera frame | Vendor blog: about 5 to 10 mm and 0.5 deg at 1 m for a 10 cm marker ([Zbotic](https://zbotic.in/aruco-marker-detection-pose-estimation-with-opencv-python/)); real markers on a hand will be 3 to 5 cm, so expect worse (my judgement) | Camera frame time plus a few ms (my judgement) | Glove-proof, simple, deterministic. Motion blur during fast swings loses the marker; use a 60+ fps camera and good light (my judgement). Calibration mistakes are the usual failure ([OpenCV forum](https://forum.opencv.org/t/aruco-marker-distance-calculation-off/13026)). |
| **MediaPipe Pose Landmarker wrists (15, 16)** | Wrist position in metres, origin at mid-hips ([Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)) | Learned, approximate depth; good for left/right/up/down, weak for depth (my judgement) | Real-time on laptop CPU or GPU (my judgement) | Uses arm and body context, so it should cope with gloves better than Hands (my judgement). Two players fit in one frame. |
| **MediaPipe Hand Landmarker world landmarks + solvePnP** | Metric hand in camera frame | 1.3 to 1.4 cm mean 3D error vs fitted ground truth ([TF blog](https://blog.tensorflow.org/2021/11/3D-handpose.html)) | 17 ms CPU, 12 ms GPU on a Pixel 6 ([Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)) | World landmarks are metres around the hand centre, not the camera, so you solvePnP world vs image landmarks to place the hand ([gist](https://gist.github.com/eldog/9012ce957be26934044131daffc25c73)). Likely fails on our gloves (above). |
| **Depth camera (OAK-D, RealSense)** | Metric depth at the detected wrist pixel | RealSense D435/D455 Z error under 2 percent ([RealSense depth accuracy](https://support.realsenseai.com/hc/en-us/articles/360059129453-Depth-accuracy-for-Intel-RealSense-D400-Series-Cameras)), so about 2 cm at 1 m | OAK-D users report 24 to 35 ms at 60 to 80 fps after updates, 170 ms in a bad setup ([Luxonis forum](https://discuss.luxonis.com/d/957-impact-of-latency-on-practical-applications/27)) | [depthai_hand_tracker](https://github.com/geaxgx/depthai_hand_tracker) measures the wrist in 3D on-device. Only if the hardware lab lends one; it still needs a 2D detector that sees the glove. |

### How others fuse glove plus camera
- Standard split: camera gives absolute wrist position and global orientation; the glove gives fingers. Meta's AVI-HT fuses a 12-IMU glove with an egocentric camera this way and gains most under occlusion ([arXiv 2605.21714](https://arxiv.org/pdf/2605.21714)).
- A 2026 sign-language preprint fuses Manus gloves (finger angles) with an Orbbec depth camera (hand position) after calibrating both into a common coordinate system ([Preprints.org](https://www.preprints.org/manuscript/202608.0151)).
- Rokoko's own answer for absolute position is the Coil Pro, not a camera. Rokoko Vision 3.0 dropped webcam capture entirely and is upload-only now ([Rokoko Vision](https://www.rokoko.com/products/video)), so there is no off-the-shelf Rokoko camera-plus-glove hybrid.

### Recipe for us (my judgement)
1. Glove hub orientation (from Studio or SDK) is better than any webcam estimate, so take **rotation from the glove and position from the camera**.
2. Align frames once: hold the hand still in 3 or 4 orientations in view of the camera, then solve the fixed rotation between Rokoko's frame and the camera frame (Kabsch on paired orientations).
3. Timestamp both streams on arrival at the laptop. Interpolate the camera position (30 to 60 Hz) to glove frames (83 Hz). For short gaps or blur during swings, extrapolate with the last camera velocity, or with the SDK hub acceleration for under 100 ms.
4. Expect about 30 to 60 ms camera latency (capture, inference, transport) versus about 20 ms for the glove. Delay the glove stream to match when you need coherent poses, and keep it un-delayed for stroke timing.

## What this means for our demo

- **Do not design around a brief we have not seen.** Talk to the Rokoko mentors first and get the SDK key question answered; that single answer decides the data path (raw IMU and USB versus Studio pose only).
- **Two-player mode is realistic**: one glove each, one-handed interaction. Plan for both gloves on one Studio actor and split the hands in our code. Treat true separate actors as a bonus if the hour-one test passes.
- **Fast swings are detectable, not precisely measurable.** At 83 Hz, build gameplay around *when* and *which way* a swing happened (timing windows, forehand or backhand, rough power tiers), not exact speed. With Studio only, derive angular velocity from joint quaternions; with the SDK, use the hub gyro and timestamps.
- **If we add a webcam, put a printed ArUco marker on each glove hub** instead of relying on MediaPipe Hands. MediaPipe Pose wrists are the zero-prop fallback. That restores rough 3D hand position (which the gloves cannot give without a Coil Pro) at low cost, and showing glove-plus-camera fusion fits Rokoko's robotics and teleoperation narrative.
- **Lead the pitch with what only the gloves do well**: finger articulation, hand orientation, low latency, and no occlusion. The camera is a cheap add-on for position, not the star (my judgement).
