# 08: Competition, judging and how to win track prizes

Researched 13 Nov 2026 (day 1 of Junction 2026). Every claim has a link. Tags: **[V]** verified on the page linked, **[I]** my inference, **[U]** unverified or not findable. Do not repeat any [I] or [U] item on stage as fact.

## 1. How Junction 2026 is judged

- 2,000 builders, 48 h, EUR 100,000 prize pool, Hype Areena, Espoo, 13 to 15 Nov. Teams of 1 to 4. [V] [2026.hackjunction.com](https://2026.hackjunction.com/)
- Three stages [V, same page]: (1) each Challenge Partner picks its own track winners "against their own criteria"; (2) the Main Event winner starts with face-to-face peer review to pick the top 5; (3) the top 5 pitch live and a grand jury of seven picks the overall winner.
- Schedule [V, [platform page](https://hackjunction.app/hackathons/junction-2026) and the site above]: preliminary submission Fri 23:55 (platform) or 23:59 (site), submissions open Sat 12:00, **final submissions Sun 10:00**, review time 10:30, final ceremony 14:00, challenge winners 15:10, Junction winner 15:50.
- Tracks listed [V]: Hardware (by Arduino), Healthcare, AI Infrastructure (by Verda), FinTech, Agentic AI, Data, plus "Tech challenges" that "run across every track" so a team can take them alongside its track. Rokoko and Google DeepMind appear as partners but **neither has a published track page or prize text** [U]. Rokoko was announced as "a challenge partner" with "motion capture gear and mentoring" and the line "build and test experiences driven by real movement" ([Junction Instagram, 9 Nov](https://www.instagram.com/p/Dfhfv38nPYo)). DeepMind: "Ambitious people. Ambitious problems... Something special is planned for the winning teams. More on that soon." ([2026 site](https://2026.hackjunction.com/)). The DeepMind keynote is at the Friday opening ceremony and a workshop at 20:00 [V, same site]. **Ask the Rokoko and DeepMind mentors on the floor for exact wording and prize today.**
- Grand jury, what each says they look for [V, [2026 site](https://2026.hackjunction.com/)]:
  - Kia Kanninen (Founders House Helsinki): "teams that start from a problem worth solving, not just a feature that's easy to build."
  - Otto Soderlund (AI lead, Supercell): "start from a real user problem and ship something people want to come back to." (Supercell link: the duel and the piano mode are the "come back to" part.)
  - Umar Noor (Google DeepMind developer experience): "move fast, stay pragmatic, ... one unique insight that solves a problem 10x faster or better."
  - Arturs Polis (CTO Verda): "tackle the hardest challenges and build prototypes with a clear path to production and scale."
  - Hubertus van der Drift (CTO Context.dev): same as Noor, pragmatic and fast.
  - Daksh Raghuvanshi (AfterQuery, RL): "explain exactly why an agent fails in their world, and whose reward holds when someone tries to break it." Our parallel: scoring is deterministic and cannot be gamed by the LLM.
  - Timo Ahopelto (Lifeline Ventures): no stated criterion, investor.
- Submissions are open-sourced under MIT and teams keep ownership [V, 2026 site FAQ]. Do not put anything in the repo you would not publish.

## 2. Submission and video rules

- Latest Junction guidance I could find (Junction 2024 guidebook, [Project Submission](https://junctionhq.notion.site/Project-Submission-fff59a11813781a38121ccc1a3fb14d4)): banner images (up to 5), name, punchline, description, challenge, technologies, **a 3-minute video pitch "not a second longer than 3 minutes, and we will be very strict"**, hosted anywhere public (YouTube, Vimeo), OR a pptx/Google Slides deck for stage; demo and source links; table number. "Every partner will determine judging criteria." [V for 2024, **U for 2026**: confirm on the Junction Platform submission form tonight].
- 2024 pitching page ([Pitching](https://junctionhq.notion.site/Pitching-21bfe4c81be94571a9cda396a3897a9f)): exactly 3 min on stage, mics cut at time, everything (demos, videos) must be inside the submitted slides, you do not show slides from your own laptop, one person on stage advised. [V for 2024]. The 2026 final ceremony has "top 5 pitches" [V]; assume the same constraints and **embed the demo video in the deck**.
- Rule of thumb: build the video at 2:45 so it never hits the cut.

## 3. Past winners, what they did

Main prize winners (Wikipedia table, [V](https://en.wikipedia.org/wiki/Junction_(hackathon))): 2022 Bitter Sweet, 2023 Driving Change "In the Blink for Safety", 2024 BREAKDANCE (Frank Sandqvist, solo), 2025 WAVELET. Track-winner lists per year are **not in any single public source I found** [U]; the Junction challenge archive lists challenges and prizes, not winners ([archive](https://www.hackjunction.com/challenges)).

| Year | Winner | What it was | Takeaway |
|---|---|---|---|
| 2022 | Bitter Sweet | App "Haru": the AI draws a picture from your diary entry; also won the Google Cloud side challenge; EUR 10,000 ([Newsis](https://mobile.newsis.com/view_amp.html?ar_id=NISX20221113_0002083845), [team write-up](https://blog.kshgroup.kr/junction-asia-2022-review)) | Emotional, simple to explain, plus a sponsor side prize in the same weekend. They also chose the track strategically (aimed at a track win first). |
| 2023 | In the Blink for Safety | Name only; I could not verify the content [U] | n/a |
| 2024 | BREAKDANCE | Solo; per Junction's own profile of Frank Sandqvist, an "AI-driven inventory management app that gamified equipment reporting", EUR 10,000. The profile does not name the project BREAKDANCE, so the link is [I] ([Junction blog](https://www.hackjunction.com/blog/frank-sandqvist-story)). His tips: "Make something that makes you truly excited"; "have the final product look clean and realistic in the presentation, present it in an interesting and fun way". | Gamification plus polish beat team size. |
| 2024 | (format) | Top 10 teams present on stage, EUR 20,000 split across the top 5, public vote exists ([jemlap blog](https://www.jemlap.fi/blog/junction-2024)) | Format changed again for 2026 (top 5, grand jury). |
| 2025 | WAVELET | Real-time electromagnetic simulation in C++/OpenGL, Maxwell's equations on GPU compute shaders ([Wikipedia](https://en.wikipedia.org/wiki/Junction_(hackathon))). Prize pool 50k+, grand prize EUR 10,000, peer review plus live top pitches ([platform](https://eu.junctionplatform.com/events/junction-2025)). 291 projects, 18 challenge winners, 11 tech-challenge winners ([Junction Instagram](https://www.instagram.com/p/DRMXXM1jxr1)). | A purely technical, visual, hard-to-fake build won. Depth and "how did they do that" beat a business story. |
| 2025 | DroneStalker (top 5) | YOLO drone detection, LSTM path prediction, a "game-like mission voiced by ElevenLabs with Gemini as your commander"; open source; top 5 of 300 teams; top 5 got a Google Legends Day ([write-up](https://codya.dev/project/2511-junction)) | Gemini as a character in the experience, not a chat box, got a top-5 and a Google event. Closest precedent to our Gemini coach. |
| 2025 | ApprenticeCircle+ (Aalto challenge winner) | Connects generations and preserves cultural skills ([Aalto](https://www.aalto.fi/en/news/aalto-students-and-researchers-shape-together-how-we-age-with-ai-at-junction-hackathon-2025)) | **Name and theme overlap with ours.** Expect a judge or mentor to mention it. Differentiator: we teach motion, theirs is intergenerational AI companionship [I]. |
| 2025 | Granlund x KONE winners (2024 edition) | Twin brothers; jury: "demo worked best and was developed furthest"; AI used lightly, user kept control, same input gives same output ([Granlund](https://www.granlundgroup.com/news/junction-hackathon)) | A working demo and deterministic behaviour won a partner track. Matches our "scoring is not the LLM" rule. |

Hardware precedent: the Junction archive shows IoT and Hardware as a standing track (Suunto Movesense 2017, Harvia "Sauna Intelligence" 2025 with EUR 1,500 + 1,500) ([archive](https://www.hackjunction.com/challenges)); a Junction sauna hardware team has been profiled ([Aalto](https://aalto.fi/en/news/winning-team-hack-the-sauna-experience-to-a-new-level-at-junction)). I could not find a published demo video for any Junction winner on a quick pass [U]; Junction posts an aftermovie only.

Pattern across winners [I]: (a) one clear sentence of what it is, (b) something that visibly works live, (c) a polished look, (d) one memorable "wow" mechanic (a drawn diary, a gamified report, a live simulation).

## 4. Rokoko: what they say they want

- Positioning has moved from animation to robotics: "Rokoko builds motion capture technology for robotics and 3D... teleoperation, robot control, data collection and training" ([LinkedIn](https://linkedin.com/company/rokoko)); IROS 2026 presence ([Rokoko](https://www.rokoko.com/mocap/iros-2026)); a robotics hub with hand integrations (BrainCo, Robotis, Tesollo etc.) ([robotics](https://www.rokoko.com/use-cases/robotics), [BrainCo](https://www.rokoko.com/robotics/brainco-hand)).
- Their showcase for Smartgloves II: a YAAK.ai engineer who teleoperated a robot arm with gloves plus Coil Pro, collected 221 demonstrations and trained a policy; "non-expert teammates could contribute usable demonstrations after a short familiarization" ([Rokoko case study](https://www.rokoko.com/insights/collecting-robot-training-data-with-rokoko-smartgloves), [author's blog](https://parsam.io/gloves)). Our "expert records, others train" is the human-side mirror of that story, and the recorded take is the same kind of demonstration data [I].
- Rokoko's own Junction blurb stresses "new ways to interact with software" and "experiences driven by real movement" ([Instagram](https://www.instagram.com/p/Dfhfv38nPYo)), so interactive, game-like and creative uses are in scope, not only robots.
- Facts to respect: Smartgloves II has **no haptics** (so our ESP32 motors are our own add-on, say so) and absolute position needs Coil Pro; spec up to 83 Hz, IMU+EMF, 7 sensors per glove ([robotics FAQ](https://www.rokoko.com/use-cases/robotics), [product](https://www.rokoko.com/products/smartgloves-ii)). Device SDK supports ROS 2, Isaac Lab, OpenXR and TCP ([robotics](https://www.rokoko.com/use-cases/robotics)).
- Past Rokoko hackathon challenges and winners: **none found** [U]. What exists are Rokoko animation contests (Love at First Move, USD 39,000 pool; ROKOKO TV Intergalactic) that reward polished creative output ([Love at First Move](https://www.rokoko.com/animation-challenge-winners/love-at-first-move), [Intergalactic](https://www.rokoko.com/es/animation-challenge/rokoko-tv-intergalactic)). Weak evidence that Rokoko likes a showy, creator-friendly result [I].

## 5. Likely competition on the Rokoko track

No public list of 2026 projects exists [U], so this is informed guessing [I], based on what the gloves and the Rokoko pitch invite:

| Idea | Likelihood | Weakness we exploit |
|---|---|---|
| Robot hand or arm teleoperation (LeRobot arms are in the Hardware Lab, [2026 site](https://2026.hackjunction.com/)) | Very high, it is Rokoko's own showcase | Needs working robot plus calibration; demos fragile; no teaching loop |
| Sign language recognition or translation | High | Classic, crowded, accuracy claims hard to verify in 2 minutes |
| VR or game control (gesture controller, air guitar) | High | "Cool toy", no problem worth solving |
| Piano or music with gloves | Medium | Often just playback; no per-finger error |
| Rehab or physio tracking | Medium (Healthcare track overlap) | Usually a dashboard, no live coaching or finish line |
| Dexterous data collection for robot learning | Medium | Pitch to Rokoko, weak for consumer judges |
| Gesture-driven UI for Gemini or agents | Medium (DeepMind overlap) | Thin wrapper |

How we stand apart [I]: we are the only one likely to combine (1) a two-sided workflow (expert records, learner trains) that explains why gloves matter, (2) a live moment judges can feel (strings turning vermilion on the wrong finger, a rally against a bot) and (3) scored, repeatable, deterministic feedback. Risks: the platform can read as "too many features", and the AI coach is rewording, not scoring (PITCH.md already says this).

## 6. Ten ranked actions to win track prizes

Ranked by expected prize value per hour. Effort: S under 1 h, M 1 to 3 h, L over 3 h. Days left: Sat and Sun morning only; final submission is Sun 10:00.

1. **Get the exact Rokoko and DeepMind criteria and prizes from the mentors today, and rewrite the Devpost/Platform description to quote their words.** (S) Both tracks have no public text; every other action depends on it. Sources above.
2. **Record the 3-minute video early (Sat night) and submit it in the Friday-night preliminary slot if the platform accepts a draft; keep a final take for Sun 09:00.** (M) A strict 3:00 limit and a hard Sun 10:00 deadline are where teams lose. See `docs/ideas/VIDEO_SCRIPT.md`.
3. **Open the video and the talk with the live wrong-finger moment, and keep the first 15 seconds free of slides.** (S) Peer review is face to face at the table; the first impression decides the top 5. Grand jury wants "a real user problem" and "something people want to come back to".
4. **Make Gemini visible in the product, not in the README: one persistent coach panel with the Gemini badge, the live line "late by 120 ms, ring finger too curled", plus the lesson-from-one-sentence beat.** (M) DroneStalker used Gemini as an on-screen character and reached the top 5 and a Google event ([write-up](https://codya.dev/project/2511-junction)). Keep the "algorithm scores, Gemini explains" sentence. Say Gemma offline only if tested.
5. **Pick one hero skill and make it flawless (piano play-along, or the table tennis rally), with the other as a cut-in.** (L) Winners like WAVELET and Granlund's pick won on depth and "developed furthest" ([Granlund](https://www.granlundgroup.com/news/junction-hackathon)). Do not demo the duel unless it has passed three clean runs.
6. **Enter the Arduino Hardware track with the ESP32 buzzers and the Uno Q scoreboard as visible on-table hardware, with a 10-second shot in the video.** (M) Hardware track by Arduino plus a Hardware Lab with UNO Q boards ([2026 site](https://2026.hackjunction.com/)); the Uno Q is the board they are pushing, and the scoreboard is a "look at the table" prop. Confirm on the platform that a team can enter both a partner track and Hardware [U]; the site says tech challenges run alongside any track, tracks themselves are less clear.
7. **Claim the Healthcare angle with one rehab line and one rehab lesson (finger extension exercise), without clinical claims.** (S to M) Healthcare is a listed track and rehab is a natural extension. Keep "never say clinically proven" (JUDGE_QA #25). Only enter if you can show one real exercise lesson.
8. **Enter tech challenges that need no extra build: Verda "Best use of Verda" (10,000 EUR credits to winner, 2,500 each to 2nd and 3rd) if any component can run on Verda, and Google Cloud/Gemini side challenge if the platform lists it.** (S to M) [Verda blog](https://verda.com/blog/junction-2026): you qualify "as long as you solve any challenge... by using any of Verda's services" and you "document your process". Past Google Cloud side challenges paid in swag or small prizes ([archive](https://www.hackjunction.com/challenges)), so low money, high ease. Verify others (OpenAI, Modal, Exa, Cloudinary) on the platform challenge list before spending time [U].
9. **Pre-empt the "ApprenticeCircle+" and "any camera app does this" questions with two prepared answers.** (S) 2025 had an Aalto challenge winner named ApprenticeCircle+ ([Aalto](https://www.aalto.fi/en/news/aalto-students-and-researchers-shape-together-how-we-age-with-ai-at-junction-hackathon-2025)). Answer: "different thing, we teach motion". For cameras: "a camera cannot see which finger under a racket" (PRODUCT.md).
10. **Open-source hygiene and a clean public repo with a 20-line README, screenshots and a "how we use Rokoko / Gemini / Arduino" table before Sun 10:00.** (S) MIT licence applies anyway ([FAQ](https://2026.hackjunction.com/)); partners read repos when picking track winners ([I], 2017 judging reviewed code repos per [Wikipedia](https://en.wikipedia.org/wiki/Junction_(hackathon))). Remove secrets and any invented numbers.

## 7. What not to do

- Do not claim "first ever" (research/04 prior art, PITCH.md).
- Do not show earnings, users or prices as real (PRODUCT.md).
- Do not rely on Gemini live on stage; keep the pre-generated lesson.
- Do not build a new feature after Sat 22:00; only reliability and the video.
