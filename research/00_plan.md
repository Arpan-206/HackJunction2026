# Junction 2026 plan: glove-based skill marketplace (v2)

Working name: **Apprentice** (alternatives: Masterhand, Mimic, Handoff).

Track: Rokoko Smartgloves. Hardware: Smartgloves II (one pair), 2x ESP32, Arduino Uno Q, laptops, a webcam.

Research behind this plan (citations live there):
- `01_hardware_feasibility.md`: Rokoko data access, plans, device roles, latency
- `02_hand_training.md`: motor learning, scoring, lesson verification
- `03_track_and_limits.md`: the track, two players on one pair, raw IMU, webcam fusion
- `04_wow_demos.md`: piano, table tennis, two-player games, other skills ranked

## One-line pitch

**Apprentice is the platform for teaching any hand skill from an expert.** Masters record a skill once with smart gloves. Anyone can then put the gloves on and train against the master: they see a ghost hand, feel a buzz on the exact finger that is wrong, and get a fair score. The gloves catch what cameras and microphones cannot: **which finger, how hard, at what angle, even when the hand is hidden**.

Piano and table tennis are not the product. They are **two example skills running on the platform**, chosen to be as different as possible (fine fingers vs grip and swing, solo vs two-player). That proves the teaching workflow is generic.

## The product: one teaching workflow, any skill

```
 MASTER                 PLATFORM                LEARNER                  BACK TO MASTER
 1 Capture  -->  2 Verify  -->  3 Publish  -->  4 Learn  -->  5 Score  -->  6 Progress + earnings
```

1. **Capture (master studio).** The master picks a skill module (Piano, Table Tennis, ...), calibrates (flat hand, fist), and records 3 to 5 takes. The platform auto-splits them into steps (phrases, strokes) and the master names each step and adds tips.
2. **Verify (platform).**
   - Sensor-health checks and pairwise-DTW consistency across takes.
   - The most typical take becomes the reference, and the spread between takes sets each finger's tolerance.
   - Duplicate check, then expert review.
   - Badges: Auto-verified, then Expert-verified, then Learner-proven.
3. **Publish (marketplace).** The master sets a price and a level. Learners browse by skill. Stripe in test mode for the demo.
4. **Learn (training room).** The learner calibrates. The skill module shows its simulation (piano keys, table tennis table) with the master's ghost hand next to the learner's live hand. Steps are checkpoints. Haptic cues are on the fingertips.
5. **Score (after every attempt).** Overall 0-100, per-finger and per-step breakdown, worst step, one plain-language tip. Live haptics **fade** over attempts (always on, then big errors only, then off), because research shows constant live feedback hurts retention.
6. **Progress and earnings.** The learner sees their history. The master sees their learners, where learners commonly fail (heatmap per step), and earnings. Learners who master a lesson feed the Learner-proven badge.

### Skill modules: how the platform stays generic

Everything above is shared. A skill is a small plug-in that supplies only five things:

| Module part | Piano | Table Tennis |
|---|---|---|
| Event detector | Key press: fast flexion stopped by the table | Stroke: rotation spike around contact time |
| Extra sensors | Webcam + ArUco for which key | None needed (optional webcam for arm) |
| Simulation view | Paper keyboard mirrored on screen, WebAudio | Three.js table, racket, ball integrator |
| Scoring weights | Notes, timing, fingering, hand shape | Grip type, face angle at contact, wrist snap timing |
| Haptic map | Cue the next finger early; buzz the wrong finger | Buzz on ball contact; buzz if grip drifts |

Adding a new skill (guitar chords, finger drumming, rehab exercises) means writing a new module, not a new app. That is the scalability slide.

## Design principle: squeeze everything out of the gloves

Every feature should show off something only the gloves can do. Judges from Rokoko are pushing the gloves as a real-time input platform (robotics, teleoperation), so lead with that.

| Glove capability | Where we show it |
|---|---|
| Per-finger articulation | Piano: which finger pressed a key (fingering score) |
| Finger flexion velocity | Piano: velocity-sensitive notes (soft vs loud) and press detection |
| Hand orientation (magnetometer-stable on Gloves II) | Table tennis: racket face angle; piano: wrist posture |
| No occlusion | Table tennis: the grip under the racket handle that a camera cannot see |
| Low latency, about 20 ms | Live games, haptic hit feedback |
| Two independent gloves, each with its own hub | Two-player modes: left glove is player 1, right glove is player 2 |
| Repeatable capture | Master lessons, consistency checks, verification |

## The two example skills

### Example 1: Table Piano fingering coach

- The learner plays on a **printed paper keyboard on a real table**. The table gives a physical stop, so press detection is reliable. Air pianos fail at exactly this.
- **Glove** gives *which finger* pressed and *how hard*. A press is a fast flexion that stops abruptly against the table. When neighbouring fingers move together, the fastest one counts.
- **Webcam** gives *which key*. A printed **ArUco marker on each glove hub** gives the wrist pose; OpenCV solvePnP does it after a 4-corner keyboard calibration. Combined with the glove's finger joints, that locates each fingertip over the keyboard. MediaPipe Hands is reported to fail on dark gloves, so do not rely on it.
- **Wow moment:** "Right note, wrong finger." Simply Piano and flowkey listen for notes; they cannot tell which finger you used. We can, and fingering gets its own score.
- Sound comes from WebAudio or MIDI, with velocity from flexion speed.
- Score 0-100 = notes + timing + fingering + hand shape.
- **Haptics:** the lesson is known in advance, so the next-finger cue buzz is sent early to cancel the delay. ERM motors spin up in 50 to 100 ms, and the full motion-to-buzz path is about 60 to 130 ms. Error buzzes are reactive and still pay the full delay.
- **Fallback with no camera:** fixed mode, where each finger owns one key (C to G).

### Example 2: Glove Table Tennis (lesson + two-player duel showstopper)

- Two players face each other, each wearing **one glove** (left = player 1, right = player 2) and holding a **real racket**. A Three.js scene shows a virtual table, their rackets and the ball.
- **What the gloves give:**
  - Grip type (shakehand vs penhold) from the finger joints
  - Racket face angle from hub orientation
  - Swing timing and direction from frame-to-frame rotation change
  - Wrist snap
- **Gameplay built on what is measurable:**
  - The game owns the ball, so it knows exactly when contact should happen.
  - At that moment it reads the glove: was the player swinging? Which way did the face point? Then a custom integrator (gravity, drag, spin) returns the ball. That is quicker and more controllable than a full physics engine.
  - Power comes in rough tiers, not exact speed: 83 Hz gives only about 8 samples per stroke, and Studio streams no raw gyro or accelerometer data (the SDK does).
- **Haptics:** each player's ESP32 band buzzes on ball contact. You *feel* the hit.
- **The Uno Q is the scoreboard.** Its built-in LED matrix shows the rally score, and a physical button serves.
- **Lesson mode (same engine):** a master records forehand topspin. The learner is scored on grip, face angle at contact and wrist snap timing.
- This also proves the platform is not piano-only: two skill categories, one engine.

### Fallback two-player mode: Echo Duel (cheap, same engine as piano)

- Player 1 (right glove) plays a short phrase. Player 2 (left glove) echoes it with the same fingers, and the piano scorer judges it.
- This acts out the product live, with one person as master and one as learner.
- It works in fixed one-key-per-finger mode, so it has no webcam dependency.
- Optional 15 s opener: quick-draw rock paper scissors, which says who formed their shape first, to about 12 ms.

## Shared scoring engine

Scoring details are in `02_hand_training.md`:
- Per-user normalisation of joint angles
- dtaidistance `dtw_ndim` with a window
- A separate rhythm score
- Per-finger score `100*exp(-(err/tol)^2)`

## Architecture

```
Smartgloves II (L + R, each its own hub) --WiFi, own router--> Rokoko Studio (laptop, Plus/Pro trial)
                                                   or Rokoko Device SDK if mentors give a key
                                                   (raw gyro/accel, USB option, Arm64 build)
        | UDP JSON :14043 (pose only)  /  SDK stream (pose + IMU)
        v
Python backend (laptop, FastAPI)
  - glove router: left hand -> player 1, right hand -> player 2
  - calibration, normalised joint angles, press detector, swing detector
  - ArUco wrist pose from webcam (OpenCV), fused with glove fingers
  - recorder (.jsonl lessons), DTW scorer, verification pipeline
        |                     |                          |
   WebSocket             UDP / ESP-NOW                 Serial / HTTP
        v                     v                          v
Web app (React + Three.js)  ESP32 #1: right hand band   Arduino Uno Q
  - piano view + ghost hand  ESP32 #2: left hand band    - LED matrix scoreboard
  - table tennis 3D scene    5 ERM motors each, MOSFETs  - serve / start button
  - marketplace, Supabase    (keep motors off sensors)   - lesson station
```

## Team split (assume 4, adjust)

| Lane | Owns | First milestone |
|---|---|---|
| Glove data + scoring | Stream receiver, L/R routing, calibration, press and swing detectors, recorder, DTW scorer | Prints live joint angles for both hands; one press detected |
| Platform + piano module | Skill-module interface, master studio, marketplace, training room shell, score card, master dashboard, Supabase; piano view, ArUco, WebAudio | Fixed-mode piano plays a note inside the training room shell |
| Table tennis module | Three.js scene, ball integrator, contact logic, racket mapping, lesson mode, duel mode | Hub rotation turns a virtual racket |
| Hardware + pitch | 2 haptic bands, Uno Q scoreboard, router, deck, demo script, recording master lessons | One motor buzzes from a UDP packet |

Build the platform shell and the skill-module interface **first** (H2-8), so both modules plug into the same capture, verify, learn and score flow. Otherwise you end up with two separate demos and no platform.

## 48h timeline

- **H0-2 (blockers):**
  1. Claim the Rokoko trial.
  2. Ask the mentors for an SDK key, a Studio voucher and a Coil Pro loan. The 6-question list is in `03_track_and_limits.md`.
  3. Set up our own router.
  4. Print one live frame and confirm the field names and the real frame rate (the sample payload shows 60 fps).
  5. Test whether Studio streams left and right gloves usefully with two different wearers.
- **H2-12:**
  - Live stream into Python.
  - Fixed-mode piano makes sound.
  - Hub rotation drives a 3D racket.
  - Haptic band buzzes.
- **H12-24:**
  - Press detection tuned on a real table.
  - ArUco key mapping.
  - Fingering score, ghost hand, haptic cues.
  - **Milestone: piano lesson end to end.**
- **H24-36:**
  - Table tennis duel: contact logic, face angle, swing timing, hit buzz, Uno Q scoreboard.
  - Marketplace pages, verification, Stripe test mode.
  - **If table tennis is not playable by H32, switch to Echo Duel.**
- **H36-44:**
  - Record master lessons.
  - Polish and rehearse.
  - Deck.
- **H44-48:**
  - Code freeze.
  - Rehearse 3 times.
  - Record a backup demo video.

## Demo script (2 minutes): walk the workflow once, then prove it generalises

1. **Hook (10 s):** "Experts can only teach hand skills in person, one learner at a time. Cameras see your hand and microphones hear your notes, but neither knows which finger you used."
2. **Workflow, live, with piano (60 s):**
   - **Capture:** a teammate (the "master") records a 4-note phrase live in the master studio. Steps auto-split.
   - **Verify:** the platform checks it against the 3 takes recorded earlier. The consistency check passes and an Auto-verified badge appears.
   - **Publish:** the master sets a price and the lesson appears in the marketplace.
   - **Learn:** a judge buys it, puts the glove on and plays on the paper keyboard. They hit the right note with the wrong finger. The screen flags it and the correct finger buzzes.
   - **Score:** score card. Second attempt: the haptics fade and the score jumps.
   - **Master dashboard:** the master's dashboard shows the new learner, a fail heatmap and earnings.
3. **Same platform, different skill (35 s):**
   - Switch the module to Table Tennis and show a master's forehand lesson for 5 s.
   - Then the showstopper: two judges, one glove each, real rackets. A rally on the big screen, a buzz on every hit, the score on the Uno Q matrix.
4. **Close (15 s):** "Two skills, one workflow. Any expert can teach any hand skill: rehab clinics, music schools, sports coaches. And every lesson recorded is training data for robot hands" (Rokoko's own direction).

Fallback: if table tennis is not ready, step 3 shows the table tennis *lesson* replay plus Echo Duel on piano.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Live streaming is paywalled | 7-day trial at H0; ask mentors for a voucher or SDK key |
| Studio has no raw IMU | Swing timing from rotation change between frames; tiered power |
| Stream may be 60 fps, not 83 | Measure at H0; table tennis uses the game-owned contact time, so it tolerates this |
| ERM motor lag | Send scripted cues early; use short sharp pulses |
| Webcam fails on dark gloves | ArUco on the hub (not MediaPipe Hands); tape dots or fixed-key mode as fallbacks |
| Two players need a joint calibration | Both stand in the pose together; script it in the demo |
| Venue WiFi | Own router, static IPs |
| Magnetometer near motors and metal | Mount motors on the outside of the fingertips, keep wires off the sensors, calibrate away from metal |
| Table tennis too ambitious | Hard switch to Echo Duel at H32 |
| Prior art (patent US 7378585 on glove music teaching) | Do not claim "first ever"; claim the marketplace, verification and multi-skill engine |
| Demo-day hardware failure | Backup video and a replay mode using recorded attempts |

## Optional: webcam fusion beyond the demo

- Camera for position, gloves for fingers and rotation. A one-time frame alignment and timestamp interpolation are in `03_track_and_limits.md`.
- This unlocks "move your hand here" lessons (full piano range, conducting, arm-level sports).
- Long term, a webcam-only learner mode lets learners train without 2,000 EUR gloves, at lower accuracy. Masters still record with gloves.
