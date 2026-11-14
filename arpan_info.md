# arpan_info.md: handover from Szymon's side

Written Sat 14 Nov 2026, late morning (Helsinki), for Arpan and Arpan's agent. Read this, then CLAUDE.md, RECONCILE.md and STATUS.md. Everything below is on `main` unless a branch is named. Final submission is Sunday 10:00, the pitch is 14:00 and challenge winners are announced at 15:10.

## 0. The one thing to know

The track is Rokoko's **Robot Teleoperation Challenge**: control robot hands, arms or humanoids with Rokoko mocap, on real hardware or in simulation. Their stated interests are:

- precise manipulation of fragile objects, tools and liquids;
- collecting human demonstrations to train robot policies;
- creative uses.

So far we use the gloves only for the screen. Szymon wants the robot hand to be central, keeping the expert and learner idea and the games. Arpan has already started: `core/robot.py` retargets the 18 angles to Unitree Dex3-1 joint targets and serves them on `/ws/robot` and as `frame.robot` (DECISIONS.md D25). **The frontend renderer for that robot block does not exist yet.** It is the top open task (section 4.1).

## 1. Ground rules both agents follow

- Commits are authored by the user only, with no `Co-Authored-By`, `Claude-Session` or "Generated with" lines. Szymon's side commits and pushes to `main` after its checks pass. Ask before any force push.
- **No em dashes** anywhere: code, docs or commits.
- Rule 9 in CLAUDE.md:
  - `core/`, `schema/`, `tools/`, `tests/`, `lessons/`, `config.toml`, `SPEC.md`, `RECONCILE.md`, `STATUS.md` and `DECISIONS.md` belong to Arpan's side. Szymon's side never edited them.
  - There is one glove path (the core) and one retargeting path (`core/robot.py`). Do not add a competing one in `backend/` or `frontend/`.
- **Formatter hook on Szymon's machine:**
  - Szymon's Claude Code has a Stop hook that runs `ruff format` on the whole repo at the end of every turn. On his checkout it reformats about 95 files, including `core/` and `SPEC.md`.
  - None of those diffs were ever committed. If you see formatting-only changes in a diff from his machine, they are noise: `git restore --worktree -- .`
  - Open question: switch the hook off for this repo, or exclude your folders.
- **Never call RCSP `GetNetworkConfiguration`.** It returns the Wi-Fi SSID and password in clear text.
- Never print, copy or commit `backend/.env`; it holds the Gemini key. Tests never call paid APIs.
- Python uses uv only. Playwright comes from `genui/node_modules`. The walk scripts launch the system Chrome with `channel: 'chrome'`.
- After `git fetch --all`, use `git merge --ff-only origin/main`, not `git pull`, which fails with "Cannot fast-forward to multiple branches".

## 2. What Szymon's side built (all on main, newest first)

| Area | What | Where |
| --- | --- | --- |
| Robot research | The teleop pivot: hardware facts (Inspire RH56, G1 and Dex3-1, Booster T1, Coil Pro), retargeting, safety, three concepts, a 24 hour plan, mentor questions and schematics in text | `research/12_robot_teleop.md` (read the update note at its top: retargeting is now in the core) |
| Glove status screen | `/gloves`: per glove link, frame rate, last frame age, sensors, battery "unknown" (Rokoko reports none), a live hand, and a fix step for each problem (missing glove, driver or solver down, Studio open, saturated sensors, low rate) | `frontend/src/features/shared/gloves/` (GlovesScreen, CalibrateScreen; routes in `frontend/src/app/App.tsx`), backend `backend/app/api/routes/gloves.py`, `backend/app/services/gloves/` |
| Calibrate gloves | `/gloves/calibrate`, 4 steps (connection, start pose, range, check). Per-wearer neutral pose with a quality band, optional RCSP `ReinitAlgo` | same files; `docs/CONTRACT.md` section "Real gloves: status, calibration area, demo mode" |
| Demo mode | Settings switch plus wearer name. Skips calibration, loads the last one, then a 2 s hold-still drift check | `frontend/src/features/shared/SettingsDialog.tsx`, `POST /gloves/drift_check` |
| Glove verification | Offline replay tests on real RGMP captures (rate, finger isolation, flex axis); opt-in live tests (`-m hardware`, `GLOVES_EXPECT=both/left/right`); a guided `glove_check.py` | `backend/tests/test_glove_rgmp_replay.py`, `backend/tests/test_glove_live.py`, `backend/tests/fixtures/rgmp/`, `backend/scripts/glove_check.py`, `docs/HARDWARE_INTEGRATION.md` (last section) |
| Skinned hand | WebXR generic-hand glTF (MIT, Amazon), skinned, 25 joints. Styles: sketch, chalk, wood, ghost | `frontend/public/models/hands/` (LICENSE.md), `frontend/src/three/handModel.ts`, `handPose.ts`, `handRig.ts`, `materials.ts` |
| New skills | Shadow puppets (lamplit wall theatre), surgical grips, crochet. All propless; a chalk sketch replaces props when they are off (the default) | `backend/app/data/moves.json`, seeds, `frontend/src/three/ShadowTheatre.tsx`, `sketchProps.tsx`, `research/11_new_skills.md`, `docs/ideas/SKILL_IDEAS.md` |
| Settings | AI Assistant switch (gates every language-model call), margin of error, 3D or flat score, Add a prop, reduced motion | `frontend/src/features/shared/settings.ts`, `SettingsDialog.tsx`, `assistant.ts` |
| Margin of error | strict 0.6, standard 1.0, relaxed 1.5, just_trying 2.5, multiplying tolerance and hint thresholds | `backend/app/constants.py` `MARGIN_MULTIPLIERS`, `frontend/src/api/margin.ts` |
| Design proposals (not built, need your approval) | Capture every glove stream (49 per glove) for training data; an iPhone LiDAR wrist-position source | `docs/ideas/CAPTURE_ALL_STREAMS.md`, `docs/ideas/IPHONE_LIDAR.md` |

### What the real gloves showed (measured on Szymon's two Smartgloves II)

- **Connection:** both gloves stream at 83.39 Hz per group over USB with zero gaps. Left id 1572077328, right 2811174587. Both report the same `HubSerialNumber`.
- **Driver behaviour:** it streams only after an RCSP `SubscribeToData` (or with `--auto-stream-usb`).
- **Heading reliable:** bit 11 of the hub `STATUS_FLAGS` on 12276; it is not visible on the solver's 12277.
- **Fingers:** flexion goes toward the palm (solver local X, negative). In the worn capture each finger moved on its own in its phase.
- **A flat hand is not zero:** index about 37 degrees, middle 27, ring 26 to 33, little 59 to 79, thumb about 70. So per-wearer flat and fist calibration matters.
- **Live tests:** 13 of 13 pass with both gloves and the solver running. The core works unchanged on the real gloves through route B, but the wrist orientation is wrong until the core's calibrate runs.
- **Solver command:** `rkk-hand-solver.exe --no-driver --emit both --emit-openxr --listen 127.0.0.1:12277`

## 3. Decisions waiting (need Arpan or Szymon)

1. **`config.toml` `hand_from_device_id_parity = true` (line 39).**
   - Real device ids are hardware ids, so the parity is right only by chance.
   - The solver always sends `device_info.hand`.
   - We proposed `false`, plus comments on the verified solver stream layout (group 2 with `--emit both`, 26 TRANSFORM FLOAT[7] streams, no STATUS_FLAGS on 12277).
   - Your `815f1eb` already fixed the replay pacing half of that proposal.
2. **CONTRACT.md additions.** The glove routes (`/gloves/*`) were added to the frozen CONTRACT.md as additive only. Approve or move them.
3. **Formatter hook.** Off, or exclude `core/` and the other root folders (section 1).
4. **Geppetto rename checklist in CLAUDE.md.** Not done yet.
5. **Capture-all-streams and iPhone LiDAR proposals.** Both touch the core's input side, so they are yours to accept or drop.
6. **`ROKOKO_FLEX_SIGN`** in `backend/app/constants.py` (Studio path only) is probably -1, because flex is negative X. Verify with `backend/scripts/probe_flexion.py`.

## 4. What still needs finishing, in priority order

### 4.1 Robot twin in the frontend (top priority, no hardware needed)

- **Data:** read `ws://localhost:8765/ws/robot`. The `hello.robot` message gives joint names and limits; each tick gives `q`, `q_norm`, `fidelity` and `missing` (`schema/robot.json`). Pick the source with `set_robot_source` (`master`, `learner`, `lesson`, `off`).
- **Drawing it:**
  - The Dex3-1 URDFs in `models/robots/dex3_1/` reference STL meshes that are not in the repo.
  - Either fetch the meshes from `unitreerobotics/unitree_ros` (BSD-3), or draw the 7 joints as simple capsules from the URDF joint origins.
- **Where it goes:**
  - A three.js view beside the human hand in the training room and the expert studio.
  - Marionette strings run from the human fingertips to the robot fingertips (the "Geppetto drives Pinocchio" picture).
  - Fidelity is shown per finger, with ring and little marked as missing on Dex3-1.
- **Mock mode:** the frontend needs a robot block in `frontend/src/mock/` so the twin works offline. Port the retarget table from `config.toml`, or replay a recorded `/ws/robot` log with `tools/ws_log.py`.

### 4.2 Robot replay scored like a learner (concept 1 in research/12)

- Play an expert's lesson on the robot (`set_robot_source lesson`).
- Read back what the robot actually did. With the twin only, that is its targets clamped by the URDF limits; with real hardware, the joint states.
- Score that against the lesson with the existing scorer.
- Show "the robot is the apprentice" with a per-finger score.

### 4.3 Real hardware

- **Ask the mentors first** (full lists in `research/12_robot_teleop.md` section 8.1). Rokoko: which hands and arms are free, G1 booking, an Inspire example, Coil Pro, the judging criteria. Aalto Robotics Club: their Inspire code, the model, port and voltage, arm or stand, safety rules, a USB to RS-485 adapter.
- **What we know about the hardware:**
  - The Aalto starter repo is `zupermiez/aaltonomous-humanoid` (per D25).
  - The G1 Dex3-1 is commanded over DDS (CycloneDDS, Ethernet, a Linux laptop is best), topic `rt/dex3/right/cmd` or `left`.
  - Whether we may command the G1 at all is not confirmed.
- **Inspire hand:**
  - If an Inspire RH56 is what we get, it takes 6 values from 0 to 1000 (little, ring, middle, index, thumb bend, thumb rotate) at `ANGLE_SET` register 1486, over RS-485.
  - That would be a second model in your `[robot]` config, not a new path.
  - Which end of 0 to 1000 is open must be checked with a slow ramp.
- **Driving it:** a small process that forwards `/ws/robot` `q` to the hardware with a rate limit, a force cap and an e-stop. It must not retarget.
- **Safety:** clamp the hand. Put an e-stop in its power line and keep a second person at it. The audience stays at least 1 m away.

### 4.4 Demonstration dataset export (concept 2, no robot needed)

- Score each take, then export only the takes above a threshold as LeRobot episodes: time, state (glove joints) and action (robot `q`).
- Show "kept N of M" in the UI, and prove the dataset loads with `lerobot`.
- Check the field names against the LeRobot v3 spec first; we have not read it.

### 4.5 Fragile grasp (concept 3, needs a real hand with force readback)

- Use a grip governor that stops each finger at a force cap, with live force bars.
- Start with a paper cup and keep the egg for last.
- Dex3-1 force and tactile readback is unverified. The Inspire `FORCE_ACT` register is 1582.

### 4.6 Hand mesh round 2 (branch `hand-round-2`, NOT merged)

- **What it changes:**
  - It replaces the hand mesh with the CC0 Godot XR Tools hand, uses dual quaternion skinning, and darkens creases.
  - Fists read better, the score view hand is clearly better, and the table tennis grip is better.
- **Why it is not merged:** with it, `node frontend/e2e/settings-walk.mjs` hangs at the phone-width step.
  - The cause was profiled: the main thread sits 26 to 38 s in `WebGLRenderer.forceContextLoss` when the training room canvas unmounts as the score appears.
  - That happens at phone width only; at 1440x900 it renders fine.
- **Ruled out:** bad skinning maths, the dual quaternion shader cost, and the mesh.
- **Next steps:**
  - Bisect on 03c82a8 and `f1c7d21`.
  - Look at deferring or skipping `forceContextLoss` on unmount (`frontend/src/three/Stage.tsx`).
- **Also on that branch:** the sepia sketch turntable regressed (the back of the hand reads as a mitten).
  - A work-in-progress fix is in `docs/handover/hand-wip-slender-and-dq.patch`. It applies to `frontend/src/three/` on `hand-round-2`: slimmer fingers, a shorter palm, and knuckle angles measured from the palm axis.
  - The patch breaks `handPose.test.ts` (straight finger, 0.146 rad off) and three `shadowTheatre.test.ts` framing cases. Lint, build and the walks were not run on it.
- **If time is short:** drop the branch. Main's hand is acceptable.

### 4.7 Smaller items

- **Neutral offsets not applied:** the per-wearer offsets from `/gloves/calibrate` are stored but not yet applied to the live stream.
- **Not yet tried on real hardware:**
  - starting and stopping the solver from the app;
  - `ReinitAlgo`;
  - the `not_streaming` fix step;
  - the wrist yaw convention used by the drift check.
- **Design board** (artifact) still shows the old hand, and the shadow puppet screenshots use the old hand.
- **Untracked files** in Szymon's checkout: `frontend/docs/screens/settings-zz-failure.png` (a failure shot) and `persisted_settings.json` (an empty device store written by a glove run). Neither is committed.

## 5. How to check everything

Expected results at handover are in section 6.

```bash
# backend (in backend/)
uv sync && uv run pytest -q
# live gloves, solver running (see the command in section 2)
uv run pytest -q -m hardware tests/test_glove_live.py      # GLOVES_EXPECT=right when one glove is plugged in
uv run python scripts/glove_check.py                       # guided, wearing the gloves

# frontend (in frontend/)
npm install && npm run lint && npm test && npm run build
E2E_PORT=5301 node e2e/mock-walk.mjs
E2E_PORT=5302 node e2e/settings-walk.mjs
E2E_PORT=5303 node e2e/gloves-walk.mjs

# core (repo root)
python -m pytest -q
```

## 6. Status at handover

See the commit that adds this file. At that commit:

- backend: 247 passed and 13 skipped (live glove tests skip without hardware);
- frontend: 253 tests, lint and build pass;
- mock-walk, settings-walk and gloves-walk pass.

## 7. Every project artifact (claude.ai pages)

All five are shared by link (Szymon turns on link sharing from each page's Share menu). If one will not open, ask Szymon to check its Share setting.

| Page | What it holds | Link |
| --- | --- | --- |
| Geppetto hub | Start here: screenshots of the build (hand, score views, Settings, shadow puppets, glove screens), decisions waiting, today's changes, links | https://claude.ai/artifact/CcSJ4wfWbaqnYJCfonRkfm |
| Geppetto robot schematics | The teleop pivot drawn: one bridge and five robot targets, glove fingers to robot motors, the three concepts, bench layout, wiring, mentor questions. Drawn before `core/robot.py`: its "retarget" in the bridge is now the core's job; the bridge only forwards `/ws/robot` to hardware | https://claude.ai/artifact/1nLRRNLAVHLmks8AFyodK3 |
| Apprentice design round 3 | The design direction the user picked: Parchment Codex (sepia sketch on brown paper) for the expert, walnut and plaster for the learner, always 3D. Still shows the old hand | https://claude.ai/artifact/BG5mphDufXaPcBzYYoLwmS |
| Apprentice app design | The first design canvas (rounds 1 and 2), kept for history | https://claude.ai/artifact/35Fb6hX92PJXUcYgdUvE1U |
| Apprentice overnight build log | Timeline of the Friday night build | https://claude.ai/artifact/CBPyisHXFDzmBn1Kho6TkN |
