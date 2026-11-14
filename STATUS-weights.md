# STATUS-weights.md: per-finger step weights

Lane "weights", branch `weights` (from `origin/main` at `3dacdbb`), Sat 14 Nov 2026.

## What it does

Every lesson step now has a weight per finger, from 0 to 1. A weight says how much the finger counts on that step.

Definitions used below:

- **Weight**: a number from 0 to 1 per finger and step. 1 counts fully. 0 does not count.
- **Light finger**: a finger with a weight under 0.3 (`focus_min_weight`). The scorers never name it as "the one to fix".
- **Take**: one recording of a step by the expert. Several takes of one pose show how consistent the expert is.
- **Unusable joint**: a joint whose flat-to-fist range in the wearer's calibration is under 2.9 degrees (0.05 rad). The glove cannot read it for this wearer.

The core builds each step weight as a product of four factors:

| Factor | Source | Rule |
| --- | --- | --- |
| static | the whole lesson trace | A finger that moves less than 15 degrees in the whole lesson gets 0.5 (the old rule, unchanged). |
| consistency | the expert's takes of the pose | Standard deviation of the finger's mean flexion across takes: 4 degrees or less gives 1, 15 or more gives 0.2, linear between. One take gives 1. |
| chart | the task's chart | The finger the chart names for the step gets 1. The other fingers get 0.2. No chart gives 1. |
| calibration | the master hand's calibration | A finger with no usable flexion joint gets 0. |

How takes are found in the core:

1. `task_config.takes = N`: the lesson is the same sequence of steps recorded N times. Step i is a take of step i mod (steps / N).
2. Otherwise, steps whose key poses differ by at most 12 degrees on every finger (`take_match_deg`) are takes of one pose.
3. Rule 2 is strict on purpose. A looser rule groups "open hand" with "index bent" in finger-by-finger lessons and drops the index on its own step. So rule 2 only finds small spreads. Declare `takes` to measure a finger that the expert varies a lot.

Chart sources (`core/recorder.py` `chart_fingers`):

| Task | task_config field | Example |
| --- | --- | --- |
| typing | `keys` (one key per step) or `text` (one character per step) | `{"keys": ["j", "k", "Space"]}` gives right index, right middle, both thumbs |
| piano | `notes`, one note per step, each with `finger` | `{"notes": [{"beat": 0, "finger": "ring"}]}` |
| any | `fingers`, one finger name or a list per step | `{"fingers": [["thumb", "index"]]}` |

The typing chart is a copy of `CHART_ROWS` from `core/tasks/typing.py` on the unmerged branch `typing`. When that file is merged, `core/recorder.py` imports its `CHART` instead of the copy.

## Where the weights are honoured

| Place | What changed |
| --- | --- |
| `core/scorer.py` | `overall` is the weighted mean (as before). `worst`, the live hint and the step summary's `fingers` only name fingers at or above `focus_min_weight`. When no finger is that heavy, the heaviest non-zero fingers stand in. Unusable joints of the learner's calibration leave the finger's error (`slot_weights`). The move-step matcher uses the weighted error. |
| `core/session.py` | Learn mode multiplies the step weights by the learner calibration's finger mask. Mirror mode uses the masks of both hands. Record mode passes the master calibration's mask into the new lesson. |
| `core/calibration.py` | `HandCalibration.slot_weights()` and `finger_weights()`. `/health` calibration summary lists `unusable` joints and `finger_weights`. |
| `backend/app/services/scoring.py` | `to_result(..., weights)`: weighted finger mean in `overall`, a zero-weight finger never breaks `within_tolerance`, `worst_finger` and `hint` only among fingers at or above `FOCUS_MIN_WEIGHT`. With an attempt calibration, unusable joints leave the total flexion and a finger with none gets weight 0 and a warning. `take_weights(takes)` gives consistency weights from several takes. |
| `frontend/src/mock/scoring.ts`, `mock/router.ts` | The same, ported. `mock-scoring.test.ts` (pinned values) still passes. New pinned values in `mock-weights.test.ts` come from the Python scorer. |
| Practice view (`frontend/src/features/apprentice/training/`) | Light fingers take the stage background colour (they recede), are never marked off, pull no string, get no tip and are left out of the match meter. The score card's "The one to fix" skips them. The local fallback score is weighted. `TrainingRoom` sends `step.weights` on `POST /score`. |

Contract changes, all additive: `Step.weights` and `ScoreRequest.weights` in `docs/CONTRACT.md`, `backend/app/schemas/`, `frontend/src/api/types.ts`. The core lesson step gains an optional `weights_from` object (how the weight was built); `schema/lesson.json` allows extra step fields, so it still validates. `SPEC.md` is unchanged.

Behaviour change to note: with an attempt calibration that has unusable joints and no `weights`, the backend now leaves those joints out of the total flexion. Before, it compared their raw values with calibrated values. Every existing backend test still passes.

## Tests

| Suite | Command | Result |
| --- | --- | --- |
| core | `python -m pytest -q` (repo root, `.venv`) | 120 passed (11 new in `tests/test_weights.py`) |
| backend | `uv run pytest -q` (in `backend/`) | 255 passed, 13 skipped (8 new in `backend/tests/test_weights.py`) |
| frontend | `npm test`, `npm run lint`, `npm run build` (in `frontend/`) | 291 passed (14 new in `mock-weights.test.ts` and `practice-weights.test.ts`); lint and build pass |

The core and backend tests use Arpan's real range calibrations from the glove slot (`c8713cacaff6` right, `50462cbe80bd` left).

## Real data

All runs use Arpan's stored calibration (`backend/data`, wearer `arpan`): right range `c8713cacaff6`, left range `50462cbe80bd`.

| Calibration | Unusable joints | Finger weight 0 (core) |
| --- | --- | --- |
| right `c8713cacaff6` | thumb_mcp, thumb_ip (the fist reads less bent than flat) | thumb |
| left `50462cbe80bd` | ring_mcp, little_mcp | none (each finger keeps two usable joints) |

The backend reads the thumb with three joints, including the CMC stand-in, which moves. So the backend keeps the right thumb at weight 1 and only masks its MCP and IP. The core reads the thumb with two joints, so it drops the thumb.

### The two lessons recorded today

`python weights/check_lessons.py LESSON_DIR ... --data-dir backend/data --wearer arpan` (the lessons are not changed):

| Lesson | Steps | Takes found | Weights before | Weights after |
| --- | --- | --- | --- | --- |
| `20261114-1335-glove-slot-checkpoint` | 1 move, 1 hold | 1 per step | all 1.0 | thumb 0, others 1.0 |
| `20261114-1351-held-fist-check` | 3 hold | 3 (the three steps are one pose) | all 0.5 (static) | thumb 0, others 0.5 |

In the held-fist lesson the spread across the three takes is at most 1.2 degrees (middle). So consistency stays 1 for every finger. With `--keys jkl` on the same lesson, the chart gives index, middle and ring 0.5 on steps 1, 2 and 3. Every other finger gets 0.1 (0.5 static times 0.2 chart).

### The live capture (`logs/live/20261114-131952/solver_12277.rgmp`, 736 MB)

`python weights/scan_capture.py CAPTURE OUT.npz --every 8` streams the capture in 70 s. It keeps one frame in eight per device. The result is 91 365 right and 91 262 left samples over 2 922 s (6 MB). `python weights/capture_takes.py OUT.npz --side right --data-dir backend/data --wearer arpan` then finds every held pose (the recorder's still rule) and groups repeated poses as takes.

| Hand | Held poses | Pose groups with 3 or more takes | Median spread t/i/m/r/l (deg) | 90th percentile spread t/i/m/r/l (deg) | Share of weights under 1, t/i/m/r/l | Share under 0.5 |
| --- | --- | --- | --- | --- | --- | --- |
| right | 619 | 25 | 3.2/3.3/3.5/2.6/2.7 | 5.0/5.2/5.2/4.4/5.3 | 0.32/0.40/0.36/0.16/0.32 | 0 |
| left | 543 | 36 | 4.3/3.3/3.4/3.6/3.9 | 6.5/6.1/5.6/5.6/5.8 | 0.61/0.36/0.42/0.42/0.44 | 0 |

What it says:

1. A real held pose repeats with a spread of 3 to 4 degrees per finger. That is why `consistent_deg` is 4: a typical finger keeps weight 1.
2. The lowest weight seen is 0.62 (left middle, one pose group). The left thumb is the least consistent finger (median 4.3 degrees).
3. Automatic grouping only accepts takes within 12 degrees on every finger. So it cannot show a large spread. A finger the expert really varies needs `task_config.takes` or separate take recordings.
4. These "takes" are all still moments in a 49-minute session, not deliberate takes. A real test needs an expert to record one pose three to five times on purpose.

### The one to fix on real frames

Every tenth right-hand sample of the capture (9 137 frames, calibrated) scored against the last step of each lesson, unsmoothed:

| Lesson | Weights | Thumb named | Index | Middle | Ring | Little | Mean overall |
| --- | --- | --- | --- | --- | --- | --- | --- |
| held-fist-check | before | 6% | 51% | 23% | 2% | 18% | 0.845 |
| held-fist-check | after | 0% | 53% | 26% | 2% | 19% | 0.824 |
| glove-slot-checkpoint | before | 0% | 86% | 5% | 6% | 2% | 0.492 |
| glove-slot-checkpoint | after | 0% | 86% | 5% | 6% | 2% | 0.385 |

The thumb is never named once its weight is 0. The overall score drops a little. The raw thumb matched easily, and it no longer pads the mean.

Not tested on the capture: the typing chart against `keys.jsonl`. The solver capture has device time only, with no wall clock, so the key times cannot be lined up without a guess. The typing lane's `tools/typing_accuracy.py` (branch `typing`) is the tool for that.

## Files this lane changed

Lane files: `weights/scan_capture.py`, `weights/check_lessons.py`, `weights/capture_takes.py`, `STATUS-weights.md`.

Outside the lane, as the lane note allows: `core/recorder.py`, `core/scorer.py`, `core/session.py`, `core/calibration.py`, `config.toml` (`[score] focus_min_weight`, `[record]` take and chart settings), `tests/test_weights.py` (new), `backend/app/services/scoring.py`, `backend/app/constants.py`, `backend/app/schemas/lesson.py`, `backend/app/schemas/records.py`, `backend/tests/test_weights.py` (new), `docs/CONTRACT.md` (additive), `frontend/src/api/types.ts` (additive), `frontend/src/mock/scoring.ts`, `frontend/src/mock/router.ts`, `frontend/src/features/apprentice/training/` (ScoreCard, TrainingRoom, coach/deviation, coach/localScore, coach/tips, coach/useCoach, modes/useFingerTints, score/scoreRules), `frontend/tests/mock-weights.test.ts` and `practice-weights.test.ts` (new).

## Written but not tested

| Part | Why | How to test |
| --- | --- | --- |
| Dimmed fingers on screen | No lesson in the mock seed or in `backend/data` has `Step.weights` yet, so no screen shows them. Unit tests cover the rules; nobody has looked at the tint | Add `"weights": {"thumb": 1, "index": 1, "middle": 1, "ring": 0.1, "little": 0.1}` to one step in `backend/app/data/` seed or a stored lesson, open it at `/apprentice` and practise: ring and little should take the stage colour and never turn vermilion |
| Learn mode on real gloves with the mask | The session code is tested with synthetic hands and the real calibration files, not live | `python -m core --solver ... --wearer arpan`, learn the held-fist lesson: `frame.score.worst` must never be `thumb` |
| Typing chart weights in a recorded lesson | No typing lesson has been recorded with `task_config.keys` | Record with `set_task typing` and `{"keys": [...]}` per step, then `python weights/check_lessons.py` on it |

## What a human must do next

1. **Expert takes to Step.weights (frontend, outside this lane).** The expert screens keep several takes per step (`features/master/components/StepRecorderDialog.tsx`, `book.takesFor(step.id)`), but nothing turns them into `Step.weights`. Patch idea, where the lesson is saved:

   ```ts
   import { resample, takeWeights } from '../../mock/scoring';
   // for each step with two or more takes, each a Recording with frames:
   const series = takes.map((t) => resample(t.frames, side));
   const { weights } = takeWeights(series);
   step.weights = weights; // PUT /lessons/{id} stores it; the backend mirror is scoring.take_weights
   ```

   A cleaner home is a backend endpoint that takes recording ids and returns `take_weights`. That would be a CONTRACT.md addition.
2. **Core lessons into the frontend.** A core lesson's step `weights` reach the frontend only through `core/compat.py` (route A), which is not in this lane. If route A serves core lessons, add `"weights": step.weights` to each step it builds.
3. **Merge order with `typing`.** When `typing` merges, `core/recorder.py` uses its `CHART` automatically. Delete `TYPING_CHART_ROWS` from `core/recorder.py` then.
4. **Tune on a deliberate take set.** Ask the expert to record one pose five times with `task_config.takes = 5`, then run `check_lessons.py`. Move `consistent_deg` and `inconsistent_deg` (config.toml `[record]`) if the spread is far from the 3 to 4 degrees seen here.
5. **Right thumb calibration.** Arpan's right range `c8713cacaff6` reads the thumb less bent in the fist than flat. Recapture the fist with the thumb folded over the fingers, or the thumb stays at weight 0 for that wearer.
