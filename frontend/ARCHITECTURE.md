# Architecture and rules

## Folder map

```
src/
  main.tsx                 providers, fonts, global CSS, DevPanel
  app/                     App (route table), AppShell (lapis rail), RoleSelect (/), HandLab (/lab), app.css
  features/
    master/                MasterHome (/master) + placeholder pages: scratch, generate, lesson studio
    apprentice/            skills/ (dashboard, skill page, catalogue), course, training (score/ = 3D and flat score views), test
    shared/                pieces both sides use: assistant.ts (AI Assistant flag), settings.ts (margin, score view,
                           reduced motion), SettingsDialog (the Settings panel), sessionPrefs, PropSwitch, calibration,
                           gloves/ (/gloves, /gloves/calibrate), robot/ (RobotScreen /robot, TeachRobot on the skill
                           page, RobotStage, logic)
  components/
    ui/                    UI kit: Button, ButtonLink, Card, Badge, Stepper, Countdown, RecordButton, Tabs, Field, TextArea, Toast
    PageHeader.tsx         standard screen header
    ThemeSelect.tsx
    Placeholder.tsx        stand-in for unbuilt screens
  three/                   3D system (see below)
  api/
    types.ts               wire types, mirror of docs/CONTRACT.md
    margin.ts              margin of error multipliers, mirror of backend/app/constants.py
    client.ts              typed fetch wrapper `api.*`, ApiError
    useGloveStream.ts      shared auto-reconnecting /ws/gloves
    useRobotStream.ts      shared auto-reconnecting core /ws/robot (VITE_CORE_URL), browser retarget fallback
    robotTypes.ts          /ws/robot wire shapes (the core's schema/robot.json, not CONTRACT.md)
    hooks.ts               useLessons, useLesson, useMoves, useDevState
    useAsync.ts            abortable request hook
    schemas.ts             optional zod validators
  theme/                   themes.ts (ids, stage colours), ThemeProvider, theme.css (tokens)
  state/settings.ts        local UI prefs (guidance mode), useSettings()
  dev/                     DevPanel (delete before the demo)
public/textures/wood/      CC0 wood maps + SOURCE.md
public/models/hands/       skinned hand mesh (WebXR generic-hand, MIT) + LICENSE.md
public/models/robots/      Dex3-1 URDFs, copies of the root models/robots (BSD-3) + LICENSE.md
docs/screens/              reference screenshots
```

Routes are defined once in `src/app/App.tsx`. Feature agents replace the page components and keep the paths.

## Rules

1. Types only from `src/api/types.ts`. Do not redeclare contract shapes. If the contract changes, change `docs/CONTRACT.md`, the backend schemas and `types.ts` together.
2. Network only through `api.*` or the hooks in `src/api`. Surface `ApiError` messages to the user (Toast or inline), never swallow them. The backend may be down: screens must still render (use `synthFrame` preview motions for guide hands).
3. Use the UI kit (`components/ui`) and `PageHeader`. Do not hand-roll buttons, inputs or cards. Targets are at least 44 px; focus rings are gold and global.
4. Style only with the semantic CSS tokens from `theme/theme.css` (`var(--surface)`, `var(--text)`, `var(--accent)`, ...). No raw hex in components, so all three themes keep working. Gold is only for verified or mastery, vermilion (`--danger`) only for corrections, malachite (`--ok`) only for correct.
5. Type: Cinzel (`--font-display`) for titles and big numerals, EB Garamond italic (`--font-note`, class `.note`) for annotations and captions, Alegreya Sans (`--font-ui`) for UI. Design for a projector at 3 m: large type, big state.
6. 3D: use `HandCanvas` and the components exported from `src/three`. No per-frame `setState`: anything that changes at frame rate goes through refs (`useGloveStream().latest`, `live`, `getFrame`, `useFrame`). Subscribing with `onFrame` is fine for non-React consumers (scoring, recording buffers).
7. Never create a second WebSocket; use `useGloveStream` (it shares one connection). The one other socket is the core's `/ws/robot`, through `useRobotStream` (also shared).
8. No em dashes anywhere. UK English in docstrings. Comment the why, not the what.
9. New screens live in `features/master/` or `features/apprentice/`. Shared pieces go in `components/`; anything 3D goes in `three/`.
10. Learner settings live in `features/shared/settings.ts` (localStorage, try/catch on every access) and are edited only in the Settings panel. Anything that judges a rep reads the margin of error: send `margin` to the scorer and build live bands with `configFromTolerance(tolerance, margin)`.
11. Motion: respect `prefersReducedMotion()` from `features/shared/settings.ts` (the learner's choice or the device's) for anything animated in script; CSS transitions are already cut by `data-reduce-motion` and the media query.

## three/ overview

- `Hand.tsx`: the hand (props below). `handModel.ts` loads the shared skinned mesh (`public/models/hands/right.glb`, MIT), `handPose.ts` holds the bone layout and the flexion-to-bone maths, `handRig.ts` builds one instance, `materials.ts` styles it, `smoothing.ts` smooths input, `motion.ts` previews MotionSpecs locally (the backend owns the canonical synthesiser).
- `Stage.tsx`: `HandCanvas` (Canvas + theme bridge + `Stage` + presets) and `Stage` (carta azzurra background, lights, drafting grid, construction circle, contact shadow, limited OrbitControls).
- `props.tsx`: `Racket` (child of Hand), `Keyboard`.
- `overlays.tsx`: `JointRings`, `FingertipTrails` (also reachable through `Hand showJoints showTrails`).
- `stageContext.ts`: `useStageColors()`.
- `robot/`: the robot twin. `urdf.ts` reads a URDF (tag scanner, no DOMParser), `kinematics.ts` holds the joint frames, forward kinematics and the URDF-to-hand-space turn (`ROBOT_SCALE` 12, the same as the hand), `model.ts` loads the Dex3-1 files once, `RobotHand.tsx` draws the automaton (walnut segments, brass pins, ink hull, dotted ghosts for missing fingers) from joint targets in a ref, `MarionetteStrings.tsx` joins human and robot fingertips (taut while engaged, sagging when released, loose for missing fingers).

Hand space: right hand, palm down, fingers along -z, y up, thumb towards -x. An identity `wrist_quat` shows that rest orientation. Left hands are mirrored.
