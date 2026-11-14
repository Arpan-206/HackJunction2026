# STATUS-fingerspelling-packs: letters live in packs

Lane "fingerspelling-packs", branch `fingerspelling-packs` from local `main` (2b399a8), written Sat 14 Nov 2026. Nobody had gloves. Everything ran on fakes and the mock only.

Definitions used below:

- **Pack**: one fingerspelling alphabet, with a slot per letter.
- **Recorded letter**: a slot with a shape the drill can score against, plus who recorded it, the reference and when.
- **Not recorded yet**: a slot with no shape at all. It is shown, flagged and never scored.
- **Curl**: how far a finger bends, 0 (straight) to 1 (closed).

## What works

| Part | What it does | Where |
| --- | --- | --- |
| Pack model | One file holds the packs. Each letter has `status` (`recorded` or `not_recorded`), `recorded_by`, `reference`, `recorded_at`, and `move_id`, `lesson_id` or `pose`. The schema refuses a not-recorded letter that carries a pose. | `backend/app/data/fingerspelling_packs.json`, `backend/app/schemas/fingerspelling.py` |
| ASL pack | The 26 letters migrated. `recorded_by` is "seeded from written sources"; the references are the four sources cited in `STATUS-shadows.md`. | `id: asl` |
| Finnish pack | "Finnish fingerspelling (sormiaakkoset)", slots S, U, O, M, I, Ä, Ö, all not recorded yet. No shape exists for them anywhere in the repo. | `id: fi` |
| API | `GET /fingerspelling/packs` and `GET /fingerspelling/packs/{id}`. Additive in `docs/CONTRACT.md`, `types.ts` and the mock router. | `backend/app/api/routes/fingerspelling.py` |
| Rename | Users see "ASL fingerspelling alphabet": skill card, skill page, drill, chart, course titles, move names, word lessons, docs. Ids, wire fields and code paths keep their names. | seeds, `moves.json`, `catalogue.ts` |
| Drill | Pick a pack. Å, Ä and Ö are letters of their own: Finnish upper case, NFC, never folded to A or O. There are Å Ä Ö buttons. Each letter shows recorded, "not recorded yet" or "not in pack". Only recorded letters are drilled and scored; with none, the start button says "Nothing to spell yet" and stays disabled. | `features/fingerspelling/packs.ts`, `FingerspellingScreen.tsx` |
| Chart | Shows a pack's letters. An unrecorded letter shows "Not recorded yet", no hand, and the official chart as the reference. A recorded letter shows who recorded it, when and against what. | same |
| Skill page | Lists each pack with "N of M letters recorded" and its letters not recorded yet. | `features/fingerspelling/PackList.tsx` |
| Slot step 9 | The person types their name and the reference (default: the official chart). For each slot, the script names the letter, the person holds it from the chart, and the core records a hold take. The pack stores the held curls, the lesson id, the name, the reference and the time. | `scripts/slot/slot_letters.py`, `slot_steps.py` |
| Camera path | The same module runs on its own against the core's camera source. | `python scripts/slot/slot_letters.py --pack fi --letter Ä --by NAME` with `python -m core --camera` |
| Core lessons | `tools/make_pose_lessons.py` emits only recorded letters. An unrecorded ASL letter is left out, a word with one is skipped, and a pack's recorded letters become `pose-pack-<id>`. Today the Finnish pack gives no lesson. | `tools/make_pose_lessons.py` |

### The official chart

Finnish reference, checked on 14 Nov 2026: "Aakkoset (sormiaakkoset kuvina)" in Suvi, the online dictionary of Finnish Sign Language: https://suvi.viittomat.net/alphabet.php.

- The page shows the alphabet A to Z plus Å, Ä and Ö as pictures. It gives two variants for E, G, J, P and X; none of those is a slot here.
- Kuurojen Liitto (the Finnish Association of the Deaf) lists Suvi among its services. The page does not name a publisher, so the label says "listed by Kuurojen Liitto".
- The page loads only with cookies set by JavaScript. Open it in a browser.

### Run it

```bash
# frontend (in frontend/)
npm run lint && npm test && npm run build
SKIP_REPS=1 node e2e/shadows-walk.mjs     # pack steps without the 3D training room
node e2e/shadows-walk.mjs                 # the full walk, needs a quiet machine
# backend (in backend/)
uv run pytest -q
# repo root, main checkout venv
python -m pytest -q
scripts/slot/run.sh --dry-run
# record Finnish letters at a real slot (gloves)
scripts/slot/run.sh --only 9 --pack fi --recorded-by "NAME"
# or with the camera
python -m core --camera
python scripts/slot/slot_letters.py --pack fi --by "NAME"
```

## Test results at the last commit

| Check | Result |
| --- | --- |
| Frontend lint, build | pass |
| Frontend `npm test` | 365 passed (6 new in `tests/fingerspellingPacks.test.ts`) |
| `SKIP_REPS=1 node e2e/shadows-walk.mjs` | pass, no console errors; the Finnish pack shows "not recorded yet" on the skill page, in the drill and in the chart |
| Full `node e2e/shadows-walk.mjs` | every step passed on the last run: 5 puppets, letters A and J (100 each), HAND drill (87, 4 of 4 held), the 3 Finnish pack steps. The walk still exits with 12 console errors, all `ws://localhost:8765/ws/robot` from the training room on `main` (see below). Earlier runs under load timed out at a puppet step |
| Backend `uv run pytest -q` | 381 passed, 13 skipped (7 new in `tests/test_fingerspelling_packs.py`) |
| Core `python -m pytest -q` | 220 passed, 1 failed under load (`test_depth_step_against_fake_phone`, fake phone at 13.9 fps); that test then passed 3 of 3 alone, and on `main` |
| New core tests | `tests/test_slot_letters.py` 8 passed; `tests/test_make_pose_lessons.py` 11 passed (3 new) |
| `scripts/slot/run.sh --dry-run` | DRY RUN PASSED, steps 0 to 9. Step 9: 7 of 7 letters stored into the run folder's copy; repo pack unchanged; 16 fake takes deleted |

### Walks under load

- The machine ran at a load average of 35 to 50 from other lanes. The 3D training room on the software renderer then blocks clicks for over 30 s, so the full walk timed out at a different puppet step on each run. On `main` the puppet steps passed once at a lower load.
- The pack steps do not use the training room. With `SKIP_REPS=1` they pass with no console errors.
- **Found on `main`, not in this lane:** `node e2e/mock-walk.mjs` fails at "expert: calibrate the glove" on `main` (5079703) the same way as on this branch. The training room on `main` also logs `WebSocket connection to 'ws://localhost:8765/ws/robot' failed` in mock mode; the walks count those as console errors.

## Written but not tested on real hardware

- Step 9 with a real person and real gloves: the hold length (3 s to get in, 3 s held), and the curls taken from the core's angles. The dry run used fake hands, which do not make the letters.
- The camera path (`python -m core --camera` plus `slot_letters.py`).
- The drill against a Finnish letter a person recorded. A unit test covers the plan and the scoring reference.

## Choices and gaps

1. **Worktree.** The session guard refused a new worktree path outside its own. So the branch `fingerspelling-packs` was made from local `main` inside `.claude/worktrees/shadows` (the old `shadows` branch is merged and pushed). The isolation is the same; only the folder name differs from the brief.
2. **Pack file in the repo.** Step 9 writes the recorded letters into the committed pack file and its frontend copy. After a real slot, commit both. No backend write route was added; the brief asked for none.
3. **Core lesson titles.** `core/priors/facts.py` reads any lesson whose title says "fingerspell" or "letter X" with the ASL letter model. Recorded Finnish takes are titled "Sormiaakkoset: Ä", and the pack lesson "Sormiaakkoset: the recorded letters", so they never reach the ASL reader. A per-pack priors switch is the core owner's call.
4. **Å.** Å is not a slot, as in the brief. The drill accepts it and shows "Å is not in Finnish fingerspelling (sormiaakkoset)". The official chart has Å; adding a slot is one line in the pack file.
5. **Recorded curls** use `core.hand.curl_from_angles` (90 degrees per finger joint, 60 for the thumb), the same rule as the synthetic hands. With a calibration loaded, the core's angles are calibrated first.

## What a human must do next

1. Review and merge `fingerspelling-packs`.
2. At the next glove slot, have a person record the Finnish letters: `scripts/slot/run.sh --only 9 --recorded-by "NAME"`, holding each letter from the Suvi chart. Then commit `backend/app/data/fingerspelling_packs.json` and `frontend/src/mock/data/fingerspelling-packs.json`.
3. Rerun the full `node e2e/shadows-walk.mjs` on a quiet machine.
4. Look at the `main` findings above: the mock walk's calibration step and the `/ws/robot` errors in mock mode.
