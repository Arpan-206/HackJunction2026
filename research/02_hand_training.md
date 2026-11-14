# 02. How to actually train hands with gloves + haptics

Scope: feedback science, scoring algorithms, demo skill choice, prior art, lesson verification. Written for a 48h build. Claims from the web carry a link. Anything marked (my judgement) is opinion, not sourced.

## Recommendation up top

1. **Demo skill:** ASL/fingerspelling-style "hold this hand shape" lessons first (static poses, easy to score, easy to show), plus one short dynamic sequence (a piano 5-finger exercise or a rehab finger-tap routine) to show tempo scoring and haptics. Do NOT pick knot tying, suturing, pottery or knife skills: gloves have no object or force data.
2. **Feedback loop:** watch the ghost hand, then practise step by step with live per-finger colour on the ghost (early), fading to score-after-attempt only (later). Use vibration on the single worst finger, and fade it out as the learner improves.
3. **Scoring:** per-finger joint-angle error with per-user calibration, DTW only for timing-flexible steps, score = 100 * exp(-(error / tolerance)^2), shown as 0 to 100 plus "worst finger" text.
4. **Verification:** require several takes by the master, check they agree with each other (take-to-take DTW consistency), reject bad data automatically, then a human expert review for the paid tier.

---

## 1. Motor learning science and design rules

### What the research says

**Concurrent vs terminal feedback, and the guidance hypothesis.** The guidance hypothesis says too much feedback during practice makes performance look great while the feedback is on, but the learner becomes dependent and does worse once it is removed. The classic reference is Salmoni, Schmidt and Walter 1984. A large review by Sigrist et al. found that for simple tasks this holds, but for complex tasks concurrent feedback (live visual feedback) is mostly helpful, especially early in learning. It also says feedback frequency should fall as skill rises ([Sigrist et al. 2013 review](https://link.springer.com/article/10.3758/s13423-012-0333-8)). Both findings matter to us: hand skills are complex, so live feedback early is justified, but we must fade it.

**Mixed evidence on concurrent feedback.** In a colonoscopy simulator study (30 novices), terminal feedback beat concurrent feedback on a transfer test, while retention was equal ([Walsh et al. 2009](https://pubmed.ncbi.nlm.nih.gov/19907387)). In a 3D rowing-type task, terminal feedback outperformed concurrent visual, auditory and haptic feedback, and the authors suggest concurrent plus terminal feedback together, adapted to the learner's level ([Sigrist et al. 2013, J Motor Behavior](https://www.tandfonline.com/doi/abs/10.1080/00222895.2013.826169)). So: do not rely on live feedback alone. Always show a terminal summary after each attempt.

**Haptic assistance and fading.** A study of self-controlled haptic assistance found that high-frequency haptic assistance was unhelpful at best for learning, and reduced-frequency help gave better results on no-feedback retention tests (for self-controlled learners) ([Frontiers in Psychology 2017](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.02082/full)). Design consequence: vibration should be sparse and fade.

**Knowledge of performance (KP) vs knowledge of results (KR).** KR says "how did it turn out", KP says "how did you move". A 2021 systematic review found KP helps most in complex tasks with more than one goal criterion, where the learner needs prescriptive guidance ([Oppici 2021 review](https://www.tandfonline.com/doi/full/10.1080/1750984X.2021.1986849)). Hand skills are KP territory because the glove measures movement, not outcome. Our "per-finger error" is KP. Our single 0-100 score is KR-like. Give both.

**Observational learning (ghost hand).** A meta-analysis found observing a model beats practice-only control for movement dynamics (effect 0.77) far more than for outcome measures (0.17) ([Ashford et al. 2006](https://www.tandfonline.com/doi/abs/10.3200/JMBR.38.3.185-205)). That is exactly our setting: the ghost hand teaches coordination. For complex tasks, a mix of model demonstrations plus practice with KP worked better than either alone ([Laguna 2008](https://pubmed.ncbi.nlm.nih.gov/18608841)). Interleaving demos between practice attempts is also supported ([Frontiers Hum Neurosci 2021](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2021.614452/full), a visuomotor adaptation task, so it is an indirect fit). Showing the model and the learner's own recorded attempt both helped short-term learning in a golf swing study ([PMC5599820](https://pmc.ncbi.nlm.nih.gov/articles/PMC5599820)), so a replay of the learner's take next to the master's is worthwhile.

**Part vs whole practice.** Evidence is mixed. A meta-analysis broadly supports textbook advice (part practice for complex, separable tasks) but says more studies are needed ([Fontana et al. 2009](https://pubmed.ncbi.nlm.nih.gov/20038005)). A review in physio/medical education found part practice was not superior on retention, and that splitting by time (fractionation) can fail because learners miss the timing links between parts ([BMC Med Educ 2016](https://link.springer.com/article/10.1186/s12909-016-0538-z)). Overlapping segments helped learn transitions in a serial aiming task ([Hansen et al. 2005](https://www.tandfonline.com/doi/abs/10.1080/02701367.2005.10599262)). Design consequence: cut lessons into steps, but always finish with a full-run attempt, and make step boundaries overlap.

**Slowed playback.** I did not find strong direct evidence on slow-motion demos for hand skills. Treat it as a usability feature, not a proven learning gain (my judgement). Cheap to build, so include it.

**Passive haptic learning (PHL).** Vibrating fingers while the learner does something else can teach finger sequences. In a 2-week at-home study, passive rehearsal raised the learning rate for note-matching accuracy by 49.7%, but did not significantly improve rhythm ([Gemicioglu et al.](https://tangemicioglu.com/projects/passive-haptic-learning-piano)). Lesson: haptics are good for "which finger, in which order", weak for timing. Do not promise haptics teach rhythm.

### Concrete design rules

1. Show the ghost hand first, at the learner's chosen speed (0.25x, 0.5x, 1x). Let them loop it.
2. Break each lesson into 3 to 8 short steps with overlapping boundaries. Always end with a full run.
3. Stage 1 (novice): concurrent feedback on the ghost hand (fingers tint green/amber/red) plus optional vibration on the worst finger.
4. Stage 2: concurrent feedback only on fingers that were wrong last attempt (a "bandwidth" rule: only signal when error exceeds a threshold).
5. Stage 3: no live feedback. Terminal feedback only (score and per-finger breakdown after the attempt).
6. Always show terminal feedback after each attempt, at every stage (supported by the Walsh and Sigrist results above).
7. Make feedback prescriptive and short: "index finger 25 degrees too straight at step 3", not a wall of numbers.
8. Fade by performance, not by time: drop a stage when the learner passes the threshold 3 times in a row.
9. Vibration cues: one finger at a time, short pulses, only when error is above threshold. Cap cue rate (for example, max one cue per second).
10. Offer a "retention check" at the end of a session: one attempt with all feedback off. That is the real learning measure and a great demo moment.

---

## 2. Algorithms to compare learner and master

### Hardware facts that affect the design

- Smartgloves II: 7 sensors per glove, 39 DOF output, 250 Hz IMU capture, maximum output about 83 Hz ([Knoxlabs spec listing](https://www.knoxlabs.com/products/smartgloves-ii-size-m), [Rokoko Device SDK](https://sdk.rokoko.com/)). First-generation gloves output 100 fps with plus or minus 1 degree rotational accuracy ([Knoxlabs gen 1 listing](https://www.knoxlabs.com/products/smartgloves-size-m), [Rokoko FAQ](https://support.rokoko.com/hc/en-us/articles/20912004920593-Rokoko-Smartgloves-FAQs)). Check which generation you have: your "100 fps" assumption fits gen 1; gen 2 streams at about 83 Hz.
- The SDK streams quaternion orientations per sensor and ships a hand solver that outputs a 26-joint hand ([Rokoko Device SDK](https://sdk.rokoko.com/)). Latency about 20 ms over Wi-Fi, 19 ms over USB (same page). Use USB for the demo if you can: less jitter. (Gen 1 may be Wi-Fi only; the SDK page lists USB for Smartgloves II, check your unit.)
- IMUs drift; Smartgloves II adds a magnetometer to fix heading drift, which is susceptible to metal and motors nearby ([Rokoko EMF/IMU overview](https://sdk.rokoko.com/guides/tech-overview-emf-imu/)). Keep your ESP32 vibration motors away from the sensors if possible, and recalibrate before each lesson.
- With only 7 sensors per glove, the in-between finger joints are probably solved by a kinematic model, not measured one by one (my inference). So do not promise "per-joint" precision. Score per finger (curl and spread), not per knuckle.

### Representation: what to compare

- Use **local joint angles** (flexion per finger, plus abduction/spread), not world positions. Angles are independent of hand size and glove position. This is the same reason the Kinect rehab papers used angle or bone-vector features, not raw coordinates ([Capecci et al., JMIR Rehab 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC7463392); [Yu and Xiong 2019](https://pubmed.ncbi.nlm.nih.gov/31261746)).
- If you use quaternions, the standard rotation distance is the angle `2 * arccos(|q1 . q2|)` between two unit quaternions (standard maths, no web source). Convert each finger's local rotation to a flexion angle first; angles are easier to explain to users than quaternion distances.
- **Hand size normalisation:** angles already cancel most size effects. The bigger problem is each person's range of motion. Do a 5-second calibration: "make a fist, then open flat". Store each user's min and max per finger, and map angles to a 0 to 1 "curl" value for both master and learner. Compare in that normalised space.
- **Tempo normalisation:** handled by DTW (below), or for checkpoint steps, ignored.

### Alignment: DTW and libraries

- **dtaidistance** (C-optimised): `dtw_ndim.distance(s1, s2)` for multivariate series with shape (timesteps, values). It computes dependent DTW (one shared warping path for all joints). For independent DTW (each joint warped separately), sum 1-D distances per dimension ([dtaidistance docs](https://dtaidistance.readthedocs.io/en/latest/usage/dtw.html), [dtw_ndim API](https://dtaidistance.readthedocs.io/en/latest/modules/dtw_ndim.html)). Options: `window` (Sakoe-Chiba band), `max_dist` (early stop), `use_pruning`. It also has `warping_path`.
- **tslearn**: `dtw_path(s1, s2, sakoe_chiba_radius=...)` returns the path and distance for multidimensional series; `dtw_subsequence_path(subseq, longseq)` finds where a short query best matches inside a longer stream ([dtw_path](https://tslearn.readthedocs.io/en/stable/gen_modules/metrics/tslearn.metrics.dtw_path.html), [dtw_subsequence_path](https://tslearn.readthedocs.io/en/stable/gen_modules/metrics/tslearn.metrics.dtw_subsequence_path.html)).
- **fastdtw**: I did not verify its current state in this pass. It is an approximation and is often slower or less exact than banded exact DTW in practice (my judgement). Prefer dtaidistance with a window.
- **Use dependent DTW (shared path)** for hand skills: all fingers move together, and a shared path keeps finger coordination errors visible. Independent DTW would hide "fingers moved at the wrong relative time". (My judgement; the dependent vs independent distinction is from the dtaidistance docs and Shokoohi-Yekta et al. cited there.)
- Use a **Sakoe-Chiba window** of about 20 to 30 percent of the lesson step length. It stops absurd alignments, cuts compute, and limits how much tempo cheating is allowed.
- Common DTW trap: dtaidistance warns that small errors accumulate over long distances and suggests differencing the series ([docs](https://dtaidistance.readthedocs.io/en/latest/usage/dtw.html)). Keep steps short (a few seconds) so this does not bite.
- DTW hides timing errors by design. One webcam rehab paper notes that DTW focuses on spatial alignment and ignores speed variation ([Webcam exergame, 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12943956)). So score tempo separately: use the total duration ratio or warping path slope as a "rhythm" sub-score.

### Per-joint feedback from the DTW path

After aligning, take the warping path pairs (i, j), compute per-finger absolute angle error at each pair, and average per finger. That gives "which finger was worst" for free. Also report where in the step the worst error occurred (path index).

### Real-time options

1. **Step checkpoints (recommended for 48h).** Each step stores a target pose (or short 0.5 to 2 s motion). Live loop: every frame compute per-finger error vs target; when error stays under threshold for about 300 ms, mark the step as done and advance. No DTW needed for static poses. Trivial to build and robust.
2. **Windowed DTW on the last 1 to 2 s.** Every 100 ms run `dtw_subsequence_path` or banded DTW of the last window against the master's current step. Cheap at this size.
3. **True online DTW.** Online-DTW (Oregi et al. 2017) and incremental DTW exist for live streams ([IncDTW vignette (R)](https://cran.r-project.org/web/packages/IncDTW/vignettes/Theory_and_Applications_for_the_R_Package_IncDTW.pdf)). I did not find a ready Python package in this pass. Skip it for the hackathon.

### Segmenting a lesson into steps

- Easiest and most reliable: the master presses a key or makes a reserved "marker gesture" (for example a thumb-pinky pinch) to mark step boundaries while recording. Store them as annotations.
- Automatic fallback: split at low-velocity moments (all finger angular speeds below a threshold for 200 ms). Fingerspelling work uses the same idea, recognising letters on low-motion frames ([Ricco and Tomasi 2009](https://users.cs.duke.edu/~tomasi/papers/ricco/riccoAccv09.pdf)). Let the master edit the cuts in a simple timeline UI.

### A fair 0-100 score

Published rehab scoring work converts a DTW distance to a percentage using a lower bound of 0 and an estimated upper bound, no training data needed. A Tai Chi study using this reported r = 0.86 with expert ratings ([Yu and Xiong 2019](https://pubmed.ncbi.nlm.nih.gov/31261746), same idea in [JMIR Rehab 2018](http://rehab.jmir.org/2020/2/e17289)). Another approach z-scores the distance against a pool of "normal" subjects, then maps to 0-100 ([Webcam exergame 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC12943956)).

Practical version for us (my design):

- `err_f` = mean absolute normalised-angle error for finger f, after calibration.
- `tol` = tolerance, set per lesson step from the master's own take-to-take variation (see section 5). A fair score forgives what the master could not repeat.
- `finger_score = 100 * exp(-(err_f / tol)^2)`.
- `accuracy = weighted mean of finger_score`. Weight fingers by how much the step uses them (a finger that barely moves in the master's take gets a low weight, so unused fingers cannot dominate).
- `rhythm = 100 * clip(1 - |log(duration_learner / duration_master)| / log(1.5), 0, 1)` for dynamic steps only.
- `score = 0.8 * accuracy + 0.2 * rhythm` (static pose lessons: 100 percent accuracy).
- Sanity check by having 2 to 3 people try a lesson and confirming the score ordering matches a human's ranking. This mirrors the expert-rating validation in the Tai Chi study above.

---

## 3. Which skills fit finger-joint-only gloves

The gloves give finger and wrist rotation only. No force, no contact, no objects, no absolute position unless you add the Coil Pro ([Rokoko Coil Pro](https://www.rokoko.com/products/coil-pro)). Skills that depend on objects or force lose most of their signal.

Ranking is my judgement, based on the data the gloves can capture. Scores are 1 (poor) to 5 (great).

| Rank | Skill | Fits glove data | 2-min demo | Market value | Notes |
|---|---|---|---|---|---|
| 1 | Sign language alphabet and short phrases | 5 | 5 | 4 | Static handshapes, instant visual win, large learner base, clear social good. Gloves are already used for handshape recognition, e.g. [Manus data glove study](https://www.mdpi.com/1424-8220/23/24/9847). Caveat: real sign language also needs facial expression and arm movement. Say "fingerspelling" honestly. |
| 2 | Piano / keyboard finger exercises | 4 | 5 | 5 | Large paying market. Fingering, not key force. Haptics have published support (section 4). Caveat: no key press info, so you score finger motion shape, not notes. Wrist height not tracked without the coil. |
| 3 | Rehab hand exercises (post-stroke, arthritis, carpal tunnel) | 5 | 4 | 5 | Pure joint angles, clinical value, repeatable. Regulatory and liability caution if you claim medical benefit: frame as "exercise guidance". |
| 4 | Guitar chord shapes | 3 | 4 | 4 | Left-hand shapes are static poses, good. But fretting pressure and finger position on the neck are not captured. |
| 5 | Card and coin magic (sleights) | 3 | 5 | 3 | Very watchable, finger dexterity heavy, but objects missing. Novelty marketplace, small market. |
| 6 | Origami | 2 | 3 | 2 | Paper not tracked. |
| 7 | Knot tying | 2 | 3 | 3 | Rope not tracked, ambiguous without the object. |
| 8 | Knife skills | 2 | 3 | 3 | Needs blade, food, force. Safety optics poor. |
| 9 | Surgical suturing | 2 | 2 | 5 | Highest value, but needs instrument and tissue tracking, and regulation. A pitch slide, not a demo. |
| 10 | Pottery | 1 | 2 | 3 | Force and clay deformation are everything. |

**Recommended demo (my judgement):** open with fingerspelling (30 s): ghost hand shows the master's "A B C", learner copies, fingers turn green, vibration on the wrong finger. Then a 60 s piano five-finger exercise (1-2-3-4-5-4-3-2-1) showing the fading feedback and a tempo score. Close with the marketplace and verification story.

---

## 4. Prior art and competitors

### Research prior art

- **Passive Haptic Learning, Georgia Tech (Starner group):** vibration motors in a glove teach piano finger sequences passively. PianoTouch (2008) used five motors, one per finger ([IEEE ISWC 2008](https://www.computer.org/csdl/proceedings-article/iswc/2008/04911582/12OmNz2C1nu)). Mobile Music Touch tested which primary tasks interfere ([ISWC 2010](https://store.computer.org/csdl/proceedings-article/iswc/2010/05665877/12OmNzayNEr)). A 2024 in-the-wild study (36 enrolled, 20 with complete data, 2 weeks) combined passive rehearsal with active practice and a web portal, and found 49.7 percent faster learning on note accuracy, no significant gain in rhythm ([Gemicioglu et al. IMWUT 2024](https://tangemicioglu.com/files/papers/PHL_IMWUT_2024.pdf), [project summary](https://tangemicioglu.com/projects/passive-haptic-learning-piano)). Their glove uses five vibration motors at the base of the fingers (Precision Microdrives 310-103) ([CHI 2022 workshop paper](https://tangemicioglu.com/files/papers/PHL_IMI_at_CHI_2022.pdf)), a useful reference for your ESP32 motor placement. The project page notes practical needs: gloves must survive daily wear and setup must be recoverable without a researcher.
- **Tactile Teacher (Georgia Tech/NUS):** a teacher's sensing glove records finger taps and a student's glove replays them as vibration. This is the closest research cousin to "master records, learner feels" ([TEI 2015 demo](http://lichard49.github.io/pdf/2015-tei_demo-tactile_teacher.pdf), [CSCW 2016 poster](http://lichard49.github.io/pdf/2016-cscw_poster-tactile_teacher.pdf)). It captures taps only, not full finger joint motion, and has no marketplace.
- **Passive haptic rehabilitation:** the MMT glove was tested for hand sensation in partial spinal cord injury ([Estes et al.](https://publications.eai.eu/index.php/ew/article/download/1067/905/1222)). Small study, treat as a hint only.
- **Hapticus (CHI 2025 demo):** compares vibrotactile glove, EMS and exoskeleton for piano learning and studies customisable haptics ([ACM](https://dl.acm.org/doi/10.1145/3706599.3721279)). Shows "customise the haptic feedback" is a live research direction.
- **Digitally embroidered smart gloves (Nature Communications 2024):** sensing plus vibrotactile gloves for transferring interactions between people, including a piano scenario ([Nature Comms](https://www.nature.com/articles/s41467-024-45059-8)).
- **Glove-based sign recognition:** many papers, including commercial gloves (Manus Prime X) for static handshape recognition ([Sensors 2023](https://www.mdpi.com/1424-8220/23/24/9847)). Most do recognition (classify the sign), not teaching with feedback (my reading of the results). See also a review of commercial smart gloves ([Sensors 2021](https://www.mdpi.com/1424-8220/21/8/2667)).
- **Motion-scoring coaching without gloves:** Kinect and webcam systems score exercise quality with DTW ([Yu and Xiong 2019](https://pubmed.ncbi.nlm.nih.gov/31261746), [Ullah et al. 2025, uses dtaidistance](https://www.nature.com/articles/s41598-025-29062-7)). The same method transfers to hands.

### Products (not researched in this pass)

I did not verify any product claims. From general knowledge, so treat as unverified leads: piano apps such as Yousician and Simply Piano listen to audio for pitch and timing, not hand posture; MasterClass-type platforms sell video only, with no measurement of the learner; VR hand-tracking tutor demos exist for camera-based headsets but suffer from occlusion, which glove sensing avoids ([Sensors 2021 review](https://www.mdpi.com/1424-8220/21/8/2667) discusses occlusion limits of visual tracking). Check these quickly before pitching any "nobody does this" line.

### Our differentiation (my judgement)

1. **Measures how you move, not just what comes out.** Video courses cannot tell the learner their ring finger lags. Audio apps only hear the result.
2. **Marketplace of masters' motion data:** research gloves use fixed, researcher-authored content; our content is creator-supplied and monetised.
3. **Fading, evidence-based feedback loop** (section 1) rather than constant correction.
4. **Verified lessons** (section 5): a quality guarantee that a data-based marketplace can offer and a video marketplace cannot.
5. **Two-way:** vibration cues from ESP32s for eyes-free practice, with the research caveat that haptics help sequence and finger identity more than rhythm.

Risk: hardware cost. Smartgloves II list price is 1,995 EUR excluding VAT ([Rokoko EU store](https://eu.store.rokoko.com/products/smartgloves-ii)), so a consumer mass market is not near-term. Pitch the learner side as "any hand-tracking device later" and the master side as capture-grade gloves (my judgement). Consider a webcam or headset hand-tracking learner mode as a roadmap slide.

---

## 5. Verifying community lessons

I did not find a published standard for verifying crowdsourced motion-capture lessons, so this section is my design, built on the scoring tools above.

### Automatic checks (cheap, do all of these)

1. **Sensor health:** reject takes with dropouts (gaps in frame timestamps greater than 3 frames), frozen channels (zero variance on a finger), jumps (angular speed above human limits), or angles outside anatomical range. Rokoko exposes EMF residual diagnostics per sensor that flag interference ([Rokoko Smartgloves SDK reference](https://sdk.rokoko.com/reference/products/smartgloves/)); reject takes where it is high.
2. **Calibration present:** the take includes the fist and flat-hand calibration poses, and they look sane.
3. **Multi-take consistency:** require 3 to 5 takes of each lesson. Compute pairwise banded DTW distances between takes (dtaidistance `distance_matrix`). Take-to-take variation gives the lesson's tolerance (`tol` in section 2). If takes disagree wildly, the lesson is not reproducible and cannot be scored fairly: send it back. Drop outlier takes by median distance.
4. **Reference construction:** use the medoid take (smallest median distance to the others) as the reference, or DTW-average the takes. Store the spread so the scoring tolerance is per step.
5. **Learnability check:** run the scorer against a held-out take by the same master. It must score above about 90, otherwise the pipeline cannot recognise the master's own motion.
6. **Duplicate and fraud check:** fingerprint takes; flag lessons whose reference is near-identical (tiny DTW distance) to an existing lesson by another author, to catch copied uploads. Real motion never repeats exactly.

### Human review (paid-tier badge)

- An expert reviewer watches the ghost hand playback and the step cuts, and ticks a checklist: the technique is correct, steps are sensibly cut, the description matches.
- Show badges: "Auto-checked" (passes 1 to 6) and "Expert-verified" (plus human sign-off). Add "learner-validated" as a third signal: lessons where 5 or more learners improved scores across attempts, an outcome-based quality metric.
- Payment link: masters are paid per lesson, so tie payout tiers to the badge, and pay a bonus once learners show improvement.

---

## Concrete recommended feedback loop and scoring pipeline for 48 hours

### Data flow

1. **Capture:** Rokoko SDK stream (USB if possible) gives quaternions or the solved 26-joint hand ([Rokoko Device SDK](https://sdk.rokoko.com/)). Convert to per-finger flexion and spread angles in a small Python module. Output about 83 to 100 Hz.
2. **Calibration (10 s):** fist then flat hand. Store per-finger min/max, map to normalised curl 0 to 1.
3. **Master recording:** 3 takes, step markers via a pinch gesture or keypress. Save JSON: steps with start/end frames, normalised angle arrays, per-step tolerance from take variation.
4. **Auto-verify:** run section 5 checks 1, 3, 4, 5. Pick the medoid take. Mark lesson "Auto-checked".
5. **Learner session:**
   - Watch: 3D ghost hand (three.js) with speed control and loop.
   - Practise step k: stream frames, compute per-finger error to the master's current step (checkpoint mode for static poses, windowed banded DTW for dynamic steps).
   - Live feedback by stage: stage 1 colours all fingers and vibrates the worst; stage 2 colours only previously bad fingers; stage 3 nothing live.
   - After each attempt: terminal screen with 0 to 100 score, per-finger bars, rhythm sub-score, and one sentence ("ring finger 22 degrees too straight in step 3").
   - Promotion: three passes at or above 80 moves to the next stage; the final stage is a no-feedback retention attempt.
   - Finish with a full run (overlapping steps first, then whole).
6. **Haptics:** Python sends the worst finger index and intensity to the ESP32 over serial or WebSocket. Pulse about 150 ms, minimum 1 s between cues, stronger when the error is bigger, off in stage 3.
7. **Score storage:** per attempt, per step, per finger, so the master dashboard can show "where learners struggle" (a feature masters will like).

### Build order (suggested)

- Hours 0 to 8: glove stream to normalised angles, calibration, recording to JSON, replay in a ghost hand.
- Hours 8 to 20: static-pose checkpoint scorer plus fingerspelling lesson, live colours, terminal score screen.
- Hours 20 to 30: ESP32 vibration on worst finger, stage fading logic.
- Hours 30 to 40: dynamic step scoring with dtaidistance banded DTW plus rhythm, piano exercise lesson, multi-take consistency check and badge.
- Hours 40 to 48: demo polish, a scripted 2-minute run, and pre-recorded fallback data in case the gloves or Wi-Fi fail (always have this).

### Minimal code sketch (scoring core, untested)

```python
import numpy as np
from dtaidistance import dtw_ndim


def normalise(angles, lo, hi):  # angles: (T, n_fingers); lo/hi from calibration
    return np.clip((angles - lo) / (hi - lo + 1e-6), 0, 1)


def score_step(learner, master, tol=0.12, window=None):
    # learner, master: (T, n_fingers) normalised curl values, float64
    window = window or max(5, int(0.3 * max(len(learner), len(master))))
    path = dtw_ndim.warping_path(master, learner, window=window)
    err = np.zeros(master.shape[1])
    for i, j in path:
        err += np.abs(master[i] - learner[j])
    err /= len(path)  # per-finger mean abs error
    finger_scores = 100 * np.exp(-((err / tol) ** 2))
    return finger_scores.mean(), finger_scores, int(np.argmin(finger_scores))
```

I have not run this. `dtw_ndim.warping_path` and the `window` argument come from the dtaidistance docs linked above; check the exact signature before relying on it.

## Open questions / gaps

- Gen 1 vs gen 2 gloves: output rate 100 vs about 83 Hz, and USB vs Wi-Fi only. Check your unit.
- Product competitor claims in section 4 are unverified; check before pitching.
- No Python online-DTW package found, so checkpoint and windowed methods are recommended instead.
- Whether the Rokoko solver exposes usable per-joint (not just per-finger) angles at the SDK level: verify in the SDK docs before promising knuckle-level feedback.
