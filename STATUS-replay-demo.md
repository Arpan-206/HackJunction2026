# STATUS-replay-demo.md

Lane "replay-demo", branch `replay-demo`, Sat 14 Nov 2026, evening. No gloves were used. Everything ran from the Saturday captures, read in place. No capture was copied, moved or deleted.

Words used in this note:

- **Capture seconds**: time from the first data frame of the first glove in a capture file. The replay, the inventory and the lessons all use this clock.
- **Still stretch**: every finger flexion angle moves slower than 20 deg/s (the recorder's own threshold) for 2 s or more.
- **Score**: the core's live score, 0 to 100, from the session's own `StepScorer`.

## 1. What works and how to run it

| Part | Command | Tested how |
| --- | --- | --- |
| Full stack on a capture | `scripts/replay_demo.sh logs/live/20261114-131952 --start 1500 --seconds 60` | Came up in 7 s on ports 9765, 9000, 5973. Ctrl-C in a real terminal stopped all four parts in 1 s; ports came free; exit code 130 |
| Whole hour, looping | `scripts/replay_demo.sh logs/live/20261114-131952` | Streams the 1.2 GB file from disk each pass. Start-up tested; a full one-hour loop was not watched |
| REPLAY mark | automatic while the core runs `--replay` | `frontend/e2e/replay-walk.mjs`: 10 screens pass; 6 vitest cases |
| Capture survey | `python -m tools.capture_inventory CAPTURE --cache inv.npz --json inv.json --md stretches.md --wall-start 13:19:53` | Whole hour parsed; 13 pytest cases for the lane |
| Lessons and scores | `python -m tools.replay_lessons CAPTURE --cache inv.npz --cal-dir <main checkout>/backend/data --lessons-dir lessons` | 10 lessons cut and scored (section 5) |
| One lesson | `python -m tools.cut_lesson CAPTURE --side right --start S --seconds D --name NAME [--learner-start S2 --learner-seconds D2]` | Used by the batch above |

Suites at the last commit: core 187 passed plus the lane's 13; frontend lint clean, 322 tests, build passes.

### scripts/replay_demo.sh

```
scripts/replay_demo.sh CAPTURE [--start S] [--seconds D] [--speed X] [--wearer NAME | --no-calibration] [--no-web]
```

- CAPTURE is a solver capture (`solver_12277.rgmp`) or its run folder. The driver capture is refused: it holds raw sensors, not solved hands.
- It starts the core with `--replay`, then the ingest bridge, the backend (`GLOVE_SOURCE=external`) and the frontend.
- The default wearer is "arpan", who wore the gloves. Set `GEPPETTO_CAL_DIR` to the backend data dir that holds the calibrations (in a worktree: the main checkout's `backend/data`).
- Ports: `GEPPETTO_CORE_PORT` (8765), `GEPPETTO_BACKEND_PORT` (8000), `GEPPETTO_FRONTEND_PORT` (5173). The frontend gets `VITE_CORE_WS` and `VITE_ROBOT_WS` for the core port.
- Logs go to `logs/replay/<time>/`; `logs/replay/current` points at the newest run. From another terminal: `scripts/stop.sh logs/replay/current`.
- Looping is seamless. `--replay-continuous` shifts each pass's timestamps, so the core never sees its clock jump back.
- With no Rokoko driver, the first app page of a tab opens `/gloves` once. Click "Continue without the gloves". `/demo` and the kiosk skip that check.

New core flags (additive, `--replay` path only, defaults unchanged): `--replay-start`, `--replay-seconds`, `--replay-speed`, `--replay-stream`, `--replay-continuous`. `tools/replay.py` has the same options. Its capture clock re-bases a glove that reconnects with a fresh boot clock. The right glove did that at 13:23:37.

## 2. REPLAY mark

- Source: the core's own `/ws/gloves` (`core/compat.py glove_frame`). It sends `source: "replay"` on every frame while the core runs `--replay`. This channel already existed; SPEC.md, CONTRACT.md and the schemas are unchanged.
- The backend's `/ws/gloves` is not used for this. It says "replay" for every bridged frame, live gloves too.
- Where: `frontend/src/features/shared/replay/`, mounted in `main.tsx` beside the routes. It is outside the shell, the kiosk switch and the dev panel, so every screen gets it.
- Look: a walnut plate in the top right corner, "REPLAY" at 34 px and "Recorded gloves, not live hands" at 18 px. It sits above dialogs and the dev panel and takes no clicks. No gold, no vermilion, no pill.
- Nothing can hide it: no prop, setting, kiosk flag or dev flag reads it. A test checks the source for that.
- To keep machines with no core free of socket errors, the watcher opens the core socket only when the core can feed the page. That is when the backend reports `glove_source: "external"`, on `/demo` and in the kiosk, and on `/robot` and `/typing` outside mock mode. `?nocore=1` skips it unless the backend is bridged.

Walk result (`REPLAY_BASE=http://localhost:5973 node e2e/replay-walk.mjs`, screenshots `frontend/docs/screens/replay-*.png`):

| Screen | Mark seen | Size (px) | Note text (px) |
| --- | --- | --- | --- |
| /demo | yes | 261 x 79 | 18 |
| /demo kiosk (1920 x 1080) | yes | 261 x 79 | 18 |
| /robot (recorded hand drives the Dex3-1 twin) | yes | 261 x 79 | 18 |
| Training room, table tennis step 1 | yes | 261 x 79 | 18 |
| /gloves, and the gloves check on first open | yes | 261 x 79 | 18 |
| /lab | yes | 261 x 79 | 18 |
| /expert/scratch | yes | 261 x 79 | 18 |
| /apprentice with the dev panel on | yes | 261 x 79 | 18 |
| /apprentice with Settings open | yes | 261 x 79 | 18 |
| Phone width (390 x 844) | yes | 261 x 79 | 18 |

## 3. Capture inventory

### 3.1 Files under logs/live/

| Run | File | Size | Duration | Hands | Content |
| --- | --- | --- | --- | --- | --- |
| 20261114-131811 | (no capture) | 0 | 0 s | none | Failed start: the driver could not bind its UDP port (Rokoko app open) |
| 20261114-131859 | (no capture) | 0 | 0 s | none | Failed start, same error |
| 20261114-131952 | solver_12277.rgmp | 1.17 GB | 3690 s (13:19:53 to 14:21:33) | right from 0 s; left from 219 s | 1 791 323 messages; solved hands, 3 groups per glove at 83.3 Hz; the right glove reconnected once at 13:23:37 |
| 20261114-131952 | driver_12276.rgmp | 406 MB | 3690 s | both | 1 194 204 messages; raw sensor transforms and angular speeds, not solved hands; not playable through the core |
| 20261114-131952 | keys.jsonl, keys2.jsonl | small | 34 s and 52 s | n/a | Typing keystrokes, 60 and 267 keys |

Devices: right 291175775, left 3552246405.

### 3.2 Activity over the hour (solver capture)

Clock times are "about": after 13:23:37 they run up to 6 s early, because the reconnect gap is removed. Still share and median finger speed come from 20 Hz samples.

| Clock | Capture s | Left still % | Right still % | Right median speed (deg/s) | Activity, from the logs |
| --- | --- | --- | --- | --- | --- |
| 13:19 to 13:24 | 0 to 300 | 73 (from 219 s) | 48 | 24 | Right glove alone, 33 s flat rest at the start; reconnect at 13:23:31 |
| 13:24 to 13:29 | 300 to 600 | 68 | 55 | 19 | Expert screen takes 13:26:50 and 13:30:26; yaw calibration 13:28:24 to 13:29:57 |
| 13:29 to 13:34 | 600 to 900 | 78 | 61 | 17 | Flat and fist calibrations 13:31:59, 13:32:17, 13:34:24 (the one in use); 4 scored takes 13:34:15 to 13:34:49 |
| 13:34 to 13:39 | 900 to 1200 | 83 | 61 | 17 | Neutral pose 13:35:12; learn "Glove slot checkpoint" 13:35:58 to 13:38:39 (stuck on step 2) |
| 13:39 to 13:44 | 1200 to 1500 | 76 | 66 | 13 | Right calibration again 13:39:06; 6 expert takes 13:36:57 to 13:41:13 |
| 13:44 to 13:49 | 1500 to 1800 | 88 | 79 | 6 | Stillest block; right calibration again 13:46:28; three-take expert lesson 13:46:53 to 13:50:48 |
| 13:49 to 13:54 | 1800 to 2100 | 75 | 67 | 10 | Typing run 1, 13:51:43 to 13:52:17; "Held fist check" recorded 13:51:47; its learn run 13:53:31 to 13:55:38 |
| 13:54 to 13:59 | 2100 to 2400 | 67 | 58 | 16 | Mixed movement, no log entries |
| 13:59 to 14:04 | 2400 to 2700 | 69 | 64 | 16 | Mixed movement, no log entries |
| 14:04 to 14:09 | 2700 to 3000 | 69 | 68 | 13 | Flat and fist calibrations 14:04:50 to 14:05:09; right thumb bent hold 14:09:27 to 14:09:37 |
| 14:09 to 14:14 | 3000 to 3300 | 77 | 73 | 9 | Both hands resting half curled, 94 to 99 % still at 14:09 |
| 14:14 to 14:19 | 3300 to 3600 | 56 | 57 | 19 | Most movement of the hour (14:15); typing run 2, 14:18:11 to 14:19:03 |
| 14:19 to 14:21 | 3600 to 3690 | 63 | 77 | 6 | Right flat rest 28 s, then both gloves disconnect at 14:21:33 |

### 3.3 Still stretches of 2 s or more

553 stretches in all. The full list (start, length, hand, pose words, flexion per finger) is in `docs/replay-demo/still-stretches.md`; the raw data is in `docs/replay-demo/inventory.json`.

| Hand | Stretches | Still time (s) | 2 to 5 s | 5 to 10 s | 10 to 30 s | 30 s or more |
| --- | --- | --- | --- | --- | --- | --- |
| left | 274 | 1985 | 152 | 71 | 45 | 6 |
| right | 279 | 1472 | 184 | 69 | 24 | 2 |

The 14 longest. Flexion is the mean raw angle per finger in degrees. A flat hand reads 15 to 40 on these gloves, so the pose words are coarse.

| Hand | Start (s) | Clock, about | Length (s) | Pose (raw curls) | Thumb | Index | Middle | Ring | Little |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| left | 1790.8 | 13:49:44 | 57.6 | flat hand, thumb open | 18 | 19 | 18 | 15 | 19 |
| left | 1202.7 | 13:39:56 | 56.0 | flat hand, thumb half | 35 | 28 | 32 | 29 | 27 |
| left | 3019.7 | 14:10:13 | 53.0 | half curl, thumb closed | 49 | 46 | 59 | 57 | 51 |
| right | 2985.7 | 14:09:39 | 40.2 | little out, rest half, thumb half | 36 | 44 | 53 | 50 | 39 |
| left | 853.4 | 13:34:06 | 33.3 | ring+little out, rest half, thumb closed | 45 | 41 | 41 | 34 | 33 |
| left | 1167.7 | 13:39:21 | 33.3 | flat hand, thumb half | 32 | 29 | 31 | 24 | 35 |
| right | 0.2 | 13:19:53 | 32.8 | flat hand, thumb half | 33 | 12 | 14 | 6 | 20 |
| left | 1736.9 | 13:48:50 | 32.3 | index+ring+little out, rest half, thumb open | 26 | 36 | 44 | 37 | 35 |
| left | 1537.8 | 13:45:31 | 29.1 | index out, rest half, thumb half | 41 | 34 | 44 | 43 | 43 |
| left | 1707.0 | 13:48:20 | 28.6 | little out, rest half, thumb half | 29 | 53 | 61 | 46 | 40 |
| right | 3544.1 | 14:18:57 | 27.9 | flat hand, thumb half | 29 | 38 | 39 | 39 | 30 |
| left | 2992.7 | 14:09:46 | 26.1 | half curl, thumb closed | 49 | 46 | 58 | 55 | 52 |
| left | 954.3 | 13:35:47 | 25.3 | ring+little out, rest half, thumb half | 44 | 41 | 44 | 37 | 29 |
| right | 1666.5 | 13:47:39 | 24.9 | flat hand, thumb open | 21 | 20 | 17 | 14 | 20 |

Good windows for `replay_demo.sh`: `--start 1500 --seconds 60` (calm, both hands), `--start 2960 --seconds 40` (the right thumb hold, then a long rest), `--start 3300 --seconds 60` (the most movement).

## 4. Held-pose lessons

Method:

- Per hand, the longest still stretches of distinct poses became lessons, 5 per hand. Distinct means the pose differs by 12 deg or more (mean over 14 flexion slots, raw).
- Each lesson is up to 8 s from inside the stretch, cut by the core's `Recorder` into one hold step (hold 500 ms). Hands are calibrated with the wearer's saved records first, as the live core does.
- The "same-pose take" is the closest stretch of the same hand at least 60 s away. The "wrong-pose take" is the farthest.
- Scoring is learn mode: `StepScorer`, step weights times the learner calibration's finger mask, tolerances 15 / 60 deg, pass score 0.85.
- The lessons are in `lessons/replay-*/` (lesson.json, trace.npz, the step sketch).

| Lesson | Hand | Expert window (s) | Same-pose take (s) | Pose gap (deg) | Same take: score, passed at | Wrong-pose take (s) | Pose gap (deg) | Wrong take: score, passed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| replay-right-little-out-rest-half-thumb-half-2985 | right | 2985.9 + 8.0 | 3090.5 + 6.0 | 2.0 | 100, 0.5 s | 1139.6 + 4.5 | 31.8 | 89, yes |
| replay-right-flat-hand-thumb-open-1666 | right | 1666.7 + 8.0 | 1605.3 + 4.5 | 3.4 | 100, 0.5 s | 857.4 + 3.7 | 51.1 | 23, no |
| replay-right-middle-ring-little-out-rest-half-thumb-open-1244 | right | 1244.5 + 8.0 | 2413.4 + 5.4 | 3.1 | 100, 0.5 s | 420.8 + 3.8 | 37.3 | 32, no |
| replay-right-half-curl-thumb-open-3189 | right | 3189.8 + 7.1 | 1523.2 + 4.2 | 5.2 | 100, 0.5 s | 1139.6 + 4.5 | 37.5 | 74, no |
| replay-right-index-out-ring-in-thumb-open-1638 | right | 1638.8 + 7.1 | 1798.8 + 4.3 | 1.8 | 100, 0.5 s | 1139.6 + 4.5 | 42.1 | 63, no |
| replay-left-flat-hand-thumb-open-1790 | left | 1791.1 + 8.0 | 2710.9 + 6.0 | 5.5 | 100, 0.5 s | 2702.8 + 3.1 | 55.8 | 14, no |
| replay-left-flat-hand-thumb-half-1202 | left | 1202.9 + 8.0 | 475.2 + 6.0 | 2.2 | 100, 0.5 s | 2702.8 + 3.1 | 43.4 | 21, no |
| replay-left-half-curl-thumb-closed-3019 | left | 3020.0 + 8.0 | 3087.0 + 6.0 | 1.9 | 100, 0.5 s | 366.8 + 3.0 | 40.7 | 40, no |
| replay-left-index-ring-little-out-rest-half-thumb-open-1736 | left | 1737.1 + 8.0 | 3562.0 + 6.0 | 4.1 | 100, 0.5 s | 2702.8 + 3.1 | 37.0 | 41, no |
| replay-left-half-curl-thumb-half-556 | left | 557.0 + 8.0 | 1858.8 + 6.0 | 5.7 | 99, 0.5 s | 366.8 + 3.0 | 38.3 | 68, no |

| Result | Count |
| --- | --- |
| Same-pose takes that passed | 10 of 10 (score 99 to 100) |
| Wrong-pose takes that failed | 9 of 10 (score 14 to 74) |
| Wrong-pose take that passed | 1: lesson 2985, score 89 |

The one false pass: index and middle were 24 to 26 deg off, ring and little within 15. With the 15 / 60 dead zone a finger 25 deg off still scores about 0.78. Two fingers off and two exact average above 0.85. This is a threshold question, not a sensing one.

## 5. Thumb-folded pose and the right thumb calibration

Answer: **yes, with a caveat.** One still stretch has the right thumb clearly bent while the fingers stay open.

| Item | Value |
| --- | --- |
| Window | capture 2969.0 to 2978.5 s (about 14:09:27), 285 frames at 30 Hz |
| Thumb MCP / IP, flat calibration | 50.9 / 14.9 deg |
| Thumb MCP / IP, fist calibration | 27.7 / 10.9 deg (lower than flat, so the thumb was unusable) |
| Thumb MCP / IP, this hold | 62.0 / 36.3 deg; CMC stand-in 52.5 deg |
| Fingers during the hold | index 38, middle 40, ring 34, little 27 deg (open, not a fist) |
| Thumb range after | 16.2 deg mean, both thumb joints usable; 14 of 14 joints usable (was 12) |

Caveat: this is the most bent still thumb of the hour, but it is a modest bend. A full fold across the palm usually flexes the IP joint more. The angles alone cannot prove that the wearer folded the thumb across the palm.

The record is written offline as a copy in the backend's own format, under `docs/replay-demo/cal-thumb/`: `calibrations/c8713cacaff6-thumb.json` (flat and fist copied, plus the `thumb` triple), `calibrations/50462cbe80bd.json` (left, unchanged), `glove_calibrations/a907152ed526-thumb.json` (links them). Today's files in `backend/data/` were only read.

Before and after, right hand. Raw = no calibration; before = saved calibration; after = saved calibration plus the thumb phase. The calibration window is excluded from every lesson and take.

| Lesson | Same take raw | Same take before | Same take after | Wrong take raw | Wrong take before | Wrong take after | Wrong take passes (before, after) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| replay-right-little-out-rest-half-thumb-half-2985 | 100.0 | 100.0 | 100.0 | 71.5 | 88.9 | 91.1 | yes, yes |
| replay-right-flat-hand-thumb-open-1666 | 100.0 | 100.0 | 100.0 | 42.4 | 23.3 | 38.6 | no, no |
| replay-right-middle-ring-little-out-rest-half-thumb-open-1244 | 100.0 | 100.0 | 100.0 | 47.6 | 32.4 | 45.7 | no, no |
| replay-right-half-curl-thumb-open-3189 | 100.0 | 99.9 | 99.9 | 65.7 | 73.8 | 77.6 | no, no |
| replay-right-index-out-ring-in-thumb-open-1638 | 100.0 | 100.0 | 100.0 | 56.1 | 63.3 | 70.6 | no, no |

Reading: the thumb phase changes no pass or fail. Same-pose scores stay at 100. Wrong-pose scores rise by 2 to 15 points, because the thumb now counts and it barely moves between these poses. So the new thumb range makes the thumb visible to the scorer, but it does not help these lessons. It would help a lesson where the thumb itself is the point (a pinch or a thumb tuck). Left-hand scores do not change; the left record is copied as it is.

## 6. Tested on fakes only, and untested

| Item | State |
| --- | --- |
| Everything above | Real captures, no gloves. Nothing ran against live hardware |
| A full one-hour loop of `--replay-stream` | Not watched to the end |
| `/demo` visitor flow on a replayed hand (calibrate, lesson, score) | Screens load with the mark; the full visitor flow was not walked on replay |
| Lessons in the main checkout's core | Not loaded there; cut into this worktree's `lessons/` |
| Ctrl-C | Tested through a pseudo-terminal; in the harness's background shell SIGINT is ignored, so use `scripts/stop.sh logs/replay/current` there |

## 7. What a human must do next

1. To demo on replay from the main checkout after merge: `GEPPETTO_CAL_DIR=backend/data scripts/replay_demo.sh logs/live/20261114-131952 --start 1500 --seconds 60`.
2. To give the main core the lessons: copy `lessons/replay-*` from this branch into the main checkout's `lessons/`, or rerun `python -m tools.replay_lessons ... --lessons-dir <main>/lessons`.
3. To use the thumb calibration live: decide first (section 5 says it does not help these lessons). If yes, copy the three files in `docs/replay-demo/cal-thumb/` into `backend/data/`. The newest wearer record wins, so `a907152ed526-thumb` would replace today's for "arpan".
4. Decide the threshold for the false pass in section 4.
5. Merge the branch. It touches `core/__main__.py` (flags only) and `tools/replay.py` (additive), as the brief allows.

## 8. Patches for files outside the lane (not applied)

a. `core/server.py`, line 492: say on `/health` that the core plays a recording. Additive; the REPLAY mark does not need it.

```diff
             "fake": self.fake,
+            "replay": getattr(self, "replay_server", None) is not None,
```

b. `frontend/src/features/shared/gloves/logic.ts` `gloveLine`: on replay the rail reads "Gloves off" because no driver runs. Suggest "Replay" when the backend source is `external` and the REPLAY mark is on. It is cosmetic; the mark already says it.

c. `core/recorder.py` `angular_speed`: the auto cut splits one held pose into several hold steps on 30 Hz sample noise (the max over all 18 slots, including spreads). `tools/cut_lesson.py` works around it for one window. A live recording of a long hold may show the same split. Suggest the flexion slots only, or a wider smoothing window.

Lessons note: `.gitignore` excludes `lessons/*/trace.npz`. The ten replay lessons are committed with `git add -f` on request of the lane lead, so the demo has them without a rerun.
