---
name: synth-breathing-global-clock
description: Reference synthesiser breathing must be periodic in the motion period, else phase-locked simulator attempts score random timing lag
metadata:
  type: project
---

Symptom: moving steps (swing, piano scale) fail on timing randomly in the real-backend e2e. Cause: `_flexion` breathing used absolute t, the simulator emits on a global clock while the scorer synthesises the reference from t=0. Fix: breathing is -cos with a whole number of cycles per motion period (backend synthesiser.py, mirrored in frontend/src/mock/synth.ts). The cosine phase matters: plain sin cancelled the swing squeeze and dropped its finger range to about 11.6 deg, under STATIC_REFERENCE_RANGE_DEG (12), so timing stopped being scored.

Trap: learner-real.mjs shares one global simulator motion and a CPU-starved headless browser; concurrent agents' e2e runs cause idle-hand reps and sparse frames (timing 220-250 ms early). Re-run when quiet before blaming scoring.
