# Geppetto: two minute video (draft shot list and script)

Draft by the `submission` lane, Sat 14 Nov 2026. Film it tonight with a phone pointed at the laptop screen. No gloves are needed: they were returned at 14:30 (STATUS.md). Every glove shot below plays a real capture or the fake gloves, and the script says so.

Words used below:

- **Core**: our Python service that reads the gloves, scores and drives the robot hand.
- **Replay**: the core plays a raw glove recording as if the gloves were live.
- **Mock mode**: the frontend runs alone, with a simulated glove and sample data.
- **Twin**: the 3D Dex3-1 robot hand on screen.

The commands come from STATUS.md, README.md and the lane notes. This lane did not run them again tonight. Do the dry run (section "Before you film") first.

## Before you film (10 minutes)

| Step | Command or action | Expect | Source |
| --- | --- | --- | --- |
| 1 | Close every other lane's core on port 8765 (`lsof -i :8765`) | Port free | STATUS-rokoko-setup.md |
| 2 | Repo root: `source .venv/bin/activate` | Venv on | STATUS.md |
| 3 | `gunzip -c backend/tests/fixtures/rgmp/worn_solver.rgmp.gz > /tmp/worn_solver.rgmp` | A raw capture of worn Smartgloves II | STATUS.md |
| 4 | Terminal A: `python -m core --replay /tmp/worn_solver.rgmp --replay-loop` | Core on 8765, both hands tracked | STATUS.md, `frontend/STATUS-robot-view.md` |
| 5 | Terminal B, in `frontend/`: `npm run dev` | App on `http://localhost:5173` | README.md |
| 6 | Browser at full screen, zoom so text reads on a phone. Close other tabs | Clean frame | none |
| 7 | Set the phone to 1080p or 4K, landscape. Lock focus and exposure on the screen | No pumping light | none |
| 8 | Open the second terminal with large text for shots 6 and 7 | Readable | none |

Shots 3 to 5 use mock mode in a second browser tab: `http://localhost:5173/apprentice?mock=1`. Mock mode is remembered. Use `?mock=0` to leave it (README.md).

## Shot list

Total: 120 s. Times are targets. Cut shot 7 first if you run long.

| # | Time | Length | On screen | How to get it | Say |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00 | 10 s | Role picker at `/`, then a slow push in on the title | `http://localhost:5173/` | "Hand skills are still taught one person at a time. A video cannot tell you which finger is wrong." |
| 2 | 0:10 | 25 s | `/robot`: the human hand, the steel Dex3-1 twin, strings from fingertip to fingertip, the fidelity bars, ring and little hanging loose | Rail entry "Robot". Pick "Apprentice glove" | "This is Geppetto. These are real Rokoko Smartgloves II, recorded today and played back. Our core turns each finger angle into targets for a Unitree Dex3-1 robot hand. The strings show what the robot copies. It has no ring or little finger, so those strings hang loose." |
| 3 | 0:35 | 20 s | Learner training room in mock mode, marionette guidance, a string turns vermilion | `/apprentice?mock=1`, open a skill, start a step, choose marionette guidance | "The same stream teaches people. An expert records a skill once. A learner trains against the expert's hands. When one finger is wrong, its string turns red." |
| 4 | 0:55 | 15 s | Score card: per-finger score and "The one to fix" | Finish the step in shot 3 | "Every finger is scored on its own. The learner sees the one finger to fix. A camera cannot see that under a racket grip. A glove can." |
| 5 | 1:10 | 15 s | Expert studio: a lesson drafted from one sentence | `/expert?mock=1`, generate a lesson from one sentence | "Experts do not write lessons by hand. The AI Assistant drafts the steps. Our scorer judges the hands, not the AI Assistant." |
| 6 | 1:25 | 15 s | `docs/VERDA.md` comparison table, then one lesson JSON from `verda/out/compare/` | Open `docs/VERDA.md` in the editor; then `verda/out/compare/worn-solver-right-gemma-pictures.json` | "For a raw recording we ran Gemma 4 31B on a Verda H200. It read the step sketches and wrote a valid lesson in 10 to 19 seconds. The whole run cost 3.94 dollars." |
| 7 | 1:40 | 12 s | Terminal: the LeRobot export and its test | `cd export && uv run geppetto-export`, then `uv run pytest -q` | "Every lesson is also a robot demonstration. Glove angles go in, robot joint targets come out, in LeRobot format." |
| 8 | 1:52 | 8 s | Back to `/robot`, wide shot, the twin moving | Same as shot 2 | "Geppetto. The expert pulls the strings. The learner and the robot follow." |

## Notes per shot

| # | Note |
| --- | --- |
| 1 | The product name on screen may still read "Apprentice": the rename checklist in CLAUDE.md is open. If it does, start on `/robot` instead and say the title line over it |
| 2 | The source panel says why a source is silent. "Expert glove" sends nothing in replay, because no hand has the expert role. "Lesson" sends nothing, because no lesson is loaded (`frontend/STATUS-robot-view.md`). Use "Apprentice glove" only |
| 2 | Do not say "live". The capture is real; the playback is not live |
| 3 | In mock mode the glove is simulated. If the simulated hand never goes wrong on its own, the vermilion string may not appear. Unverified: test it in the dry run. If no string turns red, cut the line "its string turns red" and show the strings only |
| 3 | The robot pane can show in the training room: Room settings, "Show the robot hand" (`frontend/STATUS-robot-view.md`). In mock mode it reads the mock robot. Unverified on camera |
| 5 | In mock mode the AI Assistant is the offline stand-in, not a real model (README.md: `LLM_PROVIDER=fake` is the default). Do not name a provider in the voice-over. CLAUDE.md rule 6: user copy says "the AI Assistant" |
| 6 | Do not deploy on Verda tonight. The brief forbids spend and the deployment is torn down. Show the stored results only. Say "we ran", past tense |
| 7 | Tested on the two synthetic lessons only (STATUS-export.md). Do not say "real" about this dataset. Optional: show the passing test line, which loads the result with LeRobot's own loader |
| 8 | Mock mode is remembered in the browser. Film shot 8 in the tab from shot 2, or open `/robot?mock=0`. The robot socket tries the core on 8765 first in either case (`frontend/STATUS-robot-view.md`) |
| 8 | Hold the last frame for 2 s so the edit can fade |

## Script in one block (for a teleprompter app)

Hand skills are still taught one person at a time. A video cannot tell you which finger is wrong.

This is Geppetto. These are real Rokoko Smartgloves II, recorded today and played back. Our core turns each finger angle into targets for a Unitree Dex3-1 robot hand. The strings show what the robot copies. It has no ring or little finger, so those strings hang loose.

The same stream teaches people. An expert records a skill once. A learner trains against the expert's hands. When one finger is wrong, its string turns red.

Every finger is scored on its own. The learner sees the one finger to fix. A camera cannot see that under a racket grip. A glove can.

Experts do not write lessons by hand. The AI Assistant drafts the steps. Our scorer judges the hands, not the AI Assistant.

For a raw recording we ran Gemma 4 31B on a Verda H200. It read the step sketches and wrote a valid lesson in 10 to 19 seconds. The whole run cost 3.94 dollars.

Every lesson is also a robot demonstration. Glove angles go in, robot joint targets come out, in LeRobot format.

Geppetto. The expert pulls the strings. The learner and the robot follow.

Word count: about 200. At a calm 150 words a minute that is about 80 s of speech, so the 120 s leaves room for pauses and screen time.

## Facts the script uses

| Line | Fact | Source |
| --- | --- | --- |
| Shot 2 | Real Smartgloves II capture; Dex3-1 targets; ring and little missing | STATUS.md "Verified on real data", DECISIONS.md D25, `frontend/STATUS-robot-view.md` |
| Shot 3 | Marionette strings, vermilion for the wrong finger | README.md, docs/ideas/PITCH.md |
| Shot 4 | Per-finger score, "The one to fix", racket grip hides the hand from a camera | STATUS-weights.md, PRODUCT.md "Positioning" |
| Shot 5 | The AI Assistant drafts steps; the scorer is algorithmic | README.md |
| Shot 6 | Gemma 4 31B, H200, 10.2 s and 19.1 s, 6 of 6 valid, 3.94 USD | docs/VERDA.md |
| Shot 7 | LeRobot episodes, glove state as observation, Dex3-1 targets as action | STATUS-export.md |

## Optional extra shots (if you have time and the dry run passes)

| Shot | How | Fact | Source |
| --- | --- | --- | --- |
| Debug view of the core | `http://localhost:8765/debug` with the replay running | Both hands, curl values, score bars | STATUS.md |
| iPhone depth app on the bench | `ios/mac/forward.sh`, then the app on the phone | 29.8 fps over USB, table plane in every frame. Not yet wired into the hand tracker: say so | STATUS.md |
| Typing drill | `python -m core --fake`, then `/typing` | Right key, wrong finger. Real-glove finger detection did not work (4% to 6% chart match): show the fake only and say so | STATUS-typing.md, STATUS.md |
