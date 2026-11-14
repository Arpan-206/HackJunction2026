# Geppetto: project description (draft for the Junction 2026 submission form)

Draft by the `submission` lane, Sat 14 Nov 2026. Every fact names its source file. A claim with no source says "unverified". The form's field names and length limits are unverified: cut to fit.

Words used below:

- **Glove**: one Rokoko Smartglove II. It reports the rotation of every finger joint and of the wrist.
- **Expert**: the person who records a skill. **Learner**: the person who trains against it.
- **Core**: our Python service that reads the gloves, scores the learner and drives the robot hand (`core/`).
- **Retarget**: convert human finger angles into joint targets for a robot hand with a different shape.
- **Dex3-1**: Unitree's three-finger robot hand (7 joints: thumb 3, index 2, middle 2).
- **DTW (dynamic time warping)**: a method that lines up two motions of different speeds before it compares them.

## One line

Geppetto records an expert's hands with Rokoko gloves, then teaches the skill to a learner and to a robot hand.

## Short description (about 100 words)

Hand skills are taught in person, one learner at a time. A video cannot say which finger is wrong. Geppetto records an expert once with Rokoko Smartgloves II. A learner then trains against the expert's ghost hand and sees which finger is off. The same glove stream drives a Unitree Dex3-1 robot hand twin in real time. Marionette strings join each human fingertip to the robot fingertip. Every recorded lesson also exports as a robot demonstration dataset in LeRobot format. A large Gemma model on a Verda GPU turns a raw recording into a written lesson.

## What it is

Geppetto is a hand-skill trainer and a robot teleoperation tool built on one glove stream (README.md, arpan_info.md section 0).

1. An expert records a skill with the gloves. The core cuts the take into steps and keeps a key pose for each step (STATUS.md, `core/recorder.py`).
2. A learner trains against the expert in 3D. Guidance comes as a ghost hand, a shadow or marionette strings (README.md).
3. The core scores each finger 30 times a second. It names the one finger to fix (STATUS.md, `core/scorer.py`).
4. The core retargets the same finger angles to Dex3-1 joint targets. The frontend draws the robot hand and moves it (RECONCILE.md, `frontend/STATUS-robot-view.md`).

The name: Geppetto is the woodcarver who pulls the strings. The robot hand is the puppet (arpan_info.md section 4.1, "Geppetto drives Pinocchio").

## Who it is for

| User | Need | Source |
| --- | --- | --- |
| Experts (pianists, table tennis coaches, later rehab therapists, guitar teachers) | Record a technique once and reach many learners | PRODUCT.md |
| Learners | Train with feedback on exactly which finger is wrong | PRODUCT.md |
| Robot teams | Human hand demonstrations to train robot policies | arpan_info.md section 0, STATUS-export.md |

No real experts, users, prices or earnings exist yet (PRODUCT.md, "Evidence on Hand").

## How it works

| Stage | What happens | Source |
| --- | --- | --- |
| Gloves in | The core reads the Rokoko hand solver directly (26 joints per hand) and the driver for the button and LED | STATUS.md |
| Calibration | Each angle is measured from the wearer's own flat hand and scaled by the wearer's flat-to-fist range | STATUS-core.md |
| Record | Takes are cut into hold and move steps at still moments | STATUS.md |
| Weights | Each finger gets a weight per step, from the expert's consistency across takes, the task's finger chart and the calibration | STATUS-weights.md |
| Score | Per-finger error, 30 Hz, a weighted overall score shown as 0 to 100, one hint for the worst finger | STATUS.md, RECONCILE.md section 0 |
| Robot | 18 human angles to 7 Dex3-1 joint targets, clamped to the limits in Unitree's own URDF files, with a fidelity value per robot finger | DECISIONS.md D25 |
| Robot view | `/robot` screen, a pane in the training room and a fold in the expert studio. The robot follows the expert, the learner or the lesson | `frontend/STATUS-robot-view.md` |
| Dataset | Lessons export as LeRobot episodes: glove state in, Dex3-1 targets as the action | STATUS-export.md |
| Lesson writing | The AI Assistant drafts steps from a sentence or a recording. Scoring never uses it | README.md, docs/VERDA.md |

The app has two halves (RECONCILE.md section 0). The core owns the gloves and the live score. The backend (FastAPI) and the frontend (React, three.js) own lessons, the expert and learner screens and the AI Assistant. A bridge feeds the core's glove frames into the backend.

## Rokoko Robot Teleoperation Challenge

The track asks teams to control robot hands, arms or humanoids with Rokoko motion capture. Rokoko's stated interests are fragile manipulation, human demonstrations for robot policies and creative uses (arpan_info.md section 0).

| What the track wants | What Geppetto does today | Status | Source |
| --- | --- | --- | --- |
| Rokoko gloves drive a robot hand | Glove angles retarget to Dex3-1 joint targets, served on `/ws/robot` at 30 Hz | Works on real glove captures; the robot is a 3D twin, not hardware | DECISIONS.md D25, `frontend/STATUS-robot-view.md` |
| A robot to see | Dex3-1 twin drawn from the URDF, strings from human to robot fingertips, ring and little fingers shown as missing | Works in mock mode, on `--fake` and on the real capture replay | `frontend/STATUS-robot-view.md` |
| Human demonstrations for robot learning | Lessons export as LeRobot episodes; the dataset loads with LeRobot's own loader | Tested on the two synthetic lessons only | STATUS-export.md |
| Real robot hardware | Not built. Forwarding `/ws/robot` to a real hand needs a rate limit, a force cap and an e-stop | Not started | arpan_info.md section 4.3 |
| Fragile objects | Not built. Needs a hand with force readback | Not started | arpan_info.md section 4.5 |

Rotation direction for `thumb_0` and `thumb_1` on the real Dex3-1 is unverified (STATUS.md).

## What is real today

Measured on real Smartgloves II, Sat 14 Nov (STATUS.md, "Glove slot"):

| Measure | Value |
| --- | --- |
| Gloves | 2, both solved at 83.3 Hz, both tracked in the core |
| Held pose copied by the same glove | 3 of 3 hold steps passed within 2 s; scores 0.95, 0.995, 1.00 |
| Expert copies own three-take continuous lesson | Scores in the mid 70s (a lesson and margin problem, not sensing) |
| Raw capture kept | About 1 GB solver plus 0.3 GB driver for the hour (STATUS.md also gives 1.5 GB in total), replayable with `--replay` |

Measured offline on a real worn capture (STATUS.md, "Calibrated angles"; dead zone 15 / 60 degrees, pass at 0.85):

| Pose pairs | Frames | Passes |
| --- | --- | --- |
| Right pose (same phase) | 92 | 100% |
| Wrong pose (other phase) | 450 | 3% |

Tests on `main` (STATUS.md, handover section):

| Suite | Tests |
| --- | --- |
| Core and decisions | 203 |
| Backend | 255 |
| Frontend | 296, plus lint and build |

What did not work, said plainly:

| Item | Result | Source |
| --- | --- | --- |
| Typing finger detection on real gloves | 17% and 31% of keys got a clear finger; 6% and 4% matched the chart. The solver's angles do not show keystrokes | STATUS.md |
| Left glove calibration in the slot | Ranges 0.7 to 8 degrees: loose or mis-seated, redo it | STATUS.md |
| Robot twin with live gloves | Not tested; only the recorded capture was used | `frontend/STATUS-robot-view.md` |
| LeRobot export of a real-glove lesson | Not run; only synthetic lessons | STATUS-export.md |

The gloves were returned at 14:30 on Saturday (STATUS.md). Everything shown after that runs on captures, the fake gloves or mock mode.

## Verda angle

Gemma 4 31B ran on a Verda Serverless Container with one H200 GPU, behind vLLM (docs/VERDA.md). It reads the key pose sketches of a glove recording and a short text digest of the trace. It writes the lesson JSON that the backend already stores and teaches. This is the slow step: it runs once per recording, before practice.

| Measure | Value |
| --- | --- |
| Cold start, container start to healthy | 458 s |
| Lesson call, pictures plus trace | 10.2 s and 19.1 s |
| Valid lesson on the first attempt | 6 of 6 calls |
| Total spend, list price | 3.94 USD |

With the sketches, Gemma kept the recorded step order on both takes. Without them, it reordered or merged steps (docs/VERDA.md). The deployment is torn down (verda/STATUS-verda.md). The backend can now use the endpoint as an `openai` provider (source: git log, commit `4785ddd`; STATUS.md still lists it as a patch).

## Other parts built during the weekend

| Part | Status | Source |
| --- | --- | --- |
| Fast coach decisions on the Gemini Decisions API (closed-set choices in 180 to 330 ms warm) | Registered in the core, rule fallback with no key | `decisions/STATUS-decisions.md`, `core/server.py` |
| Our own iPhone depth app (ARKit scene depth over USB, 29.8 fps) | Measured live; not yet wired into the hand tracker | STATUS.md |
| One script for the live glove stack (`scripts/live.sh`, `scripts/stop.sh`) | Used in the glove slot | STATUS-rokoko-setup.md |
| Margin of error, AI Assistant switch, props off by default | In the app | README.md |

## Team

Arpan Pandey (core, robot output, lanes) and Szymon Arciszewski (backend, frontend, glove screens), from STATUS.md and arpan_info.md. Roles are unverified as worded: confirm before you submit.

## Links to fill in

- Repository: unverified (the remote is `Blacbrd/HackJunction2026` per `decisions/STATUS-decisions.md`; check it is public).
- Video: to be filmed, see VIDEO.md.
- Demo page: none.
