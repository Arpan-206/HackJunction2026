# iPhone LiDAR for wrist position and a heading cross-check (design only)

Status: proposal. Nothing is built. It would land in the teammate's `core/camera/` and needs their approval before any
code is written. Facts marked "to verify" come from memory of the vendor documentation, not from a test on our phone.

## Problem

The gloves give orientation, not position: the wrist sits at a fixed rest pose (`[rest_pose]` in `config.toml`) unless the
MediaPipe camera supplies one, and MediaPipe's depth is a guess from hand size. The glove heading also drifts (3 to 4
degrees a minute at rest on the real gloves) and needs the core's `calibrate` to set yaw zero. An iPhone with LiDAR can
give a metric 3D position for the back of each hand and an independent heading check.

## Idea

1. Stick a printed ArUco marker (about 3 cm, `DICT_4X4_50`, ids 0 left and 1 right) flat on each glove's hub, the hard
   box on the back of the hand.
2. Stream colour and depth live from the iPhone to the PC.
3. Per frame: detect the markers in the colour image (OpenCV `cv2.aruco.ArucoDetector`), take the depth at the marker's
   four corners and centre (median over a few pixels, high-confidence pixels only), and back-project with the frame's
   intrinsics. That gives the hub position in metres in the camera frame.
4. Marker pose from the corners (`cv2.solvePnP` with `SOLVEPNP_IPPE_SQUARE` on the known marker size), with the
   LiDAR points fitting the plane to fix the scale and the sign ambiguity that single-marker PnP has.
5. Cross-check: the marker's orientation and the hub quaternion from the glove (`hub` `ORIENTATION` on the driver, or the
   solver's wrist) should differ by a constant rotation once the camera-to-world yaw is known. Fit that constant during
   the neutral pose of the calibration area (hands flat, still), then watch the residual: a residual growing past a few
   degrees means the glove heading drifted, and the app can ask for a recalibration (the same message the drift check
   gives) or correct yaw from the camera.

## Streaming options

| option | what it gives | effort | notes |
| --- | --- | --- | --- |
| Record3D app, USB streaming | RGB, LiDAR depth, intrinsics, camera pose per frame into Python via its `record3d` library | low | paid feature of the app (to verify); USB only for the Python library, Wi-Fi streaming goes to a browser (to verify) |
| Small custom iOS app (ARKit) | `ARFrame.capturedImage` plus `sceneDepth.depthMap` and `confidenceMap`, `camera.intrinsics`, `camera.transform`, sent over a socket | medium | needs a Mac with Xcode and a developer account to install |
| NeRF/3D scanner apps that export | files after the fact, not live | none | not live, so no use here |

ARKit `sceneDepth` on LiDAR iPhones is a 256 x 192 float depth map in metres with a per-pixel confidence (low, medium,
high), delivered with each frame at the camera rate (60 Hz on recent phones, to verify), aligned to the colour image
after scaling by the resolution ratio. Range is about 5 m; accuracy at arm's length is around a centimetre for
high-confidence pixels (to verify on our phone). A 3 cm marker at 60 cm covers roughly 10 depth pixels across, enough for
a median.

## Where it lands

- `core/camera/lidar.py`: a source like the existing MediaPipe camera source, producing per-hand `wrist_p` and a
  `hub_q_camera` with a confidence, on the core clock (map the phone's timestamps with `ClockMapper` as the gloves do).
- `core/session.py`: when the LiDAR source has a fix for a hand, set that hand's `wrist_p` and `anchor = "camera"`;
  otherwise keep today's behaviour. The heading cross-check reports a residual per hand in `/health`.
- `config.toml`: `[camera.lidar]` with marker ids and size, the stream address, the minimum confidence and the residual
  limit.
- The backend only reads it through the existing route: the bridge already forwards `wrist_pos` to `/ws/ingest`.

## Risks

- Markers on the hub can be hidden when the palm turns up; the glove orientation carries the hand through those frames.
- Depth at a marker edge mixes hand and background; use the inner corners and high confidence only.
- Latency: USB streaming adds about one or two frames; timestamps on the phone keep the fusion honest.
- Licence and cost of Record3D's streaming feature; a custom app avoids it.

## First experiment

Print two markers, stream with Record3D over USB, log marker position and depth for 30 s with the hands flat, then with
slow wrist turns, and compare the marker yaw with the glove hub yaw. If the residual stays within a few degrees after the
fitted offset, build the source.
