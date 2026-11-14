# STATUS-core.md: lane "core"

Branch `core-calibration`, from `origin/main` at `1e9b2c4`. Written Sat 14 Nov 2026.
Full numbers and reasons are in STATUS.md, section "Calibrated angles".

## What works, and how to run it

| Task | Result | Where |
| --- | --- | --- |
| 1. Device id parity | `hand_from_device_id_parity = false`. Comments record the verified solver layout. | `config.toml` `[rgmp]` |
| 1. Glove measurements | Szymon's numbers are in a table. | STATUS.md, "Szymon's glove measurements" |
| 2. Calibration | Each glove angle is measured from the wearer's flat pose and scaled by the wearer's flat-to-fist range. Scoring, recording, the robot retarget and the piano task use the calibrated angles. | `core/calibration.py`, `core/session.py`, `[calibration]` in `config.toml` |
| 2. Reuse of Szymon's files | The core reads the backend's `calibrations/` and `glove_calibrations/` JSON files. It writes nothing. Both shapes were checked against the backend's pydantic models. | `backend/data` by default |
| 3. Real capture rerun | New error tables, raw and calibrated, on six held-out phases. Threshold advice below. | `tools/score_capture.py --calibrate capture` |
| Tests | 109 pass (`python -m pytest -q`, about 33 s). 11 are new. | `tests/test_calibration.py`, `tests/test_score_capture.py` |

Run the core with a wearer's calibration:

```bash
source .venv/bin/activate
python -m core --solver HOST:12277 --rcsp HOST:45451 --wearer "Szymon"
curl localhost:8765/health        # "calibration": {"left": {...}, "right": {...}}
```

After a new calibration in the backend's `/gloves/calibrate` screen, send the
core's `calibrate` command. The core then reads the new files.

Rerun the capture report:

```bash
gunzip -c backend/tests/fixtures/rgmp/worn_solver.rgmp.gz > /tmp/worn_solver.rgmp
python -m tools.score_capture /tmp/worn_solver.rgmp --calibrate capture --calibration-out /tmp/cal
```

## Thresholds for the glove slot

| Dead zone (`perfect_deg` / `wrong_deg`) | Right pose passes | Wrong pose passes |
| --- | --- | --- |
| 8 / 45 (current) | 67% | 0% |
| 12 / 50 | 84% | 0% |
| **15 / 60 (start here)** | **100%** | **3%** |

Calibrated angles, 92 right-pose frames and 450 wrong-pose frames, pass at 0.85.

## Choices made without asking

| Choice | Why |
| --- | --- |
| Calibrated angles go into nominal degrees: 0 is flat, 90 is fist (thumb 60). | The scorer's degree thresholds keep their meaning. Old lessons stay usable. |
| Clip to 0 to 1 of the range. | The backend clips the same way. |
| `max_gain = 2.0`. | The real thumb moves only 14 deg flat to fist. Without a cap its noise is multiplied by 4. |
| Spread angles stay raw. | The backend stores no spread range. |
| `/ws/gloves` keeps sending raw angles. | The backend captures its calibration from that stream. Calibrated values there would corrupt the next capture. |
| The fake gloves and camera hands are not calibrated. | The fake already reads 0 when flat. The camera has no stored range. |
| No new wire command. | SPEC.md is frozen. The existing `calibrate` command reloads the files. |
| `[score]` stays 8 / 45 in `config.toml`. | The fake and the tests use it. The 15 / 60 change is a patch for a human (below). |
| The capture report scores only the six phases after flat and fist. | Flat and fist made the calibration, so scoring them would prove nothing. |

## Written but untested

| Part | Why untested | How to test |
| --- | --- | --- |
| Loading a calibration saved by the live backend | No gloves here. Only files from the capture and from tests. | Calibrate in `/gloves/calibrate`, send `calibrate` to the core, check `/health`. |
| Wearer lookup by name | Tested on test files only. | Run the core with `--wearer` and the name typed in the backend screen. |
| Across two wearers | The capture has one wearer. Only a synthetic test covers it. | Two people, one glove each, the same pose. Compare scores with and without `--no-calibration`. |
| 15 / 60 on a real learner | Advice comes from one scripted take. | Record with one glove, copy with the same glove, then with the other. |

## What a human must do next

1. **Calibrate through route B only.** The backend must take its glove frames from the core (`external` source, `python -m tools.ingest_bridge`). A calibration taken from the backend's own simulator or Studio UDP source is in a different angle space. The files do not record the source, so the core cannot detect this.
2. **Point the core at the backend's data dir** if it is not `backend/data` in this checkout. Use `--calibration-dir`, or set `[calibration] data_dir`. The backend reads `DATA_DIR` from its environment.
3. **Apply the threshold patch** for the glove slot, in `config.toml`:

   ```toml
   [score]
   perfect_deg = 15
   wrong_deg = 60
   ```

4. **Run `calibrate` once per wearer** after the backend capture, then check `/health`.
5. **No patch is needed in `backend/` or `frontend/`.** The core reads the existing files as they are.
6. **Robot twin (merged lane robot-view):** with a calibration loaded, `/ws/robot` is driven by calibrated angles. The twin's human hand comes from `/ws/gloves`, which stays raw. So a flat hand opens the robot fully, while the drawn hand keeps the glove's small flat curl. Check that this reads well on screen. Start the core with `--no-calibration` to compare.

## Commits

| Commit | What |
| --- | --- |
| 1 | `config.toml` parity off and stream layout comments; STATUS.md glove measurements |
| 2 | `core/calibration.py`, session hook, compat raw angles, config, CLI, `/health`, tests |
| 3 | `tools/score_capture.py --calibrate`, held-out phase report, gain cap, STATUS.md tables, this file |
