# STATUS-shadows: shadow puppets and fingerspelling, teachable without gloves

Lane "shadows", branch `shadows`, written Sat 14 Nov 2026. Nobody had gloves. Everything below ran on fakes and the mock only.

## What works

| Part | What a learner gets | Where |
| --- | --- | --- |
| Shadow puppets | Five lessons on the lamplit wall: Rabbit, Talking dog, Swan, Flapping bird, Snail. Each lesson reaches a score card from the existing scorer. | Seed `backend/app/data/seed/shadow_puppets.json`, stage `frontend/src/three/ShadowTheatre.tsx` (unchanged) |
| Puppet motions | The rabbit's ears twitch and the swan's neck bobs from the wrist (research/11 section 3). The dog's jaw and the bird's wings were already there. Each loop starts on the upright shape. | `backend/app/data/moves.json` (`sp_rabbit`, `sp_swan`) |
| Fingerspelling skill | A live skill, not a workshop card. Three courses: letters A to M, letters N to Z, and "spell a word" (JUNCTION, GEPPETTO). Each letter is a hold step. J and Z carry their motion. P and Q point down. | `fs_a` to `fs_z`, `fs_word_*` in `moves.json`; seeds `fingerspelling_*.json` |
| Word drill | `/apprentice/fingerspelling`: pick or type a word. The expert's hand shows each letter upright. A ring fills while every finger holds. A finger out of place is named. The letter passes after 0.6 s. The whole word is then scored by `POST /score`. | `frontend/src/features/fingerspelling/` (`drill.ts`, `FingerspellingScreen.tsx`) |
| Letter chart | 26 cards with curl bars, the written shape, the motion, and the letters the gloves read alike, with the reason in the sources' words. Same screen, "Letter chart" tab, or `?tab=chart`. | `frontend/src/features/fingerspelling/chart.ts` |
| Core lessons | `tools/make_pose_lessons.py` writes the same shapes as core lessons in `lessons/<id>/` (`lesson.json` and `trace.npz`). The core loads and plays them. | `tools/make_pose_lessons.py`, `tests/test_make_pose_lessons.py` |

Definitions used below:

- **Curl**: how far a finger bends, 0 (straight) to 1 (closed in a fist).
- **Glove twins**: two letters whose curls differ by less than 0.2 on every finger. The scorer cannot separate them.
- **Mock mode**: the frontend runs its own port of the backend in the browser (`?mock=1`).

### Run it

```bash
# frontend (in frontend/)
npm run lint && npm test && npm run build
E2E_PORT=5182 node e2e/shadows-walk.mjs      # this lane's walk
E2E_PORT=5181 node e2e/mock-walk.mjs
# backend (in backend/)
uv run pytest -q
# core lessons (repo root, main checkout venv)
python -m tools.make_pose_lessons --list
python -m tools.make_pose_lessons             # writes lessons/pose-*
python -m core --fake --lesson pose-spell-junction
```

### Test results at the last commit

| Check | Result |
| --- | --- |
| Frontend `npm test` | 303 passed (296 before; 7 new in `tests/fingerspelling.test.ts`) |
| Frontend lint, build | pass |
| `node e2e/mock-walk.mjs` | pass, no console errors |
| `node e2e/shadows-walk.mjs` | pass, no console errors |
| Backend `uv run pytest -q` | 272 passed, 13 skipped (17 new in `tests/test_fingerspelling.py`) |
| Core `python -m pytest -q` | 150 passed (8 new in `tests/test_make_pose_lessons.py`) |
| `python -m core --fake --lesson pose-spell-junction` | Core lists all five pose lessons on `/lessons`; `/ws` sends the lesson with its 8 letter steps |

### Scores from the shadows walk (mock mode, simulated glove)

| Lesson | Overall score |
| --- | --- |
| Rabbit, Talking dog, Swan, Flapping bird, Snail | 100 each |
| Letter A, letter J | 100 each |
| Drill, word HAND | 99; 4 of 4 letters held |

The simulated glove plays the expert's motion exactly, so these scores only prove the path works. They say nothing about real hands.

## Sources for the handshapes

The letter shapes come from written descriptions, not from pictures and not from memory:

1. Stokoe notation, handshape (dez) table: https://en.wikipedia.org/wiki/Stokoe_notation (A fist, B flat hand, C cupped hand, E claw hand, F okay hand, G pointing hand, H index and middle together, I pinkie, K thumb on the middle finger of V, L angle hand, O tapered hand, R crossed fingers, S fist, U fingers together, V spread fingers, W thumb touches pinkie, X hook, Y horns).
2. American manual alphabet: https://en.wikipedia.org/wiki/American_manual_alphabet (A thumb at the side, S thumb in front, G and H palm to the side, J as I with a wrist twist, Z traced with the index finger, K and P share a shape).
3. Start ASL: https://www.startasl.com/american-sign-language-alphabet/ (M thumb under three fingers, N under two, T under one, P points the middle finger down, Q points down like G).
4. Lifeprint (D: index up, the other fingertips meet the thumb): https://www.lifeprint.com/asl101/fingerspelling/fingerspelling3.htm

Every curl number is my estimate of the written shape. An expert must record the letters with the gloves.

### Letters the gloves cannot separate

The solver gives curl and the wrist. It does not give spread or thumb contact (STATUS.md). These groups are glove twins:

| Group | What really separates them |
| --- | --- |
| C, O | O closes the fingertips onto the thumb |
| G, L, Q | L opens a right angle; Q points down |
| H, R, U, V | H points sideways; R crosses; V spreads |
| I, J | J twists the wrist |
| K, P | P points down |
| M, N, S, T | How many fingers fold over the thumb |

The scorer reads only finger angles, so wrist turns (G and H sideways, P and Q down, J and Z motion) are shown but not scored. The chart says this on screen.

## Written but not tested on real hardware

- Every curl value, for all 31 shapes. All are estimates.
- The wrist angles: P and Q pitch -1.1 rad, the J twist (roll 1.3 rad), the Z zigzag (yaw 0.3 rad), the swan's bob (pitch -0.35 rad). The signs follow the keyframe docstring in `backend/app/schemas/motion.py`; nobody checked them against a real signer.
- The drill with real gloves: hold time 0.6 s, give-up after 12 s, tolerance 22 degrees times the margin.
- The core lessons on a real learner. They pass in the fake session and on a replay of their own take only.

## Findings for other owners

1. **Thumb mismatch between two synthesisers (frontend, not fixed).** `three/motion.ts` `synthFrame` (the preview, also the training room's live reference in `coach/reference.ts`) puts the thumb up to 26 degrees from `mock/synth.ts` (the backend port the scorer uses). The gap grows with thumb curl: about 5 degrees for an open thumb, about 25 for a tucked one. Effect: in the training room the live thumb marks can disagree with the final score. The drill avoids it by using `mock/synth.ts` for its target. Fix: make `trackFromMotion` use `mock/synth.ts` `frameAt`, or align the thumb maths. I did not change it; it touches every skill.
2. **Snail feelers.** Research says the snail's feelers curl 0 to 0.4. I kept the snail a `hold_pose`, because `backend/tests/test_new_skills.py` and `frontend/tests/keyframes.test.ts` pin it as a hold with `left_pose`.
3. **Core step kinds.** The core cuts hold or move steps by finger motion only. J, Z, the swan and the bird move only the wrist, so they come out as hold steps. Only the talking dog is a move step.
4. **Two-handed puppets in the core.** A core lesson has one master hand, so the bird and the snail are recorded on the right hand only.

## Gaps between this brief and what Arpan may have meant

- The brief was rebuilt from the repo. I took "the demo table" to mean the core's lesson list (`/lessons`), where the pose lessons now appear. If it means something else, the tool's lessons may need a different id or task.
- "Hold steps from the curl patterns and the one wrist or thumb motion": I made each puppet one step with its motion. I did not split a puppet into a hold step and a motion step.
- Fingerspelling is ASL (the American manual alphabet). If Arpan wanted another sign language, the seeds and the chart need new shapes.
- The generated `lessons/pose-*` folders are not committed (`trace.npz` is ignored there, and `lessons/` belongs to the core owner). Run the tool to make them.

## What a human must do next

1. Review and merge branch `shadows` (draft PR).
2. Run `python -m tools.make_pose_lessons` in the main checkout before a core demo.
3. With gloves: record the letters and puppets as an expert, then replace the estimates. Check the wrist signs of P, Q, J and Z.
4. Decide on finding 1 (thumb mismatch).
5. Apply the patches below.

## Patches for files outside this lane

`CLAUDE.md`, repo map, frontend line: after `features/master/` (expert screens: scratch, generate, lesson);` add:

```
`features/fingerspelling/` (word drill and letter chart at `/apprentice/fingerspelling`, letters read from the `fs_` moves);
```

`CLAUDE.md`, Run, frontend line: after `node e2e/settings-walk.mjs` add `, node e2e/shadows-walk.mjs`. Core line: after `python -m tools.ingest_bridge` (feed `backend/`) add `, python -m tools.make_pose_lessons` (puppets and letters as core lessons).

`docs/ideas/SKILL_IDEAS.md`, section "Built", add:

```
- **Fingerspelling** (`fingerspelling`): the American manual alphabet A to Z as hold steps (J and Z move, P and Q point down), two spelled words, a word drill and a letter chart at `/apprentice/fingerspelling`. Shapes from written sources (STATUS-shadows.md). Glove twins (C/O, G/L/Q, H/R/U/V, I/J, K/P, M/N/S/T) are named on the chart.
```

and in the ranked table, row 2, change "**Fingerspelling (sign language)**" to "**Fingerspelling (sign language)** (built)".
