# 14. Teaching the robot: mistakes, feedback and words

This builds on section 3.4 of `13_robot_teacher.md` (apprentice, protege effect, CoWriter basics). It does not repeat that. It answers how to design the errors, the robot's replies, the language, and what is known for adults and motor skills.

## 0. Recommendation (read this first)

1. Make the robot fail in plausible, learner-like ways, one error at a time, always tied to a finger and a joint.
2. Make the errors "typical" for a learner: wrong on the thing not yet taught, right on what was already fixed. Never let a fixed error come back for no reason.
3. Mix in some correct attempts (UNCONFIRMED ratio, see 1.4) so the learner keeps checking instead of assuming.
4. The robot should repeat back what it understood ("curl index more, got it"), then improve in a visible, partial, slightly imperfect way.
5. Support a small command vocabulary: finger, direction, amount, timing. Handle "more", "less", "a bit", "too late".
6. The robot's score is the teaching score. Tell the learner they are responsible for it.
7. Teaching a robot is not proven for adult finger skills. Treat it as a motivating extra, keep the normal glove practice.

## 1. Deliberate mistakes

### 1.1 What the evidence says for errors

- **Erroneous examples (finding and fixing errors in worked examples)** beat plain problem solving in several studies, but often only later. In a decimals tutor (Adams et al. 2014) there was no gap straight after, then a clear gap a week later. A replication with 390 students found the same delayed gain (d = .33). The problem-solving group liked it more and found it easier ([Adams et al., AIED 2015](https://link.springer.com/article/10.1007/s40593-015-0064-x)). Expect the "robot with errors" mode to feel harder than plain practice, and to pay off on a retention test, not on the same-day score.
- **Booth et al. 2013** (algebra tutor): explaining both correct and wrong examples gave higher post-test scores than explaining correct ones only ([summary in the AIED paper](https://www.sciencedirect.com/science/article/pii/S1560429226003823?via%3Dihub)).
- **Comparing wrong with right** helps even with low prior knowledge: 4th and 5th graders who compared incorrect and correct decimal examples learned more, and had fewer misconceptions later ([Durkin and Rittle-Johnson 2012](https://www.sciencedirect.com/science/article/abs/pii/S0959475211000880)).
- A 2025 meta-analysis and a 2025 systematic review say benefits are real but depend on design: prompts, feedback, load, prior knowledge, and the kind of knowledge ([Alemdag et al. 2025](https://journals.sagepub.com/doi/full/10.3102/00346543251390901), [Educ Psych Review 2025](https://link.springer.com/article/10.1007/s10648-025-10071-x)). Several studies found no difference vs plain problem solving, and none favoured correct-only examples (same review).

### 1.2 Evidence against, or limits

- **Grosse and Renkl 2007** (probability): mixing in wrong solutions helped far transfer only for learners with good prior knowledge. For weak learners, correct-only was better, and errors reduced principle-based self-explanation ([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0959475207001004)). They advise showing errors after correct examples, not at the start.
- Showing wrong examples before correct ones raised mental load and lowered results (Wesenberg et al. 2022, reported in the Alemdag review above).
- A robot-tutee thesis found no effect of error type on learning, only on attention and self-efficacy ([McMaster thesis 2025](https://prod-ms-be.lib.mcmaster.ca/server/api/core/bitstreams/b7c0e1bb-8102-4a4d-b92f-5aaf8691e8ff/content)). So robot mistakes are not a sure win.

Design consequence for us: first show the learner the correct step (our existing Watch step), then let them teach the robot. Novices who are lost should get the robot error with a hint, not a blank puzzle.

### 1.3 Which errors help

- **Plausible and common.** Erroneous examples work best when the errors are typical ones, and learners benefit when the example error resembles their own ([Alemdag 2025](https://journals.sagepub.com/doi/full/10.3102/00346543251390901)). CoWriter did this on purpose: it drew the typical errors of 6-8 year olds using a database of children's handwriting ([EPFL news](https://actu.epfl.ch/news/kids-and-robots-learn-to-write-together), [Hood et al. 2015](https://dl.acm.org/doi/10.1145/2696454.2696479)). For us, derive the robot's errors from real learners' glove data (for example, index too straight, thumb late, pinky lifts) rather than random noise.
- **Typical vs atypical (Frontiers 2025, Aitken et al.).** 114 children aged 8-11 taught a robot that made no mistakes, "typical" mistakes (errors on untaught material only), or "atypical" mistakes (errors on already-taught material). Any mistakes made children use more teaching strategies. Children judged the typical robot as the better learner, but they themselves learned most from the atypical robot ([Frontiers](https://www.frontiersin.org/journals/developmental-psychology/articles/10.3389/fdpys.2025.1526486/full)). That fits two goals: typical errors feel believable, atypical ones (a fixed error coming back) force the learner to re-check. Our choice: mostly typical, with one rare, labelled "relapse" (see 2.3). This is a judgement from one study of children on a classification task, so treat it as UNCONFIRMED for fingers.
- **One at a time.** Direct evidence for hand motion: none found, UNCONFIRMED. Reasoning: the learner has to localise the error to a finger, and the glove score can then be checked per finger. Start with one wrong finger per attempt, and allow two only in later levels.

### 1.4 How often, and catch trials

- No study gave an ideal error rate for a teachable agent. Do not invent a number: UNCONFIRMED. The Frontiers study matched error counts across its two mistake robots, so it says nothing about the best rate.
- Catch trials (a correct attempt now and then) are our own safeguard, with no direct source found. Reasoning: if every attempt is wrong, learners stop looking and just guess "more curl". A correct attempt lets them say "it is fine" and checks they can judge, which is the "error detection" step of erroneous-example work ([Alemdag 2025](https://journals.sagepub.com/doi/full/10.3102/00346543251390901)). Suggested start: about 1 correct attempt in 5 to 6, at random, tune by playtest. Score "leave it alone" as a right answer. Do not announce which are catch trials.

## 2. How the agent responds

### 2.1 Repeat back, show improvement

- CoWriter's key rule, from 13: the robot must look as if it learns, at the right rate. In its studies children believed the robot improved even when it did not, yet only the genuinely improving robot gave handwriting gains ([Comparing a robot tutee, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8899022)). So real improvement is worth building.
- Jamet et al. list three traits of a robot tutee: it is programmed to make mistakes, it develops skills so it appears to learn, and it communicates with speech and gesture ([Frontiers 2022](https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2022.875704/full)). Speech and gesture here means the repeat-back and the on-screen hand showing what it understood.
- Repeat back in plain words plus a motion: "So index curls 20 more degrees. Trying." Then show the new attempt with a small overshoot or undershoot. This is our design, not a studied one. It also lets the learner catch a misheard command before the attempt.
- Tutees that ask questions or ask the tutor to explain help tutoring: Martino and Maher 1999, cited in [Frontiers 2022](https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2022.875704/full). Many tutors only "knowledge tell". A robot that asks "which finger?" or "how much?" pushes learners past one-way telling.

### 2.2 Too fast or too slow

- Too fast: no room to teach, the learner feels useless (CoWriter rule in 13). Too slow: UNCONFIRMED for adults; reasoning is frustration and a feeling that corrections do nothing. Between sessions, a robot that improved gave handwriting gains while a non-improving one did not ([Chandra et al. 2020, via PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8899022)).
- Practical rule: each good correction closes roughly half to two thirds of the remaining gap, never all of it, and a bad or vague correction closes little or none. The curve is then driven by teaching quality, which is what we want to score.

### 2.3 Regression

- Atypical errors (a taught thing going wrong) gave the best learning in the 2025 study, but they made children rate the robot as a worse learner ([Frontiers 2025](https://www.frontiersin.org/journals/developmental-psychology/articles/10.3389/fdpys.2025.1526486/full)). So use regression rarely, make it look like a believable slip (fatigue, "I forgot"), and have it on a skill the learner already fixed. UNCONFIRMED for finger skills.

### 2.4 Personality and responsibility

- **Protege effect (Chase et al. 2009):** 8th graders who thought they taught Betty spent more time on learning activities and learned more, most for lower achievers. 5th graders in the verbal study treated the agent socially, took responsibility, and showed more acknowledgement of errors; the authors say having an agent may protect egos from failure ([Springer](https://link.springer.com/article/10.1007/s10956-009-9180-4)). Design: say "your robot", show its score as the learner's responsibility, let the robot "fail" so the learner does not.
- **Personality:** I found no good controlled study on robot-tutee personality for learning, UNCONFIRMED. A peer robot (friendly, "we make a great team") beat a tutor robot only for low-prior-knowledge adults in circuit building, and was seen as friendlier and more respectful ([Yale HRI 2022](https://scazlab.yale.edu/sites/default/files/files/P2P___HRI2022%20(7).pdf)). Keep the personality light: eager, a little clumsy, never sulky or blaming.

## 3. Natural-language corrections

### 3.1 What the research shows

- **Sharma et al. 2022** map a sentence to a change in the planner's cost: new constraints ("stay away from the yellow bottle") or sub-goals; one correction fixed 81% of failures, two fixed 93% ([RSS 2022](https://www.roboticsproceedings.org/rss18/p065.pdf)). Words like "go slower" act as global constraints.
- **Yell At Your Robot (Shi et al. 2024)**: fine-grained corrections such as "move a bit to the left", "move the sponge a little lower", "turn your right gripper towards me" were absorbed in real time. Live corrections raised success from 15% to 50%, and fine-tuning on them gave 15% to 45% ([RSS 2024](https://www.roboticsproceedings.org/rss20/p025.pdf)).
- **LILAC (Cui et al. 2023)**: online corrections from "left!" and "tilt down a little bit" to "no, towards the blue marker" ([paper](https://nlp.stanford.edu/pubs/cui2023lilac.pdf)).
- **Co-Fine**: I did not find a reliable source for it in this pass. UNCONFIRMED, not used.
- Note: these papers all target arms and objects, not individual fingers. No study of natural finger-correction wording was found. UNCONFIRMED for hands.

### 3.2 Vocabulary to support (our design, from the patterns above)

| Part | Examples to accept |
|---|---|
| Which finger | thumb, index/pointer, middle, ring, pinky/little, "all fingers", "your hand" |
| Joint (optional) | knuckle, tip, base, "bend", "curl", "straighten", "spread", "close" |
| Direction | more, less, curl, straighten, open, close, up, down, towards palm, away, left, right, together, apart |
| Magnitude | a bit, a little, slightly, much more, all the way, half way, "like that", plus a number in degrees as an expert option |
| Timing | earlier, later, too late, too early, faster, slower, "at the same time as", "after the thumb", hold longer |
| Meta | "again", "stop", "good", "that's right", "no, the other one", "undo" |

Rules:
- A missing finger: use the one the robot got most wrong, or ask "which finger?". Do not guess silently.
- Magnitude words map to ranges, then scale by the current error, so "a bit" moves less when the error is already small.
- Keep an `LLM or rule parser -> {finger, joint, delta, timing}` structure, as in Sharma's "sentence to cost change" idea. Tapping a finger just fills the finger slot.
- Always echo the parsed result, so a mishearing is visible (2.1).
- Voice and typing both: Yell At Your Robot used a microphone, but typed chips ("more", "less", "earlier") are safer on a noisy hackathon floor.

## 4. Learning by teaching: motor skills and adults

- **Motor, children:** CoWriter reports improved fine motor skills in children who taught a robot to write ([Science Robotics review](https://scazlab.yale.edu/sites/default/files/files/scirobotics_aat5954.pdf)). Prototype scale: about seventy 6-8 year olds in class, plus one child for a month ([EPFL news](https://actu.epfl.ch/news/kids-and-robots-learn-to-write-together)). Gains were clear only when the robot really improved (Chandra 2020).
- **Adults:** a peer robot taught adults electronic circuit building, with no overall gain over a tutor robot, but low-prior-knowledge adults gained more from the peer ([Yale HRI 2022](https://scazlab.yale.edu/sites/default/files/files/P2P___HRI2022%20(7).pdf)). Note this is the robot teaching, not the adult teaching the robot.
- **Adults teaching robots a motor skill:** novices are poor teachers by default. A study found that real-time guidance improved teaching accuracy by about 78% and carried over to new skills ([Using machine teaching to boost novices, arXiv 2024](https://arxiv.org/html/2409.15563v1)). An earlier version found little retention after guidance ([arXiv 2021](https://arxiv.org/html/2104.08631v2)). It measures robot accuracy, not the teacher's own motor learning. Implication: give the learner live feedback on how good their teaching is.
- **Cross-reference:** no study found of an adult improving their own finger skill by teaching a robot. UNCONFIRMED, treat as an assumption (as 13 does).
- A 2026 meta-analysis of social robots in education says effects depend on pedagogy; robots that assist a human educator did well, robots that replaced teachers did not ([Frontiers 2026](https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2025.1735198/full)). Keep this mode as an addition to the lesson, not a replacement.
- Learning from partially assistive teaching: leaving the learner a sub-skill to do themselves encouraged exploring new strategies ([COACH, CoRL 2022](https://proceedings.mlr.press/v205/yu23b/yu23b.pdf)). Mild support for not fixing everything for the learner.

## 5. Design recommendations (numbered)

1. Order: Watch the correct step, then Teach the robot, then Try it yourself with the glove. Errors come after the correct example (Grosse and Renkl).
2. Generate robot errors from real learner error patterns per lesson (tennis grip, typing, fingerspelling, puppets). One finger per attempt at first.
3. Mostly "typical" errors (on the thing not yet taught or fixed). Allow one rare, believable relapse per session on an already-fixed finger.
4. Include correct attempts at about 1 in 5 to 6 (tune). Give credit for "that's right, leave it".
5. Echo every command as words plus a visible parsed plan before the robot moves. Ask one short question if the finger or amount is missing.
6. Robot improves by a partial step per good correction (about half to two thirds of the gap), little or nothing for vague or wrong ones. Never perfect on the first fix.
7. Support the vocabulary in section 3.2 by chips, tap-a-finger and typed or spoken text. Map "a bit / much more" to ranges scaled by the current error.
8. Offer "show it with the glove" as a second route: the robot copies the learner's pose, and the scorer rates it against the expert. This gives the second feedback type for free.
9. The robot's score equals the teaching score. Wording: "your robot", a visible improvement curve, light eager personality, no blame.
10. Measure honestly: log learner glove score before and after, and a delayed re-test next day. Gains from error work often appear only later (Adams 2014).
