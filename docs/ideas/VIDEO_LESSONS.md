# Video lessons: master video plus synchronised 3D hands

Goal: a Skillshare/MasterClass-style lesson where the master films themselves wearing the gloves, and the apprentice watches the video with the master's 3D hands composited beside or over it, in sync, then trains against the same hands. `Step.video_url` already exists in the contract (marked future) and the course syllabus has video slots.

## Experience

Master: in the record step, a camera preview appears. Press record: countdown, then video and glove frames are captured together. Stop, scrub, trim, save.
Apprentice: the step page shows the video with the 3D hands in sync. Three layouts: **beside** (video left, hands right), **overlay** (hand skeleton drawn on the video, only when aligned), **hands only**. A "Now you try" button switches to the training room with the same recording as the ghost.

## Capture

Browser: `navigator.mediaDevices.getUserMedia({video: {width: 1280, height: 720, frameRate: 30}, audio: true})`, then `MediaRecorder` with `video/webm;codecs=vp9,opus` (fall back to `video/mp4` on Safari).

Clock sync (the crux). Glove frames carry `t` in seconds since the stream start (server clock). Video has its own media time. Align with one shared marker:
1. When record is pressed, the frontend calls `performance.now()` as `t_click` and records `recorder.start()`. The first `dataavailable` or `recorder.onstart` timestamp is `t_video0` (also `performance.now()`).
2. The frontend subscribes to the glove stream (`onFrame`) and stamps each incoming frame with the local `performance.now()` at receipt, `t_rx`. Offset for a frame: `video_time = (t_rx - t_video0) / 1000 - network_latency`.
3. Estimate `network_latency` once: send a ping over the existing WebSocket and halve the round trip, or assume about 30 ms on localhost. Rokoko pipeline latency (about 20 ms) is ignored.
4. Store a single number per recording: `video_offset_s` (glove time zero minus video time zero). Playback then does `hands.t = video.currentTime + video_offset_s`.
5. Sync check and manual fix: a "clap" cue. Ask the master to snap their fingers or close a fist sharply at the start; the fist closing shows as a flexion spike in the glove data and as a visible event in the video. Provide a slider in the editor to nudge `video_offset_s` by plus or minus 200 ms. This manual nudge is the safety net.

Do not rely on MediaRecorder timestamps alone: `start()` has jitter of tens of milliseconds. Use the nudge slider.

## Aligning the 3D hand to the video (overlay mode)

Gloves give finger flexion and wrist orientation but no position (`wrist_pos` null). MediaPipe Hands gives landmarks in the image, but the research warns it fails on dark, textureless gloves (research/03). So:
- **Beside mode** needs no alignment: it is the safe default.
- **Overlay mode** is best-effort: run MediaPipe (browser `@mediapipe/tasks-vision` HandLandmarker over video frames, or the existing backend `POST /vision/hands` per frame) and use the wrist landmark (index 0) as the 2D anchor and the hand scale (wrist to middle MCP distance in pixels) to place and scale the 3D hand in a transparent overlay canvas. Orientation comes from the glove `wrist_quat`, not from MediaPipe. Where MediaPipe fails, hold the last good anchor and fade the overlay to beside mode.
- Store per-frame anchors in a sidecar `overlay.json`: `[{t, wrist_px: [x, y], scale_px}]` at 15 Hz, computed after recording (not live) so the CPU is free.
- A bare-hand master (no glove colour issue) would work better; the gloves have the wrist hub, so consider an ArUco marker on the hub as in research/03.

## Storage

- Video: backend `DATA_DIR/videos/<recording_id>.webm`, uploaded via `POST /videos` (multipart). Served by a static route `GET /videos/<id>.webm` with range requests (needed for scrubbing). Hackathon scale: local disk.
- Metadata: extend `Recording` with optional `video_url` and `video_offset_s`; step already has `video_url`. Update `docs/CONTRACT.md`, backend schemas, and `frontend/src/api/types.ts` together (rule 1 in ARCHITECTURE.md).
- Size: 720p webm at about 2 Mbit/s is about 15 MB per minute; keep clips under 60 s.
- After the hackathon: object storage plus signed URLs.

## Playback UI

Component `VideoLessonPlayer` in `frontend/src/features/apprentice/`:
- `<video>` element is the master clock. A `requestVideoFrameCallback` (or `requestAnimationFrame`) loop reads `video.currentTime`, computes glove time, and drives a `Hand` via refs (no per-frame `setState`, ARCHITECTURE rule 6). Reuse the replay machinery that already plays recordings (`source: 'replay'`).
- Controls: play, pause, scrub, 0.5x speed (`video.playbackRate`; the hand follows automatically), loop section by step, layout toggle.
- Fallback when no video: current ghost replay.
- Keep controls 44 px, big captions (EB Garamond italic note per step).

## 6-hour MVP slice

Use the existing `VideoSlot` in the course syllabus. Beside-mode playback only, one stored offset.

Hour 0 to 1: contract fields (`video_url`, `video_offset_s`) in the three places; `POST /videos` and range-request static serving.
Hour 1 to 2: master record step: camera preview and MediaRecorder started on the SAME click that calls `POST /recordings/start`, so `video_offset_s` is one small stored constant with no client re-stamping of glove frames.
Hour 2 to 3: `VideoLessonPlayer` inside `VideoSlot`: glove time = `video.currentTime + video_offset_s`, driven through refs.
Hour 3 to 4: 0.5x speed and step loop; connect to the step page ("Watch" tab, then "Now you try").
Hour 4 to 6: polish, a pre-recorded demo video as the fallback, test on two browsers.

Dropped from the MVP: the nudge slider, the client-side clock-sync estimation and re-stamping described above (kept as the post-MVP design), and overlay mode with MediaPipe.

## Gemini extension

Feed the same video to Gemini (see GOOGLE_TRACK.md feature 2) to propose step splits and instruction text; the glove data gives the exact step boundaries.

## Risks

- Clock drift between video and glove stream: mitigate with the nudge slider and short clips.
- Camera permission and `getUserMedia` need HTTPS or localhost; fine for the demo, not for a remote deployment without TLS.
- Safari and MediaRecorder formats (use feature detection).
- MediaPipe on gloves: reported to fail; treat overlay as an extra, not the core.
- Privacy: master's face on video; add consent text.
