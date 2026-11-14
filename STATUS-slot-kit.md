# STATUS-slot-kit.md

Lane "slot-kit", branch `slot-kit`, Sat 14 Nov 2026. Everything here was tested on fakes only. No gloves and no phone were used.

## What works and how to run it

From the repo root, with the venv active:

```bash
scripts/slot/run.sh --dry-run    # fakes only; ends with "DRY RUN PASSED"
scripts/slot/run.sh              # the real slot
```

Full guide: `docs/SLOT-KIT.md`.

| Part | What it does |
| --- | --- |
| `scripts/slot/run.sh` | Finds the Python: `GEPPETTO_PY`, the active venv, `<repo>/.venv`, then the main checkout's `.venv` (for worktrees). Runs `slot_main.py` |
| `scripts/slot/slot_main.py` | Options, the step loop, retry, the summary, the exit code |
| `scripts/slot/slot_steps.py` | Steps 0 to 8, with the thresholds at the top of the file |
| `scripts/slot/slot_links.py` | Core `/ws` and `/ws/robot` client (websockets sync), HTTP, a trace of every call |
| `scripts/slot/slot_log.py` | Prompts; `results.jsonl` and `summary.md` |
| `scripts/slot/slot_stack.py` | The dry-run processes; the live stack check |
| `scripts/slot/lessons.txt` | Demo lesson titles for step 8 (edit before the slot) |
| `tools/fake_rcsp_server.py` | New. A fake Rokoko driver on the RCSP side. It logs every LED colour, and a control port presses the buttons |
| `tests/test_slot_kit.py`, `tests/test_fake_rcsp_server.py` | 9 tests: prompts, logs, heading maths, step 1 on the fake phone, the fake driver against the core's real RCSP client |

Results of the last dry run (`logs/slot/20261114-163351-dry/`, about 2 minutes):

| Step | Verdict | Result on fakes |
| --- | --- | --- |
| 0. Stack | ok | Fake core, backend, bridge and fake phone up on free ports |
| 1. Depth clip | look | 180 frames, 30.0 fps, 0 gaps, plane in every frame; depth check skipped (`tools.depth_check` not on main yet) |
| 2. Right thumb | look | Flat, fist, neutral and finish went through the backend; the core's `load_hand` read them back |
| 3. Left glove | look | The same, left side |
| 4. Button, LED, mirror, duel | look | Both buttons and LEDs ok (red while recording, then blue); mirror scored 100% of frames; duel rounds won by both hands |
| 5. Yaw | look | `calibrated` event seen; headings computed |
| 6. Piano | look | Ran; fake hands do not tap, so 0 presses |
| 7. Robot flex | look | 14 joints compared from `/ws/robot` |
| 8. Demo lessons | look | 9 of 9 takes saved, each with 2 steps (the mark after FREEZE works) |
| Exit code | 0 | DRY RUN PASSED |

Full suite: 151 passed (`python -m pytest -q`).

## Choices made (no questions asked)

1. **Python runner, thin shell wrapper.** The checks talk WebSocket and HTTP. Python does this more simply and with more safety than bash.
2. **Calibration goes through the backend API.** That is the path that worked in the Sat 14 Nov slot (STATUS.md). Steps 2 and 3 call `POST /api/calibrations` flat and fist, then `neutral`, then `finish`. `finish` keeps the other side's range id from the newest record. Then the core gets `calibrate`. The check reads the result with `core.calibration.load_hand`, the same function the core uses.
3. **Thresholds** (top of `slot_steps.py`): thumb range 8 degrees or more (a good thumb was 14); other fingers 25 degrees or more (good were 53 to 70, the bad left glove 0.7 to 8).
4. **Step 4 on fakes uses a second core.** `python -m core --fake` ignores `--rcsp`. So the dry run also starts a non-fake core on the fake solver and the new fake RCSP driver. The main dry-run core stays `--fake`, as the brief asks.
5. **Step 8 is timed.** POSE 3 s, FREEZE 2 s, then `record_mark`, then MOVE 4 s. The gloved hands never touch the keyboard during a take. Enter (left hand) starts each take.
6. **Default demo lessons** are placeholders: "Pinch and release", "Fist to open hand", "Point and wave". No document names the demo lessons. Edit `scripts/slot/lessons.txt`.
7. **Duel lesson**: `--duel-lesson ID`, else the newest non-fake lesson on the core. With none, the duel part is skipped with a note.
8. **Dry-run verdicts.** Fake hands ignore the prompts, so pose quality on fakes gives "look", not "bad". The dry run fails on "error" or "bad". "bad" stays possible for faults the fakes can show (button, LED, mirror).
9. **Logs** go to `logs/slot/<time>/`. A `.gitignore` with `*` keeps them out of git, as `live.sh` does for `logs/live/`.
10. **Clean up.** The dry run deletes the lessons it recorded with `lesson_delete`. It stops every process it started (SIGINT, then SIGTERM, then SIGKILL per process group).

## Written but untested (needs the real slot)

| Part | Why untested | What tests it |
| --- | --- | --- |
| Step 0 offer to run `scripts/live.sh` | Needs the SDK and the gloves | The real slot |
| Step 1 on the real phone | No phone tonight; tested on `ios.mac.fake_sender` only | Record with the app over the cable |
| Step 1 depth check | `tools/depth_check.py` (lidar lane) is not on main | It runs by itself once it is merged; or `--depth-check "..."` |
| Steps 2 and 3 pass marks | Fake hands move on their own | Real flat and fist poses |
| Step 4 on the real driver | Fake RCSP driver only | Real buttons; you answer the LED question |
| Step 5 heading sign | Convention from SPEC.md (Y up, X right, Z toward the person); a left turn should read +90 | Real hands; if it reads -90, the sign in `palm_heading_deg` or the core's wrist frame is flipped |
| Step 6 thresholds | Fake hands do not tap | Real taps |
| Step 7 twin check | Needs eyes on the frontend `/robot` screen | Look at the twin |
| Step 8 hold then move | Fake hands are too slow for the move step to count as "move" | Real takes |

## What a human must do next

1. Run `scripts/slot/run.sh --dry-run` once on the slot machine, from the main checkout after the merge.
2. Edit `scripts/slot/lessons.txt` with the real demo lessons.
3. At the slot: `scripts/slot/run.sh`. Send `logs/slot/<time>/summary.md` to the team.
4. Merge `slot-kit` into `main` (ask first). It adds files only. It changes no existing file.
5. Core owner, optional: a single button press with no master role records the first tracked hand (left), whichever glove was pressed. So the right button can turn the LEFT LED red. Step 4 works around it by setting the master first. A possible fix in `core/session.py` `handle_button`, not applied (rule 9):

   ```python
   # in handle_button, before record_start in idle or record mode:
   if not self.sides_with_role("master"):
       self.handle_command("set_roles", {side: "master"})
   ```

## Patches for files outside this lane

None needed. The lane adds `scripts/slot/`, `docs/SLOT-KIT.md`, `tools/fake_rcsp_server.py` and two test files. It changes no existing file.
