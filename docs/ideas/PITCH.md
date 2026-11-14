# Geppetto: pitch scripts

Framing: **the Renaissance bottega, reborn with gloves.** In a 15th-century workshop the apprentice learnt by standing at the master's shoulder and copying his hands. That never scaled: one master, a handful of apprentices. Geppetto puts the master's hands into a file.

Audience mix: Rokoko (wants gloves shown as a real-time developer platform), Google DeepMind (wants Gemini/Gemma doing visible work), Arduino (wants hardware on stage), grand jury (wants a story and a working demo).

Rules for the stage: never say "first ever" (prior art exists, see research/04). Never quote earnings, users or prices as real; say "placeholder" or "test mode". Say "scored by our algorithm, explained by Gemini" so nobody thinks the LLM is the judge.

---

## 30-second elevator

"Hand skills, like piano, table tennis or physio exercises, are still taught one person at a time, because a video cannot tell you which finger is wrong. Geppetto records a master once with Rokoko gloves. Then anyone can train against their ghost hand and get told exactly which finger, how far off, and when. Gemini builds the lessons and coaches in plain language. It is a Renaissance bottega that scales: the master's hands, in a file."

---

## 2-minute pitch (one presenter plus one gloved volunteer)

Roles: **Presenter** speaks and drives the mouse. **Gloved person** (teammate) wears the right glove and stands to the side of the screen. Second teammate on standby with the left glove only for the duel beat if time allows.

| Time | Beat | Say | Screen / action |
|---|---|---|---|
| 0:00 | Hook (live wrong finger) | Gloved person is already in the training room, marionette mode on, plays the master's move with one wrong finger. The string turns vermilion. "A camera would call that correct. It was wrong, and we know which finger." | Training room, differentiator on screen by 0:15 |
| 0:15 | Bottega line | "In 1490 you learnt by copying the master's hands. It never scaled. Now the master's hands are a file." | Role-select screen |
| 0:25 | Master beat | Show the lesson generated BEFORE the beat ("one sentence made this: Teach a table tennis forehand grip, three steps") with a pre-recorded master take as the reference. No live recording in the 2-minute version. | Pre-generated lesson, provider badge visible |
| 1:00 | Apprentice beat | "Now the apprentice." Gloved person swaps roles: marionette mode, wooden hand, strings from the master's ghost fingertips. Deliberately curl the wrong finger. | Training room, marionette strings go vermilion on the wrong finger |
| 1:25 | Coach beat | AI coach line appears: "Your ring finger is late by 120 ms and 20 degrees too curled." Presenter: "Scored by an algorithm, said by Gemini." | Score card + hint |
| 1:40 | Why gloves, why now | "Gloves are the only sensor that sees every finger, even under a racket. Rokoko is pushing gloves into robotics and developer use. Gemma can run the coach locally (only say this if the offline toggle was tested)." | Back to presenter |
| 1:50 | Close | "Masters record once and can reach many learners (earnings model to be tested). Apprentices train anywhere. The bottega, reborn. We are Geppetto." | Role-select screen |

Spare second: if Gemini is slow, the lesson was pre-generated; say "here is one I made earlier" and open it.

---

## 4-minute pitch

| Time | Beat | Who | Content |
|---|---|---|---|
| 0:00 | Hook | Presenter | Bottega story (30 s). One line on the 1490 workshop, one on why it never scaled. |
| 0:30 | Problem | Presenter | Three failures: video (passive), apps that listen (right note, wrong finger), human teacher (does not scale, costs EUR per hour; keep it unnumbered). Positioning from PRODUCT.md: "Camera sees a hand, glove sees which finger, how bent, even hidden." |
| 1:00 | Live demo 1: master | Presenter drives, Gloved A records | Generate a lesson from one sentence (Gemini, structured JSON, validated, with retry). Then "start from scratch": calibrate, countdown, 3 takes, replay with the take scores. Say: "each take is scored against the master's tolerance." Tolerance is set by hand per step and is fixed; do not claim it comes from take variance. |
| 2:00 | Live demo 2: apprentice | Gloved B (fresh volunteer from the audience if possible) | Course syllabus with video slots. Training room: switch the four guidance modes live (marionette, shadow, ghost, side by side). Wrong finger triggers fading feedback. Show fading: attempt 2 has strings only. |
| 2:50 | Live demo 3: the test | Gloved A (left) vs Gloved B (right) | Table tennis rally, left glove versus right glove, one pair of gloves as two players. Short rally, 20 s. Piano play-along only if time. |
| 3:20 | Why gloves, why now | Presenter | Rokoko Smartgloves II: finger joints at about 60 to 83 Hz, about 20 ms latency, no occlusion. Rokoko is pushing gloves into robotics (research/03); we use Studio UDP today and have an SDK stub pending the licence. Gemini builds lessons; Gemma could coach offline if tested. |
| 3:30 | Business model | Presenter | "Masters publish, learners subscribe or buy, we take a platform fee." Placeholder figures only. Markets: music tuition, sports coaching, rehab clinics. Every recording is also labelled hand-motion data, valuable for robotics teleoperation. Fee and pricing undecided (PRODUCT.md): say "to be tested". |
| 3:45 | Renaissance framing | Presenter | "Leonardo's apprentices did not learn from his notebooks. They learnt from his hands. We make hands copyable." |
| 3:55 | Close | Both | "Geppetto. Master it once. Teach it forever." |

Business model detail (keep to one slide or one breath):
- Supply: masters earn per learner or per subscription month.
- Demand: learners pay per lesson; schools buy seats.
- Moat: the verified, labelled glove-data library, plus per-finger analytics a camera cannot produce.
- Honest status: no real masters, users or revenue yet.

---

## Three alternative hooks

1. **The silent failure (recommended opener, used in the 2-minute script).** "Play me a C on this paper keyboard. [Gloved person plays with the wrong finger.] Every piano app in the world just said 'correct'. It was wrong. Only a glove knows."
2. **The audience hand.** "Everyone hold up your right hand. Make a fist, then open it. That took 14 muscles and you cannot describe it. We can record it." Then cut to the ghost hand.
3. **The Leonardo line.** "Leonardo never wrote down how he held a brush. His apprentices copied his hand, and when they left, the knowledge went with them. We just fixed that."

---

## Likely stage mistakes to avoid

- Reading the research claims as fact: the Rokoko brief, DeepMind criteria and credits are unverified (research/03, 05).
- Mentioning "Renaissance" only at the end; use it in the hook and the close.
- Running the duel before the single-player flow works; it is the riskiest beat, so it goes last and is cuttable.
