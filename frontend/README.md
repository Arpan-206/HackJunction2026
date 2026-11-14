# Apprentice frontend

Vite + React 18 + TypeScript (strict), react-router-dom, three + @react-three/fiber + drei, zod. Renaissance bottega design language (lapis, lime plaster, carta azzurra, gold leaf).

## Run

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api and /ws to http://localhost:8000
npm run build    # tsc -b && vite build
npm run lint
```

Developer panel: renders only when switched on. Open any page with `?dev=1` to show it. The flag is remembered for that browser tab only (sessionStorage key `apprentice.flag.dev`), so a new tab or a new session starts without it; `?dev=0` clears it at once. The old sticky localStorage key `apprentice.devpanel` is deleted on sight. The same flag shows the "Load demo history" button on the learner dashboard and the clumsy-apprentice switch in the training room's settings. The panel docks as a small tab on the right edge, and it also holds the theme switch. `VITE_DEV_PANEL` no longer forces it on.

`/lab` is a gallery of every hand style, pose, prop and grip camera. Use it when touching `src/three/`.

## Learner routes

- `/apprentice`: the dashboard. The Today panel, a skill search (press `/` to focus it, Escape clears it; the last query is kept in sessionStorage `apprentice.skillQuery` for the tab only), quiet Level and Hands toggles, then one card per skill. Live skills come from the lessons the API serves, grouped by `skill`; the rest are "In the workshop" and dimmed.
- `/apprentice/skills/:skillId`: one skill. A showcase replays lesson 1 and lesson 2 of its first course on the walnut bench, beside the description, level, hands, time to learn, one primary action ("Start lesson 1" or "Continue lesson N", to the training room), "Test your skills" when a course has a test, and the lesson list with progress from the practice log. Workshop skills say they are not teachable yet and have no start button.
- `/apprentice/lessons/:lessonId` (course page), `.../steps/:stepIndex` (training room) and `.../test` are unchanged. `/apprentice/skills`, `/apprentice/lessons` and `/apprentice/library` redirect to the dashboard.

The skill catalogue (names, descriptions, difficulty, keywords, hands, time to learn, key pose for the card still) lives in `src/features/apprentice/skills/catalogue.ts`, with the merge, the search filter and the per-skill progress as pure functions (`tests/skills.test.ts`). A lesson for a skill id the catalogue does not know shows up as a live skill with defaults. Card stills use the shared preview canvas (`HandPreview` with `decor`), so the grid costs one WebGL context.

## Structure

See `ARCHITECTURE.md` for the folder map and rules.

## Settings

"Settings" in the rail footer (`app/AppShell.tsx`; on a phone the last item of the bottom bar) opens `src/features/shared/SettingsDialog.tsx`: a modal dialog (focus moves in and is trapped, Escape or the scrim closes it, focus returns to the button, the app behind is `inert`). It holds the AI Assistant switch, the margin of error (four radio choices), the score view (3D scene or flat chart), "Add a prop" and "Reduce motion". `src/features/shared/settings.ts` stores them in localStorage (`apprentice.margin`, `apprentice.scoreView`, `apprentice.reduceMotion`; every read and write in try/catch) and exposes `useMargin`, `useScoreView`, `useReducedMotion` and `prefersReducedMotion()`. Reduce motion sets `data-reduce-motion` on `<html>`, which `styles/global.css` treats like the system preference. `e2e/settings-walk.mjs` checks the dialog, the switches, persistence, the margin on the score and the score flip at desktop and phone width.

## Margin of error

`src/api/margin.ts` mirrors `MARGIN_MULTIPLIERS` from the backend (strict 0.6, standard 1, relaxed 1.5, just_trying 2.5). The training room sends `margin` with every `POST /score`, builds the live coach band with `configFromTolerance(step.tolerance, margin)` (strings, fault rings, tints, tips, the match meter and the offline local score all read it), and shows the widened room for error. The score card says which margin judged the rep (`ScoreResult.margin`). `training/score/scoreRules.ts` keeps gold for mastery under the standard or strict margin only. The mock port (`mock/scoring.ts`, `mock/router.ts`) applies the same thresholds; `tests/mock-scoring.test.ts` pins margin values from the Python scorer and `tests/settings.test.ts` covers the store, the live band and the mock routes.

## Score views

`training/ScoreCard.tsx` shows the score through `training/score/ScoreView.tsx`: the 3D scene (`ScoreScene.tsx`, lazy loaded; the wooden hand on the bench, the overall score on a plaster plaque whose rule is gold only at mastery, each finger's score on a leader line, malachite when it held the shape and vermilion for the one correction) or the flat chart (`ScoreChart.tsx`, thick high-contrast bars with a tick at the clean mark 70). Settings picks which opens first; clicking, tapping, Enter or Space on the 3D scene flips it to the chart, and clicking the chart or "Show in 3D" flips back. Below 620 px the scene stacks its notes across the top and leaves out the plaque, so nothing covers the hand. The scene reuses `design/scene.tsx`, `design/Leaders.tsx` and `design/guild3d.tsx` from the round 3 prototypes, and falls back to the chart if WebGL fails.

## The AI Assistant switch

`src/features/shared/assistant.ts` holds one flag for every language-model feature (`useAssistant()` in components, `isAssistantOn()` elsewhere), stored in localStorage as `apprentice.assistant` and on by default. The switch is "Enable AI Assistant" in Settings; the rail footer shows "AI Assistant on" or "off" as plain text. While it is off, `api/client.ts` throws `AssistantOffError` for the paths in `ASSISTANT_PATHS` before any `fetch` or upload, and the mock router answers them with 403 as a second lock. Screens hide those entry points with a one-line note: Generate steps offers "Write the steps yourself" and "Start from scratch instead", "Describe the movement" becomes a note, and the plan card and the expert's note from the plan are hidden. `tests/assistant.test.ts` checks that no gated call reaches the network. In user copy the model is always "the AI Assistant"; provider names appear only in the dev panel.

## Hands and props

`src/features/shared/sessionPrefs.ts` keeps two stage preferences: whether props are drawn (`useShowProps`, off by default, switched by `PropSwitch` or in Settings, kept in localStorage) and, per session in sessionStorage, the expert's hands choice per move (`defaultHands`, `rememberHands`; the default is the move's catalogue `hands`, else the last choice, else one hand, right). `HandsControl` (expert studio, step editor and the record dialog) sets one hand left or right or two hands, collapses into a summary once a take exists, and the take is recorded with `hands`. The training room coaches one hand of a two-handed step at a time (the learner picks which) and scores both with one `/score` call per side (`training/coach/twoHands.ts`). The Test your skills scenes always draw their racket and keyboard.

## Themes

Three themes, switched at runtime with `<html data-theme="...">` and persisted in `localStorage` (`apprentice.theme`): `bottega` (default), `notte` (night hall), `affresco` (fresco).

To add a theme:

1. Add an id to `ThemeId` and an entry in `THEMES` in `src/theme/themes.ts`, including its `stage` colours (3D background, grid, chalk, ink, ghost, gold, vermilion, malachite, shadow, light colours) and picker swatches.
2. Add a `:root[data-theme='yourid']` block in `src/theme/theme.css` defining every token that the `bottega` block defines. Components only use semantic tokens (`--bg`, `--surface`, `--text`, `--accent`, `--rail-bg`, ...).
3. Add the id to the inline script in `index.html` so there is no flash of the default theme.

3D scenes receive the colours through `HandCanvas`, which bridges the theme into the R3F canvas (`useStageColors()` inside).

## Hand styles

`<Hand style=...>` in `src/three/Hand.tsx`. Every style draws the same single skinned hand: the WebXR Input Profiles `generic-hand` mesh (the hand WebXR hand-tracking viewers use), loaded once from `public/models/hands/right.glb` and shared by every instance. `handModel.ts` welds, reorients, subdivides and smooths it into hand space, closes the wrist in a tapered rounded end a couple of centimetres past the joint and raises the knuckles; `handPose.ts` rebuilds its 25 joints as a bone chain, maps the contract's flexion triples onto bone rotations about flex axes measured from the bind pose, and closes a pinch so the thumb and index pads meet (tested in `tests/handPose.test.ts`); `handRig.ts` makes one instance (bones, skinned mesh, skinned outline hull). Left hands mirror the right one. Poses are mutated in `useFrame`; nothing re-renders per frame. The hand appears once the model has loaded (`<Hand>` suspends on its own).

| style | use | look |
|---|---|---|
| `chalk` | master | toon-shaded chalk, inked skinned outline |
| `sketch` | expert codex | sepia toon shading with iron-gall hatching and a heavier ink outline |
| `wood` | apprentice | carved wood: CC0 ambientCG Wood049 colour, normal and roughness maps, grain running along the fingers |
| `ghost` | overlays | translucent, fresnel rim, fading out past the wrist; a depth pre-pass keeps only the nearest layer |
| `shadow` | shadow guidance | dark translucent silhouette (same pre-pass and fade) |

Per-finger tints (vermilion corrections, the gold focus finger) are uniforms read through per-vertex finger weights, so a tint stops at the knuckle crease. The hand lab's Anatomy tab (`/lab`, then Anatomy) holds open, fist, pinch, point, palm-up, two-hand and racket-grip poses for checking the hand; `node e2e/hand-shots.mjs <outDir> [prefix]` screenshots it and the design frames with hands.

Wood textures live in `public/textures/wood/` (source and licence in `SOURCE.md`). The hand model is MIT licensed, Copyright (c) 2019 Amazon, from the WebXR Input Profiles assets (`@webxr-input-profiles/assets`, https://github.com/immersive-web/webxr-input-profiles); the notice and the list of load-time modifications are in `public/models/hands/LICENSE.md`.

Pose input, in priority order: `getFrame(t)`, `live` (a ref to the latest GloveFrame), `frame`, `motion` (local preview synthesiser), then a relaxed rest pose. Frames pass through `HandSmoother` (exponential smoothing, time constant `tau`, default 45 ms, `smoothing={false}` to disable).

## Component playground

Open `/playground` (for example http://localhost:5173/playground; deep links such as `/playground#marionette` work) to play with every UI piece and the 3D hands. It needs no backend. The left list picks a section, the right panel holds plain React controls, and "Copy JSX" copies the current props as a snippet.

- Foundations: typography and colour tokens, with a live bottega, notte and affresco switch.
- Components: buttons, fields, tabs, stepper, countdown, record button, toast, card, page header.
- 3D: the Hand (style, motion preset and its parameters, beat, smoothing, joint rings, trails, focus finger, tint, opacity), stage presets with the racket and keyboard props, and the marionette guidance (real Strings, Crossbar and FaultMarks fed by a hand-made coach, with an error slider per finger).

Only the active section is mounted, so at most one WebGL context is alive. Code lives in `src/playground/`; the only outside edit is the lazy `/playground` route in `src/app/App.tsx`. Screenshots are `docs/screens/playground-*.png`.

## Mock mode (no Python backend)

Mock mode runs the whole app against an in-browser implementation of every route in `docs/CONTRACT.md`, so the product owner can test everything without starting the backend. It lives in `src/mock/` and works at the transport layer: `fetch`, `XMLHttpRequest` (video upload progress) and `WebSocket` (`/ws/gloves` only) are patched before the app renders, so no feature code knows about it.

Turn it on any of these ways:

- Open any page with `?mock=1`. This is remembered in localStorage; `?mock=0` clears it and returns to the real backend.
- Start the dev server or build with `VITE_MOCK=1` (`?mock=0` still overrides it).
- Do nothing: if `/api/health` is unreachable at startup, mock mode switches on by itself. The only sign is one console line and `window.__apprenticeMock === true`.

Static demo with no backend at all:

```bash
VITE_MOCK=1 npm run build     # PowerShell: $env:VITE_MOCK=1; npm run build
npm run preview               # serve dist/ with Vite, no proxy and no Python needed
```

What it does:

- Lessons (with the two seed lessons), calibrations, recordings and the dev state persist in localStorage (memory if storage is blocked). Clear the keys starting `apprentice.mock.v1.` to reset.
- A simulated glove stream at about 60 Hz with two hands, `set_motion` support, and a light 9 to 11 Hz tremor that the steadiness and smoothing settings (One Euro filter, same as the backend) reduce. Recording and calibration capture from this stream.
- `/score` is a pure TypeScript port of `backend/app/services/scoring.py` (per-finger DTW, total-flexion error, Gaussian mapping, calibration, hints). `tests/mock-scoring.test.ts` pins it to numbers produced by the Python scorer.
- LLM routes (`lessons/generate`, `generate_from_video`, `motion/from_text`, `coach/plan`) use the deterministic templates of the backend fake provider and report `provider: "mock"`. `/coach/hint` is algorithmic. All five answer 403 while the AI Assistant is off. `/score` and `/coach/hint` accept `margin` like the backend. `/vision/hands` answers 503. `/ingest/frames` feeds frames into the mock stream once the source is `external`.
- Errors use the backend's status codes and `{detail}` body; unknown routes give 404.

Walk the whole app in mock mode with `node e2e/mock-walk.mjs` (screenshots go to `docs/screens/mock-*.png`). The move catalogue and seed lessons in `src/mock/data/` are copies of `backend/app/data`; refresh them if the backend ones change.
