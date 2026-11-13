# STATUS.md

Written Sat 14 Nov 2026, 01:52 Helsinki time, on branch `core-overnight`
(not pushed). Everything below runs with no hardware. Read the three lists in
order: works and is tested; written but untested; what to check first with the
gloves. Then read DECISIONS.md.

## Run it

```bash
cd repo
source .venv/bin/activate              # Python 3.12 virtualenv, already populated
python -m pytest -q                    # 88 tests, about 28 s

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
| `core/tasks/piano.py` | Key press per finger (knuckle flexion faster than 250 deg/s ending 12 deg past rest, release within 6), `finger_down` events, note verdicts `good` (120 ms), `early`/`late` (300 ms), `wrong_finger`, `miss`, piece scheduling at `tempo_bpm`, `frame.task` with `beat`, `next`, `down`, `last` | Synthetic flexion curves: a fast rise is a press, a slow rise and a small twitch are not; a 4-note piece gets good, late, wrong_finger and miss; a session with `set_task piano` emits `finger_down` and `note` events that validate |
| `core/coach.py` | `CoachClient` protocol; `RuleCoach` with the SPEC rule table; rate limiter (one tip per hand per 4 s, newest summary replaces a queued one); keyword `describe_task` | Rule lines, rate limit, message schema |
| `core/session.py` | Modes idle/record/learn/mirror/duel/playback, roles, sources, step state machine, ghost (mirrored onto the opposite hand, glued to the learner wrist), glove button mapping, thumb-to-little pinch control, all 21 commands with error codes, attempt log | Learn: wrong pose gives stuck + tip, right pose passes and advances; ghost mirrored for the opposite hand; record start/mark/stop makes a loadable lesson that then passes in learn; discard; button and pinch controls; mirror, duel, playback; camera tolerances; chords task state |
| `core/rgmp.py` | Definition-driven RGMP parser (offsets from the definition, any data_type), joint mapping from config with aliases and an enum-order fallback, hand detection, newest frame per device, clock mapping (min arrival minus timestamp over 5 s), 250 ms silence, disconnect, yaw calibration, raw capture to file | Both guessed layouts (one FLOAT[7] TRANSFORM per joint, and split FLOAT[3]+FLOAT[4]); resync after garbage; split TCP chunks; live run against `tools/fake_rgmp_server.py` on a socket; capture file replayed with `tools/replay.py` into a second reader; silence; calibration zeroes yaw |
| `core/rcsp.py` | RCSP header + JSON client with TrackId futures, events between command and reply, `GloveControl`: ListDevices, GetDeviceInfo IsLeft, DeviceSubscribe, Subscribe, LED colours per SPEC, button to session | Against a fake RCSP server in the test: devices found, button routed to the right hand, LED blue on idle, green flash on `step_passed`, error reply raises |
| `tools/fake_rgmp_server.py` | Fake `rkk-hand-solver`: two `solved_hand` devices, `joints_openxr`, static rest pose, STATUS_FLAGS, switchable layout and hand field | Used by the tests above and by an end-to-end run: core connected, recorded a 2-step lesson from the stream, learn mode scored it |
| `tools/replay.py` | Serves a raw capture on TCP, paced by `timestamp_us`, optional loop and speed | Capture of 120 frames replays into the reader, 26 joints per frame |
| `tools/rgmp_tee.py` | Records a live solver socket to a raw capture, optionally re-serves it | Not run (needs a live socket); it is 60 lines of plain asyncio |
| `tools/ws_log.py` | Records the viewer socket to JSONL; replays it as a fake core that acks every command | Recorded 57 messages from `--fake` and replayed them to a client with an ack |
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

## Written but untested, and why

| Part | Why it is untested | What would test it |
| --- | --- | --- |
| Real RGMP stream names, the `hand` field, `timestamp_epoch` | Rokoko's docs do not list them; both guesses are implemented and configurable in `[rgmp]` | Connect once; the definition is written to `logs/rgmp_definition_<id>.json`; compare with the `[rgmp]` keys |
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

Fifteen commits on `core-overnight` (`git log --oneline main..core-overnight`),
nothing pushed, nothing of the teammate's touched. Commit signing was disabled
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
