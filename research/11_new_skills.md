# 11. New skills, synthetic data, generated props and hand look

Researched 14 Nov 2026. Plain English. Every web claim has a link. Anything marked ESTIMATE is my own number, not from a source, and must be checked on real gloves with the flat-hand and fist calibration.

## Recommendations up top

1. **Industry skill: ship "Surgical grips" first, knot tying second.** Grips are static `hold_pose` keyframes the gloves can really see. Knot tying is a `finger_sequence` that the gloves see only partly (no thread, no hand position).
2. **Crochet** is a good second skill, but the gloves only see the finger curls and wrist roll. The yarn hand is nearly static; the hook hand carries the rhythm.
3. **Shadow puppets**: pick Rabbit, Talking Dog, Swan, Flapping Bird, Snail. All five are separable by curl pattern plus one wrist or thumb motion, none needs finger spread.
4. **Synthetic data**: do NOT download big hand-object datasets in a hackathon. Almost all are non-commercial. Write expert keyframes by hand, then generate 200 jittered takes in Python and use them to set tolerance bands (pipeline in section 4, about 3 hours).
5. **Props**: hybrid. A small hand-made prop library as JSON primitives, plus Gemini Flash-Lite writing or tweaking the same JSON for new props, validated by a schema and with a fallback to a plain capsule. Skip real mesh generation at run time.
6. **Hand model**: `generic-hand` is fine. The assets package is MIT (not W3C), so you only need to keep the copyright and permission notice. Style it like the Meta Quest hand: dark fresnel fill, thin light outline, fade at the wrist.

## Conventions used below

- Curl is 0 (finger straight) to 1 (full fist), thumb the same, as in `backend/app/data/moves.json`. Order: thumb, index, middle, ring, little.
- All numbers are ESTIMATES from how the grip looks, tuned to match the existing moves (for example `general_power_grip` is 0.6, 0.8, 0.85, 0.85, 0.85).
- "Sensable" means the Smartgloves II data (finger flexion plus wrist and forearm orientation, no absolute position, no spread, no haptics, see `research/09_rokoko.md`) can show it.
- Wrist notes use the roll angle about the forearm axis (pronation is palm turning down, supination palm turning up).

---

## 1. Surgical grips and basic procedures

### 1.1 Grips (all static `hold_pose`)

Sources for the grip names and descriptions: [University of Saskatchewan vet school needle holder page](https://wcvm.usask.ca/vsac205/Lab1/needle-holders.php) (needle driver and pencil grips), [Medical University of Bialystok suturing manual](https://www.umb.edu.pl/photo/pliki/WL_jednostki/zaklad_symulacji_medycznych/a-stich-in-time.-basics-of-surgical-suturing.pdf) (scalpel pencil and "power or table-knife" grips).

| Grip | What the hand does (from the sources) | thumb | index | middle | ring | little | Wrist | Sensable? |
|---|---|---|---|---|---|---|---|---|
| `scalpel_pencil` | Scalpel held between thumb and middle finger, index finger on the back of the blade. | 0.45 | 0.35 | 0.50 | 0.85 | 0.90 | Neutral, slight supination | Yes. Curls are clear. |
| `scalpel_table_knife` (fingertip / power) | Whole hand over the handle, blade covered by the hand, used for more force. | 0.55 | 0.30 | 0.65 | 0.80 | 0.85 | Neutral | Yes, but close to the palm grip. |
| `scalpel_palm` | Handle across the palm, all fingers wrap. Same as `general_power_grip`. | 0.60 | 0.80 | 0.85 | 0.85 | 0.85 | Neutral | Yes. |
| `driver_ring` (tripod) | Thumb and ring finger in the rings, middle finger on top of the ring, index along the shaft to steady the tip. Wrist rotation drives the needle. Recommended for novices. | 0.45 | 0.20 | 0.40 | 0.55 | 0.80 | Neutral, ready to rotate | Yes. Index straight vs ring curled is the signature. |
| `driver_thenar` (palmed) | Ring finger through one ring, the other ring rests on the base of the thumb. Faster, less precise needle release. | 0.30 | 0.30 | 0.50 | 0.50 | 0.80 | Neutral | Partly. Differs from `driver_ring` by only about 0.15 per finger, so tolerance must be wide. |
| `forceps_pencil` | Held like a pencil between thumb, index and middle finger. | 0.40 | 0.30 | 0.40 | 0.80 | 0.85 | Slight pronation | Yes. Almost the same as `scalpel_pencil`, so name them separately but expect confusion. |
| `scissors_tripod` | Thumb and ring finger in the rings, index finger along the blade shaft. Same shape as `driver_ring`. | 0.45 | 0.20 | 0.45 | 0.55 | 0.80 | Neutral | Yes, but open and close (thumb 0.45 to 0.65) is the lesson, not the pose. |

The Saskatchewan page also lists the palm grip (handles held in the palm, arm and wrist drive the needle, strong but less precise) and the modified thenar grip as faster but with some needle motion on release. It recommends the wide-based tripod grip for novices.

**What the gloves cannot see:** the instrument itself, whether the needle is gripped at the right point, pressure on the rings, and the exact finger placement on a handle. A virtual prop (scalpel capsule) in the 3D scene supplies the visual cue; the score only measures curls.

### 1.2 Basic procedures

All of these are mostly finger and wrist, which suits the gloves better than almost any other real trade skill. Sources: [University of Bristol one-handed tie](https://www.bristol.ac.uk/media-library/sites/vetscience/documents/clinical-skills/One%20Handed%20Tie.pdf), [two-handed tie](https://www.bristol.ac.uk/media-library/sites/vetscience/documents/clinical-skills/Two%20Handed%20Tie.pdf), [instrument tie](https://www.bristol.ac.uk/media-library/sites/vetscience/documents/clinical-skills/Instrument%20Tie.pdf), [TeachMeSurgery knot tying](https://teachmesurgery.com/skills/surgical/knots), the [Aberdeen-style knot manual](https://w.rexresearch1.com/EmergencySurgeryLibrary/SurgicalKnotsSuturingTechniques.pdf) (pronation and supination defined, "less finger action and more wrist and arm action" for one-handed ties).

#### A. Instrument tie (square knot), `finger_sequence` on the driver hand

The driver hand holds a needle driver in `driver_ring`. The other hand does the looping, so the glove on the driver hand mostly sees small open-close clicks.

| Step | Hand | thumb | index | middle | ring | little | Wrist | Beat (ms) |
|---|---|---|---|---|---|---|---|---|
| 1 hold driver between the strands | driver | 0.45 | 0.20 | 0.40 | 0.55 | 0.80 | neutral | 0 |
| 2 loop thread over the driver (other hand moves) | driver | 0.45 | 0.20 | 0.40 | 0.55 | 0.80 | neutral | 1000 |
| 3 open jaws and grab the tail | driver | 0.30 | 0.20 | 0.35 | 0.40 | 0.80 | neutral | 800 |
| 4 close and pull tail through | driver | 0.55 | 0.20 | 0.45 | 0.60 | 0.80 | slight supination | 1000 |
| 5 lay the knot flat, reverse direction | driver | 0.45 | 0.20 | 0.40 | 0.55 | 0.80 | pronation about 20 deg | 1000 |
| repeat 2 to 4 once for the second throw | | | | | | | | |

The Bristol notes say a square knot is one loop then one loop, a surgeon's knot is two loops then one, and the loops go in opposite directions.

Sensable: only the driver hand. The thread, loop direction (granny vs square) and tension are invisible.

#### B. Two-handed square knot, `finger_sequence` (the best showpiece, both hands move)

From the Bristol two-handed page: hold one strand with the middle and ring fingers of the left hand, place the left index finger under the other strand, cross the strands, pinch left thumb and index finger, rotate the left hand so the thumb moves under the crossed strands, pass the strand between thumb and index finger, rotate back, pull both ends.

Left hand (yarn hand) keyframes:

| Step | thumb | index | middle | ring | little | Wrist roll | Beat (ms) |
|---|---|---|---|---|---|---|---|
| hold strand (middle and ring grip it) | 0.30 | 0.10 | 0.85 | 0.85 | 0.50 | neutral | 0 |
| index under strand, hand palm up | 0.30 | 0.35 | 0.85 | 0.85 | 0.50 | supinate 30 deg | 700 |
| pinch thumb and index (catch strand) | 0.55 | 0.55 | 0.85 | 0.85 | 0.50 | supinate 30 deg | 600 |
| rotate hand so thumb goes under the crossed strands | 0.55 | 0.55 | 0.85 | 0.85 | 0.50 | pronate 60 deg, from supinated | 900 |
| release pinch, take strand between thumb and index | 0.35 | 0.30 | 0.85 | 0.85 | 0.50 | neutral | 700 |
| pull and lay knot | 0.35 | 0.25 | 0.85 | 0.85 | 0.50 | neutral | 800 |

Right hand: mostly holds one strand between thumb and index (thumb 0.5, index 0.5, others 0.7) and moves it over the left index. Its curls hardly change, so it is a `hold_pose` with small wrist motion.

Sensable: finger states and the wrist roll are visible and are the whole skill. Not visible: thread, crossing order, knot type. Absolute hand position is also missing, but the lesson does not need it.

#### C. One-handed reef (square) knot

Bristol one-handed page: strands pinched between thumb and index or middle; the other three fingers go palm down over the strand, then the hand turns palm up, the strand is caught by bending the middle finger under it, then released and drawn through between middle and ring. Rough keyframes for the tying hand: pinch (thumb 0.55, index 0.55, middle 0.30, ring 0.30, little 0.30), palm-down roll 0 deg; palm-up roll about 120 deg supination with middle finger bending (middle 0.30 to 0.85); pull-through with middle and ring pinched (0.85, 0.85). The source stresses more wrist and arm than finger action, which suits the wrist sensor.

#### D. Needle driving wrist arc (simple interrupted suture), `grip_and_swing`

From the Saskatchewan page, in the ring grip "wrist rotation used to drive needle through tissues". Needle follows the needle's own curve, so the wrist rotates (pronation then supination) rather than the arm moving.

- Grip: `driver_ring` above, held steady throughout (this is the part the gloves can check well).
- Swing: roll about the forearm axis, from about 0 deg (needle tip touching tissue) through pronation about 70 to 90 deg (needle driven through) and back to supination about 20 deg (needle extracted). ESTIMATE: 1.5 to 2 s for the arc for a trainee, about 1 s for an expert.
- Beat: `beat_ms` around 1800.

Sensable: roll angle (forearm orientation) and grip stability. Not sensable: needle angle relative to tissue, entry depth, bite size (all need position or a prop).

### 1.3 How surgical skill is trained and assessed today

- **OSATS** (Objective Structured Assessment of Technical Skill) is the standard structured rating tool. The JIGSAWS authors used a modified OSATS and scored examples like "1 awkward and unsure with repeated entanglement" up to "5 excellent suture control" ([JIGSAWS paper](https://cirl.lcsr.jhu.edu/wp-content/uploads/2015/11/JIGSAWS.pdf)). A checklist for basic knot tying separated novices from experienced surgeons and correlated 0.88 with a global score ([Huang et al. 2015](https://pubmed.ncbi.nlm.nih.gov/25697509)).
- **Simulation boxes**: knot-tying boards. A low-cost board with joystick potentiometers measured knot displacement as a stand-in for tissue handling; attendings tied faster than residents ([Huffman et al. 2020](https://iro.uiowa.edu/esploro/outputs/journalArticle/Optimizing-Assessment-of-Surgical-Knot-Tying/9985138659902771)).
- **Motion analysis with a sensory glove**: a glove measuring flexion of each finger joint plus wrist, 9 experts vs 9 novices on a basic suturing task, moderate repeatability (ICC 0.64 experts, 0.53 novices) and positive user feedback ([Saggio et al. 2015](https://pubmed.ncbi.nlm.nih.gov/26089159)). This is the closest published match to our glove approach.
- **Finger tracking with a tablet**: coloured tags on both index fingers, 57 novices and 19 experts, time, distance and smoothness all separated the groups ([Hillemans et al. 2023](https://pubmed.ncbi.nlm.nih.gov/37013910)).
- **AI hand tracking (video)**: 44 participants, hand-tracking metrics (velocity, path length, jerk) separated levels for some tasks but not for short knot tying or interrupted suturing ([2026 feasibility study](https://pmc.ncbi.nlm.nih.gov/articles/PMC12953238)). A 2026 markerless MediaPipe study found economy of motion was the most relevant skill for one-handed knot tying ([SAGE 2026](https://journals.sagepub.com/doi/10.1177/15533506261451990)).
- **IMU on the hand**: rotation-based hand motion metrics distinguished novices, residents and attendings in suturing ([PMC10592328](https://pmc.ncbi.nlm.nih.gov/articles/PMC10592328)). Rotation metrics are what our wrist sensor gives us.
- **Takeaway for scoring**: the metrics that discriminate skill in the literature are time, smoothness (jerk) and economy of motion. Our app can compute smoothness and time from the glove stream without positions.

### 1.4 Datasets and licences

| Dataset | Contains | Licence | Use for us |
|---|---|---|---|
| [JIGSAWS](https://cirl.lcsr.jhu.edu/research/jigsaws) | da Vinci robot data, not hands: 8 surgeons, 5 repetitions of suturing, knot-tying, needle-passing (39, 36 and 28 usable trials). Kinematics (position, orientation, velocity, gripper angle), stereo video, gesture labels, modified OSATS scores. | "Released for the purpose of academic research, not for commercial usage." | Only as a reference for gesture names (for example "loop suture around needle driver") and timing. The gesture list is described in [Vedula et al. 2016](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0149174). Do not ship it. |
| [COMPASS](https://github.com/UVA-DSA/COMPASS) | Re-labels JIGSAWS and others with motion primitives (grasp, release, pull...). | Inherits JIGSAWS limits (check before use). | Reference only. |

I did not find any public data-glove surgical dataset. The glove studies above did not release data in anything I found. Treat this as: no usable open dataset, so section 4 (synthetic takes) is the route.

---

## 2. Crochet basic stitches

Sources: [Crochet Guild of America basics](https://crochet.org/crochet-basics), [4-H Crocheting Handbook](https://4h.extension.wisc.edu/files/2025/05/4H1480DD_Crochet.pdf), [Cilla Crochets hold guide](https://www.cillacrochets.com/crochet-tutorials/how-to-hold-crochet-hook-and-yarn), [Kathryn Clark's hand roles](https://kathrynclarkcrochet.com/how-to-hold-your-crochet-hook), [Annie's Attic hook holds](https://www.anniesattic.com/stitch-guide/crochet-guide/crochet-how-tos/how-to-hold-a-crochet-hook).

### 2.1 Hook hand (right hand for right-handers)

| Hold | Description | thumb | index | middle | ring | little |
|---|---|---|---|---|---|---|
| Pencil | Thumb and index pinch the flat thumb rest, middle finger rests near the tip. Hook points slightly toward you. | 0.45 | 0.40 | 0.50 | 0.80 | 0.85 |
| Knife | Hand over the hook, handle against the palm, thumb and middle on the thumb rest, index on the shaft. | 0.50 | 0.30 | 0.55 | 0.75 | 0.80 |

Working motions of the hook hand (the part the gloves can see):

- **Yarn over (yo)**: the hook turns so the throat catches the yarn. Wrist roll about 30 to 45 deg, fingers almost unchanged (curl change under 0.1).
- **Pull through**: hook turned to face down, drawn back through the loop. Small wrist pronation then a pull back toward the body. Fingers stay in grip.
- **Insert**: slight forward push, no curl change.

### 2.2 Yarn hand (left hand for right-handers)

The CGOA page says: lightly hold the knot between the thumb and middle finger, the working yarn runs between hook and index finger, and "your index finger will move up and down as you work to create an even tension". Cilla describes wrapping the yarn around the little finger, over the ring finger, under the middle finger, over the index finger, with thumb and middle finger holding the work.

| State | thumb | index | middle | ring | little |
|---|---|---|---|---|---|
| Hold (rest) | 0.45 | 0.20 | 0.50 | 0.70 | 0.80 |
| Tension up (index lifts yarn for yo) | 0.45 | 0.05 | 0.50 | 0.70 | 0.80 |
| Tension release (index drops) | 0.45 | 0.30 | 0.50 | 0.70 | 0.80 |

The index finger moves about 0.25 curl. That is the only real yarn-hand signal.

### 2.3 Stitch steps and rhythm

A stitch is a repeating cycle. Number of "yo then pull" cycles is what separates them ([CGOA table](https://crochet.org/crochet-basics), [citizensradio summary](https://citizensradio.org/start-a-station/crochet-basics-hook-chain-and-pattern-reading)). Beat is ESTIMATE, about 600 to 800 ms per hook cycle for a beginner, 350 to 450 ms for an expert.

| Stitch | Steps (hook hand) | Cycles of yo and pull | Yarn hand index pattern |
|---|---|---|---|
| Slip knot | Loop yarn round two fingers, pull a loop through with the hook, tighten. | 1 | up, down |
| Chain (ch) | Yo, pull through loop on hook. | 1 | up, down |
| Slip stitch (sl st) | Insert in stitch, yo, pull through stitch and loop on hook in one go. | 1 | up, down |
| Single crochet (sc) | Insert, yo, pull up a loop (2 loops), yo, pull through both. | 2 | up, down, up, down |
| Half double (hdc) | Yo first, insert, yo, pull up (3 loops), yo, pull through all three. | 3 | up, down x3 |
| Double crochet (dc) | Yo, insert, yo, pull up (3 loops), yo, pull through 2, yo, pull through last 2. | 4 | up, down x4 |

For the `finger_sequence` preset, encode each cycle as one beat: hook hand roll toggles between 0 deg and 40 deg, yarn hand index toggles 0.05 and 0.30. Stitch type is then the beat count (1, 1, 1, 2, 3, 4 cycles). Rhythm and consistency are what we can score.

### 2.4 What the gloves can and cannot see

- **Can**: pencil vs knife hold curls, the index finger tension bobbing, wrist roll for yo, rhythm and consistency of cycles, whether both hands move together.
- **Cannot**: where the hook is relative to the work (no absolute position), whether the hook entered the right stitch, yarn tension in grams, loop count. These need a virtual prop and instructions, or a "count the cycles" rule.
- Honest ranking for the demo: chain and slip stitch are nearly identical to the glove, so score them as "one cycle" moves; single, half double and double crochet are distinguished by cycle count, which a learner can fake. Say so in the UI.

---

## 3. Shadow puppets

Classic hand shadows come from the old shadowgraphy tradition ([Wikipedia](https://en.wikipedia.org/wiki/Shadowgraphy_(performing_art)), [Bursill 1859 book on Gutenberg](http://www.gutenberg.org/files/12962/12962-h/12962-h.htm/)). I could not find a source that lists per-finger configurations, so the finger descriptions below are common practice written from general knowledge, and every curl value is an ESTIMATE. Verify against the Bursill book before demo.

Rule for "distinguishable without spread": two puppets are separable if their five-curl vectors differ by more than about 0.4 in at least two fingers, or if one has a distinctive motion (wrist flap or thumb open-close).

| Puppet | Hands | Shape | thumb | index | middle | ring | little | Motion | Separable? |
|---|---|---|---|---|---|---|---|---|---|
| Rabbit | 1 | Index and middle up as ears, thumb tucked over ring and little. | 0.70 | 0.00 | 0.00 | 0.90 | 0.90 | Ears wiggle: index and middle curl 0 to 0.3 | Yes. Unique vector. |
| Talking dog | 1 | Index, middle and ring extended as the upper jaw, thumb as the lower jaw, little finger curled. | 0.10 | 0.05 | 0.05 | 0.10 | 0.90 | Mouth opens: thumb 0.10 to 0.60 at 600 ms | Yes, by the curled little finger plus the thumb motion. |
| Swan | 1 | Hand curved like a neck and beak: all fingers half curled, thumb extended as the beak. | 0.15 | 0.50 | 0.50 | 0.50 | 0.50 | Neck bob: wrist pitch 20 deg | Yes. Only half-curled pose of the set. |
| Flapping bird (dove) | 1 or 2 | Fingers flat and together, thumb slightly in. | 0.30 | 0.00 | 0.00 | 0.00 | 0.00 | Flap: wrist pitch plus and minus 30 deg at about 2 Hz | Yes, but only by the wrist motion. The static pose looks like an open hand. |
| Snail | 2 | Shell hand is a fist, body hand makes two feelers (index and middle up, ring and little and thumb curled). | shell: 0.80 / body: 0.70 | shell: 0.95 / body: 0.00 | shell: 0.95 / body: 0.00 | shell: 0.95 / body: 0.90 | shell: 0.95 / body: 0.90 | Slow forward glide, feelers curl 0 to 0.4 | Partly. The body hand has the same curl as Rabbit, so separate them by the shell hand (fist) and the pair. |

Not chosen:

- **Deer, wolf (antlers), eagle with spread wings**: classic versions rely on spread fingers or two hands interlocked at specific positions. Without spread and position they collapse into "open hand". Deer needs spread antlers. Skip.
- **Wolf**: usually a dog variant with different ear fingers. Without spread it is close to Talking dog.

Top 5 for our gloves: **Rabbit, Talking dog, Swan, Flapping bird, Snail**. Rabbit and Snail's body hand share a curl vector, which is fine because Snail is scored as a two-handed move.

---

## 4. Training without many real experts: synthetic data

### 4.1 MANO

MANO is the standard parametric hand model (pose parameters per joint, 45 axis-angle values plus shape). Licence: [non-commercial scientific research, non-commercial education or non-commercial artistic projects; commercial use, including "use in a commercial service" and training models for commercial purposes, prohibited](https://mano.is.tue.mpg.de/license.html). Commercial licensing via ps-license@tue.mpg.de. Tell the team: MANO is fine for a hackathon prototype and for non-commercial use, but not for a commercial product without a licence.

### 4.2 Public datasets (all gated or non-commercial)

| Dataset | What it has | Licence | Notes |
|---|---|---|---|
| [GRAB](https://grab.is.tue.mpg.de/license.html) | Whole-body grasps, 10 subjects, 51 objects, MANO/SMPL-X hands, contact maps ([details](https://www.humanoidsdata.com/datasets/grab)). | Non-commercial research only | Includes tool use and drinking. |
| [ARCTIC](https://arctic.is.tue.mpg.de/license.html) | Two hands with articulated objects, MANO/SMPL-X params. | Non-commercial research, no redistribution | Bimanual. |
| [DexYCB](https://dex-ycb.github.io/) | 10 subjects grasping YCB objects, RGB-D, MANO. | Data CC BY-NC 4.0, toolkit GPL-3.0 ([summary](https://dexhands.org/datasets/dex-ycb)) | 119 GB download. |
| [HO-3D](https://github.com/bearpaw/ho3d) | Hand and YCB object under occlusion, MANO. | Academic research only, no redistribution or modification | |
| [OakInk](https://github.com/oakink/OakInk) | 1,800 objects, 100 recorded, 50k hand-object pairs, MANO. | Dataset listed as CC-BY-NC-SA 3.0 ([catalogue](https://pon60pi5td.execute-api.us-east-1.amazonaws.com/datasets/oakink.md)), toolkit MIT | Check the Hub page; OakInk2 is a separate dataset. |
| [InterHand2.6M](https://github.com/facebookresearch/InterHand2.6M) | Two interacting hands, fitted MANO. | CC BY-NC 4.0 | No objects. |
| [FreiHAND](https://lmb.informatik.uni-freiburg.de/resources/datasets/FreihandDataset.en.html) | 130k single-hand RGB with 3D pose and shape. | Research only, "any commercial use is prohibited" | No tools. |
| [ContactPose](https://github.com/facebookresearch/ContactPose) | Functional grasps with contact, hand pose, RGB-D. | Code and data MIT, but each 3D object model has its own licence (see licenses.json) | The most permissive of the set, but check per-object. |

None has a scalpel, needle driver or crochet hook in the list I could verify. Their value would be generic "pencil-like" or "precision" grasp curl ranges, which is not worth a hackathon download. Recommendation: do not use them live; at most cite them in the pitch as the research route.

### 4.3 Retargeting MANO to per-joint flexion

If you ever do use MANO poses: MANO gives each non-wrist joint a 3D axis-angle rotation relative to its parent. For finger flexion take the rotation angle about the bending axis only (roughly the local Z axis in most MANO setups; confirm by checking that a fist gives large values on that axis). Sum the three joints per finger and divide by the finger's maximum, for example MCP up to 90 deg, PIP up to 100 deg, DIP up to 80 deg, to get 0 to 1. This is the same shape as the existing mapper in `rokoko_mapper.py` (`flexion[finger] = [MCP, PIP, DIP]`, radians). The max angles are ESTIMATES; use your own flat-hand and fist calibration instead.

### 4.4 Recommended hackathon pipeline (about 3 hours, no downloads)

1. **Write keyframes** (30 min): the tables in sections 1 to 3 as JSON: for each move a list of `{t_ms, thumb, index, middle, ring, little, wrist_roll}`.
2. **Interpolate** at 83 Hz with a smoothstep (or minimum-jerk) curve between keyframes (20 min).
3. **Add variation** to make N synthetic "expert takes" (40 min). Per take:
   - timing jitter: scale whole move by 1 plus a random value (sd 5 percent) and shift each keyframe time by sd 40 ms;
   - per-finger offset: a constant bias per finger drawn from sd 0.03, plus per-frame noise sd 0.01;
   - amplitude jitter: scale each curl change by 1 plus sd 0.05;
   - tremor: add a 8 to 12 Hz sine of amplitude 0.005 to 0.015 to each curl (experts lower, novices higher; this is a standard physiological tremor band, ESTIMATE);
   - wrist roll: same timing jitter, plus sd 3 degrees.
4. **Calibrate tolerance bands** (30 min): generate 200 takes, then for each timeline position compute the mean and the 5th to 95th percentile per finger. Use the 95th percentile of per-finger deviation as the "good" band and about twice that as the "needs work" band. This gives bands that reflect real variation rather than guessed constants.
5. **Make novice takes** to test the scorer (20 min): same pipeline with timing sd 25 percent, finger bias sd 0.12, tremor 0.04, and 20 percent of the takes with one finger wrong by 0.4. Check the score separates expert from novice (target under 5 percent overlap).
6. **Use it** (20 min): ship the bands in `moves.json` per move, keep the generator as a script, and replace the synthetic bands with real ones as soon as any expert records a take on the real gloves.

Be honest in the pitch: bands are synthetic-seeded and will be re-fit from real expert recordings, and the single real expert take is the ground truth.

---

## 5. Props without props, and generated props

### 5.1 Hard rule

Every skill works with no prop. The score is only the curls and wrist, the prop is a visual cue plus an optional collider for a "touch" cue. A prop failing to generate must never block the lesson: fall back to a plain capsule or to no prop.

### 5.2 Can Gemini Flash-Lite compose props from primitives?

Evidence found:

- **3JSBench** (Oct 2026): a benchmark of LLM-written Three.js assets scored on part counts, structure, spatial relations and render quality. Pass rates ran from 1.7 percent to 78.7 percent across 10 models; the Gemini 3.8 Flash entry scored 7.7 percent on the full-program task ([General Context Labs](https://generalcontextlabs.com/research/threejs)). Those tasks are harder (whole assets, strict checks) than our props, but it shows small Flash-class models fail often on spatial relations.
- **CodeGen-3D**: failure rates for Blender code generation of 44 percent (Gemini 2.5 Pro) and 50 percent (Gemini 2.5 Flash) ([IEEE](https://ieeexplore.ieee.org/abstract/document/11355469)).
- **CADPrompt / CADCodeVerify** (ICLR 2025): LLMs generate CAD code from text, and a render-and-check feedback loop improved the objects and compile rate ([paper](https://arxiv.org/html/2410.05340v2)). Newer benchmarks say models do fine on basic geometry and degrade on complex topology ([Text2CAD-Bench, May 2026](https://arxiv.org/abs/2605.18430)).
- **P3D-Bench** (2026): MLLMs often pick the right primitives but place them wrongly ([paper](https://arxiv.org/html/2606.11152)). BlenderWorld says frontier models still struggle with fine-grained 3D spatial coherence ([arXiv](https://arxiv.org/abs/2610.23986)).

Reading: simple props made of 3 to 8 primitives (scalpel: cylinder handle plus a thin box blade; crochet hook: cylinder plus a small torus or capsule tip) are within reach, but placement errors are common, so:

- constrain the output with a JSON schema (structured output), keep part count to 12 or fewer;
- give it 2 to 3 few-shot examples from our own library;
- run a validator (bounds, no NaN, parts within a unit box, parts touching) and clamp;
- if validation fails, retry once, then fall back to a library prop.

### 5.3 Real mesh generation services

| Service | Cost and licence | Fit |
|---|---|---|
| [Tripo API](https://developers.tripo3d.ai/en/pricing) | 1 credit = 0.01 USD. Text to 3D 10 credits (0.10 USD) untextured, 20 with standard texture. Free app plan is non-commercial ([plans](https://www.tripo3d.ai/pricing)). | Cheap, a few seconds to a minute, but meshes are heavy and not collider-ready. |
| [Meshy API](https://docs.meshy.ai/en/api/pricing) | Text to 3D 20 credits (Meshy 6) preview, 10 more to texture. Free plan output is CC BY 4.0, paid plans private licence ([pricing](https://docs.meshy.ai/en/webapp/pricing)). | Same. Generated assets retained 3 to 14 days on the API. |
| [TRELLIS](https://github.com/microsoft/TRELLIS/blob/main/LICENSE) | Code MIT (model weights licence not checked, verify on the model card). Needs a GPU. | Free but no GPU on hackathon laptops. |
| [Shap-E](https://github.com/openai/shap-e) | MIT. Low quality, slow, needs a GPU. | Not recommended. |

Mesh generation costs money (violates the "no paid API" rule for this research), adds seconds to minutes, yields uncontrolled scale, orientation and no clean colliders. Not recommended for the live path. Fine for a pre-baked library made before the demo, with a per-asset licence note.

### 5.4 Recommendation

Hybrid: (1) ship 8 to 10 hand-written JSON props (scalpel, needle driver, forceps, hook, yarn ball, racket, ...); (2) let Gemini Flash-Lite produce new props as the same JSON, validated, with a "regenerate" button and a hard fallback. Gemini pricing is on the [Gemini API pricing page](https://ai.google.dev/gemini-api/docs/pricing?hl=en); Flash-Lite models are priced at fractions of a dollar per million input tokens (the page shows temporary prices through 31 Dec 2026, check the exact model you call). A prop JSON is about 500 to 1,500 output tokens, so cost per prop is a fraction of a cent.

### 5.5 JSON schema sketch

```json
{
  "name": "scalpel",
  "unit": "metre",
  "attach": { "joint": "index_tip", "offset": [0, 0, 0], "rotation_euler_deg": [0, 0, 0] },
  "parts": [
    { "id": "handle", "shape": "cylinder", "size": [0.007, 0.12],
      "position": [0, 0, 0.06], "rotation_euler_deg": [90, 0, 0],
      "material": { "color": "#9aa3ad", "metalness": 0.8, "roughness": 0.3 } },
    { "id": "blade", "shape": "box", "size": [0.003, 0.012, 0.03],
      "position": [0, 0, 0.135], "rotation_euler_deg": [0, 0, 0],
      "material": { "color": "#d8dde2", "metalness": 1.0, "roughness": 0.15 } }
  ],
  "colliders": [
    { "shape": "capsule", "radius": 0.008, "height": 0.15,
      "position": [0, 0, 0.075], "rotation_euler_deg": [90, 0, 0] }
  ],
  "grip_hint": "scalpel_pencil"
}
```

Rules: `shape` is one of `box` (size = x, y, z), `cylinder` (radius, height), `sphere` (radius), `capsule` (radius, height), `torus` (radius, tube). Max 12 parts, max 4 colliders, all values within a 0.4 m box, colours hex, `rotation_euler_deg` only (no quaternions, LLMs get them wrong). The JSON-schema `enum` for `shape` and numeric `minimum`/`maximum` bounds let structured output reject nonsense at decode time.

---

## 6. Hand model look

### 6.1 Licence of generic-hand: correction

The brief said W3C Software and Document License. What I found:

- The **assets package** (which holds `profiles/generic-hand/left.glb` and `right.glb`, [folder](https://github.com/immersive-web/webxr-input-profiles/tree/main/packages/assets/profiles/generic-hand)) is **MIT**: ["Assets are available under MIT license in .glTF, or .glb formats"](https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/assets/README.md), and its [LICENSE.md](https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/assets/LICENSE.md) reads "MIT License, Copyright (c) 2019 Amazon". Meta says it contributed the generic-hand assets ([Meta docs](https://developers.meta.com/horizon/documentation/web/webxr-hands)); I did not confirm whose name is on that exact file.
- The **registry package** and the repo's documents are under the [W3C Software and Document License](https://github.com/immersive-web/webxr-input-profiles/blob/f0359bbf1bc5c0a305b56a89454bcd6b1e28be5b/packages/registry/LICENSE.md). I did not read the repo root `LICENSE.md` (it exists, per the file list), so I cannot say which licence it declares.
- The npm page shows licence "none", which is a metadata gap, not a licence.

**Attribution requirements:**

- MIT: keep the copyright notice and the permission notice "in all copies or substantial portions". In practice: put the MIT text and "Copyright (c) 2019 Amazon" (as written in the file) in a `THIRD_PARTY_NOTICES` or `public/licenses/` file served with the app.
- W3C Software and Document License, if you decide to treat the whole repo as W3C: [per W3C](https://www.w3.org/copyright/intellectual-rights) you must (1) include any pre-existing notices or the short copyright form, (2) make the full licence text available, a link is enough on the web, (3) give notice of any changes to the work, and (4) not use W3C names to endorse. The [2023 document licence](https://www.w3.org/copyright/document-license-2023) also asks for a link to the original document.
- Safe course: ship both notices, state that the hand mesh is modified (rigged to our WebXR joint set, re-skinned), and link the repo. Trademarks are not an issue for the hand mesh (the trademark note in the README is about controller assets).

### 6.2 How Meta Quest renders tracked hands

From [Meta's hand representation guide](https://developers.meta.com/horizon/design/hand-representation):

- Custom hand shader has a **fill and an outline**.
- The **fill** uses a **fresnel blending two dark grey tones** for a subtle light effect and a **constant slight transparency**. This gives the hand presence on bright backgrounds without hiding what is behind.
- The **outline** is a **translucent light grey**, so the hand has contrast in dark environments without being harsh.
- **Both fill and outline fade out at the wrist**, because wrist angle is not tracked and breaks immersion.
- The shader also gives interaction feedback (progress feedback, for example a pinch).
- Meta also says: where hands are a primary input, a "functionally realistic" look works best, and a generic or customisable look avoids the uncanny effect.

Recipe for three.js (our implementation, ESTIMATE values): `MeshStandardMaterial` or a `ShaderMaterial` with `transparent: true`, base colour `#1b2230` to `#2c3646` blended by `pow(1 - dot(N, V), 2.5)`, opacity 0.75 at the centre and 0.95 at the edge, a second back-face pass scaled 1.02 in `#cfd8e3` with opacity 0.35 for the outline, and an alpha gradient along the forearm so the wrist fades out. Add per-finger tint (green to red by error) as a feedback layer on top.

### 6.3 How Rokoko Studio displays hands

I could not find a source describing Studio's hand look. Rokoko's [Smartgloves page](https://www.rokoko.com/products/smartgloves-ii) says Studio handles setup, streaming, recording and retargeting but says nothing about the visual style. The Rokoko SDK ships an [RGMP Viewer with a live 3D hand and a Python hand solver](https://sdk.rokoko.com/guides/hand-solving) that solves per-sensor orientations onto a rigged skeleton, and warns that the sample "is a learning reference". If you need to match Studio's look, take a screenshot on site. Stated as unknown.

### 6.4 Alternative free rigged hands (check each licence on the page before shipping)

| Model | Size | Licence | Note |
|---|---|---|---|
| [Free Pack VR Hands (Rigged), PolyOne Studio](https://sketchfab.com/3d-models/free-pack-vr-hands-rigged-b3b8309e59c748e3956531c8f57dd233) | 1.7k verts, 3.3k tris, left and right, FBX | CC BY (attribution required, commercial use allowed) | Closest in weight to generic-hand; Unity or Unreal ready, so you must convert to glTF and map bones to the 25 WebXR joints. |
| [Hand Rig by CreativeMachine](https://sketchfab.com/3d-models/hand-rig-a348cf6087eb4fd98a83b026593823ad) | about 70k faces per hand, 563k tris in the pack | CC BY | Far too heavy as is; the author says it can be unsubdivided to about 5k faces. |
| [Hands Rigged, SparrowHawk, BlendSwap](https://blendswap.com/blend/22269) | Blender 2.7 file, one control bone per finger (no thumb control) | CC0 | No attribution needed but old and the thumb is not rigged independently, so it needs work. |
| [Anatomically accurate rigged hand for XR](https://sketchfab.com/3d-models/anatomically-accurate-rigged-hand-model-for-xr-86f37207468b427ead21e2eef820c06c) | 2.2k verts, 21 bones, glb | CC BY-NC | NON-COMMERCIAL, avoid for anything beyond a demo. |
| [Ultraleap rigged hand (leapjs-rigged-hand)](https://github.com/leapmotion/leapjs-rigged-hand) | three.js hand plugin with left and right models | Repo Apache-2.0 (I did not verify that the model files carry the same licence) | Another option if you want a ready three.js rig. |

If generic-hand looks too low poly, a cheap route is to subdivide once in Blender (Catmull-Clark, 1 level, then transfer weights) and apply a smooth normal shading plus the fresnel look above, which hides most of the faceting.

---

## Open questions and risks

- All curl and wrist numbers are ESTIMATES. Run the flat-hand and fist calibration, record one real take per grip, and overwrite.
- Shadow puppet finger configs are not from a cited source.
- The Gemini model name and the Flash-Lite price in the repo should be checked against the pricing page on the day.
- I did not read the root LICENSE.md of webxr-input-profiles.
- `driver_ring` vs `scissors_tripod` vs `driver_thenar` differ by too little to be told apart by glove alone; label them by lesson, not by detection.

## Summary of key recommendations

1. Build "Surgical grips" as `hold_pose`: scalpel pencil (0.45, 0.35, 0.50, 0.85, 0.90), table-knife (0.55, 0.30, 0.65, 0.80, 0.85), driver ring/tripod (0.45, 0.20, 0.40, 0.55, 0.80), driver thenar (0.30, 0.30, 0.50, 0.50, 0.80), forceps pencil (0.40, 0.30, 0.40, 0.80, 0.85).
2. Surgical procedures as `finger_sequence`/`grip_and_swing`: instrument tie (driver clicks thumb 0.30 to 0.55), two-handed square knot (left-hand pinch then 60 deg pronation), needle-driving arc (roll 0 to 70-90 deg pronation and back to 20 deg supination, about 1.8 s).
3. Crochet: pencil hold (0.45, 0.40, 0.50, 0.80, 0.85) or knife hold (0.50, 0.30, 0.55, 0.75, 0.80), yarn hand index bobbing 0.05 to 0.30, hook roll 0 to 40 deg per yarn-over; stitch = cycle count: chain 1, slip stitch 1, sc 2, hdc 3, dc 4.
4. Shadow puppets (curl thumb, index, middle, ring, little): Rabbit (0.70, 0, 0, 0.90, 0.90); Talking dog (0.10, 0.05, 0.05, 0.10, 0.90, thumb 0.10 to 0.60 opens mouth); Swan (0.15, 0.5, 0.5, 0.5, 0.5); Flapping bird (0.30, 0, 0, 0, 0, wrist flap plus and minus 30 deg); Snail (two hands, shell fist plus feelers hand).
5. Scoring metrics that the literature supports: time, smoothness (jerk) and economy of motion; the closest prior work is a sensory glove study on suturing (Saggio 2015).
6. No usable open data-glove surgical dataset; JIGSAWS is robot data, academic non-commercial only. MANO and almost every hand-object dataset (GRAB, ARCTIC, DexYCB, HO-3D, OakInk, InterHand2.6M, FreiHAND) are non-commercial; ContactPose is MIT except per-object models.
7. Synthetic pipeline: keyframes, smoothstep at 83 Hz, 200 jittered takes (timing sd 5 percent, finger bias sd 0.03, tremor 8 to 12 Hz), tolerance bands from the 95th percentile, novice takes to validate the scorer; about 3 hours.
8. Props: hand-made JSON library plus Gemini Flash-Lite generating the same schema with validation and fallback; LLM 3D evidence is weak for complex scenes (3JSBench Gemini Flash 7.7 percent) so keep parts at 12 or fewer; skip Tripo (0.10 to 0.20 USD) and Meshy for the live path.
9. generic-hand licence: assets package is MIT (keep copyright and permission notice), registry and docs are W3C; ship both notices and say the mesh is modified.
10. Hand look: Quest-style dark two-tone fresnel fill, slight constant transparency, thin translucent light-grey outline, both fading at the wrist; fallback hand models: PolyOne VR hands (CC BY, 1.7k verts), BlendSwap Hands Rigged (CC0), avoid the CC BY-NC anatomical hand.
