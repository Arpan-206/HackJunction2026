---
name: stage-target-ignored-without-controls
description: HandCanvas with stage controls 'none' ignores the preset target (camera looks at world origin); hand origin is the wrist, not its centre; canvas clocks are per canvas
metadata:
  type: project
---

Symptom: a hand floats off its ring in a fixed-camera card scene. Cause: `Stage` only applies `target` through OrbitControls, so with `controls: 'none'` the camera looks at (0,0,0); and `Hand` position is the wrist (fingers reach z -2.2, centroid about (0.4, -0.26, -1.0) at rest-ish motion).

How to apply: in fixed-camera scenes aim the camera yourself (`camera.lookAt` in a child component), offset the hand by its measured centroid, and use a shared wall clock (`performance.now()`) via `getFrame` plus own sway if two canvases must stay in sync (each R3F canvas has its own clock that starts at mount and stops when scrolled out of view). The finger_sequence press is only 42% of each beat, so sequence screenshots need dense spacing to catch it.
