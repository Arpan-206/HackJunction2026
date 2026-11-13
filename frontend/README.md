# Apprentice frontend

Vite + React 18 + TypeScript (strict), react-router-dom, three + @react-three/fiber + drei, zod. Renaissance bottega design language (lapis, lime plaster, carta azzurra, gold leaf).

## Run

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api and /ws to http://localhost:8000
npm run build    # tsc -b && vite build
npm run lint
```

Developer panel: open any page with `?dev=1` (remembered in localStorage, `?dev=0` forgets it) or set `VITE_DEV_PANEL=true`. To remove it for the demo, delete the `DevPanel` import and element in `src/main.tsx`.

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
