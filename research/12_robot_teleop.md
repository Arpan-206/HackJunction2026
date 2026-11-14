# 12. Robot teleoperation pivot: Geppetto drives the robot hand

Written Sat 14 Nov 2026. Plain English. Every claim from the web has its source inline. Anything I could not confirm is marked **ASSUMED** or **UNCONFIRMED**.

## 0. Recommendation (read this first)

**Pivot line:** "Geppetto and Pinocchio. The human is the puppeteer, the robot hand is the puppet, the marionette strings on screen are the teleop UI. Every skill an expert teaches a human learner also teaches the robot."

Keep everything already built (expert studio, ghost, per-finger scorer, games). Add **one new process, `robot_bridge`**, that reads the core's `/ws` hands, retargets them to a robot hand's 6 numbers, and drives either the real hand or a simulated twin through the same message. Add a robot twin view and a "Teleop" mode to the frontend. No edits to `core/`.

Top 3 concepts, in build order:

1. **Live teleop plus "the robot is the apprentice"** (concepts a + b). The robot hand mirrors the glove live, and replays an expert's recorded lesson, scored by our existing per-finger scorer against what the robot actually did. Needs only the 6-number command stream. About 8 to 10 hours. Best wow per hour.
2. **Demonstration collection with the scorer as a quality filter** (concept c). Each lesson take becomes a robot training episode in LeRobot format; only takes above a score threshold are exported. Software only, so it works even if hardware access fails. About 4 to 6 hours. This answers the challenge's "collect human demonstrations to train autonomous policies" interest directly.
3. **Fragile-object grasp with live tactile or force readout** (concept d, egg or paper cup). Uses Inspire's per-finger force register and a force cap. Needs the real hand (the DFTP model adds a tactile map). About 4 hours after concept 1 works. This answers "precise manipulation, fragile objects".

Hardware facts that decide feasibility (details in section 2):

- The Inspire RH56 hands take **6 numbers, each 0 to 1000** (little, ring, middle, index, thumb bend, thumb rotate). Our core already outputs per-finger `curl` 0 to 1. A working first mapping is a one-line linear map per finger.
- The Inspire hand talks over **RS-485 (serial) or, on the tactile DFTP model only, Modbus TCP**. A USB-to-RS485 adapter and a free serial port is the whole wiring.
- On a **Unitree G1** the Inspire hand is reached through **DDS over Ethernet** (or serial on the G1's PC2). Who is allowed to command the G1 at Junction is **UNCONFIRMED**.
- **Confirmed at Junction:** a Hardware Lab by Arduino with **LeRobot arms** and Arduino UNO Q boards, and Aalto Robotics Club (AROC) helps run it ([Junction 2026](https://2026.hackjunction.com/), [Helsinki Robotics Week](https://helsinkiroboticsweek.com/)). The Inspire integration by AROC, and a Unitree G1, come from the challenge text you gave me, not from any page I could open.

Fallback ladder: real Inspire hand (best) then G1 hand then **simulation twin in our own app** (always works). Build the simulation twin first, because it is also the demo safety net.

---

## 1. What the judges want

### 1.1 The challenge text, decoded

The text you were given: "Use professional motion capture suits and gloves to control robotic hands, arms and humanoid robots... physically or in simulation." Interests: precise manipulation (fragile objects, tools, liquids), collecting human demonstrations through teleoperation to train autonomous policies, creative or entertainment uses.

What that tells us:

| Phrase | What it means for us |
| --- | --- |
| "robotic hands" listed first | A robot hand driven by the gloves is on-topic by itself. We do not need a humanoid. |
| "physically or in simulation" | A sim-only demo is allowed. A real robot moving is still the strongest thing on stage. |
| "fragile objects, tools, liquids" | The judges like force-aware grasps: egg, cup of water, a tool pick-up. Tactile or force numbers on screen help. |
| "collecting human demonstrations... to train autonomous policies" | The data story matters. Export episodes in a standard format (LeRobot), show a quality filter. |
| "creative or entertainment" | Games and puppetry are explicitly allowed. This is where our existing work scores. |

Junction's own judging, from the main page: each partner picks their own track winners against their own criteria, then a top 5 peer review ([Junction 2026](https://2026.hackjunction.com/)). The exact Rokoko scoring rubric is **UNCONFIRMED**. Ask the mentors (section 7).

### 1.2 What past Rokoko teleop demos looked like

- **YAAK.ai teleop rig** (Rokoko blog, 8 Sep 2026): 2 AgileX Nero 7-DOF arms, 2 BrainCo Revo2 Touch hands (6-DOF), 2 Smartgloves II and 1 Coil Pro. Pipeline: read RGMP, calibrate glove frame to robot frame with six directional movements, map five fingers to six motors, add a clutch (like lifting a mouse), damped least squares IK, smoothing filters. Validated in a simulator first, then recorded glove, robot and camera data (MCAP). Result: 221 demonstrations, a policy that did the task autonomously, control reliability 73.5 percent to 99.3 percent in one session. Honest problems listed: Coil can flip 180 degrees, accuracy degrades beyond about 1.1 m and within about 50 cm, IK pauses, a thumb motor failed. Source: [Rokoko article](https://www.rokoko.com/insights/collecting-robot-training-data-with-rokoko-smartgloves).
- **Stanford DexCap**: policies trained from 30 minutes of glove mocap, no teleop needed. Source: [Rokoko robotics page](https://www.rokoko.com/use-cases/robotics), [DexCap](https://dex-cap.github.io/).
- **Isaac Lab integration** (15 Oct 2026): Smartgloves II feed Isaac Lab as an OpenXR-style hand device; validated on a Franka cube stacking task and a Fourier GR1T2 pick and place; records HDF5 episodes; up to 83 Hz per glove. Source: [Rokoko article](https://www.rokoko.com/insights/rokoko-sdk-now-supports-nvidia-isaac-lab).
- Rokoko's robotics page lists hand integrations: Tesollo, BrainCo, Wuji, Robotis live; **Inspire "Coming soon"** ([Rokoko robotics](https://www.rokoko.com/use-cases/robotics)). So an Inspire integration working at Junction would be new to Rokoko. That is a reason the AROC integration matters; ask to see it.

### 1.3 What "impressive" means here

My reading from the sources above (judgement, not a published rubric):

1. A **real robot hand visibly following a real glove** with low lag. Nothing beats this on stage.
2. **Rigour that shows engineering**: calibration step, clutch or dead-man switch, smoothing, a latency number on screen, a force cap. YAAK's write-up wins on honesty about limits; copy that tone.
3. **A data and learning story**: demos in, filter, dataset out.
4. **A reason a human cares**: our expert and learner loop gives the teleop a purpose beyond "it moves".

---

## 2. Hardware facts, with sources

### 2.1 Junction hardware lab and Aalto Robotics Club (what is confirmed)

| Fact | Status | Source |
| --- | --- | --- |
| Hardware Lab by Arduino on the 5th floor: Arduino UNO Q, components, 3D printers, **LeRobot arms** ("open-source robot arms") | Confirmed | [Junction 2026](https://2026.hackjunction.com/) |
| AROC "is helping organise the Hardware Lab" | Confirmed | [Helsinki Robotics Week](https://helsinkiroboticsweek.com/) |
| Rokoko is a challenge partner, with "motion capture gear and mentoring" | Confirmed | [Junction Instagram post](https://www.instagram.com/p/Dfhfv38nPYo) |
| Arduino workshop on Hardware Floor (5th floor), Fri 20:45 | Confirmed | [Junction 2026](https://2026.hackjunction.com/) |
| Final ceremony Sun 14:00; challenge winners announced 15:10; final submissions Sun 10:00 | Confirmed | [Junction 2026](https://2026.hackjunction.com/) |
| Unitree G1 (shared with a humanoid challenge), Booster T1, Inspire integration by AROC | **UNCONFIRMED** (from your challenge text only; I found no public page) | none |
| AROC GitHub repo for an Inspire integration | **Not found.** The club site's GitHub link points to the generic github.com. Founded 2026, ROS2 and CAD workshops | [AROC site](https://site.aaltoroboticsclub.fi/) |

"LeRobot arms" almost certainly means the SO-100 / SO-101 family (**ASSUMED**; the SO-101 is the standard LeRobot arm, and LeRobot's USD set names "SO-101, also used for SO-100", see [lerobot/robot-usds](https://huggingface.co/datasets/lerobot/robot-usds)). Those arms have a **one-motor gripper, not a dexterous hand** (general knowledge, not in these sources). So the arm in the hardware lab is a candidate for concept 2 (dataset export in LeRobot format drives it natively), not for finger-level teleop.

Candidate arms, honest status:

| Candidate | Likely at Junction? | Why it matters |
| --- | --- | --- |
| LeRobot SO-100 / SO-101 | **Likely** (hardware lab text) | LeRobot dataset format is native. Gripper only. |
| Inspire hand on some arm (AROC integration) | **Claimed in your brief, unverified** | The best target for 6-number finger teleop. |
| G1 arms | Possible, shared | G1 arm is 5 DOF plus optional 2 wrist DOF per the [Unitree developer guide](https://support.unitree.com/home/en/G1_developer). |
| xArm, UR | **No evidence** | Do not plan around them. |

### 2.2 Unitree G1

- Versions: G1 basic 23 DOF; G1-EDU 23 to 43 DOF. EDU Ultimate variants: A = 2 Dex3-1 hands no touch, B = Dex3-1 with tactile, C = 2 Inspire DFQ hands, D = 2 Inspire FTP hands ([G1 SDK guide](https://support.unitree.com/home/en/G1_developer/get_sdk)). Only EDU is programmable ([G1 developer guide](https://support.unitree.com/home/en/G1_developer)).
- **Dex3-1**: three fingers, 7 DOF (thumb 3, index 2, middle 2), 33 tactile sensors with the tactile option, RS485 inside, resident service turns it into DDS ([dexterous hand doc](https://support.unitree.com/home/en/G1_developer/dexterous_hand), [about Dex3-1](https://support.unitree.com/home/en/dex3-1_hand/about_dex3-1)). Topics: `rt/dex3/(left|right)/cmd` (`unitree_hg::msg::dds_::HandCmd_`) and `.../state` ([basic services](https://support.unitree.com/home/en/G1_developer/basic_services_interface)).
- **Inspire on G1**: FTP/DFQ SDK topics `rt/inspire_hand/ctrl/*` (`inspire_hand_ctrl`: `angle_set[6]`, `force_set[6]`, `speed_set[6]`, `mode`), `rt/inspire_hand/state/*`, `rt/inspire_hand/touch/*`; RS-485 or Modbus TCP; touch topic is silent over RS-485 ([Inspire FTP doc](https://support.unitree.com/home/en/G1_developer/inspire_ftp_dexterity_hand)). DFX uses `rt/inspire/cmd` (`MotorCmds_`, 12 motors: ids 0 to 5 right pinky, ring, middle, index, thumb-bend, thumb-rotation, 6 to 11 left; only `q` is used) ([DFX doc](https://support.unitree.com/home/en/G1_developer/inspire_dfx_dexterous_hand)). The USB to serial module plugs into the G1's PC2.
- **Control stack:** `unitree_sdk2` (C++) and `unitree_sdk2_python` (CycloneDDS 0.10.2, high-level sport mode and low-level modes; you pass the network interface name) ([repo](https://github.com/unitreerobotics/unitree_sdk2_python)). DDS over Ethernet.
- **Safety (from docs):** keep the hand clear of the body, add outward shoulder offset, do not do running or balance tests with the hand fitted ([G1 developer guide](https://support.unitree.com/home/en/G1_developer)). Low-level `rt/lowcmd` bypasses the built-in stability; I did not find a Unitree page that states a software e-stop, so rely on the handheld remote and power cut (**ASSUMED**; confirm at the robot).
- **Who may control it at Junction:** UNCONFIRMED. It is shared with the humanoid challenge. Plan for short, booked slots.

### 2.3 Unitree's own teleop stacks

- [`xr_teleoperate`](https://github.com/unitreerobotics/xr_teleoperate): XR headsets (Vision Pro, PICO 4 Ultra, Quest 3) to G1, H1, H1_2, H2, R1. End effectors: `dex1`, `dex3`, `inspire_ftp`, `inspire_dfx`, `brainco`. Hand input is a **25 joints x 3 = 75 float array per hand** (see `teleop_hand_and_arm.py`: `Array('d', 75)`), retargeted by a vendored `dex-retargeting`; arm IK is separate. `--sim` flag exists. Release v1.6 dated 29 Jul 2026 per its README. Our 26 OpenXR joints minus the palm give the same 25, so the format is a near match (my inference).
- [`unitree_lerobot`](https://github.com/unitreerobotics/unitree_lerobot): converts Unitree JSON episodes to LeRobot format (`--robot_type Unitree_G1_Inspire` etc.) and has replay and real-machine inference. Useful as a reference for the dataset schema in concept 2.

### 2.4 Inspire RH56 hands

- **Model facts.** 6 actuated DOF, 12 joints; the thumb bends and rotates ([Inspire DFX product page](https://en.inspire-robots.com/product/rh56dfx), [Unitree DFX doc](https://support.unitree.com/home/en/G1_developer/inspire_dfx_dexterous_hand)). 540 g and four-finger flexion speed 260 deg/s per a reseller ([Knox Labs](https://www.knoxlabs.com/products/inspire-robots-rh56dfx-dexterous-hand)). Thumb active output force 1.5 kg on the DFX page. DFTP adds 17 tactile regions, 1185 cells, 16-bit values 0 to 4095 ([inspire-rh56dftp on PyPI](https://pypi.org/project/inspire-rh56dftp/)).
- **Register map** (manual, DFTP V1.0.0, [PDF](https://en.inspire-robots.com/wp-content/uploads/2025/01/INSPIRE-ROBOTS-The-Dexterous-Hand-RH56DFTP-User-Manual-V1.0.0.pdf)): `ANGLE_SET` 1486 (6 shorts), `FORCE_SET` 1498, `SPEED_SET` 1522, `ANGLE_ACT` 1546, `FORCE_ACT` 1582, `CURRENT` 1594, `ERROR` 1606, `STATUS` 1612, `TEMP` 1618. Order: pinky, ring, middle, index, thumb-bend, thumb-rotation. Angle range 0 to 1000, and -1 means "leave unchanged". Force threshold units are grams (0 to 1000 for fingers, up to 1500 for thumb) ([controller README](https://github.com/Z13156D2/inspire-rh56-controller)).
- **Angle direction.** Booster's doc says 0 is fully closed and 1000 fully open for the fingers ([Booster T1 manual](https://static.generation-robots.com/media/user-manual-booster-t1-en.pdf)); the PyPI driver says the same (`[0,0,0,0,0,1000]` closes the fist, 1000 is extended; thumb rotation 0 retracted, 1000 across palm). **Verify on the first real command with a slow ramp.**
- **Wire protocol, and a conflict.** The manual shows a serial frame `EB 90 ID LEN 12 ADDR_L ADDR_H DATA... CHECKSUM` (checksum = low 8 bits of sum from ID) ([manual](https://en.inspire-robots.com/wp-content/uploads/2025/01/INSPIRE-ROBOTS-The-Dexterous-Hand-RH56DFTP-User-Manual-V1.0.0.pdf), [pyrh56](https://pypi.org/project/pyrh56)); Unitree and a community library call the serial link "Modbus RTU" ([Unitree](https://support.unitree.com/home/en/G1_developer/inspire_ftp_dexterity_hand), [Sentdex library](https://github.com/Sentdex/inspire_hands)). I could not settle whether serial is true Modbus RTU or the private `EB 90` framing. **Do not hand-roll it: use one of the libraries below.** TCP is real Modbus TCP, default IP `192.168.123.211`, port 6000 ([inspire-rh56dftp](https://pypi.org/project/inspire-rh56dftp/)); one other source uses `.210`, so check the label on the hand.
- **Update rate and latency.** Stock community library: about 5 Hz because of fixed 200 ms sleeps; the performance fork gets **60 Hz per hand** with polling under 30 ms ([GeneralTrajectory fork](https://github.com/GeneralTrajectory/inspire_hands)). Direct write in that fork: `hand.modbus.write_multiple_registers(1486, [6 values])`. Serial baud 115200 in the examples. Reconnect needs a 300 ms pause on TCP ([inspire-rh56dftp](https://pypi.org/project/inspire-rh56dftp/)).
- **Python libraries:** [`pyrh56`](https://pypi.org/project/pyrh56) (serial, validated writes, fault handling), [GeneralTrajectory/inspire_hands](https://github.com/GeneralTrajectory/inspire_hands) (60 Hz serial), [`inspire-rh56dftp`](https://pypi.org/project/inspire-rh56dftp/) (stdlib-only Modbus TCP with tactile and a background scheduler), [NYU inspire-sdk](https://github.com/NYU-robot-learning/inspire-sdk) (also has an IK "hand operator"), [Unitree `inspire_hand_ws`](https://github.com/NaCl-1374/inspire_hand_ws) (DDS bridge).
- **AROC Inspire integration:** repo not found, so language, interface and expected input are **UNCONFIRMED**. Guess to test, not a fact: it takes 6 values 0 to 1000 or a ROS2 topic (an unrelated ROS2 repo shows this pattern, [Akhavana/Dexterous-Hand-ROS2](https://github.com/Akhavana/Dexterous-Hand-ROS2), which pairs a Rokoko glove with an Inspire hand in ROS2 Humble). Ask for it first.

### 2.5 Booster T1

23 DOF base, 41 with 7-DOF arms and 6-DOF dexterous hands; SDK over Fast-DDS, RPC for high level and DDS for low level ([Booster T1](https://www.boosterobotics.com/booster-t1), [manual](https://static.generation-robots.com/media/user-manual-booster-t1-en.pdf)). Hand call: `ControlDexterousHand(finger_params, hand_index)` where each param is `(seq 0..5, angle 0..1000, force, speed)` and the hand type can be `kInspireHand` or `kInspireTouchHand` ([Booster docs](https://docs.booster.tech/docs/developer-guide/cpp/rpc/motion)). Works in walking or custom mode only. **Same 6-number interface as the Inspire, so our retargeter is reusable.** Whether a T1 is at Junction is UNCONFIRMED.

### 2.6 Coil Pro

Adds absolute global hand position by EMF (the gloves' own EMF sensors sense the coil). Range stated as 2 to 4 m radius, about 5 m tracking radius, IMUs take over outside it; the Rokoko SDK page says "just under 5 m (noise reaches 20 mm)" ([Coil Pro](https://www.rokoko.com/products/coil-pro), [Device SDK](https://sdk.rokoko.com/)). Needs its own power supply ([Rokoko support](https://support.rokoko.com/hc/en-us/articles/17592160373137-Coil-Pro-Specifications-and-Recommendations-For-Use)). YAAK saw 180 degree flips and poor accuracy within about 50 cm and beyond about 1.1 m ([Rokoko article](https://www.rokoko.com/insights/collecting-robot-training-data-with-rokoko-smartgloves)). In our own capture, the glove stream has **no position, only orientation**, and the Coil Pro streams were all zero ([FINDINGS.md](../../../AppData/Local/Temp/claude/2b0d7c269f3f7e8e/a0a015b8-e721-4f7c-aa5d-52166c568c33/scratchpad/gloves/FINDINGS.md), local). **Hand-only teleop does not need it. Arm teleop does.**

Latency numbers worth quoting: about 19 ms over USB and 20 ms over Wi-Fi, motion to SDK output; solver adds about 0.09 ms ([Rokoko Device SDK](https://sdk.rokoko.com/)). Our measured glove-to-pixel on route B was about 85 to 120 ms (FINDINGS.md).

---

## 3. Retargeting: 26 OpenXR joints to a robot hand

### 3.1 Two methods

| Method | How | Good | Bad | Hours |
| --- | --- | --- | --- | --- |
| **A. Curl map** | Per finger: `angle = 1000 * (1 - c)` where `c` is the core's `curl` rescaled between each wearer's flat and fist calibration. Thumb: bend from thumb curl, rotate from a thumb-opposition measure. | Works in an hour, no URDF, easy to debug, stable. | Does not match fingertip positions, so pinching precisely is approximate. | 1 to 2 |
| **B. dex-retargeting** | Optimise robot joint angles so fingertip vectors or positions match the human's, using the robot URDF ([dex-retargeting](https://github.com/dexsuite/dex-retargeting), MIT). Used inside xr_teleoperate. | Better pinches and tip alignment. | Needs the Inspire URDF (the G1+Inspire URDF is `g1_29dof_rev_1_0_with_inspire_hand_DFQ.urdf` in `unitree_ros`, per [lerobot/robot-usds](https://huggingface.co/datasets/lerobot/robot-usds)), a hand-size scale, joint-order care (it warns URDF parsers differ), more risk. | 4 to 6 |

**Recommendation:** ship A first. Add B only if A works by Saturday evening, behind a flag `--retarget dex`. Keep a **pinch override**: when the core's `pinch.index` is true, move thumb and index toward a fixed pinch pose, which makes pick-up demos reliable (my design choice).

### 3.2 Curl map details

Facts from our own measurements (FINDINGS.md): flat hand is not zero (summed flexion index 37 deg, middle 27, ring 26 to 33, little 59 to 79, thumb about 70 deg); fist curl 0.76 to 0.93; per-user calibration is needed; angles are unsigned; the thumb bends mostly off-axis.

```
# per wearer, per hand, from two 1 to 2 s holds: flat and fist (the core already records both)
c_norm[f] = clamp((curl[f] - flat[f]) / (fist[f] - flat[f]), 0, 1)
target[f] = round(1000 * (1 - c_norm[f]))          # 1000 open, 0 closed (VERIFY direction)
# fingers order: little, ring, middle, index, thumb_bend; thumb_rot from opposition
thumb_rot = clamp(opposition, 0, 1) * 1000          # 0 retracted, 1000 across palm (VERIFY)
```

`opposition` (my sketch): distance from thumb tip to the base of the little finger metacarpal, normalised between its flat and fist values, from the 26 joint positions the core already sends.

### 3.3 Smoothing, rate, latency budget

- **Smoothing:** the backend already has a One Euro filter (`backend/app/services/smoothing/one_euro.py`). Reuse the same parameters idea in the bridge, per target channel (min cutoff about 1.0 Hz, beta tuned by eye; **a starting guess, tune live**).
- **Rate limit per channel:** cap change per tick (for example 60 units per 16 ms) so a glove glitch cannot slam a finger. Also set `SPEED_SET` to a moderate value at start.
- **Rates:** core emits 30 Hz by default and the SPEC `subscribe` command allows 15 to 60 Hz (SPEC.md section on commands); the hand takes about 60 Hz at best over serial. Run the bridge at 50 Hz output and ask for 60 Hz input. Envelope of the `subscribe` message: see `schema/cmd.json` (not checked by me).

Estimated glove-to-finger budget (estimates, measure for real):

| Stage | ms |
| --- | --- |
| Glove to SDK (USB) | about 19 |
| Solver | about 0.1 |
| Core sampling at 30 to 60 Hz | 0 to 33, or 0 to 17 |
| Core to bridge (localhost WebSocket) | about 2 to 5 |
| Retarget plus filter | about 1 to 5 |
| Serial write and ack (60 Hz polling) | about 17 to 30 |
| Hand motion (actuator speed) | about 50 to 150 (**ASSUMED**) |
| **Total** | **about 100 to 250** |

Show the live number on screen: time between a glove-curl change and the hand's `ANGLE_ACT` change (read back from the hand).

### 3.4 Safety

- **Force cap:** write `FORCE_SET` (grams) once at start: 300 to 400 g per finger for "fragile" mode, 800 to 1000 g for normal. Tune on a paper cup. Starting values are guesses.
- **Joint limits:** clamp every target to 0 to 1000 and to per-finger safe ranges found on the bench.
- **Dead-man switch:** teleop only moves the robot while a glove button is held or the clutch is engaged (RCSP `ButtonPushed` exists and is untested, see FINDINGS.md), otherwise hold last pose. Software fallback: keyboard hold-space.
- **Tracking loss:** if the core's `tracked` is false (glove silent 250 ms, SPEC.md), freeze and open slowly, do not follow stale data.
- **E-stop:** physical power cut on the hand supply (inline switch or the strip) is the real e-stop. Software `STOP` command sets speed to 0 and holds. On the G1, use the remote and the vendor's emergency procedure; **UNCONFIRMED**.
- **Heading drift:** wrist yaw drifts 3 to 4 deg per minute (FINDINGS.md). For a hand-only demo this does not matter.

---

## 4. Simulation path

| Option | What | Status |
| --- | --- | --- |
| Our own app, three.js | Render a robot hand (Inspire-like) driven by the same 6 numbers. Load the Inspire URDF if licensing and time allow, else a stylised hand with 6 joints. | **Recommended first.** No install, works offline, fits our existing 3D app. |
| MuJoCo in the browser | Official MuJoCo WASM bindings plus three.js demo suite ([zalo/mujoco_wasm](https://github.com/zalo/mujoco_wasm), MuJoCo 3.3.8). | Works as a demo; heavier to integrate. |
| `mujoco_menagerie` | Has Unitree G1 (29 DOF, with a `g1_with_hands.xml`, derived MJCF), Unitree H1, and **Booster T1 (23 DOF)** ([menagerie](https://github.com/google-deepmind/mujoco_menagerie), [G1 README](https://github.com/google-deepmind/mujoco_menagerie/blob/main/unitree_g1/README.md)). I did not find an Inspire hand MJCF there. | Good for a G1 body view. |
| `unitree_mujoco` | Unitree SDK2-compatible simulator; **only supports low-level messages** (LowCmd, LowState etc.), not the hand topics ([repo](https://github.com/unitreerobotics/unitree_mujoco)). | Not a free hand sim. |
| Models with Inspire | [lerobot/robot-usds](https://huggingface.co/datasets/lerobot/robot-usds) has G1 with Inspire hands as USD; `unitree_ros` has the URDF. | Source for the twin mesh. |
| Isaac Lab | Rokoko's own integration exists, with stock retargeters ([Rokoko](https://www.rokoko.com/insights/rokoko-sdk-now-supports-nvidia-isaac-lab)). `unitree_lerobot` mentions a `unitree_sim_isaaclab` environment ([repo](https://github.com/unitreerobotics/unitree_lerobot)). Needs an NVIDIA GPU and setup time. | Skip today unless a mentor has it ready. |

**One command stream for sim and real.** The bridge always emits the same `robot_cmd` (section 6.2). A driver adapter picks the destination: `sim_ws` (our frontend), `inspire_serial`, `inspire_tcp`, `unitree_dds`, `booster_rpc`, or `null` (log only). The twin in the browser is just another subscriber, so a judge can see the real hand and the twin side by side, and we can prove the real one matched the twin.

---

## 5. Pivot concepts ranked

Time check: now Saturday, core freeze 23:00, final submissions Sunday 10:00, pitch Sunday 14:00 (confirmed above). About 12 hours of real build time before the freeze, then polish.

| Rank | Concept | Wow for judges | Hardware | Risk | Hours | Demo beats |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | **(a+b) Geppetto and Pinocchio, apprentice robot.** Live puppeteering, then the expert's lesson replayed on the robot and scored by our scorer (robot `ANGLE_ACT` vs lesson) | High. Real hand follows you; strings UI is the teleop UI; unique idea | Inspire hand (or sim) + 1 glove | Medium. Direction, force, hand access | 8 to 10 | 1 put glove on, calibrate in 10 s; 2 robot hand mirrors you; 3 show strings; 4 play expert lesson, robot copies; 5 score per finger on both human and robot |
| **2** | **(c) Demo collection with quality filter.** Lesson takes become LeRobot episodes; only takes with score above threshold exported; show "kept 41 of 60" | High for the data interest, quiet visually | None required (sim or recorded); better with robot | Low. Format work only | 4 to 6 | 1 record 5 takes; 2 scorer flags 2 bad ones; 3 export; 4 show dataset loads in LeRobot; 5 replay on the hand |
| **3** | **(d) Fragile grasp.** Pick up an egg or paper cup, force readout live, force cap shown | Very high if it works | Real Inspire hand, ideally DFTP with tactile | High. Needs hand plus object plus tuning | about 4 on top of 1 | 1 grab a rigid cup; 2 force cap on, grab a paper cup without crushing; 3 live force bars; 4 try egg |
| 4 | **(d) Rock paper scissors vs the robot** | Fun, crowd-pleaser; needs a gesture classifier on glove curls and a robot throw | Hand + glove | Low-medium (robot cheats by reading you, so show a delay) | 3 | Play 3 rounds, robot wins one |
| 5 | **(d) Robot shadow puppets** | Cute, ties to our shadow puppets | Hand | Low | 2 | Dog, bird, rabbit from lesson library |
| 6 | **(e) Learner vs robot** (robot shows the move, learner copies, scored) | Medium; folds into concept 1 | Hand | Low | 2 on top | Robot demonstrates a lesson step, learner copies |

**Why this order:** concept 1 makes the robot hand central, reuses the ghost, scorer and lessons, and is the same pipeline every other concept needs. Concept 2 is the cheapest to finish and speaks to the challenge's data interest and is the safety net if hardware slips. Concept 3 is the show-stopper but depends on the tactile or force register and access; it comes last.

Table tennis and piano games stay as the "also" in the pitch: "the same lesson format teaches a human, and now a robot."

---

## 6. Architecture

```
   Rokoko gloves -> USB -> Rokoko Device SDK driver (RGMP 12276, RCSP 45451)
        -> rkk-hand-solver (RGMP 12277)
        -> core/  (port 8765, /ws)            [teammate, UNCHANGED]
        -> robot_bridge  (new process, subscribes to /ws)     [ours]
             -> driver adapter -> real hand / G1 / T1 / sim
             -> robot_state back to frontend
        -> frontend (robot twin view, Teleop mode, dataset export)
        -> backend (lessons, takes, export, port 8000)
```

### 6.1 Rules kept

- No edits to `core/`. The bridge is a client of `/ws`, like `tools/ingest_bridge.py` is (it reconnects every 2 s and forwards frames; I read it).
- Put it at `tools/robot_bridge.py` (or `robot/`), ours, with its own tests, no paid APIs.
- Bridge consumes `frame.hands.<side>.curl`, `joints` (26 positions), `pinch`, `tracked` from the core (shapes from SPEC.md).

### 6.2 Message shapes (sketch, new, ours)

Bridge to drivers, one per hand per tick (50 Hz):

```json
{ "v": 1, "type": "robot_cmd", "t": 1731533000123456, "seq": 991,
  "hand": "right", "target": "inspire6",
  "angle": [812, 790, 805, 760, 640, 120],
  "force_limit_g": [400, 400, 400, 400, 600, 600],
  "speed": 600, "engaged": true, "estop": false }
```

Bridge to frontend (new `/ws/robot` served by the bridge, JSON, 30 Hz):

```json
{ "v": 1, "type": "robot_state", "t": 1731533000150000,
  "driver": "inspire_serial", "connected": true, "engaged": true,
  "cmd":  [812, 790, 805, 760, 640, 120],
  "act":  [805, 788, 801, 758, 630, 118],
  "force_g": [0, 0, 12, 0, 40, 5],
  "touch_peak": 0.21, "lag_ms": 142, "faults": [] }
```

Frontend to bridge: `{ "type": "engage", "on": true }`, `{ "type": "estop" }`, `{ "type": "mode", "value": "mirror|replay|fragile" }`, `{ "type": "calibrate", "phase": "flat|fist" }`.

Dataset export (concept 2), a backend route, for example `POST /api/lessons/{id}/export?format=lerobot&min_score=0.8`. A LeRobot episode needs a state vector, an action vector and a timestamp per frame (general LeRobot practice; the schema used by `unitree_lerobot` is the reference, [repo](https://github.com/unitreerobotics/unitree_lerobot)). Our state = hand `ANGLE_ACT` (6), action = `robot_cmd.angle` (6), plus optional glove 26 joints as extra observation. **I did not read the LeRobot v3 spec today; verify field names against the installed `lerobot` before coding.**

Rates: gloves 83 Hz, core `/ws` 30 Hz (up to 60 on request), bridge to hand 50 to 60 Hz, bridge to frontend 30 Hz.

### 6.3 Frontend adds

- **Robot twin view:** a three.js hand with 6 joints driven by `robot_state.act` (real) and ghost-overlaid `cmd` (what we asked for). Reuses our marionette strings: strings run from the human hand to the robot hand.
- **Teleop mode:** Engage button (dead-man), calibrate flat then fist, mode switch, big red STOP, live lag and force bars.
- **Lesson replay on robot:** "Teach the robot" button runs a lesson step through the bridge, and the scorer compares `act` to the lesson.
- **Export:** "Export as robot dataset" with a score threshold slider, showing kept versus dropped.

---

## 7. Schematics

Everything marked **(A)** is assumed. Network and port numbers are from our own repo and the sources above.

### 7.1 System schematic

**Boxes (device, process, port, protocol):**

| # | Box | Kind | Port or interface | Protocol |
| --- | --- | --- | --- | --- |
| 1 | Operator (the human, expert or learner) wearing two Smartgloves II | Human plus device | USB-C to laptop (we measured both gloves 83.39 Hz over USB) | RGMP over TCP to the driver |
| 2 | Rokoko Device SDK driver | Process (laptop) | RGMP 12276, RCSP 45451 | RGMP 2.0.0 binary, RCSP framing `DC 01 08 type` plus JSON |
| 3 | `rkk-hand-solver` | Process (laptop) | RGMP 12277 | RGMP, 26 OpenXR joints at 83 Hz |
| 4 | `core/` | Process (laptop) | `ws://localhost:8765/ws` | JSON WebSocket, `frame` at 30 Hz |
| 5 | `robot_bridge` | New process (laptop) | client to 4; serves `ws://localhost:8770/robot` (port **(A)** chosen by us) | JSON WebSocket |
| 6 | Driver adapter (inside 5, or a small agent on a Linux laptop) | Process | serial or TCP or DDS | see 7.1 table below |
| 7 | Robot hand | Device | RS-485 or Ethernet | Inspire register protocol |
| 8 | `backend/` | Process (laptop) | `http://localhost:8000/api` | REST plus `/ws/gloves` |
| 9 | `frontend/` | Browser (laptop, screen) | `http://localhost:5173` | HTTP, WebSocket |
| 10 | Emergency stop | Physical | inline switch on hand supply | power cut |

**Arrows (data, rate, latency):**

| From to | Data | Rate | Latency |
| --- | --- | --- | --- |
| 1 to 2 | Raw glove sensors | 83.39 Hz per glove | about 19 ms (USB) |
| 2 to 3 | RGMP frames | 83 Hz | solver about 0.1 ms |
| 3 to 4 | 26 joints per hand | 83 Hz in, core samples newest | 0 to 33 ms sampling |
| 4 to 9 | `frame` (hands, ghost, score) | 30 Hz (15 to 60 by `subscribe`) | about 5 to 50 ms |
| 4 to 5 | `frame` (curl, joints, pinch, tracked) | 30 to 60 Hz | a few ms |
| 5 to 6 to 7 | `robot_cmd` angle[6], force limit, speed | 50 to 60 Hz | 17 to 30 ms serial |
| 7 to 5 | `ANGLE_ACT`, `FORCE_ACT`, optional tactile | 30 to 60 Hz | 17 to 30 ms |
| 5 to 9 | `robot_state` | 30 Hz | a few ms |
| 9 to 8 | REST: lessons, takes, export | on demand | local |
| 8 to 5 | "teach robot" job (lesson id, step) | on demand | local |

**Driver adapter table:**

| Adapter | Link | Notes |
| --- | --- | --- |
| `inspire_serial` | USB-to-RS485 adapter, `COMx` on Windows, 115200 baud (per library examples) | Works for all RH56 models. Hand ID default 1. |
| `inspire_tcp` | Ethernet to the DFTP, laptop static IP in 192.168.123.0/24, hand at `.211` port 6000 | DFTP only. Gives tactile. |
| `unitree_dds` | Ethernet to the G1, CycloneDDS, topic `rt/inspire_hand/ctrl/r` or `rt/dex3/right/cmd` | Linux-first SDK. Run on a Linux laptop **(A)**. |
| `booster_rpc` | Ethernet, `ControlDexterousHand` | If a T1 is available. |
| `sim_ws` | WebSocket to the frontend | Always available. |

**Physical wiring:**

```
Laptop USB-C  <- glove L (USB)         power: laptop charger
Laptop USB-A  <- glove R (USB)
Laptop USB-A  -> USB-RS485 adapter -> hand RS-485 (A, B, GND), 4 wires (verify pinout on the hand's cable)
Hand power    <- DC supply (check label: voltage; 24 V on Dex3-1 per Unitree; Inspire voltage to read from the hand label)
Hand power line -> inline switch/relay (e-stop) -> supply
Optional: Laptop Ethernet -> hand (DFTP) or -> G1 (192.168.123.x)
Optional: Coil Pro -> own supply, on tripod, placed 0.5 to 1.1 m from the gloves (YAAK range tip)
```

**Where people stand:**

- **Operator (expert or learner):** seated at the laptop, gloves on, in clear sight of the robot hand, arm length from the table, hand about 20 to 60 cm clear of the robot. Coil Pro, if used, on a tripod within about 1 m.
- **Robot hand:** on the table, fixed in a clamp or bolted to its stand, pointing at the operator or at the audience. A table edge guard so it cannot fall.
- **Second person (safety):** next to the e-stop, hand on the switch, during all force demos.
- **Audience and judges:** behind a line at least 1 m from the robot.

```
 [Glove L][Glove R]  --USB-->  [LAPTOP]
                                |-- driver 12276/45451 -> solver 12277
                                |-- core :8765 /ws
                                |-- robot_bridge :8770 --RS485--> [INSPIRE HAND] <-- DC supply <-- [E-STOP]
                                |-- backend :8000
                                '-- browser :5173 (robot twin, strings, scores)
 Operator seated at laptop        Hand clamped on table      Safety person at E-STOP
```

### 7.2 Concept 1 schematic: live teleop plus "robot is the apprentice"

**Boxes:** Operator (expert) with gloves; core; robot_bridge (mode `mirror`, then `replay`); Inspire hand; backend (lessons); frontend (strings plus twin); scorer (the existing per-finger DTW and live scorer).

**Arrows:**

| Arrow | Data | Rate | Latency |
| --- | --- | --- | --- |
| Operator to core | glove joints | 83 Hz in, 30 to 60 Hz out | about 100 ms glove to pixel |
| core to bridge | `curl[5]`, `pinch`, `tracked` | 30 to 60 Hz | few ms |
| bridge to hand | `angle[6]`, force limit | 50 to 60 Hz | 17 to 30 ms |
| hand to bridge | `ANGLE_ACT[6]`, `FORCE_ACT[6]` | 30 to 60 Hz | 17 to 30 ms |
| bridge to frontend | `robot_state` | 30 Hz | few ms |
| backend to bridge | lesson step trace (`curl` vs time) in replay | one job, then 50 Hz playback | local |
| bridge to scorer | robot `act` trace for the replay | 30 Hz | local |
| scorer to frontend | per-finger score of the robot's copy | 30 Hz | few ms |

**Positions:** expert at the laptop, gloves on, watching the hand and the screen; the learner (later) swaps in, wears the same gloves, and copies what the robot shows (concept e). Robot hand clamped at table front.

```
 EXPERT --glove--> core --curl--> robot_bridge --angle[6]--> INSPIRE HAND
                     |                 |  ^                      |
                     |                 |  '---- act, force ------'
                     v                 v
                  frontend <----- robot_state          backend (lessons)
                     ^                 |                  |
                     |            replay: lesson trace <--'
                     '--- score: lesson vs robot act (per finger) ---
 REPLAY: lesson file -> bridge -> hand; hand act -> scorer -> screen
```

### 7.3 Concept 2 schematic: demonstration collection, scorer as quality filter

**Boxes:** Operator; core; robot_bridge (records `act` and `cmd`); hand or sim; backend export route; scorer; LeRobot dataset folder on disk; optional `lerobot` loader to prove it loads.

**Arrows:**

| Arrow | Data | Rate |
| --- | --- | --- |
| Operator to core to bridge to hand | as concept 1 | 50 Hz |
| bridge to backend | per-take trace: timestamp, `cmd[6]`, `act[6]`, optional 26 joints, optional camera frame | 30 Hz while recording |
| scorer | take vs lesson score 0 to 1 | per take |
| backend export | keeps takes with score at least threshold, writes parquet and metadata (LeRobot layout, verify) | once per export |
| dataset to loader | "dataset loads in LeRobot" check | once |

**Positions:** same as concept 1. No extra hardware needed. If a LeRobot SO-101 arm is borrowed **(A)**, the same dataset could replay on it, but that is a stretch goal.

```
 OPERATOR -> core -> bridge -> hand (or sim)
                       |
                       v  trace (cmd, act) per take
                    backend: scorer --score--> keep if >= threshold
                       |
                       v
              export lerobot dataset (episodes: state, action, t)
                       |
                       v
          lerobot loads it (demo: "kept 41 of 60")
```

### 7.4 Concept 3 schematic: fragile-object grasp with force readout

**Boxes:** Operator with one glove; core; robot_bridge (mode `fragile`, force cap, grip governor); Inspire hand (DFTP preferred for tactile); object (paper cup, egg, in a soft holder); table; e-stop; frontend (force bars, tactile heat map).

**Arrows:**

| Arrow | Data | Rate | Latency |
| --- | --- | --- | --- |
| core to bridge | `curl`, `pinch` | 30 to 60 Hz | few ms |
| bridge to hand | `ANGLE_SET[6]`, `FORCE_SET[6]` (cap), `SPEED_SET` | 50 to 60 Hz | 17 to 30 ms |
| hand to bridge | `FORCE_ACT[6]`, `ANGLE_ACT[6]`, tactile 1185 cells (DFTP over TCP only) | force 30 to 60 Hz; tactile lower **(A)** | 17 to 30 ms |
| bridge internal | grip governor: if `FORCE_ACT` above cap on any finger, stop closing that finger and hold | per tick | under 5 ms |
| bridge to frontend | force bars, tactile peak, "grip held at X g" | 30 Hz | few ms |

**Positions:** hand clamped on the table with the object in front; operator seated, 60 cm away; the safety person at the e-stop. Object on a tray so a drop is soft.

```
 OPERATOR -glove-> core -> bridge [force governor] --angle, force cap--> INSPIRE (DFTP)
                                     ^                                       |
                                     '------ FORCE_ACT, tactile (Modbus TCP) '--> [EGG / CUP]
                                     |
                                     v
                                  frontend: force bars, tactile map, "no crack"
```

---

## 8. A plan for the next 24 hours

### 8.1 First questions for the mentors (ask in this order)

**Rokoko (Victoria Stein, Rokoko mentors):**

1. "Which robot hands and arms will be at Junction, and which are free for our team? Is the Unitree G1 available to us, and when can we book a slot?"
2. "Is there an Inspire hand integration for the Device SDK, or an example repo (the Rokoko robotics page lists Inspire as coming soon)? Where is the example?"
3. "Will there be a Coil Pro for us, and for how long? Is it needed for arm teleop on the G1?"
4. "How will you judge this track: live robot, simulation, data, creativity? What would make a project win?"
5. "Are we allowed to run a separate process that reads the core's output and drives the hand? Any licence limits on the Device SDK for the demo?"

**Aalto Robotics Club (Hardware Lab):**

1. "Where is your Inspire integration repo, and what language and interface does it use? What input does it expect: 6 numbers 0 to 1000, a ROS2 topic, or DDS?"
2. "Which Inspire model is it (DFX with no touch, DFTP with touch, DFQ), what port and baud rate or IP, and which voltage supply?"
3. "Is the hand on an arm or on a stand? Which arm? Can we clamp it on a table?"
4. "What are the safety rules: force limits, e-stop, who must supervise?"
5. "Do we need to book time on the G1 and who owns that queue? Is the G1 powered over a tether or battery?"
6. "Does the Hardware Lab have a USB-RS485 adapter and a bench power supply we can borrow?"

### 8.2 Hour plan

| When | Task |
| --- | --- |
| Now to 11:00 | Ask the mentors. Build `robot_bridge` skeleton with `null` and `sim_ws` drivers. Write curl map v0 and unit tests with recorded core frames (`tools/replay.py` can replay). |
| 11:00 to 13:00 | Frontend robot twin (three.js, 6 joints) driven by `robot_state`. Strings from human hand to twin. This is the safety net: demo works with no hardware. |
| 13:00 to 16:00 | **Real hand bring-up** (whatever access exists): find COM port, read `ANGLE_ACT`, slow ramp to find direction, set `FORCE_SET`, engage with dead-man. |
| 16:00 to 19:00 | Calibrate flat and fist per wearer; tune smoothing and rate limit; measure latency; replay a lesson on the hand and score it (concept 1 done). |
| 19:00 to 23:00 | Dataset export (concept 2) and "kept versus dropped" UI. **Core freeze 23:00**: bridge and frontend can still change after it, `core/` cannot. |
| 23:00 to 02:00 | Fragile grasp tuning (concept 3) if hand access is good. Record a 2 minute backup video of the best run. |
| Sun 02:00 to 08:00 | Sleep, then rehearse. Final submission is 10:00. |
| Sun 10:00 to 14:00 | Final submission, test the demo twice, check Wi-Fi or Ethernet, tape cables. Pitch at 14:00; challenge winners are announced at 15:10. |

### 8.3 Fallback ladder

1. **Real Inspire hand** over RS-485 (best). If no serial hand is free, look for a DFTP over Ethernet.
2. **G1 hand** (Dex3-1 or Inspire) via DDS on a Linux laptop, during a booked slot only. Keep a pre-recorded 2 minute clip of the real hand in case the slot is lost.
3. **Simulation only:** the three.js robot twin in our app, plus MuJoCo G1 or T1 viewer if time allows. Present it honestly as "simulation, hardware-ready: here is the register map and the 6-number command we would send."

### 8.4 Demo script (3 minutes, with concept 1 and 2, concept 3 as the finale)

1. (0:00) "Geppetto teaches humans. Now it also teaches robots." Gloves on, press Calibrate (10 s).
2. (0:20) Press Engage: the robot hand mirrors the operator's fingers, strings run from the glove to the hand. Show the lag number on screen.
3. (0:50) The expert records a lesson (e.g. pinch grasp). The ghost hand and per-finger scorer show on screen.
4. (1:20) "Teach the robot": the lesson plays on the robot hand; the scorer shows how close the robot's copy was per finger.
5. (1:50) "Not every take is good": export as robot dataset, 41 of 60 kept above 0.8; show it loading.
6. (2:20) Finale: fragile grasp. Rigid cup, then paper cup with the force cap, live force bars. If it fails, the bridge's grip governor holds; keep the egg for last.
7. (2:50) Close: "Same lesson format for human and robot, with the scorer deciding what is good enough to teach a machine."

---

## 9. Risks and honest limits

| Risk | Effect | Mitigation |
| --- | --- | --- |
| No Coil Pro | No absolute wrist position, so no arm teleop and no "reach and place". Our glove stream has orientation only (FINDINGS.md). | Do hand-only teleop. Pitch it honestly. If a Coil Pro appears, add position later; expect the 180 degree flip and range limits YAAK reported. |
| G1 shared with another team | Few short slots, queue risk, unknown rules | Make hand-on-a-stand the primary target; G1 is a bonus. Pre-record a clip. |
| AROC Inspire integration unverified | May need our own driver | Use `pyrh56` or the 60 Hz fork. Test registers on the bench first. |
| Serial protocol ambiguity (Modbus RTU vs `EB 90` frames) | Wrong framing, no response | Use a library, not hand-rolled bytes. |
| Finger direction or thumb mapping wrong | Hand moves the wrong way | Slow ramp test with low speed first. |
| Thumb mapping (two actuators, our thumb bends off-axis) | Pinch is poor | Pinch override pose; accept approximate thumb. |
| Force limits | Crushing an object or the hand | Force cap, grip governor, e-stop switch, a second person present. |
| Latency 100 to 250 ms | Feels laggy | Show the number honestly; filter lightly; raise rates to 60 Hz. |
| Wrist heading drift 3 to 4 degrees per minute | Not relevant to hand-only teleop | Re-calibrate between lessons. |
| Windows and DDS | `unitree_sdk2_python` and CycloneDDS are Linux-first | Run the DDS adapter on a Linux laptop (**ASSUMED** easy; check). |
| No public AROC repo, no confirmed G1 or T1 | Plan may meet different hardware | Section 8.3 ladder; the six-number contract works for Inspire and Booster. |
| Judges' rubric unknown | We may optimise the wrong thing | Ask the Rokoko mentors question 4 first. |
| Device SDK is licensed | Rokoko says access needs a quote ([Rokoko](https://www.rokoko.com/insights/rokoko-sdk-now-supports-nvidia-isaac-lab)) | Hackathon provides it per the brief; our laptop already runs the driver (FINDINGS.md). |

Honest limits to say on stage: this is a hand-level teleop and training demo, not a full-body or arm-with-position system unless a Coil Pro shows up; latency is about 100 to 250 ms; the grip force cap is tuned for a few objects only.

---

## 10. Things I could not confirm

- Whether a Unitree G1, Booster T1, or any Inspire hand is at Junction, and its model (the Junction pages mention only LeRobot arms and Arduino boards).
- AROC's Inspire repo (not found; the club site's GitHub link is generic).
- Rokoko's judging criteria for this track.
- Serial protocol name (Modbus RTU vs private `EB 90` framing), thumb rotation direction, finger direction on the real hand.
- LeRobot dataset v3 field names (read `unitree_lerobot` or the installed package before coding).
- Whether Windows can run the Unitree DDS stack.
