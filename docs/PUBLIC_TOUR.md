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

| Entry | Stop | Take now | Why this take |
| --- | --- | --- | --- |
| `expert` | 1 | `szymon-4ca8e37c97eb`: Szymon spells J U N C T (his "Lesson 2: Spell junct"; the step id `seed-fs-word-geppetto` is misleading, he retitled the step) | The expert reference of that step, 10.4 s, right hand. The clearest take for a Junction audience. The five letters show under the stage as plain text; no per-letter timing is shown, because it is not measured. |
| `reference` | 2, the expert's ghost | `szymon-6b8b367c4015`, shadow puppet rabbit | The expert reference of the rabbit step. |
| `attempt` | 2, the learner's attempt | `szymon-5992b3c9201c`, shadow puppet rabbit, another take | Same step. The browser scorer gives it 83 against the reference, so the stop shows real corrections, not a 100. |
| `robot` | 4, the Dex3-1 follows it | `szymon-4986ea2809a7`, piano five-finger scale | The expert reference of the scale step. Every finger moves in turn, so the robot's thumb and two fingers move too. |
| `teach` | 5, Pinocchio's reference | `szymon-977906efe597`, table tennis wrist snap | The expert reference of that step. The fingers hold still, so a planted bend fault is easy to see. |

Which takes are expert references comes from Szymon's own app (his lesson records are not in git). `frontend/tour/takes.json` keeps the step and the reference id of each entry.

Browser scores of Szymon's other takes against the references (standard margin, no calibration, so lower than in his app): rabbit 83, 86, 49, 46, 43, 40; piano scale 86, 81, 45, 39.

Before Szymon's bundle reached main (bd703f1), the tour used four of Arpan's takes from `lessons/shared/arpan/` (`arpan-38d8e15a43cf`, `arpan-c298f22f6609`, `arpan-698ffa18b8c2`, `arpan-11f0f06a17d9`). The first zip handed over (run 43661246252) has those.

## The five stops

| Stop | What it shows | Data |
| --- | --- | --- |
| 1. An expert records a step | The chalk hand plays the expert's take at 30 frames a second. | `expert` take |
| 2. The training room | The learner's wooden hand plays a recorded attempt over the expert's ghost. Fingers past their band turn vermilion. A tip line, the per-finger state, a live score and the final score show. | `reference` and `attempt` takes, replayed through the app's own scorer (`mock/scoring.ts`) and live-correction code (`features/apprentice/training/coach/`). The page says "replayed through the same scorer". No per-frame log of the session exists. |
| 3. The AI Assistant | Six real lines of the tuned hint model, each labelled "Recorded hint", with its input. The result table: 55.5% before tuning and 89.0% tuned on 1,150 held-out test examples; 43.5% and 62.2% on the 333 real capture frames. It matches its 31B teacher on the held-out test (89.0% vs 85.7%), with the note that the labels were filtered for correctness. | `frontend/tour/hints.json`, made once by `scripts/tour/build-hints.mjs` from `coach_tune/out` (git-ignored). Only synthetic test attempts. Numbers: docs/COACH_MODEL.md. |
| 4. The robot hand | The Dex3-1 twin follows the take through the app's retarget, with strings. Then the push-recovery clip with its numbers and limits. | `robot` take; `robot_policy/out/policy_demo.mp4` (copied into the site at build time, `preload="none"`, poster frame); docs/ROBOT_POLICY.md. |
| 5. Teach Pinocchio | Interactive. The teach rules run in the browser with no model: tap a finger and a fix, type words, ask for a hint. Voice and the glove demonstration are left out (browser speech recognition can send audio to a server). | `teach` take; `features/shared/robot/teach/`. |

Every stop shows the badge "Recorded session, the live version uses Rokoko gloves" and a "What you would see live" note.

## Privacy

The tour bundles takes from the lesson-sync bundle under `lessons/shared/` only: Szymon's folder now, Arpan's folder before. Both were cleared for use by Arpan (they are the team's own takes). The tour bundles no calibration file, no wearer label and no name.

| Take | Recorded (UTC) | Step |
| --- | --- | --- |
| `szymon-977906efe597` | 15 Nov, 00:50 | his table tennis lesson, wrist snap |
| `szymon-6b8b367c4015` | 15 Nov, 00:48 | `seed-sp-rabbit` |
| `szymon-5992b3c9201c` | 15 Nov, 00:48 | `seed-sp-rabbit` |
| `szymon-4ca8e37c97eb` | 15 Nov, 00:11 | "Lesson 2: Spell junct" (`seed-fs-word-geppetto`) |
| `szymon-4986ea2809a7` | 15 Nov, 00:52 | `seed-piano-scale` |

What a bundled take holds: a title, the hand side, whether a wrist position was recorded, and 30 Hz rows of wrist rotation, wrist position, 15 bends and 5 spreads. Szymon's takes carry no wrist position, so the hand stays where the stage puts it. It holds no id, time stamp, wearer, calibration, lesson id or recorder name. `tests/tour.test.ts` checks this.

The recorded hints come from synthetic test attempts. They hold no glove data of any wearer.

## No calls out

| Guard | Where |
| --- | --- |
| fetch, XMLHttpRequest, WebSocket, EventSource and sendBeacon throw for any other origin | `src/tour/netGuard.ts`, installed first in `src/tour/main.tsx` |
| Content Security Policy: everything from `'self'` only | `frontend/tour.html` |
| No env value can reach the bundle | `envPrefix` in `vite.tour.config.ts` is a name no variable has |
| The delay probe (it can call the core on :8765) is replaced by a stub | alias in `vite.tour.config.ts` |
| The browser check fails on any request that leaves the page's origin | `e2e/tour-check.mjs` |

Two third-party URLs are present in library code inside the bundle, and are never requested:

| String in the bundle | From | Why it is never requested |
| --- | --- | --- |
| The Draco decoder path on `www.gstatic.com` | drei (`useGLTF` Draco support) | No model in the tour is Draco-compressed: `models/hands/right.glb` has no `KHR_draco_mesh_compression` |
| The environment preset path on `raw.githack.com` | drei (`Environment` presets) | The tour draws the stage with `decor: false`, so no `Environment` renders; the app's own `Environment` uses a local file, never a preset |

The browser check names both hosts and fails if either is requested.

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

The workflow has five jobs.

| Job | What it does | Runs when |
| --- | --- | --- |
| `build` | Tour data, lint, the whole test suite, the normal app build, the tour build, a placeholder SBOM summary, the key-leak check, the size report, upload of `tour-dist`, the browser checks at the site root and under `/HackJunction2026/` | Every push to `public-tour`, and by hand |
| `sbom` | On a GitHub-hosted runner (`ubuntu-latest`), the one job not on CRACI: finds the `build` job's id and fetches that job's SBOM from the CRACI API, then hands `sbom.cdx.json` and `sbom-summary.json` on. Why: the CRACI API answered HTTP 403 to a CRACI runner (the network policy allowed the request and the token fingerprint matched), and the same token works from outside. | After `build` |
| `publish` | On CRACI: puts the SBOM files into the site, runs the key-leak check again on the final site, checks the "What's in this site" page against the SBOM file, uploads `tour-site` and `geppetto-tour-zip` | After `build` and `sbom` |
| `netlify` | Deploys `tour-site` to Netlify with `netlify-cli@27.19.0` (`netlify deploy --prod --dir=dist-tour --no-build`) | Only when the repository secrets `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` exist; otherwise its steps skip and the job passes |
| `pages` | Deploys to GitHub Pages | Only when started by hand with `pages: true` |

Netlify (from Netlify's CLI guide): the CLI reads `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID`. The site ID is the "Project ID" under Project configuration > General > Project details > Project information (it was labelled "Site ID" before).

The site has a relative base and hash routing (`#/1` to `#/5`), so one build works at the root of a domain and under a sub-path, and a reload never asks the server for a page that does not exist.

## What's in this site

Every stop has a link "What's in this site". It opens `sbom.html`, a plain page with no 3D and no tour code. It reads `sbom-summary.json` from the site and shows the commit, the CRACI job link, the number of packages (every component in the SBOM file, the checked-out repository included), the vulnerability entries by severity and a link to the CycloneDX file. It says plainly when the SBOM is empty, incomplete or unavailable, and why. It never shows a zero where there is no data. The list is every package the build downloaded, the build and test tools included; it is not the code inside the page.

Runs 43664418557 to 43667497387 fetched the SBOM from the publish job on CRACI and got HTTP 403 Forbidden. The evidence: the secret's SHA-256 prefix and length equal those of the working local token; the job's network trace shows the request to `api.craci.com` allowed by the policy and answered by the API; CRACI's authentication docs name no scope, IP or runner limit. So the fetch moved to the `sbom` job on a GitHub-hosted runner.

The `sbom` job waits up to 15 minutes for the SBOM: CRACI answers HTTP 409 "the job exists but has not finished" until the job record is final. Without the `CRACI_API_TOKEN` secret the summary says "no API token in this build".

## Explore mode (the whole app, after the tour)

The last stop offers "Explore the whole app", and the tour footer links to it. It opens `explore.html`: the real Geppetto app, complete, in the browser with no gloves and no backend.

| Part | How |
| --- | --- |
| Backend | The app's own mock (`src/mock/`, the browser port of the backend) answers every `/api` call and the `/ws/gloves` and `/ws/robot` sockets. |
| Hands | The "No gloves" mode (simulated hands) is switched on. |
| Routing | Hash routing (`explore.html#/apprentice`), so a reload never asks the server for a missing page. |
| Badge | "Demo without gloves: simulated hands. The live version uses Rokoko gloves." It also says that scores come from the in-browser scorer on simulated hands, and that any AI Assistant text is example text. |
| AI Assistant text | The mock's canned text is labelled as a template in this build (`exploreHonesty` in `vite.tour.config.ts`), so the score card, the plan card, the lesson generator and text-to-motion say the AI Assistant was not used. The developer-only model names become neutral words. |
| Screens that need hardware | The gloves status, calibration, phone depth and glove compare screens show one plain line saying why, not a broken screen. |
| No calls out | The same network guard as the tour, installed before the mock. The explore browser check fails on any request off the origin, any console error, any 404, a missing badge, and any text that names Gemini, Gemma or Verda or says text was written by the AI Assistant. |
| Load | The tour's first load does not change. The app's code and its files (models, textures, stills) load only in explore mode. |
| Expert takes | The lessons in explore mode use the mock's synthetic references, not Szymon's recorded takes. Wiring his takes into the mock store was not done safely in the time. |

Storage: explore mode writes only to this browser's own storage. localStorage holds the mock store (`apprentice.mock.v1.*`: lessons, recordings and attempts made in the demo, settings of the mock backend), the app's preferences (`apprentice.*`, for example the margin, the score view, the AI Assistant switch and `apprentice.noGloves`) and `apprentice.mock`. sessionStorage holds per-tab flags of the app. Nothing is sent anywhere. Clearing the site's data in the browser removes all of it.

## Load time

The browser check measures two numbers. "First stop readable" is the stop's text and a poster still of its stage on screen. "3D stage live" is the first frames of the live hand. The 5 s budget is a failing check on the first number. The second number is recorded.

Run 43664418557 (commit 5fb1337), CRACI runner, site root:

| Viewport | Network | First stop readable | 3D stage live |
| --- | --- | --- | --- |
| Phone 390 x 844, touch emulation | 10 Mbit/s, 40 ms | 0.69 s | 5.99 s |
| Phone 390 x 844, no touch emulation | 10 Mbit/s, 40 ms | 0.66 s | 5.13 s |
| Desktop 1280 x 900 | not throttled | 0.50 s | 0.90 s |

Every file stop 1 needs has arrived by about 1.4 s on the phone runs (modulepreload of the stage code, preload of the hand mesh and the poster). The rest of the 3D time is script start-up on the runner, which has no GPU and draws WebGL in software.

Sizes (from the CRACI size report): first load about 1.6 MB as served without compression; the largest file is the 3D code at 1.1 MB raw, 0.3 MB gzip. The whole site is 6.9 MB raw. Most of the rest loads only on its stop: the wood texture (3.2 MB) on stop 2 and the robot clip (1.3 MB) on stop 4 when played.

## Limits

| Limit | Note |
| --- | --- |
| Recorded only | Nothing on the page is live. The badge says so on every stop. |
| Stop 2 corrections | Replayed from the frames through the same code, not logged during the session. |
| Stop 4 clip | Simulation only. No real robot hand and no contact. |
| Stop 5 | Tap and typed words only. No voice, no glove. |
| Decor | The stage has no workshop props or image light, so it loads fast on a phone. |
| Load time | See "Load time" above. CRACI's runner has no GPU, so WebGL runs in software there. A real phone can be faster or slower in ways the runner cannot show. No real-phone number is measured yet. |
| Webcam try-it (Tier 2) | Left out. It could not be tested with a real hand: no browser runs on the demo laptop, and CI has no camera. |
