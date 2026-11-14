# STATUS-thumb-align: the preview thumb now matches the scorer's thumb

Lane "thumb-align", branch `thumb-align`, written Sat 14 Nov 2026. Nobody had gloves. Everything below ran on the synthesisers, the mock and the backend tests only.

Definitions used below:

- **Preview**: the guide hand that a screen draws, `synthFrame` in `frontend/src/three/motion.ts`. The training room's live reference (`coach/reference.ts` `trackFromMotion`), the word drill, the skill cards and `Hand` all use it.
- **Scorer's target**: the joint angles that the scorer compares a learner against. For a motion, the backend synthesiser makes them (`backend/app/services/motion/synthesiser.py`, ported in `frontend/src/mock/synth.ts`). Without a calibration, the scorer maps a curl c to `flat + c * (fist - flat)` (`scoring._standard`).
- **Curl**: how far a finger bends, 0 (straight) to 1 (closed in a fist).
- **Total thumb flexion**: the sum of the thumb's three joint angles (CMC, MCP, IP). The scorer measures each finger's error on this sum.

## Root cause

The two sides use a different thumb scale.

| Side | Thumb joint angle for curl c |
| --- | --- |
| Scorer (`scoring._standard`, both scorer ports) | `(RELAXED + FULL * c) * 0.8` |
| Backend synthesiser and `mock/synth.ts` | `(RELAXED + FULL * c) * 0.8` |
| Preview `curlsToFlexion` in `three/motion.ts`, before | `RELAXED + FULL * c` (no scale) |

The preview left out `THUMB_FLEXION_SCALE` (0.8). Joint order, zero and sign were the same on all sides. There was no CMC stand-in. So the error was a fixed 20 percent of the thumb angle, and it grew with curl.

The backend synthesiser and its port already agreed with the scorer. I did not change them, and I did not change the scorer. The error lived in the preview path, so the fix is there.

## The fix

| File | Change |
| --- | --- |
| `frontend/src/three/motion.ts` | `curlsToFlexion` multiplies the thumb by `THUMB_FLEXION_SCALE`. |
| `frontend/src/mock/synth.ts` | Exports `THUMB_FLEXION_SCALE` (value unchanged, 0.8), so the preview reads the one constant. |

No pinned value in `frontend/tests/mock-scoring.test.ts` changed. The synthesiser maths did not change.

Visible effect: the preview thumb now bends 20 percent less than before. Tucked thumbs (M, N, S, T, E) look slightly less tucked. This is the angle the scorer wants.

I left `THUMB_CMC_REST = 0.1` in `three/handPose.ts`. It is the rig's bind calibration. At rest the preview now sends 0.08 rad, a 1 degree swing that nobody can see.

## Tests

| Test | What it checks | Result |
| --- | --- | --- |
| `backend/tests/test_thumb_align.py` (71 cases) | Every letter A to Z, both words and the five puppets, each hand they use. The synthesiser holds each key, and each joint must be within 5 degrees of the scorer's target. The thumb must match to 0.01 degree. A pose built straight from the target must score 99 or more on `POST /api/score`. | pass; 64 fail if the synthesiser drops the thumb scale |
| `frontend/tests/thumbAlign.test.ts` (37 cases) | The same moves through the preview `synthFrame`, every frame at 30 Hz, against `mock/synth.ts` `handFrame`. Each joint within 5 degrees. Preview frames used as the attempt score 99 or more in `mock/scoring.ts`. | pass; 28 of 37 fail without the fix (27 joint checks and the score check) |
| Backend `uv run pytest -q` | Full suite | 375 passed, 13 skipped |
| Frontend `npm test` | Full suite | 353 passed |
| Frontend `npm run lint`, `npm run build` | | pass |
| `E2E_PORT=5193 node e2e/shadows-walk.mjs` | Mock mode walk, puppets, letters, drill | pass, no console or page errors; J 100, drill HAND 99 |

## Error per move, before and after

"Worst joint" is the largest single joint gap. "Thumb total" is the gap in total thumb flexion, the number the scorer uses. After the fix the thumb gap is 0. The 1.15 degree residue is on the other fingers: the backend adds a breathing motion of 0.02 rad, and the preview leaves it out. It is well inside 5 degrees.

| Move | Max thumb curl | Worst joint before (deg) | Thumb total before (deg) | Worst joint after (deg) | Thumb total after (deg) |
| --- | --- | --- | --- | --- | --- |
| fs_a | 0.20 | 3.8 | 9.6 | 1.15 | 0.0 |
| fs_b | 0.80 | 8.9 | 23.7 | 1.15 | 0.0 |
| fs_c | 0.35 | 5.1 | 13.1 | 1.15 | 0.0 |
| fs_d | 0.60 | 7.2 | 19.0 | 1.15 | 0.0 |
| fs_e | 0.80 | 8.9 | 23.7 | 1.15 | 0.0 |
| fs_f | 0.50 | 6.4 | 16.7 | 1.15 | 0.0 |
| fs_g | 0.10 | 2.9 | 7.3 | 1.15 | 0.0 |
| fs_h | 0.70 | 8.1 | 21.4 | 1.15 | 0.0 |
| fs_i | 0.70 | 8.1 | 21.4 | 1.15 | 0.0 |
| fs_j | 0.70 | 8.1 | 21.4 | 1.15 | 0.0 |
| fs_k | 0.40 | 5.5 | 14.3 | 1.15 | 0.0 |
| fs_l | 0.00 | 2.1 | 4.9 | 1.15 | 0.0 |
| fs_m | 0.90 | 9.8 | 26.1 | 1.15 | 0.0 |
| fs_n | 0.85 | 9.4 | 24.9 | 1.15 | 0.0 |
| fs_o | 0.50 | 6.4 | 16.7 | 1.15 | 0.0 |
| fs_p | 0.40 | 5.5 | 14.3 | 1.15 | 0.0 |
| fs_q | 0.10 | 2.9 | 7.3 | 1.15 | 0.0 |
| fs_r | 0.70 | 8.1 | 21.4 | 1.15 | 0.0 |
| fs_s | 0.70 | 8.1 | 21.4 | 1.15 | 0.0 |
| fs_t | 0.80 | 8.9 | 23.7 | 1.15 | 0.0 |
| fs_u | 0.70 | 8.1 | 21.4 | 1.15 | 0.0 |
| fs_v | 0.70 | 8.1 | 21.4 | 1.15 | 0.0 |
| fs_w | 0.80 | 8.9 | 23.7 | 1.15 | 0.0 |
| fs_x | 0.70 | 8.1 | 21.4 | 1.15 | 0.0 |
| fs_y | 0.00 | 2.1 | 4.9 | 1.15 | 0.0 |
| fs_z | 0.70 | 8.1 | 21.4 | 1.15 | 0.0 |
| fs_word_junction | 0.85 | 9.4 | 24.9 | 1.15 | 0.0 |
| fs_word_geppetto | 0.80 | 8.9 | 23.7 | 1.15 | 0.0 |
| sp_rabbit | 0.70 | 8.1 | 21.4 | 1.15 | 0.0 |
| sp_talking_dog | 0.60 | 7.2 | 19.0 | 1.15 | 0.0 |
| sp_swan | 0.15 | 3.4 | 8.5 | 1.15 | 0.0 |
| sp_flapping_bird | 0.30 | 4.6 | 12.0 | 1.15 | 0.0 |
| sp_snail | 0.80 | 8.9 | 23.7 | 1.15 | 0.0 |

Letters that still cannot reach 5 degrees: none.

The "before" columns come from the formula `(RELAXED + FULL * c) * 0.2` per thumb joint at each move's largest thumb curl. The "after" columns come from the frontend test, every frame at 30 Hz.

## Written but not tested

- Real gloves. The scorer reads a learner's raw thumb angles. Whether a real thumb reaches the scaled target is a calibration question. This lane did not touch it.
- The look of the thumb on screen. I ran the shadows walk for errors only. I did not compare screenshots before and after. The walk rewrites `frontend/docs/screens/shadows-*.png`; I did not commit the new ones. Run the walk again after the merge to refresh them.

## Findings for other owners

1. **Other presets still differ (not thumb, not fixed).** `three/motion.ts` keeps its own maths for `finger_sequence`, `grip_and_swing`, `pinch` and `idle`. It does not match `mock/synth.ts`. Hold poses and keyframes, which carry every letter and puppet, already share the port's maths.

   | Preset | Preview `three/motion.ts` | Scorer's target `mock/synth.ts` |
   | --- | --- | --- |
   | finger_sequence | rest curl -0.08, press 0.4 | rest curl 0, press 0.36 |
   | pinch | thumb 0.25, fingers 0.3, rest 0.05, default beat 900 ms | thumb 0.45, fingers 0.5, rest 0, default beat 800 ms |
   | idle | thumb -0.05, fingers -0.1 | all 0.05 |
   | grip_and_swing | same curls, own wrist maths | same curls, roll factor 0.35, pitch -0.25 |

   Effect: in the training room the live marks for piano, pinch and idle can disagree with the final score. Proposed fix, not applied because it changes how those skills look: in `synthFrame`, take `flexion` and `wrist_quat` from `mock/synth.ts` `handFrame(spec, side, t)` for every preset, and keep only `active` from the local `poseAt`. The test in `frontend/tests/thumbAlign.test.ts` can then run over every move in `moves.json`.

2. **Breathing.** The preview leaves out the 0.02 rad breathing motion. That is 1.15 degrees. It does no harm, and it keeps the preview still.

## What a human must do next

1. Review and merge branch `thumb-align`.
2. Decide on finding 1.

## Patches for files outside this lane

None. All changes are inside this lane's files.
