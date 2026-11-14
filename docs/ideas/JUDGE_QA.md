# Judge Q&A: 27 hard questions

Flag key: **[VERIFIED]** grounded in our research or code. **[UNVERIFIED]** depends on something we have not confirmed; say so honestly, do not bluff.

## Rokoko

1. **What does this do that Rokoko Studio does not?**
Studio captures and streams pose. We add the teaching layer on top: calibration capture, takes scored against a per-step tolerance the master sets by hand, per-finger DTW scoring and fading feedback. We use Studio's output as a developer platform. [VERIFIED: Custom Streaming carries pose only, research/03]

2. **Can one pair of gloves really be two players?**
Each glove is its own device with its own hub, so in the SDK it is two hands. We route left to player 1, right to player 2 ourselves. We use Studio UDP, and the two-player rally (left vs right glove) is built (`TableTennisRally.tsx`). Whether Studio can pair them to two actors is undocumented; our setup is one actor, two wearers. [VERIFIED built; UNVERIFIED Studio pairing until tested on real gloves]

3. **How accurate and fast is the data?**
About 60 to 83 Hz, about 20 ms latency. Studio streaming has no IMU, so we cannot measure peak swing speed; we use timing and rotation tiers. [VERIFIED, research/01, 03]

4. **Why not use raw IMU from the SDK?**
We use Rokoko Studio UDP, not the SDK. The `rokoko_sdk` stub exists (returns 501) because the SDK needs a licence (`rokoko_sdk.py`). [VERIFIED; UNVERIFIED whether a key was granted]

5. **How does this relate to Rokoko's robotics push?**
Every master recording is clean, labelled hand-motion data, the same kind Rokoko collects for robot teleoperation training (their case study has 221 demonstrations). We position it as a post-hackathon data business. [VERIFIED: Rokoko page cited in research/03]

6. **What about hand position, since gloves have none without a Coil Pro?**
Position is `null` in the contract unless a webcam (MediaPipe) or Coil Pro supplies it. We never claim absolute position from the gloves alone. [VERIFIED]

## Google DeepMind

7. **Where exactly do you use Gemini?**
Gemini Flash generates validated lesson JSON from natural language (structured output with the Lesson JSON schema), rewords coaching hints, and (built, fake provider tested) `POST /api/coach/plan` writes a practice plan from attempt scores and `POST /api/motion/from_text` turns text into a `MotionSpec`. Fallbacks: Gemma 4 on Verda, then a deterministic fake. [VERIFIED in code: providers `gemini`, `ollama`, `fake`]

8. **Is the LLM scoring the learner?**
No. Scoring is deterministic (per-finger angle error, tolerance, timing). The LLM only explains. This is deliberate so scores are fair and reproducible. [VERIFIED]

9. **Why Gemma and not only Gemini?**
Offline, no key, no latency, privacy of body data. Gemma 4 runs on Verda, our own GPU endpoint, as the fallback behind Gemini. Needs the Verda endpoint up in advance. [VERIFIED for existence, research/05; UNVERIFIED for demo-day speed on our laptop]

10. **How do you stop the LLM hallucinating invalid lessons?**
Structured output with a JSON schema, then pydantic validation, retry up to two times with errors fed back, then fall back to a template. [VERIFIED in CONTRACT.md]

11. **Could Gemini watch the master's video and build the lesson?**
Yes, that is the planned multimodal extension (see GOOGLE_TRACK.md). Not built unless it says so in the demo. [UNVERIFIED as shipped]

12. **Is there a DeepMind-specific brief you target?**
We could not find a public one. We asked at the workshop. [UNVERIFIED]

## Business

13. **Who pays?**
Learners pay per lesson or subscription; masters earn a share; institutions (clinics, schools) pay seats. All prices are placeholders; Stripe would be test mode. [VERIFIED: PRODUCT.md says undecided]

14. **How many users or revenue do you have?**
None. No real masters or testimonials yet. We have a working prototype and a research basis. [VERIFIED honesty]

15. **Why would a master record for you?**
Earn passively, see where learners fail (per-step heatmap), and keep their technique alive. Needs a pilot with two or three real teachers. [UNVERIFIED demand]

16. **Why would a learner buy gloves?**
Today they would not, for hobby learners. First markets are institutions that already buy hardware: rehab clinics, music schools, sports academies. Glove price is a real barrier. [UNVERIFIED glove retail price; check before saying a number]

17. **What is the moat?**
Verified, labelled finger-level motion data, per-skill modules, and the creator network. Camera-only competitors cannot see finger-level data under occlusion. [VERIFIED reasoning, research/04]

## Technical

18. **How do you score a learner fairly across hand sizes?**
Calibration (flat and fist) is captured per user and applied in scoring when the learner has calibrated: each joint is normalised by the learner's own flat-to-fist range and mapped into the expert's range, so a stiffer or smaller hand is not penalised for range alone (`backend/app/services/scoring.py`, tests in `tests/test_scoring.py`). Incomplete calibrations are ignored with a warning. Tolerance defaults to 18 degrees and 250 ms and is set per step. [VERIFIED in code and tests; say "range normalisation", not "hand-size modelling"]

19. **What is the DTW or timing approach?**
Per-finger Sakoe-Chiba banded DTW, then per-finger score `100*exp(-0.5*(err/(1.5*tol))^2)`; overall weights fingers 0.8 and timing 0.2 (`scoring.py:41-101`, `constants.py:96-102`). [VERIFIED]

20. **How do you keep the hand from jittering?**
One Euro filter per joint angle, normalised-lerp on the wrist quaternion, small deadband; tunable live in the dev panel. [VERIFIED]

21. **Does the learning science hold up?**
Observational learning of a model improves movement dynamics; fading feedback avoids dependence (guidance hypothesis). Evidence is mixed for concurrent feedback, which is why ours fades. Slow-motion benefit is unproven. [VERIFIED research/02]

22. **Latency of haptics?**
Motion to buzz about 60 to 130 ms; we cue early because the lesson is known in advance. Reactive error buzzes pay the full delay. Haptics may not be in the demo. [VERIFIED research; UNVERIFIED hardware status]

## Ethics and accessibility

23. **Privacy of body data?**
Hand motion is biometric-adjacent. Plan: local-first (Gemma offline), explicit consent for masters, no sharing of learner data. Not implemented today. [UNVERIFIED as built]

24. **Does this replace teachers?**
No. It multiplies them: the master teaches thousands, and sees where learners fail. A teacher's judgement still verifies lessons (Expert-verified badge). [VERIFIED product principle]

25. **Accessibility: who can use it?**
Target large type for 3 m reading, 44 px targets, and colour not as the only signal (check vermilion/malachite pairing for colour blindness). Strong use case: stroke and hand-injury rehab, and a single-hand mode. Users without hands or with tremor need different calibration; unvalidated. [VERIFIED design rules; UNVERIFIED clinical claims, never say "clinically proven"]

26. **Is this live or simulated?**
Be honest: the simulator is for development, ClumsySim (a deliberately clumsy simulated learner) demonstrates guidance feedback reproducibly, and real gloves run through Rokoko Studio UDP. Say which one is on screen. [VERIFIED]

27. **What does Gemini add if the fake provider gives the same demo?**
The fake provider is deterministic templates. Gemini adds free-text lesson generation, a practice plan from attempt scores (`/api/coach/plan`), text to motion (`/api/motion/from_text`), and video to lesson if built. The coach hint is rewording only; do not oversell it. The new endpoints are tested with the fake provider only. [VERIFIED scope; UNVERIFIED Gemini quality live]
