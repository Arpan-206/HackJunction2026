# More skills to teach (beyond table tennis and piano)

What the gloves can and cannot see decides which skills demo well. Smartgloves II give per-joint finger flexion and wrist and forearm orientation at about 83 Hz with about 20 ms latency (research/09_rokoko.md). They do **not** give absolute hand position without a Coil Pro, finger spread (abduction) is not in our `HandFrame`, and there is no haptics. So the best skills are **hand shapes, grips and wrist motions**, not paths through space.

Our motion presets already cover most of these: `hold_pose` (a shape, with an optional `left_pose` when the two hands differ), `finger_sequence` (shapes in rhythm), `grip_and_swing` (grip plus wrist motion), `pinch`, and `keyframes` (a list of shapes, each with its own wrist angles and duration, plus optional `left_keys` for the other hand). A new skill is mostly a few entries in `backend/app/data/moves.json` plus a seed lesson.

## Built

- **Shadow puppets** (`shadow_puppets`): rabbit, talking dog, swan, flapping bird, snail. Lessons play in the shadow theatre (`frontend/src/three/ShadowTheatre.tsx`, `training/modes/ShadowPuppets.tsx`): a spot light at the oil lamp throws the expert's and the learner's hands onto the plaster wall side by side, the shape is named above the wall, and a wrong finger gets a vermilion ring on the hand and on its shadow.
- **Surgical grips** (`surgical_grips`): scalpel pencil and table-knife grips, needle driver ring and thenar grips, forceps, instrument tie, needle arc, two-handed square knot. The gloves cannot see thread, knot type or needle depth, and the copy says so.
- **Crochet basics** (`crochet`): hook and yarn hands, chain, slip stitch, single and double crochet, as yarn-over cycles of the hook hand.
- **Fingerspelling** (`fingerspelling`): letters live in packs (`backend/app/data/fingerspelling_packs.json`). The **ASL fingerspelling alphabet** pack is A to Z as hold steps (J and Z move, P and Q point down), two spelled words, a word drill and a letter chart at `/apprentice/fingerspelling`; glove twins the solver cannot separate are listed in `STATUS-shadows.md`. The **Finnish fingerspelling (sormiaakkoset)** pack has slots S, U, O, M, I, Ä, Ö, all "not recorded yet" until a person records them from the official chart with the slot kit's step 9 or the camera (`STATUS-fingerspelling-packs.md`).

All three are propless. Every curl is an estimate from `research/11_new_skills.md` until an expert records it with the gloves.

## Ranked

| # | Skill | Why it demos well | Glove fit | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Shadow puppets by candlelight** (built) | The 3D hands cast a shadow on the plaster wall from the oil lamp already on the stage; the learner matches the expert's rabbit, dog or bird. Instantly readable from 3 m, playful, and pure Renaissance (candlelight, plaster). | Excellent: static shapes, some two-handed | 4 to 5 h (shadow light, 5 shapes) |
| 2 | **Fingerspelling (sign language)** (built) | Spell a judge's name or "JUNCTION" letter by letter, scored per finger. Strong accessibility story; experts are Deaf teachers. | Good for letters that differ by flexion and wrist angle (A, B, C, D, E, F, I, L, O, S, Y, W, G and H by wrist). Letters that differ only by spread (U vs V) or crossing (R) are out | 3 h for a 12 to 15 letter set |
| 3 | **Boxing: fist and wrist** | Not punch paths (no position), but the two things coaches fix first: a proper fist (thumb outside, all fingers fully curled) and a **straight wrist at impact** (the forearm sensor plus hub give the wrist angle). Shadowbox a called combo, "jab, cross, hook", scored on fist tightness and wrist alignment on the beat. Physical, loud, fun to watch. Safety story: the boxer's fracture. | Good for fist and wrist; punch speed only from wrist rotation | 3 to 4 h (combo caller, wrist-angle check) |
| 4 | **Rock, paper, scissors vs the bot** | A 30-second booth magnet any judge can play: the bot reads your throw from the glove at "shoot". Shows the latency and accuracy honestly. | Excellent (three shapes) | 2 h (reuse the duel screen) |
| 5 | **Guitar chord shapes** | Fretting-hand shapes (C, G, D, E minor) and timed changes; music sells well. Air guitar works without a prop. | Good for shapes; exact fret position is not sensed | 3 h |
| 6 | **Drum stick rudiments** | Single and double stroke rolls are wrist rotation in rhythm, which the gloves do measure; add sound per stroke. | Good (wrist rotation and timing) | 3 to 4 h |
| 7 | **Surgical grips and knot tying** (built) | The strongest apprenticeship story (surgeons still learn by watching): scalpel pencil grip, needle driver grip, a one-handed knot as a finger sequence. | Grips good; knot only coarse | 3 h for grips |
| 8 | **Hand therapy (tendon glides)** | The standard sequence (straight, hook, fist, tabletop, straight fist) is already a `finger_sequence`. Real impact for stroke and hand-injury rehab; say "practice aid", never "clinically proven". | Excellent | 1 to 2 h |
| 9 | Climbing grips | Crimp, open hand, pinch, with an injury warning on full crimp | Good | 2 h |
| 10 | Quill or pen grip (calligraphy) | Renaissance flavour, tripod grip only; strokes need position | Grip only | 1 h |

Weaker fits: anything judged on where the hand goes (CPR compressions, darts, juggling, pottery), and skills needing spread or touch (card fans, coin rolls).

## Recommendation

- **Most impressive demo: shadow puppets.** It turns the stage we already have (wall, oil lamp) into the scoring display. The learner sees their shadow beside the expert's, and the vermilion ring still marks the wrong finger. Nobody else will have it.
- **Best story: fingerspelling.** Pair it with the pitch line about passing skills between people. Keep the letter set honest (see above).
- **Best booth game: rock, paper, scissors**, or boxing if you want something physical. Boxing's honest pitch is "fist and wrist form", not punch tracking.
- Keep table tennis and piano as the core modules; add one of the above as the "and it is general" moment.

## How to add one (for whoever builds it)

1. Add moves to `backend/app/data/moves.json` with a `skill` id, `hands`, and a motion preset (`hold_pose` curls per finger, `finger_sequence`, or `keyframes` for shapes with wrist motion). A new skill id goes in the `Skill` literal on both sides (`backend/app/schemas/common.py`, `frontend/src/api/types.ts`) and `docs/CONTRACT.md`.
2. Add a seed lesson in `backend/app/data/seed/` and copy both into `frontend/src/mock/data/` so mock mode has them.
3. Add a catalogue entry in `frontend/src/features/apprentice/skills/catalogue.ts` (card, description, level, key pose or a `still` picture). Pick a test for the skill, or reuse the generic play-along.
4. Record a real expert take with the gloves once they arrive; the synthesised guide is only a stand-in.
