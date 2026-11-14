# Glove slot kit

One command walks you through the next glove slot. It runs each check and logs every result.

Terms:

- **Slot**: a time window with the Rokoko gloves on this Mac.
- **Stack**: the processes that `scripts/live.sh` starts (driver, solver, core, bridge, backend, frontend).
- **Core**: our glove engine, `python -m core`.
- **Dry run**: the same walk with fakes only. No gloves and no phone.

## 1. Run it

From the repo root, with the venv active:

```bash
scripts/slot/run.sh                 # the real slot
scripts/slot/run.sh --dry-run       # fakes only; must end with "DRY RUN PASSED"
scripts/slot/run.sh --only 2,3      # only these steps (step 0 always runs)
scripts/slot/run.sh --from 5        # start at step 5
scripts/slot/run.sh --help          # every option
```

Before the real slot:

1. Quit the Rokoko desktop app and Rokoko Studio (docs/GLOVE-SLOT.md, step 0).
2. Plug in both gloves by USB.
3. Edit `scripts/slot/lessons.txt`: one demo lesson title on each line.
4. For the phone over the cable, run `ios/mac/forward.sh` in a second terminal.

Step 0 checks the stack. If the stack is down, the script offers to run `scripts/live.sh arpan`.

## 2. What each step does

At each step the script tells you what to do. It waits for Enter and runs the check. It shows the result. Then you answer pass, fail, skip or retry.

| Step | What you do | What the script runs | Pass mark |
| --- | --- | --- | --- |
| 0. Stack | Nothing | `GET :8765/health`, `GET :8000/api/health`; offers `scripts/live.sh` | Both gloves tracked |
| 1. Depth clip | Gloved hand on the table for 20 s, then an empty table for 20 s | `python -m ios.mac.record logs/slot/<time>/depth_clip.gdrec.gz --seconds 40`, then `python -m ios.mac.replay ... --info`, then the depth check | 20 fps or more, gaps under 5% |
| 2. Right thumb | Right hand flat, then a fist with the thumb folded across, then both hands flat | `POST /api/calibrations` flat and fist, `POST /api/gloves/calibrations/neutral`, `.../finish`, core `calibrate` | Thumb range 8 degrees or more |
| 3. Left glove | Reseat the left glove; same poses with the left hand | The same calls for the left side | Thumb 8 degrees or more; other fingers 25 degrees or more |
| 4. Button, LED, mirror, duel | Single press, then double press, on each glove; look at the LED; copy the left hand with the right; duel | Core `set_mode`, `set_roles`, `lesson_load`; waits for `button`, `recording_started`, `recording_stopped`, `round_won` | Both presses seen on both gloves; LED red then blue; mirror scored on 90% of frames |
| 5. Yaw | Both hands flat, fingers away; then turn both hands a quarter turn left | Core `calibrate`; palm heading from the frame joints | Heading within 20 degrees of away; the turn within 30 degrees of 90 |
| 6. Piano | Tap each named finger twice; then keep still | Core `set_task piano`; counts `finger_down` per cue | 4 of 5 fingers seen; 2 or fewer taps while still |
| 7. Robot flex | Both hands flat, then both fists; watch the twin at `localhost:5173/robot` | Core `set_robot_source master` and `learner`; reads `/ws/robot` | Each joint moves to its flex limit, and you see the twin curl into the palm |
| 8. Demo lessons | For each lesson, three takes. The script calls each phase: POSE 3 s, FREEZE 2 s, MOVE 4 s | Core `set_mode record`, `record_start`, `record_mark` after FREEZE, `record_stop`, `GET /lessons/{id}` | Every take saved as a hold step, then a move step |
| 9. Fingerspelling letters into a pack | Type your name and the reference (default: the pack's official chart, for Finnish the Suvi alphabet page). For each letter not recorded yet, find it on the chart, then hold it with the right hand: 3 s to get into it, then a still hold | Core `record_start` (title "Sormiaakkoset: Ä"), `record_stop`, `GET /lessons/{id}`; the longest hold step's angles give the curls (`core.hand.curl_from_angles`) | Every letter stored in `backend/app/data/fingerspelling_packs.json` and its frontend copy with `recorded_by`, `reference`, `recorded_at`, `lesson_id` and `pose`. Commit both files. Options: `--pack fi`, `--pack-letters S,U,Ä`, `--recorded-by NAME`, `--reference URL`. The dry run writes a copy in its run folder and deletes the fake takes; the repo pack stays unchanged |

The thresholds are at the top of `scripts/slot/slot_steps.py`. Each has the measurement it comes from.

## 3. The depth check

Step 1 runs `python -m tools.depth_check {file}` after the recording. The lidar lane builds that tool. If the module is not on the branch, the step skips the check and logs the command to run later. Change the command with `--depth-check "..."` or `SLOT_DEPTH_CHECK`. The text `{file}` becomes the clip path.

The phone address comes from `--depth-host`. With no option, the script uses `127.0.0.1` when `ios/mac/forward.sh` runs. Otherwise it uses `config.toml` `[camera.geppetto_depth]`.

## 4. The logs

Each run writes to `logs/slot/<date-time>/` (a dry run adds `-dry`). Git ignores this folder.

| File | Contents |
| --- | --- |
| `results.jsonl` | One line per attempt: step, verdict, your answer, details, and every command with its output |
| `summary.md` | A table of the last attempt of each step, plus the fixes to try |
| `run.json` | Options, wearer, start time |
| `depth_clip.gdrec.gz` | The depth clip from step 1 |
| `depth_check.txt` | The output of the depth check, when it ran |
| `*.log`, `leds.jsonl`, `backend-data/` | Dry run only: one log per fake process, the LED colours, the scratch backend data |

Verdicts (the script's view):

| Verdict | Meaning |
| --- | --- |
| ok | The numbers say it works |
| look | It ran. A person must look (an LED, the robot twin), or the data is fake |
| bad | It ran, and the numbers say it does not work |
| error | It could not run (a process is down, a timeout, a tool is missing) |
| skip | Nothing to run |

## 5. The dry run

The dry run starts these on free ports, with logs in the run folder:

| Process | Command |
| --- | --- |
| core | `python -m core --fake --wearer W --calibration-dir <run>/backend-data` |
| backend | `uv run uvicorn app.main:app` with `GLOVE_SOURCE=external`, `DATA_DIR=<run>/backend-data`, `LLM_PROVIDER=fake` |
| bridge | `python -m tools.ingest_bridge` from the core to that backend |
| fake phone | `python -m ios.mac.fake_sender` |
| step 4 only | `python -m tools.fake_rgmp_server`, `python -m tools.fake_rcsp_server`, and a second core with `--solver` and `--rcsp` |

The fake core ignores the RCSP options. So step 4 uses a second core that is not fake. The fake RCSP driver logs each LED colour, and the script presses the buttons through its control port.

The answers follow the verdicts (ok and look give pass). Fake hands ignore the prompts. So quality checks on fake hands give "look", not "bad". The fakes can still show some faults: a missed button press, a wrong LED colour, mirror with no score. Those give "bad". The dry run passes when every step runs and none gives "error" or "bad". At the end it deletes the lessons it recorded and stops every process.

Step 8 times each take, so the gloved hands stay free. Press Enter with the left hand to start a take. Change the times with `--pose-seconds`, `--freeze-seconds` and `--move-seconds`.

## 6. Known core behaviour found by the dry run

With no master role set, a single press on either glove button records the first tracked hand, which is the left one. So a press on the right button can turn the LEFT LED red. Step 4 sets the pressed glove as master first. For the demo, set the roles before anyone presses a button.
