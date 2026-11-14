# STATUS.md

## Saturday 14 Nov, 14:40: handover to Szymon (read this first)

Everything below this section is the overnight core report, still valid.
This section is what changed on Saturday and where things stand.

**Evening batch (Sat 16:20 to 17:55), six lanes on Opus 5.5, all merged on
main, every suite green** (core 177, backend 304, frontend 316, lint, build,
demo walk and mock walk clean; nothing touched live gloves):

| Lane | What it added | Its note |
| --- | --- | --- |
| lidar | core depth source on `ios/PROTOCOL.md`, fake phone `core/camera/fake_depth.py` (dark-hand and no-plane variants), depth step behind `python -m core --depth` or `--depth-fake` (table, forearm by cylinder fit, glove yaw drift correction), `/ws/depth` point cloud, `/depth` viewer, `tools/depth_check`, `docs/DEPTH_STREAM.md`. Nothing verified on real depth | `STATUS-lidar.md` |
| demo-mode | `/demo` visitor flow with a 20 s guest calibration (flat, fist, thumb folded), lesson pick, live score beside the robot twin, Next visitor; kiosk flag; Geppetto rename done; thumb phase stored by the backend and now used by the core's thumb range | `STATUS-demo-mode.md` |
| shadows | five shadow puppets reach a score card; Fingerspelling is teachable (A to Z, word drill, letter chart at `/apprentice/fingerspelling`); `tools/make_pose_lessons.py` emits core lessons | `STATUS-shadows.md` |
| slot-kit | `scripts/slot/run.sh` guided checklist for the next glove slot, logs to `logs/slot/<time>/`, `--dry-run` on fakes passes; fake RCSP driver `tools/fake_rcsp_server.py` | `STATUS-slot-kit.md`, `docs/SLOT-KIT.md` |
| models | Gemini and Gemma on Verda back each other up (20 s cap on Verda, fallback logged), fixed offline sentence when neither answers, "AI Assistant" label under lessons and plans, `backend/scripts/llm_health.py` with a per-role table, no Ollama | `STATUS-models.md`, `docs/MODELS.md` |
| submission | drafts in `docs/submission/` (project text, 2 minute video script, deck outline, Verda Discord summary), unverified claims marked | `docs/submission/STATUS-submission.md` |

**For Szymon's Claude (Sat 22:40): lidar follow-up and hand-root merged;
live stack recipe with the phone.** Core: the depth step's arm gate (no false
arms on the real clips), a safe yaw correction (rate cap, hold when the arm is
lost, flag on with no arm equals flag off, proven frame by frame), gloved
hand blobs, and hand-root: the wrist position from the phone fused into
`HandState.wrist_p` behind `python -m core --root` (config `[camera.root]`,
off by default); with it on, compat `/ws/gloves` sets `wrist_pos`, the field
CONTRACT.md already has, and `frontend/src/three/Hand.tsx` offsets the hand
when `wrist_pos` is present (your pivot logic kept, the offset added on top).
`scripts/live.sh` takes `CORE_EXTRA_ARGS` (for example
`"--root --depth-host 127.0.0.1:7700"` with `iproxy 7700:7700` running) and
no longer echoes secrets into the run log. Live at 22:21 with both gloves and
the phone: gloves tracked, depth 30 fps, table found; the 3D hand position was
jumpy and left the view, so a stabilisation pass runs on branch hand-root
(work box, jump rejection, One Euro, motion scale 0.6); until it lands, run
the stack without `--root` for a steady demo. Suites on this merge: frontend
537, lint, build; backend 498 before the two core merges (they touch no
backend file); the core suite was cut short by the push and is rerun next.
Notes: `STATUS-lidar.md` (section "Follow-up: real clips"),
`STATUS-hand-root.md`, `docs/DEPTH_STREAM.md`.

**For Szymon's Claude (Sat 22:20): your 94 commits are merged into main
with ours.** Seven conflicts, resolved like this. `moves.json` (backend and
mock): your 77 moves, with the 26 ASL letters and the two words as the packs
lane wrote them ("ASL letter A" and friends). `docs/CONTRACT.md`: both new
sections kept, fingerspelling packs and your drafts, bundles and backups.
`useRobotStream.ts`: your version (explicit mock mode skips the core's port).
`catalogue.ts`: your four demo skills as you narrowed them at 17:22, with
`HIDDEN_SKILLS` keeping the ASL drill off the dashboard; the pack-aware drill
from the fingerspelling-packs lane lives at `/apprentice/fingerspelling` and
is reached from there. `seed.ts` and `router.ts`: your lesson list and
imports plus the packs export and the two pack routes. Your
`tests/skills.test.ts` is unchanged and passes. One product overlap for you
and Arpan to settle in the morning: your `finnish_fingerspelling` skill
carries estimated curls, and Arpan's rule for Finnish letters (19:50) is
"never a placeholder pose, not recorded yet until a person records it from
the official chart"; the packs lane's Finnish pack does exactly that, with
slots S U O M I Ä Ö and a slot-kit step to record them. Both are in the
tree; nothing was deleted. Checks on the merged tree: core 248, backend 498,
frontend 537, lint, build. Walk results are in the commit message.

**For Szymon's Claude (Sat 21:35):** main gained fingerspelling-packs and
two walk fixes. Packs: letters now live in packs
(`backend/app/data/fingerspelling_packs.json`, `GET /fingerspelling/packs`,
additive in CONTRACT.md, types.ts and the mock router together). The ASL
alphabet is "ASL fingerspelling alphabet" everywhere a user sees it and keeps
its sources; the Finnish pack "Finnish fingerspelling (sormiaakkoset)" has
slots S U O M I Ä Ö, all "not recorded yet", nothing guessed, reference
https://suvi.viittomat.net/alphabet.php; Å Ä Ö work in the word drill;
unrecorded letters are flagged and never scored; slot step 9 records a letter
from the chart with recorded_by and reference (`scripts/slot/`), also with
`python -m core --camera`; `tools/make_pose_lessons.py` emits only recorded
letters. Note: `STATUS-fingerspelling-packs.md`. Mock walk: in mock mode the
robot socket no longer tries the core on 8765 first (it logged a failed
connection on every reconnect; `frontend/src/api/useRobotStream.ts`), and the
walk window is 1200 px high because the robot pane on the expert scratch
screen pushes the calibration card below a 900 px fold. That fold is a real
layout point for a laptop screen: decide whether the robot pane on the
expert screen should start collapsed. Suites on this main: core 248, backend
390, frontend 365, lint, build, mock walk clean.

**For Szymon's Claude (Sat 20:45):** since the 20:05 push, main gained
coach-tune. What it is: our own fast coach, a LoRA on `google/gemma-4-E2B-it`
trained on 3,231 coaching lines written by `google/gemma-4-31B-it` (bf16, on a
Verda Serverless Container), evaluated and torn down, 5.72 USD. It is OFF by
default: the backend provider sits behind `COACH_MODEL=tuned` with
`TUNED_BASE_URL`, and nothing changes for you unless both are set. Held-out
score 89 % tuned against 56 % untuned and 86 % teacher; on the 333 real-capture
rows the tuned model scores 62 %, below the teacher's 67 %. Files:
`coach_tune/` (dataset builder, label, train, eval, container scripts,
`RUN.md`), `docs/COACH_MODEL.md` (model card, the no-Gemini statement,
"Serve it again" in about 5 minutes), `docs/VERDA.md` (updated),
`docs/submission/VERDA-COACH-TUNE.md`, `STATUS-coach-tune.md`. The adapter
(95 MB) lives git-ignored in the coach-tune worktree's `coach_tune/out/`.
Nothing else in `backend/` changed behaviour. Also since 20:05:
`tools/depth_live_view.py` (browser live view of the phone's colour, depth,
confidence and an overlay, port 8790) and the iPhone app rebinds its listener
after lock or background. Lanes still running on their own branches: lidar
(arm gate, colour plus depth, gloved blobs), hand-root (hand position from
the phone), fingerspelling-packs (alphabet packs, Finnish slots). Each gets
its own note here when merged.

**Third batch (Sat 18:55 on), merged so far:** expert-priors (core 210
pass). `core/priors/`: an ASL letter recogniser on the 18 angles (20 classes,
J and Z excluded, G/Q, K/P and H/U/V merged; leave-one-session-out top-1
67.4 %, top-2 87.7 %, calibrated confidence), a FurElise piano posture checker
(47 training pieces, held-out pianists inside the expert band 85 to 98 % per
joint; suggested piano tolerances about 7 perfect and 20 to 23 wrong, config
unchanged at 15/60), both as optional coach facts behind the environment
flags PRIORS_ASL and PRIORS_PIANO, off by default, and a provenance test (no
Gemini, no Decisions API, no logs/live data in training). PianoMotion10M was
dropped: CC BY-NC-ND and MANO-gated. Not tested on real piano or real
fingerspelling: record one glove piano take and one fingerspelled alphabet,
then `python -m core.priors.real_check`. `docs/PRIORS.md`,
`STATUS-expert-priors.md`. Verda VMs refuse the coupon balance without a
payment method; only Serverless Containers run. coach-tune is still running.

**Second batch (Sat 18:05 to 18:40), merged on main, suites green** (core 190,
backend 375, frontend 359, lint, build):

| Lane | What it added | Its note |
| --- | --- | --- |
| thumb-align | the preview's thumb now uses the scorer's 0.8 scale (`frontend/src/three/motion.ts`); a pose copied from the preview scores 99 or more; tests over every letter, both words and five puppets within 5 degrees. Open: `finger_sequence`, `pinch`, `idle` and `grip_and_swing` presets still differ between preview and scorer target | `STATUS-thumb-align.md` |
| replay-demo | capture inventory (`tools/capture_inventory.py`, 553 still stretches in `docs/replay-demo/still-stretches.md`); `python -m core --replay` gains `--replay-start`, `--replay-seconds`, `--replay-speed`, `--replay-stream`, `--replay-continuous`; `scripts/replay_demo.sh CAPTURE [--start S --seconds D]` plays a capture through the whole stack, looping; a REPLAY corner mark from the core's own `/ws/gloves` source that no setting, kiosk flag or dev panel hides; ten held-pose lessons in `lessons/replay-*` (same pose 99 to 100, wrong pose fails 9 of 10); an offline thumb-folded calibration from capture 2969 to 2978.5 s makes the right thumb usable without changing any pass or fail | `STATUS-replay-demo.md` |

Core fixes from the batch: a glove button press records that glove
(`record_start` takes a hand), and the thumb-folded capture sets the thumb
range (`core/calibration.py`).

**Depth camera (Sat 14:30):** `core/camera/depth.py` (`DepthFrame`,
`DepthSource`) and `core/camera/record3dstream.py` read the free
Record3DStream app (PathOn) on an iPhone; address in config.toml
`[camera.record3dstream]`. `python -m tools.r3d_snapshot` saves one frame of
each stream to `logs/r3d/<time>/` and prints resolution, frame rate and depth
and confidence statistics. Tested on a 17 frame capture over WiFi (RGB
1920x1440, depth and confidence 256x192, about 9 fps); not yet wired into the
hand tracker. The ARKit app lane (ios/) produces the same `DepthFrame`.

**Our own iPhone app (Sat 15:33), live over USB:** `ios/GeppettoDepth` on the
iPhone 16 Pro streamed to the Mac through `ios/mac/forward.sh` (iproxy, port
7700): 296 frames in 9.9 s, 29.8 fps, no gaps, colour 640x480, depth and
confidence 256x192, table plane in every frame. Recorded with
`python -m ios.mac.record captures/bench.gdrec.gz --seconds 10`, summarised
with `python -m ios.mac.replay captures/bench.gdrec.gz --info`. The PathOn
app is the WiFi fallback only: in its USB mode the phone refuses port 8888 and
no other port of its own listens.

**Bench capture (Sat 15:51, patched app):** `captures/bench-3.gdrec.gz`, 300
frames at 30 fps, the phone on the bench with a hand on black fabric. The
bench plane faced up, 0.19 m below the camera, and held the same height to
the millimetre over the 10 s. Depth noise on a still scene: 1.8 mm on high
confidence pixels, 59 mm on low confidence pixels, so mask by confidence
(`DepthFrame.depth_ok`). Black fabric gives filled, smooth depth with low
confidence; hands and objects give high confidence. The app preview is in
colour. Reinstall path from the terminal is in `ios/README.md`.
Parked (Sat 16:05): a no-router link between phone and Mac (peer-to-peer WiFi
through Network.framework plus a Mac helper, or the phone's Personal Hotspot at
172.20.10.1). Bluetooth is too slow for the stream. The cable is the demo link;
WiFi at 10.0.34.248 is the fallback in config.toml.

**On `main` now, all suites green** (core and decisions 203 tests, backend 255,
frontend 296, lint and build):

| Lane | What it added | Its note |
| --- | --- | --- |
| core | Per-wearer flat and fist calibration read from the backend's files; parity off; threshold study on real data | `STATUS-core.md` |
| robot-view | Dex3-1 twin in the frontend from `/ws/robot`, `/robot` screen, source control | `frontend/STATUS-robot-view.md` |
| decisions | Gemini Decisions adapter behind the core's coach interface, rule fallback, registered in `core/server.py` | `decisions/STATUS-decisions.md` |
| export | Lessons plus Dex3-1 targets to LeRobot episodes, one command | `STATUS-export.md` |
| verda | Gemma 4 31B on a Verda H200 behind vLLM, measured, torn down; 3.94 USD spent | `verda/STATUS-verda.md`, `docs/VERDA.md` |
| typing | Typing task, `/typing` screen, keystroke verdicts, accuracy tool, `[typing]` thresholds | `STATUS-typing.md` |
| weights | Per-finger step weights (take consistency x task chart x calibration mask) in both scorers and the practice view | `STATUS-weights.md` |
| rokoko-setup | Rokoko SDK installed and activated on this Mac; `scripts/live.sh`, `scripts/stop.sh`, `docs/GLOVE-SLOT.md` | `STATUS-rokoko-setup.md` |

**Glove slot, 13:19 to 14:20, both Smartgloves II on this Mac, through
route B** (core reads the solver; the bridge feeds the backend; the frontend
reads the backend):

| Check | Result |
| --- | --- |
| Live stack | `scripts/live.sh arpan` brought up driver, solver, two raw captures, core, bridge, backend, frontend. Two earlier attempts failed because the Rokoko desktop app held the driver's UDP port; quit it first (GLOVE-SLOT step 0) |
| Gloves | right device 291175775 and left 3552246405, both solved at 83.3 Hz, both tracked in the core |
| Raw captures | `logs/live/20261114-131952/` (untracked, about 1 GB solver plus 0.3 GB driver for the hour); replay any window with `--replay` |
| Calibration | flat and fist captured through the backend API for wearer "arpan", linked by a neutral record, loaded by the core. Right glove calibrated well (knuckle ranges 37 to 49 deg). Left glove ranges 0.7 to 8 deg: loose or mis-seated, redo it |
| Held pose copied by the same glove | 3 of 3 hold steps passed within 2 s, scores 0.95, 0.995, 1.00. The sensing and the scorer are proven |
| Three-take continuous lesson (crochet style) in the expert screens | mid 70s when the expert copies himself: a lesson and margin problem, not a sensing problem. Record clear poses for visitors; set the margin from the expert's own spread |
| Typing finger detection | two clean runs: 17% and 31% of keys got a clear finger, 6% and 4% matched the chart. The solver's angles do not show keystrokes. Keep typing as a drill without a finger verdict, or try the raw driver stream |

**Decisions taken today**: route B, one owner per capability, both contracts
frozen (`RECONCILE.md` section 0). The product name is Geppetto; the rename
checklist in `CLAUDE.md` is still open. Thresholds: pose lessons score at
`perfect_deg = 15`, `wrong_deg = 60` on calibrated angles (applied in `4785ddd`).

**Lane patches applied on main in `4785ddd`**: expert takes set
`Step.weights` in the expert screens; the `openai` provider (Gemma on Verda)
is registered in the backend; Rokoko binary names and the SDK path are right
on macOS; coach model calls run off the tick and land on a later poll. Still
not applied, optional: the decisions rubric into the scorer and `/health`
counters (`decisions/STATUS-decisions.md`).

**Running on this Mac at handover**: nothing. The gloves were returned at
14:30 and `scripts/stop.sh` took the live stack down at 14:33: every part
stopped in reverse order and all six ports came free; the core ignored SIGINT
and SIGTERM and needed the script's SIGKILL after 9 s (a small core fix for
later). The hour of raw captures is kept untracked in
`logs/live/20261114-131952/` (1.5 GB). No lane session is running.
Keys and tokens are in the git-ignored `.env` at the repo root.

Written Sat 14 Nov 2026, 05:00 Helsinki time, updated 10:55, on branch
`core-overnight` (pushed to origin at 07:15, merged with `main` as of `9810bf5`). Everything below runs with no hardware. Read the three lists in
order: works and is tested; written but untested; what to check first with the
gloves. Then read DECISIONS.md.

## Run it

```bash
cd repo
source .venv/bin/activate              # Python 3.12 virtualenv, already populated
python -m pytest -q                    # 109 tests, about 33 s

python -m core --fake                  # synthetic gloves + synthetic lesson, learn mode, 30 Hz on :8765
open http://localhost:8765/debug       # 2D canvas debug view (connects to /ws, has buttons for every command)
curl localhost:8765/health             # tick_hz, hands, validation_errors, rgmp/rcsp/camera state

# real gloves (glove laptop at 10.0.0.5, solver on 12277, driver RCSP on 45451):
python -m core --solver 10.0.0.5:12277 --rcsp 10.0.0.5:45451 --capture logs/capture_$(date +%H%M).rgmp
python -m core --solver 10.0.0.5:12277 --no-rcsp      # without button/LED

# replay a raw RGMP capture through the real pipeline (no gloves):
python -m core --replay logs/capture_0930.rgmp [--replay-loop]

# a fake hand solver on a port, for anyone who wants bytes on 12277 without gloves:
python -m tools.fake_rgmp_server --port 12277 [--layout split] [--capture out.rgmp]

# camera fallback (needs models/hand_landmarker.task; fetch once with network):
python -m tools.fetch_models
python -m core --camera                 # both hands from MediaPipe on webcam 0
python -m core --camera --video clip.mp4

# viewer side: record the message stream, replay it with no core at all
python -m tools.ws_log record --out logs/ws_demo.jsonl --seconds 60
python -m tools.ws_log replay logs/ws_demo.jsonl --port 8765 --loop
```

Viewer notes: `hello.lessons` is read once at connect; after a `record_stop`
or `lesson_delete` the viewer should `GET /lessons` again (a `lesson` message
carries the new lesson itself). CORS allows GET from any origin.

`config.toml` holds every threshold. `[sources]` picks `glove`, `camera` or
`none` per hand (also at runtime with the `set_sources` command).

## Works and is tested (no hardware)

| Part | What it does | How it is tested |
| --- | --- | --- |
| `schema/` (12 files) | JSON Schema for hello, frame, session, lesson, event, coach, ack, cmd, lesson.json, step summary | Every message the fake server emits is validated at runtime (`/health` shows `validation_errors`); tests validate every message type and the SPEC's own examples |
| `core/hand.py` | 26 OpenXR joints to 18 angles, curl, pinch with hysteresis, mirroring, wrist frame, joint rotations, MediaPipe 21 to 26 conversion | Flat hand gives flexions near 0, fist near 90 (thumb 60); a hand and its mirror give identical angles; angles invariant to rigid motion and scale; pinch on 15 mm off 30 mm; round trips |
| `core/fake.py` | Two synthetic gloves and two synthetic lessons: `fake-demo` (4 hold steps; the right hand plays a learner that passes a step about every 8 s) and `fake-wave` (one `move` step, for a moving ghost and `timing_ms`) | Server test waits for a real `step_passed` from the real scorer on fake hands; a second test loads `fake-wave`, sees the ghost's `lesson_t` advance and an integer `timing_ms`, then a moving `recorded` ghost in playback |
| `core/server.py` + `__main__.py` | FastAPI: `/ws`, `/health`, `/lessons`, `/lessons/{id}`, `/lessons/{id}/frames/{name}.jpg`, `/schema/{name}.json`, `/debug`. 30 Hz tick, per-client `subscribe` rate and `rots`, one ack per command | TestClient websocket test: hello, session, lesson, frames, ping ack, bad command ack, bad JSON ack, subscribe with rots, playback switch; also run over a real socket |
| `core/recorder.py` | Lesson folders (`lesson.json` + `trace.npz` + `frames/step_XX.jpg` sketches of each key pose), marks, auto step cuts (still 400 ms under 20 deg/s), stillest-300 ms key pose, hold/move kind, static-finger weights, chord step names | Fake master: 4 marked steps all `hold`, key poses match; unmarked 4-pose take auto-cuts into 4 hold steps; a wave gives one `move` step; save/load; schema |
| `core/scorer.py` | Per-frame per-finger error, 8/45 degree map, weighted overall, 150 ms EMA, hints, hold timer, move matching in a 250 ms window with `timing_ms`, mean-pass for move, stuck detection, DTW worst moment, step summaries; mirror scorer | Identical gives 1.0; 45 degree finger gives 0; hint directions; hold passes after `hold_ms`; move step passes when followed and reports about -100 ms when 100 ms early; fails when wrong; summary validates |
| `core/robot.py` | Retargets the 18 angles to robot joint targets: Unitree Dex3-1 (7 joints: thumb 3, index 2, middle 2) with names and limits read from the official URDFs (`models/robots/dex3_1/`, BSD-3 from unitreerobotics/unitree_ros; the Aalto starter repo has no hand URDF). Weighted sums plus offsets from `[robot.retarget]` in config.toml, clamped to limits; flexion sign from the limit range per side; fidelity per robot finger; `missing` lists ring and little. Source `master`, `learner`, `lesson` or `off` via `set_robot_source`. Served as `frame.robot` on `/ws` and alone on `/ws/robot` | URDF parse; flat hand near 0; fist clamps at the mirrored limits for left and right; block and frame validate; session sources in learn and playback; `/ws/robot` over the TestClient; on the real capture with `--replay` both hands give targets inside the limits (one 4-decimal rounding flag, fixed) |
| `core/tasks/piano.py` | Key press per finger (knuckle flexion faster than 250 deg/s ending 12 deg past rest, release within 6), `finger_down` events, note verdicts `good` (120 ms), `early`/`late` (300 ms), `wrong_finger`, `miss`, piece scheduling at `tempo_bpm`, `frame.task` with `beat`, `next`, `down`, `last` | Synthetic flexion curves: a fast rise is a press, a slow rise and a small twitch are not; a 4-note piece gets good, late, wrong_finger and miss; a session with `set_task piano` emits `finger_down` and `note` events that validate |
| `core/coach.py` | `CoachClient` protocol; `RuleCoach` with the SPEC rule table; rate limiter (one tip per hand per 4 s, newest summary replaces a queued one); keyword `describe_task` | Rule lines, rate limit, message schema |
| `core/session.py` | Modes idle/record/learn/mirror/duel/playback, roles, sources, step state machine, ghost (mirrored onto the opposite hand, glued to the learner wrist), glove button mapping, thumb-to-little pinch control, all 21 commands with error codes, attempt log | Learn: wrong pose gives stuck + tip, right pose passes and advances; ghost mirrored for the opposite hand; record start/mark/stop makes a loadable lesson that then passes in learn; discard; button and pinch controls; mirror, duel, playback; camera tolerances; chords task state |
| `core/rgmp.py` | Definition-driven RGMP parser (offsets from the definition, any data_type), joint mapping from config with aliases and an enum-order fallback, hand detection, newest frame per device, clock mapping (min arrival minus timestamp over 5 s), 250 ms silence, disconnect, yaw calibration, raw capture to file | Both guessed layouts (one FLOAT[7] TRANSFORM per joint, and split FLOAT[3]+FLOAT[4]); resync after garbage; split TCP chunks; live run against `tools/fake_rgmp_server.py` on a socket; capture file replayed with `tools/replay.py` into a second reader; silence; calibration zeroes yaw |
| `core/rcsp.py` | RCSP header + JSON client with TrackId futures, events between command and reply, `GloveControl`: ListDevices, GetDeviceInfo IsLeft, DeviceSubscribe, Subscribe, LED colours per SPEC, button to session | Against a fake RCSP server in the test: devices found, button routed to the right hand, LED blue on idle, green flash on `step_passed`, error reply raises |
| `tools/fake_rgmp_server.py` | Fake `rkk-hand-solver`: two `solved_hand` devices, `joints_openxr`, static rest pose, STATUS_FLAGS, switchable layout and hand field | Used by the tests above and by an end-to-end run: core connected, recorded a 2-step lesson from the stream, learn mode scored it |
| `tools/replay.py` | Serves a raw capture on TCP, paced by `timestamp_us`, optional loop and speed | Capture of 120 frames replays into the reader, 26 joints per frame |
| `tools/rgmp_tee.py` | Records a live solver socket to a raw capture, optionally re-serves it | Not run (needs a live socket); it is 60 lines of plain asyncio |
| `tools/ws_log.py` | Records the viewer socket to JSONL; replays it as a fake core that acks every command | Recorded 57 messages from `--fake` and replayed them to a client with an ack |
| `tools/ingest_bridge.py` | Forwards this core's `/ws/gloves` hands into the teammate backend's `/ws/ingest` external source | Ran against their backend at `cfbe9c2`: both hands re-emitted on their `/ws/gloves` as `source: "replay"` (see Teammate activity) |
| `tools/debug_view.html` | Plain canvas page: hands (finger colours from the score), sepia ghost, score bars, coach line, session, event log, buttons for every command, measured frames/s | Served at `/debug`; JS passes `node --check`; rendered in headless Chrome against `--fake` (screenshot checked) |
| `core/camera/` | MediaPipe HandLandmarker (installed 1.2.3 tasks API, checked against the package, VIDEO mode) in a thread; webcam or video file; 21 landmarks to the same Hand object with `source: "camera"`, `anchor: "camera"`, wrist on a plane in front of the viewer, One Euro filter; wider `[score.camera]` tolerances | Synthetic landmarks round-trip angles and handedness for both hands and both mirror settings; ingest/poll with a fake result; the landmarker ran on blank frames and on a synthetic 45-frame video (0 hands, no error, 5.6 ms/frame) |

Throughput and soak, measured on `--fake` (see DECISIONS D20 for the one
exception to the tick rate):

| Measure | Value |
| --- | --- |
| Tick period, median, with a client | 33.3 ms |
| Late ticks (over 45 ms) in 150 | 0 |
| Cost of one tick | about 3 ms |
| Of which schema validation | 1.5 ms |
| Soak length, two clients (30 Hz and 60 Hz with `rots`) | 8 min |
| `tick_hz` during the soak | 30.0 throughout |
| Memory during the soak | 105 MB, flat |
| Validation errors, bad acks | 0, 0 |
| Frames delivered to the two clients | 9 616 and 10 802 |
| Frame gap at the 60 Hz client, median and p99 | 33.4 ms and 36.7 ms |

## Verified on real data (Sat 10:50)

Szymon's 07:41 push holds raw TCP captures from the real solver (port 12277)
and driver (12276), taken with worn Smartgloves II. The core's reader ran on
the solver capture with no change to code or `config.toml`:

| Fact | Value seen |
| --- | --- |
| `device_type` | `solved_hand` |
| `timestamp_epoch` | `device_boot` (the clock mapper handles it) |
| Hand field | `device_info.hand` = `left` or `right` |
| `device_id` | large unsigned values (1572077328, 2811174587); parity fallback not needed |
| Groups | `joints_local` (428 B), `joints_world` (728 B), `joints_openxr` (728 B), all 83.33 Hz |
| `joints_openxr` streams | 26 x `FLOAT[7] TRANSFORM`, `target_frame` = `xr_palm`, `xr_wrist`, `xr_thumb_metacarpal` ... `xr_little_tip`, `reference_frame` = `xr_base` |
| Mapping | 26/26 by name (the `xr_` prefix is stripped), no enum-order fallback |
| Static data | 52 `TRANSFORM` entries (rest pose) |
| Parse result | 2 definitions, 268 data frames, 0 bad frames; wrist at the origin as SPEC says |
| `python -m core --replay worn_solver.rgmp` | both hands tracked, curl and pinch values live in the debug view |

`[rgmp] hand_from_device_id_parity` is now `false` (Sat 14 Nov,
branch `core-calibration`): the ids above are hardware ids, and the solver
always sends `device_info.hand`. `config.toml` records the verified layout
beside the setting.

### Szymon's glove measurements (two Smartgloves II, Sat 14 Nov)

From `arpan_info.md` section 2, measured on Szymon's side with the live
glove tests and `backend/scripts/glove_check.py`.

| Measure | Value |
| --- | --- |
| Stream rate | 83.39 Hz per group per glove, over USB, zero gaps |
| Device ids | left 1572077328, right 2811174587 |
| Hub | both gloves report the same `HubSerialNumber` |
| Driver | streams only after an RCSP `SubscribeToData`, or with `--auto-stream-usb` |
| Heading reliable | bit 11 of the hub `STATUS_FLAGS` on 12276; not on the solver's 12277 |
| Flexion direction | toward the palm is solver local X, negative |
| Finger isolation | in the worn capture each finger moved on its own in its phase |
| Flat hand, flexion read | index about 37 deg, middle 27, ring 26 to 33, little 59 to 79, thumb about 70 |
| Live tests | 13 of 13 pass with both gloves and the solver running |
| Core on real gloves | works unchanged through route B; the wrist orientation is wrong until the core's `calibrate` runs |
| Solver command | `rkk-hand-solver.exe --no-driver --emit both --emit-openxr --listen 127.0.0.1:12277` |

The flat-hand row is why raw angles from two hands cannot be compared. The
per-wearer calibration on this branch answers it (section "Calibrated
angles" below).

Unverified in the robot output: which rotation direction Unitree's hand
model treats as "flex" for `thumb_0` (abduction) and `thumb_1`; the signs
are set from the URDF limit ranges and can be flipped per joint with
`sign_left` and `sign_right` in `config.toml`. Check in Szymon's renderer.

Still unverified on real gloves: the wrist orientation convention used for
the local frame (fingers along -Z, back of the hand +Y), yaw calibration,
RCSP button and LED, and the scoring thresholds on real fingers. His
`backend/app/services/rig/core_link.py` imports `core.rgmp` and `core.rcsp`
read-only for his glove status screen.

## Learn mode on the real capture (Sat 12:10)

`python -m tools.score_capture backend/tests/fixtures/rgmp/worn_solver.rgmp`
records a lesson from the right glove in Szymon's capture and scores the
left glove against it with the real scorer. Read the numbers with care: the
fixture is trimmed to short slices (126 frames per hand over 25 s), and the
left hand was not copying the right, it was doing its own thing at the same
time. So this is the error between two hands of one wearer, not a learner's
attempt.

| Measure, per-finger absolute angle error, degrees | thumb | index | middle | ring | little |
| --- | --- | --- | --- | --- | --- |
| median | 8 | 14 | 13 | 21 | 11 |
| 90th percentile | 30 | 53 | 47 | 48 | 34 |

| Dead zone `perfect_deg` / `wrong_deg` | mean per-frame overall | frames at or above 0.85 |
| --- | --- | --- |
| 8 / 45 (current) | 0.70 | 13% |
| 12 / 45 | 0.73 | 21% |
| 15 / 60 | 0.79 | 41% |
| 20 / 60 | 0.81 | 49% |
| 25 / 70 | 0.86 | 66% |

What it says about the thresholds:

1. 8 degrees is below the real cross-hand variation (median 12 over all
   fingers, 21 for the ring). Start the glove slot at `perfect_deg = 12` and
   `wrong_deg = 50`; move to 15 / 60 if a learner who copies well still sits
   under 0.85.
2. The ring finger is the noisiest on both hands. Give it weight 0.5 in
   `[record] default_weights` for general lessons, or add a per-finger
   tolerance scale (not built; ten lines in `scorer.py`).
3. `hold_ms = 500` was reachable: every step was "passed" at some point even
   by a hand that was not trying. Keep 500 for the demo, raise to 800 once
   the dead zone is widened.
4. The real test is the one in the checklist: record with the right glove,
   copy with the same glove (self-consistency floor), then with the left
   glove (cross-hand floor). Set `perfect_deg` a little above the self-copy
   median and `wrong_deg` near 1.5 times its 90th percentile.

**Correction (Sat 14 Nov, afternoon).** The capture is Szymon's scripted take. Both
hands did the same eight poses at the same time: flat, fist, open, then
thumb, index, middle, ring and little one at a time
(`backend/tests/test_glove_rgmp_replay.py`). So the left hand did copy the
right. The table above scores the whole left take against each step's key
pose, which mixes all eight poses. Use the time-aligned tables in
"Calibrated angles" below instead.

## Calibrated angles (Sat 14 Nov, branch `core-calibration`)

A flat hand does not read zero, and the offset differs per wearer and per
glove. The core now measures each flexion angle from the wearer's own flat
pose. It then scales the angle by the wearer's own flat-to-fist range.

| Item | What it does |
| --- | --- |
| `core/calibration.py` | Reads the files that Szymon's backend already writes (no second format). `calibrations/<id>.json` holds flat and fist. `glove_calibrations/<id>.json` holds the wearer record. |
| Formula | `calibrated = clip((raw - flat) / (fist - flat), 0, 1) * full`. `full` is 90 deg (thumb 60). So 0 is the wearer's flat and `full` is the wearer's fist. |
| Gain cap | `max_gain = 2.0`: the span is at least `full / 2`. The thumb moves only about 14 deg from flat to fist; without the cap its noise is multiplied by 4. |
| Spread angles | Stay raw. The backend stores no spread range. |
| Where it applies | `Session.update_hand`, glove hands only, before scoring, recording, the robot retarget and the piano task. Fake and camera hands are not changed. |
| Raw angles | Kept in `HandState.angles_raw`. `compat.py` sends them on `/ws/gloves`, so the backend never captures a calibration on calibrated values. |
| Which file | `[calibration] wearer` (or `left_wearer`, `right_wearer`): that wearer's newest record and its range ids. With no name: the newest flat and fist for that side. |
| When it loads | At start, and again on every `calibrate` command. `/health` shows `calibration` per side. |
| CLI | `--wearer NAME`, `--wearer-left`, `--wearer-right`, `--calibration-dir DIR`, `--no-calibration` |
| Tests | `tests/test_calibration.py` (10) and one more in `tests/test_score_capture.py`. Two wearers with different offsets and ranges read the same after calibration. |
| Format check | Files written by `tools/score_capture.py --calibrate capture`, and the test's wearer record, load in the backend's own `Calibration` and `WearerCalibration` models. |

How to run it on the real capture:

```bash
gunzip -c backend/tests/fixtures/rgmp/worn_solver.rgmp.gz > /tmp/worn_solver.rgmp
python -m tools.score_capture /tmp/worn_solver.rgmp --calibrate capture --calibration-out /tmp/cal
```

`--calibrate capture` takes each hand's flat and fist slices from the
capture. It writes them as backend `Calibration` files and reads them back
with `core/calibration.py`. The report then scores only the other six
phases, so the calibration is never scored on its own data.

Flat pose and range in the core's own angles (degrees, mean of the joints of
each finger):

| Hand | Measure | thumb | index | middle | ring | little |
| --- | --- | --- | --- | --- | --- | --- |
| left | flat | 15 | 12 | 9 | 11 | 26 |
| right | flat | 15 | 12 | 9 | 9 | 20 |
| left | flat to fist | 14 | 66 | 75 | 66 | 50 |
| right | flat to fist | 14 | 57 | 70 | 69 | 53 |

These are smaller than Szymon's numbers (index 37, little 59 to 79, thumb
70). His numbers are finger sensor rotations on the driver stream. The core
reads the solver's 26 joints, which start nearer to zero.

Time-aligned error, left against right, same phase, frames paired in order
(degrees, median per phase):

| Phase | Angles | thumb | index | middle | ring | little |
| --- | --- | --- | --- | --- | --- | --- |
| open | raw | 3 | 7 | 6 | 6 | 12 |
| open | calibrated | 4 | 7 | 6 | 5 | 5 |
| thumb | raw | 3 | 5 | 7 | 19 | 12 |
| thumb | calibrated | 0 | 4 | 9 | 24 | 4 |
| index | raw | 7 | 18 | 11 | 21 | 8 |
| index | calibrated | 14 | 14 | 14 | 27 | 1 |
| middle | raw | 6 | 6 | 19 | 6 | 11 |
| middle | calibrated | 11 | 4 | 15 | 10 | 6 |
| ring | raw | 2 | 6 | 4 | 20 | 7 |
| ring | calibrated | 5 | 6 | 8 | 16 | 1 |
| little | raw | 5 | 5 | 9 | 5 | 19 |
| little | calibrated | 12 | 3 | 9 | 9 | 45 |

| All six phases | median | p75 | p90 |
| --- | --- | --- | --- |
| raw | 6.9 | 11.5 | 19.5 |
| calibrated | 6.7 | 13.8 | 15.7 |

Dead zones on the same frames. "Right pose" pairs the same phase (92
frames). "Wrong pose" pairs every other phase (450 frames), which mostly
differs by one finger. Pass is `pass_score = 0.85` on the mean of the five
finger scores.

| `perfect_deg` / `wrong_deg` | Angles | Right pose passes | Wrong pose passes |
| --- | --- | --- | --- |
| 8 / 45 (current) | raw | 98% | 3% |
| 8 / 45 (current) | calibrated | 67% | 0% |
| 12 / 45 | raw | 100% | 7% |
| 12 / 45 | calibrated | 84% | 0% |
| 12 / 50 | calibrated | 84% | 0% |
| 15 / 60 | raw | 100% | 17% |
| 15 / 60 | calibrated | 100% | 3% |
| 20 / 60 | calibrated | 100% | 6% |

What it says:

1. **Start the glove slot at `perfect_deg = 15`, `wrong_deg = 60`** on
   calibrated angles. Every right-pose frame passes, and 3% of wrong-pose
   frames pass. If wrong poses pass in practice, go to 12 / 50 (84% and 0%).
2. Calibrated degrees are larger than raw degrees. Each joint is stretched
   from its own range to 90 (index about 1.5 times). So the dead zone must
   be wider than on raw angles for the same strictness.
3. On this capture both hands belong to one wearer. Raw cross-hand error is
   already small (median 7). So calibration does not lower the median here.
   It does lower the wrong-pose pass rate at each dead zone. Its main value
   is across wearers, which this capture cannot show. The two-wearer test in
   `tests/test_calibration.py` shows it on synthetic hands.
4. The ring finger stays the noisiest (median 16 to 27 in the thumb, index
   and ring phases). It moves with its neighbours. Weight 0.5 for the ring
   in general lessons is still a good idea.
5. Large calibrated errors in the `index` phase (thumb) and the `little`
   phase (little) are real pose differences. One hand curled that finger
   more than the other. The range stretch makes them larger, as it should.
6. 92 right-pose frames is a small sample. Repeat with a real learner
   capture: record with one glove, copy with the same glove, then with the
   other.

`config.toml` `[score]` is still 8 / 45: the fake and the tests use it. To
use the recommendation on real gloves, apply this patch before the slot:

```toml
[score]
perfect_deg = 15
wrong_deg = 60
```

## Written but untested, and why

| Part | Why it is untested | What would test it |
| --- | --- | --- |
| ~~Real RGMP stream names, the `hand` field, `timestamp_epoch`~~ | **Verified offline at 10:50 on Szymon's real Smartgloves II solver capture** (`backend/tests/fixtures/rgmp/worn_solver.rgmp.gz`): see "Verified on real data" below | Nothing left to check here |
| Real RCSP driver: `IsLeft`, `ButtonPushed`, `SetColorLed` over USB | Only a fake server tonight | `python -m core --solver ... --rcsp ...`, press the button, watch `/health` and the event log in `/debug` |
| Live webcam with MediaPipe | No camera was opened overnight; the thread, model load and `detect_for_video` path ran on a video file only, with no hand in it | `python -m core --camera`, hold a bare hand up, watch `/health` `camera.detections` and the debug view |
| Camera hand orientation and mirroring on a real image | Derived from the MediaPipe docs' convention (handedness assumes a mirrored image). Angles are unaffected either way; only the drawn hand side and wrist position could be flipped | If the drawn hand is the wrong side, set `camera.mirror = false` |
| `tools/rgmp_tee.py` | Needs a live socket | Run it against the solver on Saturday morning for the 2-minute capture |
| Yaw calibration on a real glove | The maths is tested on synthetic quaternions; the solver's wrist orientation convention (+Y dorsal, -Z along the bone) is from the docs | `calibrate` with palms down, fingers away; the hands in the debug view should point away from the viewer |
| Mirror and duel modes with two people | Only synthetic hands | Two gloves, roles master and learner, `set_mode mirror` |
| Ghost placement `recorded` and `anchor: camera/held` from markers | No camera anchor was built; wrist position is the `rest_pose` for gloves | Out of scope tonight (SPEC Input B) |
| `calibrate_camera` | Returns error code `device` on purpose | Needs the marker anchor |
| Task `piano` on a real hand | Thresholds (`[piano]` in config.toml) are the SPEC's numbers, tuned on nothing | Tap a table with each finger and watch the `finger_down` events in `/debug`; raise `press_min_deg` if idle fingers trigger, lower `press_velocity_deg_s` if real taps are missed |
| Task `boxing` | Needs the raw accelerometer stream on 12276 | Not started; `frame.task` says `{"implemented": false}` |
| Gemma | Off by design tonight (`session.gemma` is `off`); `CoachClient` is the interface a model client implements | Implement `CoachClient` in a new module; `Coach` falls back to rules when it returns None |
| Lesson keyframes `frames/step_XX.jpg` | No images from glove recordings; `frame` is `null` | Camera-source recordings could save them later |

## What to check first with real gloves

1. Dump the definition. Start the solver with `--emit-openxr`, run
   `python -m core --solver HOST:12277 --no-rcsp --capture logs/first.rgmp`,
   and open `logs/rgmp_definition_*.json`. Check: group name `joints_openxr`,
   stream `target_frame` names against `core/hand.py` `JOINT_NAMES`,
   `data_type` (expected `FLOAT[7]`), where left/right is stated. Fix `[rgmp]`
   in `config.toml` if any differ. The log line `device N is the left hand:
   26/26 joints mapped` is the pass mark. `(by order)` in that line means the
   names were not recognised and enum order was assumed.
2. Watch `/debug`: both hands drawn, `tracked` true, curl values move with
   the fingers, pinch shows when thumb touches a fingertip. If the fingers
   bend the wrong way the wrist frame convention differs; look at
   `wrist_frame_from_joints` and `GloveSource.poll`.
3. `calibrate` (long press or button in `/debug`), then check the hands point
   away from the viewer with palms down.
4. Record a 3-step lesson with the pinch mark, load it, `set_mode learn`, and
   pass a hold step. That is the Saturday 12:00 checkpoint.
5. Tune `[score]` on a real learner: `perfect_deg`, `wrong_deg`, `pass_score`,
   `hold_ms_default`. `logs/attempts.jsonl` collects every attempt.
6. `--rcsp`: button presses and LED colours. If `GetDeviceInfo` has no
   `Smartgloves.IsLeft`, the code falls back to device id parity.
7. Keep a 2-minute capture (`--capture` or `tools/rgmp_tee.py`) so scoring
   can be tuned later with `--replay`.

## Branch and commits

Twenty-one commits of core work on top of `origin/main`
(`git log --oneline origin/main..core-overnight`), pushed to
`origin/core-overnight`, nothing of the teammate's changed. Commit signing was disabled
in this clone only (DECISIONS D12). 88 tests pass (`python -m pytest -q`,
about 28 s). A code review of the branch found 14 defects at 01:50; all 14
are fixed and 7 have regression tests (DECISIONS D23). The branch is based on the old `main` (the "Research" commit);
it merges cleanly in principle because it only adds `core/`, `schema/`,
`tools/`, `tests/`, `lessons/`, `config.toml` and the three markdown files,
none of which exist on the new `main`.

Not done tonight, on purpose: Gemma (rule lines only), the camera wrist
anchor (markers, Record3D), boxing, the piano dataset importer, viewer work.

## Teammate activity (read this first)

`origin/main` moved from the single "Research" commit to ten commits by
Szymon Arciszewski, all stamped Fri 23:34 and fetched here at 01:38. Checked
again at 01:47: nothing newer. Earlier checks at 01:07 and 01:20 saw nothing.
Checked at 01:52: four more commits by Szymon Arciszewski (authored 23:48 to
23:50, pushed just before 01:52), `2c7ff54..072d5a4`:

| Commit | What | Touches |
| --- | --- | --- |
| `9ebf8af` | Score inline attempt frames and apply learner calibration | `backend/app`, `docs/CONTRACT.md` |
| `ad007e4` | Add coach plan, text-to-motion and video-to-lesson endpoints | `backend/app`, `docs/CONTRACT.md` |
| `9437d14` | Pitch, demo runbook, judge Q&A and idea notes | `docs/ideas/` (7 files) |
| `072d5a4` | Score finger error on total flexion to match the live coach | `backend/app`, `backend/tests` |

Contract changes: `POST /score` now takes `attempt_frames` and calibration
ids; new `POST /coach/plan`, `POST /motion/from_text`,
`POST /lessons/generate_from_video`; their scoring metric is the mean error
of each finger's total flexion mapped by `100 * exp(-0.5 * (err / (1.5 *
angle_deg))^2)`. Nothing under `frontend/` changed. No effect on SPEC.md or
on `core/`; `core/compat.py` does not serve the three new endpoints (404)
and `/api/score` still answers 501. Read `docs/ideas/` for their demo
runbook before the morning stand-up.

Checked at 02:34: five more commits by Szymon Arciszewski (authored 00:27 to
00:28), `072d5a4..cfbe9c2`, all in `backend/`, `docs/` and `research/`:

| Commit | What |
| --- | --- |
| `512cb87` | Scoring follows the attempt's side and ignores timing for held poses |
| `5a24f56` | Glove WebSocket teardown with an anyio task group |
| `743f134` | Rokoko Studio UDP mapper rewritten for JSON v3/v4; **new `external` glove source**: `POST /api/ingest/frames` and `WS /ws/ingest` accept HandFrames from "your own pipeline" |
| `2cc3c8a` | Gemini request budget, live hint fields, Flash-Lite hint model |
| `cfbe9c2` | `docs/HARDWARE_INTEGRATION.md`, `research/06..10`: Studio UDP setup, the unverified finger flex axis, the external source |

Why it matters: the external source is the second way to join the two
halves. This core can read the real solver (RGMP) and push each hand into
their backend as a HandFrame; their frontend then needs no change at all.
`tools/ingest_bridge.py` does that, and it is verified: their backend at
`cfbe9c2` was installed in a scratch worktree (`uv sync`) and started on
`:8000`; this core ran `--fake` on `:8765`; the bridge switched their source
to `external` and their `/ws/gloves` re-emitted both hands as `source:
"replay"` at 30 Hz with the right flexion and wrist quaternion, with no
backend errors. Their own Rokoko path is Studio UDP, with a flex axis they
call unverified. Nothing under `frontend/` changed. No contract change for
SPEC.md.

So there are two ways to join the halves in the morning, both tested here:

| Route | Processes | Command |
| --- | --- | --- |
| A. Core serves their contract | this core only | `python -m core --solver HOST:12277 --rcsp HOST:45451 --port 8000`, then their `npm run dev` |
| B. Core feeds their backend | this core, their backend, the bridge | `python -m core --solver ...` on 8765; their `uv run uvicorn app.main:app --port 8000`; `python -m tools.ingest_bridge` |

Route A gives their frontend only the glove stream and lessons; route B
gives their backend everything it already does (its scoring, LLM, storage)
with real-glove input. SPEC.md's `/ws` (ghost, score, coach, session) is
served in both cases on this core's port.

Checked at 03:44: ten more commits by Szymon Arciszewski (authored 00:49 to
01:26), `cfbe9c2..9376632`:

| Area | What landed |
| --- | --- |
| `frontend/src` (128 files) | Rework: shared WebGL preview, learner pipeline (stages, progress, rank), "expert" wording (routes are now `/expert`, `/apprentice`, `/playground`, `/lab`), Gemini UI, playground, design critique fixes |
| `frontend/src/mock` | A mock backend in the browser: `?mock=1`, or automatic when `/api/health` does not answer |
| `frontend/tests`, `frontend/e2e` | vitest suite and Playwright scripts |
| `frontend/src/api/types.ts`, `docs/CONTRACT.md` | `GloveSource` gains `external`; `/score` takes `attempt_frames`, calibration ids, `side`; `ScoreResult.warnings`; video upload client. `/ws/gloves` shape unchanged |
| `backend/app` (5 files) | Gemini 3.5 Flash-Lite for every assistant task; move catalogue and seed lessons tracked |
| root `README.md`, `CLAUDE.md`, `.claude/agent-memory` | Their repo rules: `docs/CONTRACT.md` is the API source of truth; uv only; no em dashes anywhere; commit only when asked, then push; Renaissance theme |

Effect on the core: none on SPEC.md; `core/compat.py` still matches their
`/ws/gloves` and `/api/health` shapes, so route A keeps their mock mode off
(it only switches on when `/api/health` fails). Their `GloveSource` now has
the `external` value route B uses. Their root `CLAUDE.md` says "no em
dashes anywhere" and "uv only": this branch was checked for em dashes and
its virtualenv was made with `uv venv`, so it conforms; its commits were not
pushed because the overnight brief said not to.

Checked at 04:55: eight more commits by Szymon Arciszewski (authored 01:44 to
02:47), `9376632..ad9822d`:

| Area | What landed |
| --- | --- |
| `frontend/src` (77 files) | Learner skill dashboard replaces the library; hands choice, optional props and an assistant switch; codex parchment stage and sketch hand style; `/design` prototype routes |
| `frontend/docs`, tests, e2e | Dashboard screenshots, mock walk extended |
| `backend/app` (6 files), `docs/CONTRACT.md` | New `Hands = Side | 'both'` type; `Recording.hands`; `POST /recordings/start` takes `hands` (default `both`). `/ws/gloves` and `/ws/ingest` unchanged |

Effect on the core: none on SPEC.md. `core/compat.py` ignores the new
`hands` field on `/api/recordings/start` (the core records the master hand
it finds); add it if route A is chosen. Both stream shapes are unchanged, so
routes A and B still hold.

Checked at 10:44: twenty-six more commits by Szymon Arciszewski (authored
05:58 to 08:41), `eb59fd5..3674034`: a skinned WebXR hand model and hand
styles; real Smartgloves II captures as fixtures with an offline replay test
and a guided `backend/scripts/glove_check.py`; opt-in live glove tests
(expect the driver on 12276, RCSP 45451 and the solver on 12277, the same
ports the core uses); a `rig` service with `/api/gloves/*` (status, driver
start and stop, `ReinitAlgo`, per-wearer neutral calibration, drift check)
that imports `core.rgmp` and `core.rcsp`; a gloves screen, calibration area
and demo mode in the frontend; research on an iPhone LiDAR source and a
robot teleoperation pivot. `docs/CONTRACT.md` gained the gloves section.
Nothing of the core's was edited (his rule 9 forbids it).

Checked at 07:05: twelve more commits by Szymon Arciszewski (authored 05:11
to 05:57), `ad9822d..9810bf5`: shadow puppet theatre, learner margin of
error in scoring and hints, a Settings panel, propless skills (shadow
puppets, surgical grips, crochet), keyframes motion and per-hand hold poses,
3D and flat score views. Mostly `frontend/src`; `backend/app` scoring gained
the margin. Stream shapes unchanged.

Merged at 07:10: `origin/main` (`9810bf5`) was merged into `core-overnight`.
Conflicts were only `.gitignore` (now the union) and `README.md` (his, plus
a core section). 88 tests pass after the merge. `SPEC.md` was added to the
repo. The direction agreed on Saturday morning is in `RECONCILE.md`
section 0: route B, one owner per capability, both contracts frozen.

| Area | What landed | Why it matters to the core |
| --- | --- | --- |
| `docs/CONTRACT.md` | A frontend/backend contract: REST under `/api` on port 8000, `/ws/gloves` streaming `GloveFrame {t, source, hands[{side, wrist_quat, wrist_pos, flexion[finger] = [a, b, c] radians, spread}]}`, lessons of steps with "move" catalogue ids and "motion specs", scores 0 to 100 | It is not SPEC.md. No `hello`/`frame`/`session`/`event`/`coach`/`ack`, no ghost, no 26 joints on the wire |
| `backend/` | A full FastAPI app for that contract: simulator source, Rokoko Studio UDP source (port 14043, JSON v3/v4), One Euro smoothing, JSON-file lessons/recordings, scoring, LLM lesson generation (fake/gemini/ollama), MediaPipe route. **The Rokoko Device SDK source is a stub that answers 501** (`backend/app/services/gloves/rokoko_sdk.py`) | Overlaps this `core/` almost entirely, except the one thing it does not do: read the solver's RGMP/RCSP, which `core/rgmp.py` and `core/rcsp.py` do |
| `frontend/` | React + react-three-fiber app: role select, master studio (calibrate, record takes, lesson editor), apprentice training room (ghost, marionette, strings modes), piano and table-tennis tests, dev panel. Vite proxies `/api` and `/ws` to `localhost:8000` | This is the viewer. It consumes `/ws/gloves`, not `/ws` |
| `genui/` | A Gemini "generative UI" prototype with its own renderer | Not related to the core |

What was done about it (DECISIONS D22): nothing of theirs was touched;
`core/compat.py` now serves their `/ws/gloves` and the `/api/*` routes the
core can honour, on the same port as `/ws`. So the committed frontend can run
against this core, with real gloves, by starting the core on their port:

```bash
python -m core --fake --port 8000          # or --solver HOST:12277 --rcsp HOST:45451 --port 8000
cd frontend && npm install && npm run dev  # their app, unchanged, on :5173
```

Tested: `/api/health`, `/api/lessons`, `/api/dev/state`, `/api/coach/hint`,
`/api/recordings/start|stop`, `/api/calibrations`, `/ws/gloves` frames
(flexion in radians, both hands) in `tests/test_compat.py`. Also tested for
real: their frontend at `origin/main` was installed in a scratch worktree
(`npm ci`), started with `npm run dev`, and loaded in headless Chrome with
the core on `:8000` in `--fake` mode. The role page and `/master` rendered
with no console errors, and while `/master` was open the core showed one
`/ws/gloves` client receiving frames. Not checked: whether their 3D hand
follows the stream correctly (SwiftShader headless, no eyes on the motion),
and every other page. Routes that need their lesson generator or motion
synthesiser answer 501.

Decision needed in the morning, between the two of you: either the frontend
moves to SPEC.md's `/ws` (it then gets ghost, score, coach and session for
free and the core does all the maths, as SPEC.md intends), or it stays on
CONTRACT.md and the core keeps serving both. Either way only one process
should own the gloves: their backend cannot read the SDK stream, this core
can.
