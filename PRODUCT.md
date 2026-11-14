# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + Three.js web app (Vite, React, react-three-fiber). A Python backend (FastAPI) receives Rokoko Smartgloves II data and streams it to the browser over WebSocket. Shown on a laptop driving a big screen or projector.

## Users

- **Primary: masters (creators).** Experts in a hand skill (pianists, table tennis coaches, later rehab therapists, guitar teachers) who record a lesson once with smart gloves and earn from every learner who trains against it. Their job: capture their technique faithfully, get it verified, publish it, and see where learners struggle.
- **Secondary: learners.** People who buy a lesson, put on the gloves and train against the master with a ghost hand, fingertip haptics and scores.
- **Demo audience:** Junction 2026 judges (Rokoko Smartgloves track) watching on a big screen, some of whom will wear the gloves.

## Product Purpose

Geppetto is a platform for teaching any hand skill from an expert. Hand skills are normally taught in person, one learner at a time. Geppetto lets a master record a skill once and lets anyone train against it with feedback on exactly which finger is wrong. Success: a learner measurably improves across attempts, and a master can publish a verified lesson and earn from it.

## Positioning

Cameras see a hand and microphones hear notes; neither knows which finger did what, how hard, or at what angle, especially when the hand is hidden (a racket grip). Geppetto is built on glove data, so it scores fingering, grip, wrist angle and timing. It is a platform with one generic teaching workflow (capture, verify, publish, learn, score, progress) and pluggable skill modules, not a single-skill app.

## Operating Context

- Hardware: Rokoko Smartgloves II (one pair; left and right glove can be two players), 2x ESP32 driving fingertip vibration motors, Arduino Uno Q as a lesson station and LED-matrix scoreboard, a webcam with ArUco markers on the glove hubs.
- Example skill modules: Table Piano (paper keyboard on a real table, fingering coach) and Table Tennis (real racket, grip and wrist snap, two-player duel).
- Use scene: a person standing or sitting at a table in front of a large screen, wearing gloves, hands busy. The screen must read from 1 to 3 m away.

## Capabilities and Constraints

- Gloves give finger joint rotations and wrist orientation at about 60 to 83 Hz, about 20 ms latency. No absolute hand position without a webcam or Coil Pro.
- Workflow: Capture (calibrate, 3 to 5 takes, auto-split steps), Verify (consistency check, badges Auto-verified, Expert-verified, Learner-proven), Publish (price, level), Learn (ghost hand vs live hand, checkpoints, haptic cues that fade), Score (0-100 with per-finger and per-step breakdown), Progress and earnings.
- Payments are Stripe test mode in the demo. Undecided: platform fee, pricing model.

## Evidence on Hand

- Research in `research/00_plan.md` to `research/04_wow_demos.md`.
- No real masters, testimonials, user counts, prices or earnings exist yet. Designs must use clearly marked placeholders, never invented figures presented as real.

## Product Principles

1. Show what only gloves can know: every screen should surface finger-level, grip or wrist data a camera could not.
2. One workflow, any skill: skill-specific views plug into shared capture, verify, learn and score flows.
3. Masters first: the creator's capture and insight tools are the heart of the supply side.
4. Readable at a distance, operable with busy hands: big type, big state, minimal mid-task clicking.
5. Feedback that teaches, then steps back: live cues fade, a score always follows.
