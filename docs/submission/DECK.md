# Geppetto: pitch deck outline (draft)

Draft by the `submission` lane, Sat 14 Nov 2026. One row per slide: the claim, the fact or picture it carries, and the source. "Unverified" marks a claim with no source. Design rules from CLAUDE.md: Renaissance bottega theme, gold only for mastery, vermilion only for corrections, malachite for correct, text at least 16 px, no status pills, "expert" not "master", "the AI Assistant" for any language model in product copy.

Pitch slot: Sunday 14:00 (arpan_info.md). Length of the slot: unverified.

## Slides

| # | Title (the claim) | Fact or picture | Source |
| --- | --- | --- | --- |
| 1 | Geppetto | Screenshot of `/robot`: human hand, Dex3-1 twin, strings between the fingertips | `frontend/docs/screens/robot-core-0*.png` (from the real capture) |
| 2 | A video cannot say which finger is wrong | Hand skills are taught one learner at a time. Cameras and microphones do not know which finger did what, especially under a racket grip | PRODUCT.md "Positioning", docs/ideas/PITCH.md |
| 3 | In 1490 you learnt by copying the expert's hands | Bottega picture. Line: "Now the expert's hands are a file" | docs/ideas/PITCH.md (picture source: unverified, pick a public-domain image) |
| 4 | One glove stream, three uses | Diagram: Rokoko gloves to the core; out to the learner (score), the robot (Dex3-1 targets), the dataset (LeRobot) | README.md, DECISIONS.md D25, STATUS-export.md |
| 5 | The gloves drive a robot hand | 18 human angles to 7 Dex3-1 joints, limits from Unitree's URDF, fidelity per finger, ring and little shown as missing. Served on `/ws/robot` at 30 Hz | DECISIONS.md D25, RECONCILE.md section 0 |
| 6 | The robot twin | Screen grab of `/robot` with the source switch: Expert glove, Apprentice glove, Lesson, Off | `frontend/STATUS-robot-view.md` |
| 7 | Teaching people with the same stream | Training room, marionette strings, one string in vermilion; score card with "The one to fix" | README.md, STATUS-weights.md |
| 8 | Scored per finger, from the wearer's own range | Each angle measured from the wearer's flat hand and scaled to the wearer's fist. Table: right pose passes 100%, wrong pose passes 3% (92 and 450 frames, 15 / 60 degree dead zone) | STATUS.md "Calibrated angles", STATUS-core.md |
| 9 | Real gloves, measured | Table: 2 gloves at 83.3 Hz; 3 of 3 held poses passed in 2 s (0.95, 0.995, 1.00); about one hour of raw capture kept | STATUS.md "Glove slot" |
| 10 | Every lesson is a robot demonstration | LeRobot episodes: glove state as observation, Dex3-1 targets as action. Loads with LeRobot's own loader. Say: tested on synthetic lessons so far | STATUS-export.md |
| 11 | Gemma on Verda writes the lesson | Gemma 4 31B on one H200: 458 s cold start, 10.2 s and 19.1 s per lesson, 6 of 6 valid, 3.94 USD in total. With the sketches, Gemma kept the step order | docs/VERDA.md |
| 12 | Fast judgements stay fast | Closed-set coach choices on the Gemini Decisions API: 180 to 330 ms warm, rules when offline. The scorer judges, the AI Assistant explains | `decisions/STATUS-decisions.md`, docs/ideas/PITCH.md |
| 13 | What did not work | Typing finger detection on real gloves: 4% to 6% chart match. Left glove calibration needs a redo. Robot twin not yet tried on live gloves | STATUS.md, STATUS-typing.md, `frontend/STATUS-robot-view.md` |
| 14 | Next: real hardware, safely | Forward `/ws/robot` to a real hand with a rate limit, a force cap and an e-stop. Fragile grasp needs force readback | arpan_info.md sections 4.3 and 4.5 |
| 15 | Who pays | Experts publish, learners buy or subscribe, robot teams use the demonstration library. Fee and price undecided. No users or revenue yet: say "to be tested" | PRODUCT.md, docs/ideas/PITCH.md |
| 16 | Geppetto. The expert pulls the strings | Same picture as slide 1. Team names and repository link | STATUS.md, arpan_info.md (repository link: unverified, see PROJECT.md) |

## Numbers on the slides

Use only these. Each comes from the named file.

| Number | Meaning | Source |
| --- | --- | --- |
| 83.3 Hz | Solver rate per glove in the glove slot | STATUS.md |
| 30 Hz | Core tick: score, ghost and robot targets | STATUS.md |
| 7 | Dex3-1 joints driven (thumb 3, index 2, middle 2) | STATUS.md, DECISIONS.md D25 |
| 18 | Human angle features per hand | STATUS.md |
| 100% and 3% | Right pose and wrong pose pass rates, calibrated, 15 / 60 | STATUS.md |
| 0.95, 0.995, 1.00 | Held pose scores with the same glove | STATUS.md |
| 458 s | Verda cold start to healthy | docs/VERDA.md |
| 10.2 s and 19.1 s | Gemma lesson calls with pictures | docs/VERDA.md |
| 3.94 USD | Total Verda spend at list price | docs/VERDA.md |
| 203, 255, 296 | Tests on main: core and decisions, backend, frontend | STATUS.md |

## Rules for the stage

From docs/ideas/PITCH.md, kept:

- Never say "first ever".
- Never quote earnings, users or prices as real. Say "placeholder" or "to be tested".
- Say "scored by our algorithm, explained by the AI Assistant", so nobody thinks the language model is the judge.

Added from the lane notes:

- Say "recorded" or "played back" for every glove shot after 14:30 Saturday. The gloves were returned (STATUS.md).
- Say "twin" or "simulated robot". No real robot hand was driven (arpan_info.md section 4.3).
- Do not show the Arduino scoreboard or fingertip haptics. PRODUCT.md plans them; no status note says they were built (unverified).
