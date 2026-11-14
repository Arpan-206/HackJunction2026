# Apprentice frontend

Vite + React 18 + TypeScript (strict), react-router-dom, three + @react-three/fiber + drei, zod. Renaissance bottega design language (lapis, lime plaster, carta azzurra, gold leaf).

## Run

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api and /ws to http://localhost:8000
npm run build    # tsc -b && vite build
npm run lint
```

Developer panel: renders only when switched on. Open any page with `?dev=1` to show it (the flag is remembered in localStorage under `apprentice.devpanel`, so it stays on for later visits). Open `/?dev=0` to clear the flag and hide it; presenters should do this before going on stage. The panel docks as a small tab on the right edge, and it also holds the theme switch. `VITE_DEV_PANEL` no longer forces it on.

`/lab` is a gallery of every hand style, pose, prop and grip camera. Use it when touching `src/three/`.

## Structure

See `ARCHITECTURE.md` for the folder map and rules.

## Themes

Three themes, switched at runtime with `<html data-theme="...">` and persisted in `localStorage` (`apprentice.theme`): `bottega` (default), `notte` (night hall), `affresco` (fresco).

To add a theme:

1. Add an id to `ThemeId` and an entry in `THEMES` in `src/theme/themes.ts`, including its `stage` colours (3D background, grid, chalk, ink, ghost, gold, vermilion, malachite, shadow, light colours) and picker swatches.
2. Add a `:root[data-theme='yourid']` block in `src/theme/theme.css` defining every token that the `bottega` block defines. Components only use semantic tokens (`--bg`, `--surface`, `--text`, `--accent`, `--rail-bg`, ...).
3. Add the id to the inline script in `index.html` so there is no flash of the default theme.

3D scenes receive the colours through `HandCanvas`, which bridges the theme into the R3F canvas (`useStageColors()` inside).

## Hand styles

`<Hand style=...>` in `src/three/Hand.tsx`. All styles share one articulated rig (`handRig.ts`): lofted palm with thenar and hypothenar pads, a thumb web, knuckle bumps, three phalanges per finger. Poses are mutated in `useFrame`; nothing re-renders per frame.

| style | use | look |
|---|---|---|
| `chalk` | master | toon-shaded chalk, inked back-face outline, glove cuff |
| `wood` | apprentice | carved wooden marionette: CC0 ambientCG Wood049 colour, normal and roughness maps, separated segments, ball joints and dowel pegs at every joint |
| `ghost` | overlays | translucent white heightening, stencil-masked so overlapping segments do not double up |
| `shadow` | shadow guidance | dark translucent silhouette (same stencil trick) |

Wood textures live in `public/textures/wood/` (source and licence in `SOURCE.md`).

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
- LLM routes (`lessons/generate`, `generate_from_video`, `motion/from_text`, `coach/plan`) use the deterministic templates of the backend fake provider and report `provider: "mock"`. `/coach/hint` is algorithmic. `/vision/hands` answers 503. `/ingest/frames` feeds frames into the mock stream once the source is `external`.
- Errors use the backend's status codes and `{detail}` body; unknown routes give 404.

Walk the whole app in mock mode with `node e2e/mock-walk.mjs` (screenshots go to `docs/screens/mock-*.png`). The move catalogue and seed lessons in `src/mock/data/` are copies of `backend/app/data`; refresh them if the backend ones change.
