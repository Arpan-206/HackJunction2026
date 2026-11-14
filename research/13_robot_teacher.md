# 13. The robot hand as a physical teacher (a 3D ghost in the room)

Written Sat 14 Nov 2026. Plain English. Every web claim has its source inline. Anything I could not confirm is marked **ASSUMED** or **UNCONFIRMED**. Read research/12_robot_teleop.md first: this file does not repeat the hardware, retargeting or bridge detail there, and the "robot is the apprentice" and "learner vs robot" ideas in section 5 of that file are developed here.

## 0. Recommendation (read this first)

**Pitch line:** "On screen the ghost shows you the move. On the desk, the robot hand shows it too, slows down, stops on the finger you got wrong, and then lets you teach it."

What the evidence says, in one paragraph each:

1. **Physical beats screen? Only a little, and mostly for motivation.** Embodied-robot tutors often beat on-screen ones for engagement and compliance, and sometimes for learning (puzzle study, sign language study). But two newer results are weaker: one 56-student study found no performance gain from the physical robot, only more enjoyment, and a large 2026 meta-analysis says the answer depends on what the control group is. For raw motor learning I found **no study comparing a robot hand demo with a screen hand demo**. So do not promise "better learning". Promise "more engaging, and a good place to look when the 3D view is ambiguous".
2. **Pushing the learner's fingers is the wrong thing to build.** Haptic guidance often does not beat plain visual demonstration for healthy adults, and the guidance hypothesis says it can hurt retention. With no exoskeleton we cannot do it anyway, and a stock hand next to a human hand should never apply force to the human.
3. **The strongest evidence is for the "robot as apprentice" pattern** (learning by teaching, the protege effect). It has real studies with robots, including a motor skill (handwriting), and it needs no force on the human. It also ties straight into our teleop pivot.
4. **Practical:** the Inspire RH56 can replay a lesson at slow speed with a documented speed register and a force cap. Dex3-1 has only 3 fingers and cannot show ring and little finger poses at all.

**Top builds (full ranked list in section 6):** (1) Robot demonstrator with slow-mo and pause-on-error, (2) apprentice mode where the learner teaches the robot and the robot's score is the learner's score, (3) side by side "your error vs correct pose" on the robot and twin. All three are software over the 6-number command stream we already plan. None needs force on the learner.

---

## 1. Robot hand as a physical demonstrator

### 1.1 Existing examples (what people have actually built)

| Example | What it is | What it found | Source |
| --- | --- | --- | --- |
| Uluer, Akalin, Kose 2015 (Turkish Sign Language) | Robovie R3 (5 independent fingers) vs NAO (3 coupled fingers) as sign tutors, plus a physical-robot game vs a video-of-robot mobile game. N = 42 over adults, children and deaf children. | All groups learned most signs. Novices learned more from the 5-finger hand than the 3-finger one. Physical embodiment improved performance, engagement and motivation vs the video game. | [Springer](https://link.springer.com/article/10.1007/s12369-015-0311-1), [review summary](https://journals.sagepub.com/doi/10.3102/0034654318821286) |
| Axelsson et al. 2019, Aalto (assistive sign for children with autism) | Robot prompts children to imitate 9 signs, co-designed. | Children imitated the robot and held their gaze on it. Pilot, no control group. | [Aalto](https://research.aalto.fi/en/publications/a-participatory-design-process-of-a-robotic-tutor-of-assistive-si) |
| Zapata et al. 2026 (Ecuadorian Sign Language) | Webcam scoring plus a robot arm that gives a physical reward (stacks a pyramid). | Published as a **protocol** (about 70 students planned). **No results yet.** | [PLOS One](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0345934) |
| Fingerspelling robot hands | Low-cost servo hands that spell letters. One Mexican Sign Language build: 8 servos, 60 percent of letters fully correct, 33 percent with limits, 7 percent not possible. | Shows a cheap hand cannot do every handshape. No learner study. | [RCTA 2026](https://www.redalyc.org/journal/7935/793584960011/793584960011_2.pdf) |
| Signs of Language (arXiv) | Robot hand learns fingerspelled letters from video by RL. | The robot learns, not the human. Useful only as "robots can copy letters". | [arXiv 2209.05135](https://arxiv.org/html/2209.05135v3) |

I did not find a published product or study of a robot hand teaching **piano fingering** to humans. The nearest work is piano learning with exoskeletons and EMS (section 2). **UNCONFIRMED:** that no such product exists, I only found none.

Lesson from the sign language rows: **hand fidelity matters for novices**. A 5-finger independent hand beat a 3-finger one. That is a point for the Inspire (5 fingers, 6 actuators) over the Dex3-1 (3 fingers). Our hand-skill lessons that need ring or little finger poses should be marked "needs 5-finger hand" and skipped on Dex3-1 (my design choice).

### 1.2 Physical vs screen: what the studies say

| Study | Task | Result | Source |
| --- | --- | --- | --- |
| Leyzberg et al. 2012, N = 100, 5 conditions | Puzzle tutoring (cognitive, not motor) | Physically present robot beat video-of-the-robot and voice-only on solving time and on improvement. They flag novelty as a possible cause. | [paper](https://scazlab.yale.edu/sites/default/files/files/Leyzberg-Cogsci-12.pdf) |
| Belpaeme et al., Science Robotics 2018 review | Social robots in education | Claims three advantages for physical robots: suit physical skills, more social behaviour, more learning than virtual agents. Names handwriting and basketball free throws as physical skills where a robot may be better. Also says a robot "must be explicitly justified" vs a cheap screen agent. | [review](https://www.science.org/doi/10.1126/scirobotics.aat5954) |
| Nature npj Science of Learning 2025, N = 56 | Betty's Brain tutor, on-screen agent vs agent plus physical robot | Physical presence **not** significantly related to task performance. It was related to higher initial enjoyment. | [paper](https://www.nature.com/articles/s41539-024-00293-z) |
| de Winter et al. 2026 meta-analysis (146 studies, 183 post-test effect sizes) | Physical social robots for cognitive skills | Says the control condition type changes the result. I only read the abstract, so I cannot quote an effect size. | [Frontiers](https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2025.1735198/full) |
| Embodied robot vs virtual agent, preschool motor play | Robot or its virtual twin demonstrates movements, child repeats | Children interacted less with the virtual agent. Inexperienced children did not interact at all with it. Engagement, not learning gain. | [IJHCI 2014](https://www.tandfonline.com/doi/abs/10.1080/10447318.2014.888500) |
| TeachBot pilot | Robotics concepts, learner touches the robot | "Learning by touching" gave suggestive gains and significant self-efficacy gains. Small pilot. | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8322294) |

**Honest summary for the pitch:** physical embodiment reliably raises engagement and willingness to follow instructions. Learning gains are mixed and mostly measured on cognitive tasks. For fine finger motor skills specifically, **no direct evidence either way** (UNCONFIRMED that none exists, none found). We should say "we expect, and we will measure" and then actually measure it (feature 4 below: A/B counter).

### 1.3 What helps regardless of the robot

- **Mimicking while watching helps.** Learners who gestured along while watching animated piano hand demonstrations learned more, with lower cognitive load, and the benefit depended on expertise and task difficulty ([study](https://unsworks.unsw.edu.au/server/api/core/bitstreams/4be57d52-1e30-47e4-9a27-13c7fd294705/content), [MDPI 2024 follow-up](https://www.mdpi.com/2227-7102/14/9/949): imitative practice beat no practice, real practice did not clearly beat imitative). So "copy the robot while it plays" is supported by evidence, and our scorer gives the feedback loop.
- **Robot's fidelity limits what it can teach.** See the sign-language rows above.
- A passive robot demo is a **visual** demonstration. Liu et al. found visual demonstration of a robot path was as good as, perhaps marginally better than, being physically guided (section 2).

---

## 2. Haptic and kinesthetic guidance

### 2.1 What the literature says

- **Guidance hypothesis.** Physically guiding a movement can impair learning because the learner relies on the guidance and does not learn the commands ([JNER 2014](https://link.springer.com/article/10.1186/1743-0003-11-25)). The same paper notes there is "little evidence" robotic guidance beats unassisted practice for people without impairment.
- **Liu, Cramer, Reinkensmeyer 2006 (N = 20).** Learning a 3D path: haptic guidance vs just watching the robot move with the hand in the lap. Both cut spatial error by 30 to 40 percent. No significant difference, with a near-significant trend for **visual alone** being better (p = 0.09) ([paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC1569852)).
- **Reinkensmeyer review** ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2905644)): guidance is not a panacea. It helps when a task is too hard or dangerous to start otherwise, and one simulated driving task got a modest benefit. Suggested plan: guidance first, then fade it out, then add error amplification.
- **Heuer and Luttgen 2015 review** ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0149763415001906)): haptic demonstration beats visual for movement **dynamics**, loses for movement **paths**. Guidance tends to impede error-based learning. Error amplification tends to help.
- **Error amplification vs guidance depends on skill.** In a timing task, more skilled people learned more with amplified errors, less skilled with guidance ([Exp Brain Res 2009](https://link.springer.com/article/10.1007/s00221-009-2014-z)). A review links this to challenge point theory: advanced learners profit from challenge, novices do not ([Psychon Bull Rev 2012](https://link.springer.com/article/10.3758/s13423-012-0333-8)).
- **Hand exoskeleton, the strongest finger result.** Expert pianists' speed plateaued with practice. Passively moving their fingers with an exoskeleton through complex, faster-than-voluntary patterns raised their max playing speed, and it transferred to the untrained hand. Fast but simple, or complex but slow, did nothing ([Science Robotics 2025](https://www.science.org/doi/10.1126/scirobotics.adn3802)). This is for **experts at a ceiling**, not beginners, and needs a real exoskeleton.
- **Haptic piano learning devices exist:** linkage exoskeleton, vibrotactile glove, and EMS (electrical muscle stimulation) compared in Hapticus (CHI 2025) ([ACM](https://dl.acm.org/doi/10.1145/3706598.3713821)). Piano exoskeleton design papers exist too ([Biomimetics 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11274512)). I did not read any of them for effect sizes.
- **Social framing of a physical trainer.** A humanoid (iCub) framed as the expert trainer behind robotic physical assistance led to more motivation and enjoyment, without worse workload ([arXiv 2007.05980](https://arxiv.org/html/2007.05980v3)). I only read the abstract-level claim, so treat it as "motivation, not proven skill gain".

### 2.2 What is feasible and safe at a 24h hackathon with a stock hand

**Do not do:** strapping the learner's fingers to the robot, pushing or pulling human fingers, or letting the hand close on a human hand. The Inspire is rated for about 10 to 15 N fingertip force depending on model ([RoboticsCenter spec table](https://www.roboticscenter.ai/guides/dexterous-hands/inspire-hand-guide)), and the DFX thumb is quoted at 1.5 kg of force by one source in research/12. That is enough to hurt. Also, the hand's own `stop_motion()` in one driver is documented as **not guaranteeing an immediate stop** ([pyrh56](https://pypi.org/project/pyrh56/)). Hand-on-hand contact is a no for a 24h build (my judgement).

**Safe substitutes that stay on the "show, do not push" side:**

1. **Visual kinesthetic echo:** the learner rests a hand near the robot, not touching it, and mirrors it. This is the evidence-backed "visual demonstration plus mimicking".
2. **Tactile read-back to the robot, not to the human:** with a fingertip-sensor model, a learner presses a pad and the robot shows the pressed force (section 4). That is feedback on **us**, not force on them. **UNCONFIRMED** whether the hands we get have tactile sensing.
3. **Error amplification, on screen only:** exaggerate the learner's deviation on the twin (for example draw the error finger 2x bent). Visual error amplification has support ([Reinkensmeyer review](https://pmc.ncbi.nlm.nih.gov/articles/PMC2905644) notes errors can be enhanced with visual feedback alone). Use it for advanced learners, plain correction for beginners (my reading of the skill-level result above).
4. **Rokoko glove haptics:** whether the Smartglove can buzz or resist is **UNCONFIRMED**. Not checked, do not plan on it. Ask a mentor.

Guidance hypothesis consequence for our design: **fade the robot demo.** Show it in early reps, then hide it and make the learner recall, with the robot only reappearing on errors (my design choice, grounded in the guidance and retention results above).

---

## 3. Interaction patterns

Evidence level in brackets. All of these are software over the same ghost and scorer.

### 3.1 Slowed, step-by-step demonstration

- Evidence: a robot trainer was a motivating framing in the iCub study; mimicking while watching helps (section 1.3). No study I found tests slow-mo robot hand playback specifically. **ASSUMED** useful. Cheap to build.
- Mechanism on Inspire: stream interpolated `ANGLE_SET` targets at a lower time scale and set `SPEED_SET` so the hand is not the bottleneck (section 4).

### 3.2 Pause on the pose the learner gets wrong

- The scorer already finds the worst finger and time (per-finger DTW). The robot holds the **expert pose at that moment** and optionally pulses that finger. Evidence: error feedback drives learning ([Reinkensmeyer review](https://pmc.ncbi.nlm.nih.gov/articles/PMC2905644)). Pause timing is our design, not tested.

### 3.3 Mirror the error, then the correct pose

- Robot (or twin) shows the **learner's** wrong pose for about 1 second, then morphs to the correct one. Side by side: real robot shows correct, twin on screen shows the learner's wrong one (or the reverse).
- Caution from the evidence: seeing a model's errors may be less useful than seeing correct ones, and learners tend to **repeat their own previous mistakes** within a few unguided trials unless trained periodically ([Liu et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC1569852)). So after each mirrored error, show the correct pose last and have the learner retry at once.

### 3.4 Robot as apprentice (learning by teaching)

This is the best-supported pattern and the one that matches our pivot.

- **Protege effect:** students put in more effort and learn more when teaching an agent than when studying for themselves ([Belpaeme et al. via Aitken et al. 2025](https://www.frontiersin.org/journals/developmental-psychology/articles/10.3389/fdpys.2025.1526486/full)).
- **CoWriter (EPFL):** children teach a NAO to handwrite. The robot starts with bad writing, the child corrects it. Children committed to helping, and the review says they reflected on their own writing and showed improved fine motor skills ([EPFL paper](https://infoscience.epfl.ch/server/api/core/bitstreams/79de4adf-b7ee-4385-b095-c5dce35072c2/content), [Science Robotics review](https://scazlab.yale.edu/sites/default/files/files/scirobotics_aat5954.pdf), [HRI 2015](https://dl.acm.org/doi/10.1145/2696454.2696479)). Key design rule from CoWriter: the robot must look like it **really learns**, at the right rate, not too fast or the child has no room to improve.
- **Children Teach Handwriting to a Social Robot (2019):** children learned with the robot that showed a learning competency, and not with a non-learning one ([Springer](https://link.springer.com/article/10.1007/s12369-019-00589-w)). Whether the robot truly improves matters less for belief than for outcomes, per another study cited in a Frontiers paper ([Frontiers 2022](https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2022.836462/full)). Conflict: children **believed** the robot improved regardless of its real change, yet learning outcomes still tracked the robot's learning competency. I take both: make the robot visibly improve.
- **Caveat on robot mistakes:** the kind of mistakes a robot tutee makes changes how children teach and what they learn ([Frontiers 2025](https://www.frontiersin.org/journals/developmental-psychology/articles/10.3389/fdpys.2025.1526486/full)). Do not make the apprentice fail randomly: make its errors the specific, correctable ones.
- **Caveat:** a pair of students teaching a robot together showed no learning difference vs solo, only nicer attitude ([Steele 2022](https://lrdc.pitt.edu/sites/default/files/assets/Nokes/Steele%20et%20al.%2C%202022.pdf)). All the learning-by-teaching studies above are with children and mostly cognitive or handwriting tasks. **No finger-skill adult study found.** ASSUMED to transfer.

**How it works for us:** the learner wears the glove and performs the lesson. The robot hand replays what the learner did, with an error that gets smaller each attempt (or the learner's actual motion, run through our scorer). The learner's goal is "make the robot get it right". The robot's score **is** the learner's score, so there is no extra scoring code. The robot also shows what the learner actually did, which works as the mirror in 3.3.

---

## 4. Practical: running lessons on a real hand

### 4.1 Inspire RH56

All from the user manual unless stated ([manual PDF](https://en.inspire-robots.com/wp-content/uploads/2026/09/INSPIRE-ROBOTS-THE-DEXTEROUS-HAND-RH56-SERIES-USER-MANUAL.pdf)):

- `ANGLE_SET` (reg 1486), `FORCE_SET` (1498), `SPEED_SET` (1522), each 6 shorts. Order is little, ring, middle, index, thumb bend, thumb rotation (matches research/12).
- **Speed:** `SPEED_SET` 0 to 1000, dimensionless. At 1000, an unloaded finger takes **about 800 ms** from large angle to minimum angle. So a full open to fist takes at least 0.8 s. Under heavy load it is slower. This means **fast lesson moves cannot be shown at 1x**; the robot will lag, and our playback must clamp the time scale (my inference).
- **Force:** `FORCE_SET` 0 to 1000 grams, the fingertip force at which a finger stops. When the actual force reaches it, the finger stops. This is saved across power cycles. Thumb has its own range up to 1500 g on some models.
- **Current limit:** `CURRENT_LIMIT` 0 to 1500 mA per finger. If exceeded the finger stops and `STATUS` shows current protection. Also saved across power cycles.
- **Power-on defaults** for speed and force are also saved. **Set them low before anyone else touches the hand.** Writing to flash has a documented procedure in the controller README ([repo](https://github.com/Z13156D2/inspire-rh56-controller)).
- **Rates:** about 60 Hz per hand over serial with the fast fork, about 5 Hz with the stock community library (from research/12, [GeneralTrajectory fork](https://github.com/GeneralTrajectory/inspire_hands)). Sensor refresh after the control board is **50 Hz** per one reseller guide ([RoboticsCenter](https://www.roboticscenter.ai/guides/dexterous-hands/inspire-hand-guide)). Lessons are slow gestures, so 20 to 30 Hz command rate is plenty (my judgement).
- **Hand specs:** four-finger flexion about 260 deg/s, 540 g (DFX). Another reseller notes a fast-model hand can jitter at max position and has a driver mode setting for it (RoboticsCenter above).
- **Driver safety features worth copying:** `pyrh56` validates all writes (length, type, range), latches a safe-stop on hardware fault, and has a conservative-limits profile 200 to 700 ([pyrh56](https://pypi.org/project/pyrh56/)). Use it, do not hand-roll.
- **Stock drivers present angles in different units.** The NYU SDK uses 0 to 100 percent with 0 = open ([NYU inspire-sdk](https://github.com/NYU-robot-learning/inspire-sdk)). The register manual and Booster doc use 0 to 1000 with **0 = closed** per research/12. **Watch the direction** and verify with a slow ramp.

### 4.2 Unitree Dex3-1 on a G1

- Command topic `rt/dex3/(left|right)/cmd`, `HandCmd_` type ([Unitree docs](https://support.unitree.com/home/en/G1_developer/basic_services_interface)).
- Unitree's own teleop controller sets per joint `q`, `dq = 0`, `tau = 0`, `kp = 1.5`, `kd = 0.2`, and runs a fixed-fps loop (`fps` is a parameter; **the default value was not visible in what I read**) ([robot_hand_unitree.py](https://raw.githubusercontent.com/unitreerobotics/xr_teleoperate/main/teleop/robot_control/robot_hand_unitree.py)). Low `kp` is itself a soft force limit.
- 3 fingers, 7 DOF. It cannot show ring or little finger. Lessons that depend on those fingers cannot be demonstrated.
- Dex3-1 speed limit and force spec: not found in what I read. **UNCONFIRMED.**

### 4.3 Open examples of streaming recorded trajectories to these hands

- **`unitree_lerobot`**: replays recorded episodes on G1 including Inspire and Dex3 setups (from research/12, [repo](https://github.com/unitreerobotics/unitree_lerobot)). Best reference for "play a recorded take on the real hand".
- **`g1_inspire_sdk`** ([repo](https://github.com/Daniel891116/g1_inspire_sdk)): `hand.set_joint_targets` with 6-D canonical joints, soft-clipped, plus `open()` and `close_fist()`. Good template for a lesson player.
- **The RH56 GUI controller has an action-sequence feature** ([repo](https://github.com/Z13156D2/inspire-rh56-controller)). It is a built-in stored sequence, not a stream. Not useful for slow-mo synced to a lesson.
- I did **not** find a ready, open "replay a Rokoko take on an Inspire" project beyond the generic pieces above and the Rokoko-glove-to-Inspire ROS2 repo in research/12. Treat the replay player as ours to write.

### 4.4 Latency and sync

- Hand motion lag is about 50 to 150 ms (**ASSUMED**, from research/12). For a teaching demo that is fine at 0.5x speed. When the robot and the on-screen ghost both play, send the robot's commands **early** by the measured lag so the two stay aligned (my design choice). Measure by reading `ANGLE_ACT` back, as research/12 section 3.3 suggests.

---

## 5. Risks and honest limits

1. **The robot cannot match the human hand.** 6 actuators vs about 20 joints, 1 DOF per finger, no finger spread. Many handshapes are only approximations. Show a "fidelity" tag per lesson (1 to 3) so we are honest.
2. **Evidence for fine motor learning gains from robot demos is thin.** Our pitch should not claim better learning.
3. **Novelty effect.** Leyzberg et al. say novelty may drive the gain. Demo-day results will be inflated by it.
4. **Hardware access** is still unconfirmed (research/12). Every feature below has a twin-only fallback.
5. **Safety:** no contact with the learner, low default speed and force, power switch within reach.

---

## 6. Ranked features we could build

Hours are rough, for someone who already has the bridge and twin working (research/12 concept 1). "Hardware" means a real Inspire hand needed for the full effect, with the twin as fallback.

| Rank | Feature | What it does | Hours | Real hardware? | Why this rank |
| --- | --- | --- | --- | --- | --- |
| **1** | **Robot demonstrator with slow-mo and pause-on-error** | For a lesson step, robot plays the expert take at 0.25x to 1x, clamped by the 800 ms finger travel limit. When the scorer flags the worst finger, the robot stops on the expert pose at that frame and the twin highlights the finger. Fade option hides the demo on later reps. | 4 to 6 | Nice to have. Works on the twin. | Direct answer to the brief, uses only existing ghost, scorer and 6-number stream. Mimic-while-watching is the best supported piece. |
| **2** | **Robot as apprentice (learning by teaching)** | Learner performs the skill, robot reproduces the learner's attempt with a visible, shrinking error. Goal: "teach Pinocchio until it passes". The robot's score equals the learner's score. Optional "how does Pinocchio learn" progress bar. | 6 to 8 | Nice to have. Twin-only works. | Strongest evidence (protege effect, CoWriter), fits the Geppetto and Pinocchio pivot, and demos well. Needs a believable improvement curve. |
| **3** | **Error-then-correct mirror** | Robot shows what the learner actually did (about 1 s), then morphs to the expert pose; the learner retries at once. Beginners see plain correction, advanced learners see 2x exaggerated error on the twin. | 3 to 4 | Optional. | Cheap add-on to 1 or 2. Error amplification and skill-level splitting have support, but only in other motor tasks. |
| **4** | **Physical vs screen A/B counter** | Records, per learner, which mode (robot, screen only) they used and their score change on a repeat. Shows "n = 6, pilot, not significant" honestly on a stats card. | 2 to 3 | Needs the real hand for the robot arm of the comparison. | Gives us our own evidence in a field with none, and fits the "rigour that shows engineering" line in research/12. Small n, so label as a pilot. |
| **5 (stretch)** | **Fidelity check and lesson filter** | Per lesson, estimate how well the 6-actuator hand matches the expert's joints (curl error between human take and robot `ANGLE_ACT`). Lessons below a threshold are shown on screen only and labelled "hand cannot show this". | 2 to 3 | Needs real hand or twin with the real joint limits. | Honest, reuses the scorer. Stops us demoing a bad pose. |

**Not recommended:** any feature that moves or loads the learner's fingers (exoskeleton, strapping, hand-on-hand contact). Evidence is weak for beginners, the hardware is wrong and the risk is real.

**Order to build:** 1 then 2 (shared playback code), then 3, then 4 if time. Feature 5 is the cheap honesty slide.

---

## 7. Questions for the Rokoko or AROC mentors

1. Which hand will we actually get (Inspire model, Dex3-1) and is there a tactile-sensing version?
2. Can we write `DEFAULT_SPEED` and `DEFAULT_FORCE` to flash, and is there a firmware speed or force cap?
3. Do the Smartgloves have any haptic output? (UNCONFIRMED, I found no source.)
4. Is it OK for a learner to stand next to the hand, and where is the power cut?
