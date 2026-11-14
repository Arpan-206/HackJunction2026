# Backlog

Priority: P0 must land for the demo, P1 strongly improves it, P2 nice to have, P3 only if everything else is done. Estimates are for one developer.

## Before demo (hackathon, Sat 14 to Sun 15 Nov)

### P0
- Claims fix pass over PITCH and Q&A (no tolerance-from-variance, calibration claim limited to range normalisation, no offline-as-fact): 30 min
- Gemini timeout (8 s then fake fallback, landing): 30 min
- Full click path rehearsed end to end on real gloves and on the simulator (DEMO_RUNBOOK): 1 h
- Pre-generated lesson JSON and a screen-recorded fallback video of the full demo: 1 h
- Rokoko UDP source verified with both gloves, calibration ritual written and practised: 1 h
- Pitch script rehearsed three times with timing (PITCH.md): 1 h
- Gemini provider key confirmed, `provider` badge visible on the hint and lesson screens: 30 min
- Dev panel hidden by default, `?dev=1` only: 15 min

**Hard cut line: stop after 4 to 6 hours of P1 work. Everything below the cut is a roadmap mention in the pitch, not a build.**

### P1
- Gemma offline toggle (ops only) plus standalone Gemini video to lesson (GOOGLE_TRACK): 1.5 h + 4 h
- Optional browser `speechSynthesis` on the hint (polish only, not Gemini evidence): 1 h
- Provider badges already exist (`TrainingRoom.tsx`, `GenerateSteps.tsx`); only add an offline label: 15 min
- Frontend card for `POST /api/coach/plan` (endpoint built, fake provider tested): 2 h
- Video lessons MVP, beside mode only (VIDEO_LESSONS): 6 h
- Master heatmap of where learners fail per step: only with real attempt data; otherwise cut it or label it clearly as sample data: 2 h
- Score screen polish for projector readability (big numerals, one tip): 1 h
- Table tennis duel (already built, `TableTennisRally.tsx`): 20 s hold test on real gloves: 20 min

### P2
- Frontend input for `POST /api/motion/from_text` (endpoint built, fake provider tested): 1.5 h
- `GET /recordings` list endpoint for the ML teammate: 30 min
- Move classification baseline (DTW kNN) and `POST /ml/classify`: 3 h
- Piano play-along polish (paper keyboard, fixed one-key-per-finger mode): 4 h
- Arduino Uno Q scoreboard over serial or HTTP: 3 h
- Haptic bands from ESP32 with early cue scheduling: 4 h

### P3
- MediaPipe overlay mode on video (wrist anchor): 4 h
- A2UI generative course page (GOOGLE_TRACK 5): 6 h
- Stripe test-mode checkout for lessons: 3 h
- Learner and master accounts: 4 h
- Verification badges pipeline (take-to-take DTW consistency, auto-verified): 4 h

## After hackathon

### P0 (first month)
- Pilot with 2 to 3 real teachers (piano, table tennis, physiotherapy) and 10 learners: 2 weeks
- Replace placeholder data with real measurements and remove all invented figures: 1 week
- Privacy basics: consent, local-first storage, deletion: 1 week
- Confirm glove retail price and loan options to understand learner cost: 2 days

### P1
- Real storage and auth (Postgres/Supabase, object storage for video): 2 weeks
- Expert-verified and Learner-proven badges workflow: 2 weeks
- Skill-module SDK so third parties add a new skill without touching core: 2 weeks
- Calibration normalisation in scoring: DONE (per-joint flat-to-fist range, mapped to the reference). Next: validate on several wearers: 1 day
- Rokoko Device SDK source (raw IMU, 83 Hz): 1 week
- Quality model calibrated against master ratings: 3 weeks

### P2
- Mobile viewer for videos and progress: 3 weeks
- Subscription and marketplace payments, platform fee tests: 3 weeks
- Accessibility audit (colour blindness, single-hand mode, tremor): 1 week
- Multilingual coaching (Gemini, Finnish and English first): 1 week

### P3
- Webcam fusion with ArUco markers for absolute position: 2 weeks
- Haptic hardware product design (bands or glove-integrated): months

## Business ideas (post-hackathon)

- **Rehab clinics**: hand therapists prescribe exercises, the glove measures range of motion and adherence at home, the clinic sees a report. Needs regulatory advice before any clinical claim. Hardest, highest willingness to pay. (Prior art: stroke virtual piano studies, research/04.)
- **Music schools**: fingering coach as a classroom tool; teachers see per-student finger errors across a class. Sells seats.
- **Sports academies**: table tennis, golf grip, climbing grip; coach library with progress tracking.
- **Craft and trade training**: not suitable for knot, suture or pottery work without force data (research/02 advises against).
- **Robot teleoperation training data**: every verified master recording is labelled human hand motion; Rokoko already publishes a case study collecting 221 demonstrations for robot training. Sell curated datasets or a collection tool to robotics labs. Strategic fit with Rokoko.
- **Creator marketplace**: masters publish and earn; platform takes a fee (undecided).
- **Esports and dexterity games**: left vs right duels, rock-paper-scissors reaction; a consumer funnel.

Caveat: none of these has been validated with customers; every figure and name must stay marked as a placeholder until it has.
