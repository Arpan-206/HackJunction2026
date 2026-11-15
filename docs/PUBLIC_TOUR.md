# Public tour

A public page that anyone can open. It needs no gloves, no login and no backend. It plays a recorded session in five stops.

Branch: `public-tour`. This branch does not merge into main before the demo. Nothing here changes the running app.

## Words

| Word | Meaning here |
| --- | --- |
| Take | One real recording of a gloved hand: wrist turn and finger bends over time. |
| Tour build | The second Vite entry `frontend/tour.html` with `frontend/vite.tour.config.ts`. It makes the static site in `frontend/dist-tour/`. |
| Lesson-sync bundle | `lessons/shared/<recorder>/` on main: takes exported with `scripts/lesson_sync.py` (docs/LESSON_SYNC.md). |
| CRACI | The CI runners (`runs-on: craci`). All builds and browser checks run there, never on the demo laptop. |

## Build

All steps run in the CRACI workflow `.github/workflows/public-tour.yml` on a push to `public-tour`. To run them by hand on a machine that is not the demo laptop, in `frontend/`:

| Step | Command |
| --- | --- |
| 1. Tour data from the lesson-sync bundle | `node scripts/tour/build-data.mjs` |
| 2. Tour build | `npx vite build --config vite.tour.config.ts` |
| 3. Key-leak check | `node scripts/leak-check.mjs dist-tour` |
| 4. Browser check | `node e2e/tour-check.mjs dist-tour tour-check` (needs Playwright chromium) |

The normal app build (`npm run build`) does not change. The tour code is in `frontend/src/tour/`. It reuses the app's hand, stage, robot twin, scorer, live corrections and teach rules as they are.

## Choose the takes

`frontend/tour/takes.json` names the take for each stop: the recorder folder under `lessons/shared/` and the take id. To change a take, edit this file and push. The workflow runs step 1 again.

| Entry | Stop | Take now | Waits for Szymon's takes |
| --- | --- | --- | --- |
| `expert` | 1, and the ghost on stop 2 | `arpan/arpan-38d8e15a43cf`, table tennis grip | Yes |
| `attempt` | 2, the learner's attempt | `arpan/arpan-c298f22f6609`, table tennis grip, second take | No |
| `rabbit` | 4, the robot follows it | `arpan/arpan-698ffa18b8c2`, shadow puppet rabbit | Yes |
| `letter` | 5, the expert reference for Pinocchio | `arpan/arpan-11f0f06a17d9`, Finnish letter A | Yes |

When `lessons/shared/szymon/` is on main, merge main into `public-tour` and point the three expert entries at his takes.

## The five stops

| Stop | What it shows | Data |
| --- | --- | --- |
| 1. An expert records a step | The chalk hand plays the expert's take at 30 frames a second. | `expert` take |
| 2. The training room | The learner's wooden hand plays a recorded attempt over the expert's ghost. Fingers past their band turn vermilion. A tip line, the per-finger state, a live score and the final score show. | `expert` and `attempt` takes, replayed through the app's own scorer (`mock/scoring.ts`) and live-correction code (`features/apprentice/training/coach/`). The page says "replayed through the same scorer". No per-frame log of the session exists. |
| 3. The AI Assistant | Six real lines of the tuned hint model, each labelled "Recorded hint", with its input. The result table: 55.5% before tuning and 89.0% tuned on 1,150 held-out test examples; 43.5% and 62.2% on the 333 real capture frames. It matches its 31B teacher on the held-out test (89.0% vs 85.7%), with the note that the labels were filtered for correctness. | `frontend/tour/hints.json`, made once by `scripts/tour/build-hints.mjs` from `coach_tune/out` (git-ignored). Only synthetic test attempts. Numbers: docs/COACH_MODEL.md. |
| 4. The robot hand | The Dex3-1 twin follows the take through the app's retarget, with strings. Then the push-recovery clip with its numbers and limits. | `rabbit` take; `robot_policy/out/policy_demo.mp4` (copied into the site at build time, `preload="none"`, poster frame); docs/ROBOT_POLICY.md. |
| 5. Teach Pinocchio | Interactive. The teach rules run in the browser with no model: tap a finger and a fix, type words, ask for a hint. Voice and the glove demonstration are left out (browser speech recognition can send audio to a server). | `letter` take; `features/shared/robot/teach/`. |

Every stop shows the badge "Recorded session, the live version uses Rokoko gloves" and a "What you would see live" note.

## Privacy

The tour bundles takes from Arpan's lesson-sync folder only. It bundles no calibration file.

| Take | Recorded (Helsinki) | Why it is Arpan's |
| --- | --- | --- |
| `arpan-38d8e15a43cf` | 14 Nov, 23:30 | In `lessons/shared/arpan/`, cleared by Arpan for use. Inside the glove session from 22:21 that Arpan ran. The last wearer calibrations before it (22:23 to 22:33) are all Arpan's. |
| `arpan-c298f22f6609` | 14 Nov, 23:37 | Same. |
| `arpan-698ffa18b8c2` | 14 Nov, 23:39 | Same. |
| `arpan-11f0f06a17d9` | 14 Nov, 23:40 | Same. |

What a bundled take holds: a title, the hand side, 30 Hz rows of wrist rotation, wrist position, 15 bends and 5 spreads. It holds no id, time stamp, wearer, calibration, lesson id or recorder name. `tests/tour.test.ts` checks this.

The recorded hints come from synthetic test attempts. They hold no glove data of any wearer.

## No calls out

| Guard | Where |
| --- | --- |
| fetch, XMLHttpRequest, WebSocket, EventSource and sendBeacon throw for any other origin | `src/tour/netGuard.ts`, installed first in `src/tour/main.tsx` |
| Content Security Policy: everything from `'self'` only | `frontend/tour.html` |
| No env value can reach the bundle | `envPrefix` in `vite.tour.config.ts` is a name no variable has |
| The delay probe (it can call the core on :8765) is replaced by a stub | alias in `vite.tour.config.ts` |
| The browser check fails on any request that leaves the page's origin | `e2e/tour-check.mjs` |

## Key-leak check

`frontend/scripts/leak-check.mjs` scans every file in `dist-tour/` after the build. The build fails on any finding.

| Rule | What it finds |
| --- | --- |
| (a) | The value of any variable in the build environment, except a short allowlist of non-secret names (paths, locale, runner layout) |
| (b) | Key shapes: Google API keys, `sk-` keys, bearer tokens, long secrets next to key, token, secret, authorization or password, private key blocks |
| (c) | The names `GEMINI_API_KEY`, `VERDA_`, `CRACI_API_TOKEN`, `HF_TOKEN` |
| (d) | Local paths: `/Users/`, `/home/<user>/`, `C:\Users\` |
| (e) | Hosts the tour never calls: `localhost:8000`, `:8765`, `generativelanguage.googleapis.com`, `containers.datacrunch.io`, `verda` |

`tests/leak-check.test.ts` plants a made-up key (built by concatenation, so the repo holds no key-shaped literal) and checks that the scan fails, then passes once it is removed.

## Deploy

The workflow uploads the site as the artifact `tour-dist` and as a Pages artifact. The `deploy` job runs only when GitHub Pages is on for the repository.

## Limits

| Limit | Note |
| --- | --- |
| Recorded only | Nothing on the page is live. The badge says so on every stop. |
| Stop 2 corrections | Replayed from the frames through the same code, not logged during the session. |
| Stop 4 clip | Simulation only. No real robot hand and no contact. |
| Stop 5 | Tap and typed words only. No voice, no glove. |
| Decor | The stage has no workshop props or image light, so it loads fast on a phone. |
