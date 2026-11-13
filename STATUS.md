# STATUS.md

Written Sat 14 Nov 2026, about 01:45 Helsinki time, on branch `core-overnight`
(not pushed). Everything below runs with no hardware. Read the three lists in
order: works and is tested; written but untested; what to check first with the
gloves. Then read DECISIONS.md.

## Run it

```bash
cd repo
source .venv/bin/activate              # Python 3.12 virtualenv, already populated
python -m pytest -q                    # 69 tests, about 16 s

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

`config.toml` holds every threshold. `[sources]` picks `glove`, `camera` or
`none` per hand (also at runtime with the `set_sources` command).

## Works and is tested (no hardware)

| Part | What it does | How it is tested |
| --- | --- | --- |
| `schema/` (12 files) | JSON Schema for hello, frame, session, lesson, event, coach, ack, cmd, lesson.json, step summary | Every message the fake server emits is validated at runtime (`/health` shows `validation_errors`); tests validate every message type and the SPEC's own examples |
| `core/hand.py` | 26 OpenXR joints to 18 angles, curl, pinch with hysteresis, mirroring, wrist frame, joint rotations, MediaPipe 21 to 26 conversion | Flat hand gives flexions near 0, fist near 90 (thumb 60); a hand and its mirror give identical angles; angles invariant to rigid motion and scale; pinch on 15 mm off 30 mm; round trips |
| `core/fake.py` | Two synthetic gloves and a synthetic 4-step lesson. The right hand plays a learner that passes a step about every 8 s | Server test waits for a real `step_passed` from the real scorer on fake hands |
| `core/server.py` + `__main__.py` | FastAPI: `/ws`, `/health`, `/lessons`, `/lessons/{id}`, `/lessons/{id}/frames/{name}.jpg`, `/schema/{name}.json`, `/debug`. 30 Hz tick, per-client `subscribe` rate and `rots`, one ack per command | TestClient websocket test: hello, session, lesson, frames, ping ack, bad command ack, bad JSON ack, subscribe with rots, playback switch; also run over a real socket |
| `core/recorder.py` | Lesson folders (`lesson.json` + `trace.npz`), marks, auto step cuts (still 400 ms under 20 deg/s), stillest-300 ms key pose, hold/move kind, static-finger weights, chord step names | Fake master: 4 marked steps all `hold`, key poses match; unmarked 4-pose take auto-cuts into 4 hold steps; a wave gives one `move` step; save/load; schema |
| `core/scorer.py` | Per-frame per-finger error, 8/45 degree map, weighted overall, 150 ms EMA, hints, hold timer, move matching in a 250 ms window with `timing_ms`, mean-pass for move, stuck detection, DTW worst moment, step summaries; mirror scorer | Identical gives 1.0; 45 degree finger gives 0; hint directions; hold passes after `hold_ms`; move step passes when followed and reports about -100 ms when 100 ms early; fails when wrong; summary validates |
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

Throughput: tick 33.3 ms median with a client connected, no late ticks
(see DECISIONS D20 for the one exception). A tick costs about 3 ms, of which
schema validation is 1.5 ms.

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
| Tasks `piano` and `boxing` | Screens can be selected; `frame.task` says `{"implemented": false}` | Not started |
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

Seven commits on `core-overnight`, nothing pushed, nothing under `viewer/`
touched. Commit signing was disabled in this clone only (DECISIONS D12).

## Teammate activity

Checked `origin` at 01:07 (clone), 01:20 and 01:28: `origin/main` is still
the single "Research" commit. No new branches. Nothing to merge.
