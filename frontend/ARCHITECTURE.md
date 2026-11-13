# Architecture and rules

## Folder map

```
src/
  main.tsx                 providers, fonts, global CSS, DevPanel
  app/                     App (route table), AppShell (lapis rail), RoleSelect (/), HandLab (/lab), app.css
  features/
    master/                MasterHome (/master) + placeholder pages: scratch, generate, lesson studio
    apprentice/            placeholder pages: home, lesson, step, test
  components/
    ui/                    UI kit: Button, ButtonLink, Card, Badge, Stepper, Countdown, RecordButton, Tabs, Field, TextArea, Toast
    PageHeader.tsx         standard screen header
    ThemeSelect.tsx
    Placeholder.tsx        stand-in for unbuilt screens
  three/                   3D system (see below)
  api/
    types.ts               wire types, mirror of docs/CONTRACT.md
    client.ts              typed fetch wrapper `api.*`, ApiError
    useGloveStream.ts      shared auto-reconnecting /ws/gloves
    hooks.ts               useLessons, useLesson, useMoves, useDevState
    useAsync.ts            abortable request hook
    schemas.ts             optional zod validators
  theme/                   themes.ts (ids, stage colours), ThemeProvider, theme.css (tokens)
  state/settings.ts        local UI prefs (guidance mode), useSettings()
  dev/                     DevPanel (delete before the demo)
public/textures/wood/      CC0 wood maps + SOURCE.md
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
7. Never create a second WebSocket; use `useGloveStream` (it shares one connection).
8. No em dashes anywhere. UK English in docstrings. Comment the why, not the what.
9. New screens live in `features/master/` or `features/apprentice/`. Shared pieces go in `components/`; anything 3D goes in `three/`.

## three/ overview

- `Hand.tsx`: the hand (props below). `handRig.ts` builds it, `materials.ts` styles it, `smoothing.ts` smooths input, `motion.ts` previews MotionSpecs locally (the backend owns the canonical synthesiser).
- `Stage.tsx`: `HandCanvas` (Canvas + theme bridge + `Stage` + presets) and `Stage` (carta azzurra background, lights, drafting grid, construction circle, contact shadow, limited OrbitControls).
- `props.tsx`: `Racket` (child of Hand), `Keyboard`.
- `overlays.tsx`: `JointRings`, `FingertipTrails` (also reachable through `Hand showJoints showTrails`).
- `stageContext.ts`: `useStageColors()`.

Hand space: right hand, palm down, fingers along -z, y up, thumb towards -x. An identity `wrist_quat` shows that rest orientation. Left hands are mirrored.
