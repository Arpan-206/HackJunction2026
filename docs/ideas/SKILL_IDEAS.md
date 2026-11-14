# More skills to teach (beyond table tennis and piano)

What the gloves can and cannot see decides which skills demo well. Smartgloves II give per-joint finger flexion and wrist and forearm orientation at about 83 Hz with about 20 ms latency (research/09_rokoko.md). They do **not** give absolute hand position without a Coil Pro, finger spread (abduction) is not in our `HandFrame`, and there is no haptics. So the best skills are **hand shapes, grips and wrist motions**, not paths through space.

Our motion presets already cover most of these: `hold_pose` (a shape), `finger_sequence` (shapes in rhythm), `grip_and_swing` (grip plus wrist motion), `pinch`. A new skill is mostly a few entries in `backend/app/data/moves.json` plus a seed lesson.

## Ranked

| # | Skill | Why it demos well | Glove fit | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Shadow puppets by candlelight** | The 3D hands cast a shadow on the plaster wall from the oil lamp already on the stage; the learner matches the expert's rabbit, dog or bird. Instantly readable from 3 m, playful, and pure Renaissance (candlelight, plaster). | Excellent: static shapes, some two-handed | 4 to 5 h (shadow light, 5 shapes) |
| 2 | **Fingerspelling (sign language)** | Spell a judge's name or "JUNCTION" letter by letter, scored per finger. Strong accessibility story; experts are Deaf teachers. | Good for letters that differ by flexion and wrist angle (A, B, C, D, E, F, I, L, O, S, Y, W, G and H by wrist). Letters that differ only by spread (U vs V) or crossing (R) are out | 3 h for a 12 to 15 letter set |
| 3 | **Boxing: fist and wrist** | Not punch paths (no position), but the two things coaches fix first: a proper fist (thumb outside, all fingers fully curled) and a **straight wrist at impact** (the forearm sensor plus hub give the wrist angle). Shadowbox a called combo, "jab, cross, hook", scored on fist tightness and wrist alignment on the beat. Physical, loud, fun to watch. Safety story: the boxer's fracture. | Good for fist and wrist; punch speed only from wrist rotation | 3 to 4 h (combo caller, wrist-angle check) |
| 4 | **Rock, paper, scissors vs the bot** | A 30-second booth magnet any judge can play: the bot reads your throw from the glove at "shoot". Shows the latency and accuracy honestly. | Excellent (three shapes) | 2 h (reuse the duel screen) |
| 5 | **Guitar chord shapes** | Fretting-hand shapes (C, G, D, E minor) and timed changes; music sells well. Air guitar works without a prop. | Good for shapes; exact fret position is not sensed | 3 h |
| 6 | **Drum stick rudiments** | Single and double stroke rolls are wrist rotation in rhythm, which the gloves do measure; add sound per stroke. | Good (wrist rotation and timing) | 3 to 4 h |
| 7 | **Surgical grips and knot tying** | The strongest apprenticeship story (surgeons still learn by watching): scalpel pencil grip, needle driver grip, a one-handed knot as a finger sequence. | Grips good; knot only coarse | 3 h for grips |
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

1. Add moves to `backend/app/data/moves.json` with a `skill` id, `hands`, and a motion preset (`hold_pose` curls per finger, or `finger_sequence`).
2. Add a seed lesson in `backend/app/data/seed/` and copy both into `frontend/src/mock/data/` so mock mode has them.
3. Pick an icon and a test for the skill, or reuse the generic play-along.
4. Record a real expert take with the gloves once they arrive; the synthesised guide is only a stand-in.
