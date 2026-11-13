# 04 Wow demos: pushing the gloves in a live simulation

Date: 13 Nov 2026. Builds on 01 (hardware, latency) and 02 (feedback science, DTW scoring). Not repeated here. Claims with a link are sourced. Anything marked (my judgement) is opinion.

## Recommendation up top

- **Hero demo: "Table Piano with a fingering coach".** The learner plays on a printed paper keyboard on a normal table, wearing the gloves. The glove says *which finger* pressed and *when*. A top-down webcam says *which key* the finger is over. A falling-notes screen, a 3D ghost of the master's hands, real piano sound, fingertip buzz cues timed ahead of each note, and a 0-100 score split into notes, timing and fingering. The killer line for judges: *"Simply Piano can hear that you played a D. It cannot tell that you used the wrong finger. We can."*
- **Two-player mode: "Echo Duel".** Player 1 wears the right glove, player 2 the left. P1 plays a short phrase, P2 must echo it with the same finger numbers. It is literally the product in miniature: P1 is a live master, P2 is the learner, scored with the same engine. Optional 15-second opener: **"Quick-draw rock paper scissors"** where the glove times who formed their shape first, to 12 ms.
- **Runner-up / stretch: "Grip and Snap" table tennis.** Real racket in hand, simulated ball. Very visual, but the glove only sees grip shape and wrist rotation, not the arm swing or grip force, so it is a riskier hero and a smaller lesson market. Build it only if a second sub-team has spare hours after hour 24.
- **Biggest technical trick (my judgement):** in both piano and table tennis the *simulation knows the future* (the score says when the next note is due; the physics says when the ball reaches the racket). So schedule haptic cues ahead of time by the measured pipeline latency. That turns the 60 to 130 ms loop from 01 into near-zero perceived haptic delay for cues. Only *reactive* feedback (error buzzes, note sound on your own press) still pays the full latency.

---

## 1. Virtual piano with data gloves

### Prior art

- **Patents and old research.** A data-glove patent describes detecting a virtual key hit from "an abrupt rate of change of the angle measured", the exact signal we have ([US 6304840](https://patents.google.com/patent/US6304840)). There is also a patent for a "Musical teaching device and method using gloves and a virtual keyboard" ([US 7378585](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7378585)), so check claims before saying "first ever".
- **Stroke rehab virtual piano (RESNA 2008):** strain-gauge data gloves at 100 Hz plus hand position tracking, a virtual piano, force feedback; all 3 subjects improved in key accuracy and independent finger flexion after 6 to 12 hours ([Mathai et al.](https://www.resna.org/sites/default/files/legacy/conference/proceedings/2008/CAC/Mathai.html)). Proof that a glove plus virtual keys can train fingers.
- **Flex-sensor synth glove (Circuit Cellar):** one flex sensor per finger, Schmitt trigger threshold triggers a note; the authors note "flexing a human finger is not necessarily a digital operation", i.e. threshold choice is fiddly ([Circuit Cellar](https://circuitcellar.com/research-design-hub/projects/build-a-wearable-synthesizer-system/)).
- **Air Guitar gloves (UIUC ECE445, 2026):** finger-curvature glove for chords plus strumming glove, target "Motion-to-Sound" delay under 30 ms ([proposal PDF](https://courses.grainger.illinois.edu/ece445/getfile.asp?id=25360)). Their target is far tighter than our pipeline, see latency below.
- **Leap Motion / camera air pianos and their failure mode:** depth estimates are too coarse to tell if a finger pressed a key, so researchers added fingertip pressure sensors and an acrylic surface to press on ([NTHU VR piano platform](https://mislab.cs.nthu.edu.tw/project-pages/vr-piano-learning-platform.html)). Players struggle to find keys without tactile feedback ([SIGGRAPH 2017 poster](https://history.siggraph.org/wp-content/uploads/2022/09/2017-Poster-33-Matsusue_Touch-typable-VR-piano-that-corrects-positional-deviation.pdf)). A Leap "AirKeys" paper reports a downward press is hard to tell apart from other hand motion ([UCL paper](https://discovery-pp.ucl.ac.uk/id/eprint/1436807/1/Han_Gold_Leap_Motion.pdf)). **This is our opening: the glove measures finger flexion directly, so press detection is not a depth guess.**
- **Webcam table pianos:** AnywherePiano maps MediaPipe hand keypoints to keys with a tap threshold ([GitHub](https://github.com/CynapticsAI/AnywherePiano)). "Hands Tiles" plays on a flat table with a four-corner homography for camera-to-table mapping and velocity-based tap detection with a 150 ms cooldown; position-based detection was too noisy; vision capped at 30 fps ([Devpost](https://kelaenderkoe.pages.dev/patterns-https-devpost.com/software/table-tiles)). Barehanded Music did desk tapping with a depth sensor ([paper](https://cse.buffalo.edu/~jsyuan/papers/2016/Barehanded%20Music,%20Real-time%20Hand%20Interaction%20for%20Virtual%20Piano.pdf)). Copy the homography idea; replace their noisy camera tap detection with the glove.
- **Haptic piano teaching** (Passive Haptic Learning, Tactile Teacher, Hapticus) is already covered in 02. Not repeated.

### What camera-only and audio-only apps cannot do

- Simply Piano and flowkey detect notes by microphone or MIDI. Reviews say Simply Piano *tells* you which finger to use and flowkey shows a video to copy; neither checks it ([Musicianwave comparison](https://www.musicianwave.com/flowkey-vs-simply-piano/), [Trustpilot reviews](https://ca.trustpilot.com/review/flowkey.com?page=7)). Not official docs, but nothing suggests finger checking.
- Extracting fingering from video alone is a research problem because key presses are "often subtle for the naked eye" ([Moryossef et al. 2023](https://huggingface.co/papers/2303.03745.md)).
- Fingering matters to teachers: fixed fingering speeds learning, and one group-piano instructor reports students who ignore fingering principles read worse than total beginners ([Fundamentals of Piano Practice](https://fundamentals-of-piano-practice.readthedocs.io/chapter1/ch1_procedures/II.18.html), [Sight Reading Mastery](https://sightreadingmastery.com/laura-beauchamp-the-building-blocks-of-sight-reading/bb5.html)). These are teacher opinions, not controlled studies.
- **So yes: the glove can teach correct fingering**, provided we also know which key the finger is over (webcam or fixed hand position, below). That is a genuine, demonstrable gap.

### Key press detection: three input modes

The Rokoko finger sensor sits on the middle phalanx (01), so a key press shows as a fast flexion of that finger's curl angle.

| Mode | How a press is detected | Which key | Robustness | Verdict |
|---|---|---|---|---|
| **A. Air** (no surface) | Flexion velocity peak above threshold, then curl past a press level | Webcam x, or fixed | Poor. No end stop, no tactile feedback; the Leap literature shows players lose key position and presses blur into other motion (links above). | Show for 5 s as a flourish only. |
| **B. Table + printed keyboard** (recommended) | Flexion velocity goes high, then **stops abruptly** when the fingertip hits the table (a sharp deceleration, velocity sign flip). This is a much cleaner event than an air threshold. | Top-down webcam: fingertip x,y through a 4-corner homography onto the paper keys | Good. Table gives a real end stop and the player feels a "key". | **Hero mode.** |
| **C. Fixed 5-finger position** | Same as B | Each finger owns one key (C D E F G for the right hand). Optional: wrist yaw or webcam x shifts the whole hand by an octave or position. | Very robust, no camera needed. But wrong finger always means wrong note, so it **cannot show the fingering advantage**. | Fallback if the webcam fails. |
| D. Real MIDI keyboard + glove (if one can be borrowed) | MIDI note-on gives exact note and time; glove picks the finger with the largest flexion velocity in a +/-40 ms window | MIDI | Best accuracy (my judgement). Less "simulation wow". | Ask organisers; good fallback for the fingering story. |

**Press detector sketch (my judgement, tune on day 1):**
1. Normalise each finger's curl to 0..1 with the fist/flat calibration from 02.
2. Velocity `v = d(curl)/dt` with a 2-frame difference (at 83 Hz a frame is 12 ms).
3. Press onset when `v` exceeds a per-user threshold *and* this finger's `v` is at least about 1.5x every other finger's `v`. The "winner takes it" rule handles finger enslaving: neighbouring fingers move involuntarily, and less so in trained pianists ([Sci Rep 2024 on enslaving](https://link.springer.com/10.1038/s41598-024-65888-3), [PSU EEG study](https://pure.psu.edu/en/publications/modulated-cortical-control-of-individual-fingers-in-experienced-m/)). Novices will have more cross-talk, so the ratio rule matters.
4. Table mode: confirm with the deceleration spike (velocity drops from high to about zero within 1 to 2 frames).
5. Refractory until curl comes back up past a release level, plus a 100 ms cooldown (Hands Tiles used 150 ms, above).
6. Velocity at onset maps to MIDI velocity, so loud/soft also works (my judgement).

**Is the frame rate enough?** Skilled pianists in lab studies played at 125 ms between keystrokes and as fast as about 95 ms ([Dalla Bella and Palmer 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3121738)). At 83 Hz that is 8 to 10 frames per note, enough for beginner and intermediate pieces. Fast trills will smear (my judgement). **Risk to verify in hour 1:** the Rokoko Custom Streaming sample payload shows `"fps": 60` ([Custom Streaming docs](https://support.rokoko.com/hc/en-us/articles/4410416376977-Custom-Streaming)). If Studio streams at 60 rather than 83 Hz, frames are 17 ms; still fine for slow pieces.

### Which key a finger is over

- **Webcam top-down, MediaPipe Hand Landmarker in the browser.** Expect about 20 to 30 fps on a laptop; one tester got about 25 fps tracking two hands ([TDS article](https://towardsdatascience.com/exquisite-hand-and-finger-tracking-in-web-browsers-with-mediapipes-machine-learning-models-2c4c2beee5df), [official docs](https://ai.google.dev/mediapipe/solutions/vision/hand_landmarker)). The camera is too slow and noisy to detect presses, but it only needs to answer "which key column is fingertip 3 over", which changes slowly. Hold the last camera position and let the glove supply timing.
- Use the gloves for *which finger* and *when*, the camera for *where*. Fuse at the press event: on a press by finger f, look up fingertip f's latest camera x,y, run it through the homography, read the key (my judgement).
- Dark gloves on a white paper keyboard should track fine, but MediaPipe is trained on bare hands; test the gloved hand on hour 1 (my judgement). Fallback: a coloured tape dot on each glove fingertip and a simple colour blob tracker.

### Latency tolerance for music

- Musicians detect a delay between key press and sound at about 102 +/- 65 ms; non-musicians at 180 +/- 104 ms ([van Vugt and Tillmann 2014, PLoS ONE](https://doaj.org/article/adcc2bcf89314076a2975ec0c0b7f596)).
- A just-noticeable-difference study found a mean JND of 49 ms from a 0 ms baseline, lower for more musically trained people ([Regensburg 2024](https://epub.uni-regensburg.de/59003/1/JND_Audio_Latency.pdf)).
- Instrument design guidance aims for 10 ms with +/-1 ms jitter; percussive instruments at 20 ms were rated worse than 0 to 10 ms ([Jack et al. 2016](https://instrumentslab.org/data/andrew/jack_am2016.pdf); the 10 ms / 1 ms figure is Wessel and Wright's, as cited in search summaries, original not opened).
- **Our estimate for press-to-sound (my judgement):** glove 20 to 40 ms + Studio and UDP 5 to 15 ms + detection 1 to 2 frames (12 to 24 ms) + browser audio output (device dependent; read `AudioContext.outputLatency` ([MDN](https://developer.mozilla.org/docs/Web/API/AudioContext/outputLatency)); old Windows measurements were near 100 ms ([Mozilla bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1375466))) = **about 50 to 100 ms with a good audio setup**.
- **Verdict:** a pianist judge will feel it, a beginner mostly will not (sits around the 102 ms musician threshold). Mitigations: `latencyHint: "interactive"`, wired headphones or laptop speakers (no Bluetooth audio), keep audio in the same browser tab, measure `outputLatency` on the demo laptop, and pick a slow, legato piece so lag is less obvious. Do not pitch it as a performance instrument; pitch it as a **practice coach**.
- Audio vs haptic sync: audio-tactile asynchrony thresholds are in the tens of ms and lower when audio leads ([driving study](https://www.emergentmind.com/papers/2307.05451), [Fujisaki and Nishida 2009](https://link.springer.com/doi/10.1007/s00221-009-1870-x)). Pre-scheduled cues (below) keep buzz and expected note aligned.

### Audio output

- **Tone.js + `@tonejs/piano`** (Salamander Grand samples, up to 16 velocity levels) gives a real piano sound in a few lines ([npm](https://npmjs.org/package/@tonejs/piano)). Tone.Sampler fills missing notes by pitch shifting.
- **Web MIDI** if we want to drive a DAW or a real keyboard; needs HTTPS or localhost and a permission prompt ([MIDI.org](https://midi.org/about-web-midi?format=amp)).
- Also log every detected note as a MIDI-like event list `{t, note, finger, velocity}`; this is the lesson and attempt format.

### Scoring against the master

The master records the piece with the gloves on the same paper keyboard. The lesson becomes a note list with a finger per note, plus the raw joint stream for the ghost hand.

- **Align** learner notes to master notes with DTW on onset times or a simple greedy match within a tempo-scaled window (02 covers DTW; a note-level match is simpler here).
- **Notes (0-100):** fraction of master notes matched by the right key.
- **Timing (0-100):** after removing the overall tempo ratio, mean absolute onset error; score `100 * exp(-(err/60 ms)^2)` (tolerance is my judgement; tie it to the master's take-to-take spread as in 02).
- **Fingering (0-100):** fraction of matched notes played with the master's finger. **This is the unique sub-score.**
- **Hand shape (optional):** the 02 per-finger joint-angle score between presses (curved fingers, relaxed thumb).
- Final: e.g. `0.35 notes + 0.25 timing + 0.30 fingering + 0.10 shape` (weights my judgement).
- Feedback text: "Bar 2, note E: right note, wrong finger (3 instead of 2)."

### Haptics for piano

- **Pre-cue:** about 150 ms before each note is due, buzz the finger that should play it (ERM 80 ms pulse). Because the score is known, send the UDP command early by the measured pipeline delay. ERM motors take about 50 to 100 ms to reach 90% amplitude, LRAs faster ([TI SLOA194](https://ti.com/lit/SLOA194), [Power Electronic Tips](https://www.powerelectronictips.com/haptics-components-pt-1-lra-erm-and-piezo-actuators/)). That is slower than the 20 to 50 ms assumed in 01, so measure our motors and include spin-up in the lead time. Overdrive (full PWM for 20 ms, then hold) helps (my judgement).
- **Correction:** wrong finger used: short double buzz on the correct finger.
- Fade cues per 02 (pre-cues stage 1, correction only stage 2, none in the retention run). Note PHL research showed haptics teach *which finger, which order*, not rhythm (02), which fits exactly.

---

## 2. Table tennis and racket sports

### What the glove data shows

| Signal | Visible to Rokoko gloves? | Notes |
|---|---|---|
| Grip type (shakehand vs penhold) | **Yes, clearly.** | Different finger flexion patterns: penhold wraps thumb and index around the front of the handle, shakehand wraps three fingers round the handle with index on the backhand rubber. A nearest-template classifier on curl values should separate them (my judgement). Xia et al. found penhold players hold the racket at a much larger initial adduction angle relative to the forearm (about 45 vs 7 degrees) ([JSSM 2020, PMC7675628](https://pmc.ncbi.nlm.nih.gov/articles/PMC7675628)), which is a hub-vs-forearm angle we can read if the forearm sensor is streamed. |
| Grip tightness | **Weak proxy only.** | Once fingers touch the handle, squeezing harder barely changes joint angles (my judgement). A sensor-racket study measured combined grip force peaking at impact, about 85 N in fast drives with a range of 30 to 135 N between players ([Watanabe et al., ISBS 2024](https://commons.nmu.edu/isbs/vol42/iss1/27)). Force is invisible to us. Honest framing: "grip shape and finger placement", not "grip pressure". A cheap FSR on the handle wired to an ESP32 would add real pressure (my judgement, stretch). |
| Racket face angle | **Yes**, if the racket is held consistently: racket orientation = hub orientation x fixed grip offset, calibrated once. | |
| Wrist snap | **Yes.** Angular velocity of hub relative to forearm. | Coaches disagree whether the wrist should snap at contact or be added last; most agree it adds spin and that the grip should stay relaxed ([PingSkills forum](https://www.pingskills.com/table-tennis-forum/forehand-topspin-wrist), [PingSkills, forearm snap at contact](https://pingskills.com/table-tennis-forum/using-wrist-when-hitting-forehand-topspin)). Practitioner opinion, not science. |
| Arm swing path and speed | **Mostly no.** No absolute position without the Coil Pro (01). | Estimate with an arm model: shoulder pivot, forearm orientation from the arm sensor, hand from hub (my judgement). Webcam pose at 30 fps will blur during a fast swing; use it only for stance and elbow height at the backswing (my judgement). |

### Is 83 Hz enough?

- Racket IMU work samples much faster (a patent family cites 1 kHz), while a working hobby smart bat used 50 Hz with swing detection at acceleration above 2 g and angular velocity above 200 deg/s ([Edge Impulse smart bat](https://docs.edgeimpulse.com/projects/expert-network/smart-table-tennis-bat-arduino-nano-33)). A tennis forehand study found joint-angle error tolerable (5 to 10 degrees) at 100, 250 and 500 Hz but significantly worse at 100 Hz ([Unirioja study](https://investigacion.unirioja.es/documentos/62f80c959162cc4ea7f1faee/f/6304bd43af66e27e1a068d00.pdf)).
- **Verdict (my judgement):** 83 Hz (or 60 Hz if Studio caps it) is enough to detect a swing, classify forehand vs backhand, read grip and racket face angle, and roughly rank wrist snap. It undersamples the peak angular velocity, so absolute speed numbers will be low and noisy. Also, Studio gives orientations, not raw gyro; the Device SDK would give gyro and accelerometer (01), which would be much better for swings.
- **Design around it:** the ball is simulated, so the game *defines* the contact time T. Interpolate the racket's orientation and angular velocity at T from the frames either side. No need to catch the real impact instant.

### Webcam

- MediaPipe Pose for shoulder and elbow at 20 to 30 fps (same browser numbers as above). Use it for setup checks ("elbow too high at the backswing") and to place the 3D arm roughly, not for contact.

### 3D sim in the browser

- **Three.js for rendering.** For physics, the honest community view is: Rapier (WASM) is faster, better maintained, deterministic and has CCD (continuous collision detection, stops a fast ball tunnelling through a thin racket); cannon-es is pure JS and quicker to start but "on life support"; no rigorous benchmark exists ([three.js forum](https://discourse.threejs.org/t/rapier-vs-cannon-performance/53475), [comparison](https://learnwithhasan.com/js-libraries/compare/rapier-vs-cannon-js/)).
- **Better for 48 h (my judgement): no physics engine at all.** One ball, one table plane, one net, one racket plane. Write a 60-line integrator: gravity + drag + Magnus (spin cross velocity), table bounce with restitution, and an analytic racket hit at time T: outgoing velocity from racket face normal, racket speed estimate and wrist angular velocity (spin). A developer did exactly this with RK4, Magnus and Three.js-only rendering ([ping pong physics engine](https://hamza-syrage.is-a.dev/projects/ping-pong-physics-engine)); the Pelota docs list the same force set ([Pelota physics](https://mbkma.github.io/pelota-docs/docs/physics-simulation/)). Sanity check Magnus magnitude; one forum sim got it about 10x gravity by mistake ([Physics Forums](https://www.physicsforums.com/threads/relative-strength-of-the-magnus-effect-relative-to-gravity.1015219)). Ball radius 0.02 m, table height 0.76 m.
- Unity would look nicer and Rokoko has an official Unity live plugin (01), but splitting the stack between a browser marketplace and Unity costs integration hours (my judgement).

### Prior art: VR table tennis coaching

- 57 non-competitive players training in Eleven Table Tennis VR improved real-table play versus a no-training control, Cohen's d about 1.1; no active control group ([Michalski et al. 2019, PLoS ONE](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6736297/)).
- A smaller custom VR system (7 control, 8 training) improved technique ratings but not balls returned ([IEEE TVCG 2021 record](https://bvbvf1.bib-bvb.de/vufind/PrimoRecord/cdi_proquest_journals_2728571976)).
- VR uses a hand controller, so it knows racket position but **not the grip or fingers**. Our angle: "VR teaches where the racket goes; the glove teaches how you hold it." (my judgement)

### What a master's forehand topspin lesson would look like

1. **Grip check (static, 10 s):** master's shakehand grip as a pose template. Learner matches; per-finger colours; buzz the finger that is off (index finger too far up the blade is a classic fault, my judgement).
2. **Ready position:** racket face angle and wrist cocked/neutral, from hub orientation.
3. **Shadow swing x5 (no ball):** DTW against the master's swing on hub + forearm orientation (02 method). Score: face closing angle through the swing, wrist snap timing relative to the angular velocity peak, and a "relaxed grip" check (finger curls should not tighten during the swing; a weak proxy).
4. **Ball mode:** simulated balls with backspin; contact at the scripted time; the sim shows where the ball lands and how much topspin it carried. Haptic: all five motors buzz at contact, pre-scheduled so it lands on the ball impact frame.
5. Terminal score: grip 0-100, face angle 0-100, snap timing 0-100, balls on table.

---

## 3. Two-player single-glove modes

One pair = one right glove and one left glove, so each player gets one hand. P2 plays left-handed, which is fine for finger games. Score both through the same engine (my judgement for all game designs below).

| Game | How it works | Wow | Build | Shows the product? |
|---|---|---|---|---|
| **Echo Duel (recommended)** | Table piano. P1 (right) plays a 4 to 8 note phrase in their 5-finger position. P2 (left) must echo it with the same finger numbers (thumb = 1 on both hands, mirror mapping). Score notes, timing, fingering. Swap roles; first to 3 rounds. | 4 | 4, reuses the hero engine | **Yes: P1 is a live master, P2 a learner.** |
| Quick-draw RPS | On "3, 2, 1, shoot", both form rock, paper or scissors. Classifier on 5 curl values. Winner by RPS rules; tie broken by who held a stable shape first, timed to one frame (12 ms). Humans form a gesture in about 60 ms ([NBC on the Ishikawa robot](https://www.nbcnews.com/tech/tech-news/robot-will-beat-you-rock-paper-scissors-100-percent-time-flna847446)), so frame-level timing makes a fun "you were 36 ms faster" readout. | 4 | 5, a few hours | Partly (shape recognition). |
| Mirror Me | P1 moves freely, P2 copies live; score = per-finger similarity with a lag-tolerant window (DTW over the last 1 s). Big screen shows both 3D hands overlaid. | 3 | 4 | Yes, the "live master" mode. |
| Reaction drill | Screen flashes a finger number (or a motor buzzes a finger); first to flex the correct finger wins. Haptic version is eyes-free and great for judges. | 3 | 5 | Partly (haptics). |
| Finger sumo / tug | Each player's mean flex speed pushes a 3D ball across a line. | 3 | 5 | No, pure party game. |
| Piano duel race | Both play the same falling-notes line, one per hand, live scoreboard. | 4 | 4 | Yes |

Recommended: **Echo Duel** as the two-player mode, with **Quick-draw RPS** as an optional 15 s crowd opener if time allows.

---

## 4. Other high-wow precision skills, ranked

Scores 1 (poor) to 5 (great). All scores are my judgement; sources are for the supporting facts.

| Skill | Wow | Glove shows skill | 48 h build | Paid lesson market | Notes |
|---|---|---|---|---|---|
| **Table piano + fingering** | 5 | 5 | 4 | 5 | Online music education about USD 4.3 bn in 2025, piano about 39% of it ([Expert Market Research](https://www.expertmarketresearch.com/reports/online-music-education-market), [Mordor Intelligence](https://mordorintelligence.com/industry-reports/online-music-education-market)); syndicated estimates, treat as order of magnitude. |
| **Table tennis grip and snap** | 5 | 3 | 3 | 3 | Grip and wrist yes, swing and force no. |
| Finger drumming (pads on table) | 4 | 4 | 4 | 3 | Melodics claims over 1M users and sells finger drumming lessons via hardware bundles ([Melodics](https://melodics.com/finger-drumming), [info page](https://melodics.com/info/ai-info-page)). Same engine as piano. But drumming is the least latency tolerant (Jack et al. above) and 01 already flags it as too fast. Good as a second lesson type, not hero. |
| Guitar fretting hand | 3 | 3 | 4 | 4 | Chord shapes are static poses (02). Without a real guitar, no fret position. Student "Air Guitar" glove project exists ([UIUC](https://courses.grainger.illinois.edu/ece445/getfile.asp?id=25360)). Less visual than piano. |
| Theremin-style instrument | 4 | 4 | 5 | 1 | Wrist pitch = pitch, finger curl = volume/filter, very easy and beautiful. Mi.Mu gloves did gesture music for Imogen Heap ([Wikipedia](https://en.wikipedia.org/wiki/Mi.Mu_Gloves)). A search summary mentioned a theremin study where people perceived latency differences of 30 ms and above, but I did not find or open that paper, so treat it as unverified. Continuous control likely hides lag better than note onsets (my judgement). Nobody pays for theremin lessons. Use as a 10 s "free play" flourish. |
| Conducting an orchestra | 4 | 2 | 4 | 1 | Glove-based virtual conducting is well trodden ([NTHU iConduct](https://idea.cs.nthu.edu.tw/works/conducting.html), [Cornell ECE4760](https://people.ece.cornell.edu/land/courses/ece4760/FinalProjects/f2014/pjj39_wg79/index.html)). Needs baton/arm trajectory, which we lack. |
| Surgical / pipetting sim | 3 | 2 (pipetting thumb 3) | 3 | 4 (B2B) | VR pipetting training exists with controllers, SenseGlove and haptic pipette controllers ([AAU thesis](https://projekter.aau.dk/virtual-pipetting-a-comparison-of-learning-transfer-in-vles-using-handheld-and-hand-worn-controllers-60ef959f.html), [Imperial](https://medlearn.imperial.ac.uk/innovation/?p=141)). The glove sees thumb plunger technique but not the instrument. A pitch slide, not the hero. |
| Robot / drone control | 5 if a real robot | n/a (control, not skill) | 2 | 1 for lessons | Glove drone control is published ([Macchini et al. ICRA 2020](https://arxiv.org/pdf/2004.07111), [Glove2UAV](https://arxiv.deeppaper.ai/papers/2601.15775v1)). We have no robot or drone, and it is not a lesson. Skip. |
| VR sculpting | 4 | 2 | 2 | 2 | Needs hand position in space (webcam z is poor). |
| Pottery wheel sim | 3 | 1 | 2 | 2 | Force and clay are the skill (02). |
| Card magic | 4 | 3 | 3 | 2 | Glove can show a hidden finger technique, but cards are untracked (02). |
| Juggling | 4 | 1 | 1 | 1 | Arms and balls, not fingers. |
| Esports aim | 2 | 2 | 4 | 2 | The mouse already measures aim; glove adds grip posture only. |

---

## 5. Top 3 for a 2-minute judged demo

1. **Table Piano with fingering coach** (hero). Highest combined wow, data fit and market. The fingering sub-score is a claim competitors cannot match.
2. **Echo Duel** (two-player, same engine). Cheap once 1 works, and it stages the marketplace story live (one person teaches, one learns).
3. **Grip and Snap table tennis** (stretch). Spectacular if it works, but more physics and calibration risk, and the glove misses half of the skill. Keep as a separate 20-hour sub-project or a roadmap slide with a 10 s clip.

### Hero demo technical outline: Table Piano

```
Rokoko Studio --UDP JSON :14043--> Python bridge (laptop)
   per-finger curl, velocity, press detector, hub orientation
        |  WebSocket (JSON, ~83 Hz frames + press events)
        v
Browser app (Three.js + Tone.js + MediaPipe)
   - webcam top-down -> MediaPipe fingertips -> homography -> key under each fingertip
   - press event (finger f, t, velocity) + key under f -> note -> Tone.js piano sound
   - lesson player: falling notes, 3D ghost of master's hands, learner hand in colour
   - scorer: notes / timing / fingering / shape -> 0-100
        |  WebSocket back to Python (or UDP direct from Python)
        v
ESP32 haptic band(s): pre-scheduled finger cues, correction double-buzz
```

- **Calibration (30 s):** fist/flat for curl range (02); 4 corner taps on the paper keyboard for the homography; a tap-on-beat test to measure our own press-to-detect latency and subtract it from timing scores.
- **Master side:** master plays a C-position melody (Ode to Joy, 5 fingers, no crossings) 3 times; store note list with fingers + joint stream; medoid take is the lesson (02 verification).
- **Learner side:** watch ghost, play with cues, play without cues, score screen.
- **Fallbacks:** webcam fails, switch to fixed 5-finger mode (C). Glove WiFi fails, replay a recorded learner take (01 advice).

### Two-player technical outline: Echo Duel

- Same bridge; tag events by glove side (left = P2, right = P1).
- Fixed 5-finger mode is enough here (each player owns 5 keys, P1 C-G, P2 an octave lower), so no camera dependency. Mirror mapping by finger number so a left-hand echo of a right-hand phrase is fair.
- Round: P1 plays phrase (recorded live as the "master take"), screen shows it as falling notes, P2 echoes, scorer runs the same notes/timing/fingering maths, P2's motors pre-cue on the first round only.
- Score display: two big 0-100 numbers and a best-of-3 tally.

### Suggested 2-minute script (my judgement)

- 0:00 to 0:15. Problem: video and audio apps cannot see your hands. Show the glove.
- 0:15 to 0:30. Master's lesson card in the marketplace, play the ghost hands.
- 0:30 to 1:05. Judge or teammate plays the table piano; fingertip buzz cues; play a deliberately wrong finger on a right note; screen shows "right note, wrong finger". Score 0-100 with fingering bar.
- 1:05 to 1:35. Echo Duel: two teammates, one glove each, one round.
- 1:35 to 2:00. Marketplace: masters record once, sell forever; verified lessons; roadmap (table tennis clip, drumming, guitar).

### Build plan for the hero (my judgement)

- H0 to 6: confirm stream rate (60 vs 83 Hz), curl normalisation, press detector printing finger events on a table.
- H6 to 14: browser: Tone.js piano, fixed 5-finger mode end to end (mode C). This is already a working demo.
- H14 to 24: webcam + homography for key position (mode B), fingering sub-score, ghost hand.
- H24 to 32: ESP32 pre-scheduled cues, latency measurement and compensation.
- H32 to 40: Echo Duel, master recording flow, score screen.
- H40 to 48: polish, recorded fallback takes, rehearse the script.

## Open risks

- Studio Custom Streaming may run at 60 fps, not 83 (sample payload shows 60). Check first.
- MediaPipe on gloved hands is untested; have the colour-dot fallback.
- ERM spin-up may be 50 to 100 ms (TI), slower than 01 assumed; pre-scheduling hides it for cues only.
- Press-to-sound of about 50 to 100 ms will be noticeable to trained pianists; frame it as a coach, choose slow pieces.
- Patent US 7378585 covers gloves plus virtual keyboard teaching; avoid "first ever" claims.
