# Geppetto: pitch script

Framing: **the Renaissance bottega, reborn.** In a 15th-century workshop the apprentice learnt by standing beside the master and copying his hands. It worked, but only for the few who fit in the room. Geppetto puts the master beside every apprentice, human or robot.

Shape of the story: **story first, product second, build third.** A real master and a real apprentice, one quote, the problem in one image, then the app in someone's hands, then "here's how we made it".

Track: Rokoko's Robot Teleoperation Challenge, so the robot hand gets its own beat before "how we made it" and comes back in the last line. Other judges in the room: Google DeepMind (Gemini and Gemma doing visible work), Verda (inference), the grand jury (a story and a working demo).

Rules for the stage:
- Never say "first ever" (prior art exists, research/04).
- Never quote earnings, users or prices as real. If asked: "no users or revenue yet, pricing to be tested".
- The score is our algorithm. The AI Assistant writes lessons and explains scores, it never decides them.
- The robot is a live simulated twin (Unitree Dex3-1 from its URDF), not real hardware. Say "simulated" once, clearly.
- In the history beats say "master". Once the app is on screen say "expert", because that is what the app says.
- Junction video limit: 3:00, strictly. Target 2:50 spoken, captions burned in.

---

## Main script (about 2:50, works as the video voice-over and the stage pitch)

Read pace: about 140 words a minute, with a real pause after the quote. Spoken words: about 365 (2:36 of speech, plus pauses).

### Act 1: the bottega (0:00 to 0:35)

| Time | Say | Show |
|---|---|---|
| 0:00 | "Florence, the 1460s. Andrea del Verrocchio teaches with his hands. One of his apprentices is a boy called Leonardo." | Black screen, then warm candlelight. Slow push-in on a Renaissance hand study. Sound: a single low string note. |
| 0:10 | (beat, then slowly) **"'He is a poor disciple who does not excel his master.'"** (beat) "Leonardo wrote that. Then he did it." | Verrocchio and Leonardo's *Baptism of Christ* slams onto the screen: hard cut, slight camera shake, paper-tear or ink-splash wipe. Zoom to the angel Leonardo painted. Quote types on in serif, credit underneath: "Leonardo da Vinci, Notebooks". |
| 0:22 | "But a master could only teach the apprentices who fit in his room. Skill travelled one shoulder at a time." | Workshop engraving: one master, a room of apprentices. Slow pan across the faces. |
| 0:30 | "Today, with Geppetto, a master can teach anyone, anywhere. Record your hands once, and every apprentice after you can learn from them." | Hard cut to now: a teammate turns a laptop to camera, Geppetto open on the expert studio. Gloves visible on their hands. |

### Act 2: beside you, not facing you (0:40 to 1:10)

| Time | Say | Show |
|---|---|---|
| 0:40 | "Tutorials today are flat. Filmed facing you, so everything is backwards. And the video never knows if you got it right." | A generic flat tutorial-style clip (our own footage, no real channel), mirrored, with a red "?" over the hands. Keep it 3 seconds. |
| 0:50 | "So what if the master was right beside you? Same side, same hand, in 3D." | Training room: the expert's ghost hand next to the learner's live hand, camera from the learner's shoulder. |
| 0:58 | "And because the gloves feel every finger, it knows when you play the right note with the wrong finger." | Learner curls the wrong finger. One marionette string turns vermilion. Fix it, string relaxes, malachite. |

### Act 3: any skill (1:10 to 1:30)

| Time | Say | Show |
|---|---|---|
| 1:10 | "Piano. Sign language. Table tennis. Even hand shadows." | Fast montage, one second each, cut on the beat: typing/piano desk, Finnish fingerspelling, table tennis grip with the chalk racket, the lamplit shadow puppet wall. |
| 1:16 | "Experts take you through step-by-step exercises. The help fades as you improve, until it's just you, and the skill you always wanted." | Attempt 1 with strings and ghost, attempt 2 strings only, score climbs. End on the gold seal "Sealed by {expert}". |

### Act 4: the newest apprentice (1:30 to 1:55)

| Time | Say | Show |
|---|---|---|
| 1:30 | "And the newest apprentice isn't human." | Hard cut: the simulated Dex3-1 robot hand twin, still. Silence for one second. |
| 1:34 | "The same gloves drive a robot hand, live. Every lesson an expert records is a demonstration a robot can learn from." | Gloved teammate moves; the robot twin follows in real time, side by side with the human hand. |
| 1:44 | "And Geppetto shows, finger by finger, how closely the robot keeps up, and which fingers it simply doesn't have." | Robot fidelity per finger; ring and little finger marked as missing on the three-finger hand. |

### Act 5: here's how we made it (1:55 to 2:40)

| Time | Say | Show |
|---|---|---|
| 1:55 | "Here's how we made it." | Title card on parchment. |
| 1:58 | "Rokoko Smartgloves stream every finger 83 times a second. We read Rokoko's hand solver directly, turn it into 26 joints, and stream them to the browser, where a 3D hand moves with you." | Simple animated diagram: gloves, then our engine, then the browser hand. Real glove close-up under it. |
| 2:10 | "Experts record a few takes. Your attempt is matched against them in time, finger by finger, so being a little slow isn't the same as being wrong." | Expert replay with takes stacked as ghosts, then the per-finger score breakdown. |
| 2:20 | "The score is our algorithm. The AI Assistant, Gemini and Gemma running on Verda, turns one sentence into a full lesson, and explains your score in plain words. It never decides it." | Type "Teach a table tennis forehand grip, three steps", lesson builds; then a coach line under a score card. |
| 2:32 | "For the robot, we retarget the same joint angles onto a Unitree Dex3-1, inside its real joint limits, and render it live from its URDF." | Diagram grows a second branch to the robot twin. |

### Act 6: close (2:40 to 2:50)

| Time | Say | Show |
|---|---|---|
| 2:40 | "Leonardo was right. Every apprentice should surpass the master. Geppetto puts the master beside every one of them, human or robot." | Back to the angel from the *Baptism*, cross-fade to the live ghost hand and the robot twin side by side. |
| 2:47 | "Geppetto. Master it once, teach it forever." | Logo on parchment. "Built at Junction 2026." |

Images: use only the public-domain files listed in `PITCH_ASSETS.md`. Baptism: the 3760x4520 Uffizi file (the two biggest Commons copies are CC BY-SA, not PD), and crop the angel from it. Workshop: Stradanus "Color Olivi" (Rijksmuseum CC0), captioned "a Renaissance painter's workshop, c. 1590s". Leonardo joined Verrocchio's shop around 1466, aged about 14, so the script says "the 1460s" and "a boy".

Cut order if over 3:00: the Verda/Gemini line shrinks to "The AI Assistant writes the lessons; it never decides the score" (saves 6 s), then the "matched in time" line (saves 8 s). Never cut Act 4.

Optional line, only if there is time (it explains the name): after "Master it once" add "We named it after the woodcarver who taught a wooden puppet to move." Pairs with the wooden marionette hand on screen.

---

## Before you say it, check it on the build

- "26 joints" and "83 times a second": measured on Szymon's gloves (arpan_info.md section 2). Fine to say.
- "Matched in time, finger by finger": per-finger DTW in `backend/app/services/scoring.py`. Fine to say.
- Robot fidelity per finger and missing fingers: `core/robot.py` computes both. Confirm the twin screen shows them before filming Act 4; if not, cut the 1:44 line.
- "Live": only if the robot twin is driven by the real gloves in the shot. If it is driven by a replay, say "follows the expert's recording" instead.
- Gemini and Gemma on Verda: say it only if the chain answered on the demo machine that day.

---

## 30-second elevator

"In a Renaissance workshop you learnt a skill by standing beside the master and copying his hands. It only worked for the few who fit in the room. Geppetto records an expert's hands once with Rokoko gloves, and puts them right beside you in 3D, same side, same hand. The gloves feel every finger, so it knows when you play the right note with the wrong finger. The same recordings drive a robot hand, so every lesson is also a demonstration a robot can learn from. Geppetto: master it once, teach it forever."

---

## The phrases to repeat (booth, stage, video, Devpost text)

1. **"Right note, wrong finger."**
2. **"Beside you, not facing you."**
3. **"The newest apprentice isn't human."**
4. **"Scored by our algorithm, explained by the AI Assistant."**
5. **"Master it once, teach it forever."**

---

## Likely stage mistakes to avoid

- Saying "broadcast" or "live lesson": lessons are recorded, not streamed. Say "teach anyone, anywhere".
- Letting the robot read as an afterthought. This is a robot teleoperation track: Act 4 stays, and the close names the robot.
- Calling the robot real hardware. It is a simulated twin.
- Reading the research claims as fact: the Rokoko brief and DeepMind criteria are unverified (research/03, 05).
- Running a two-player game before the single-player flow works; it is the riskiest beat, so it is not in the main script.
