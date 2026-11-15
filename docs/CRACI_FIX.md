# CRACI fix: 6 critical and high advisories (branch craci-fix)

**Update, Sun 15 Nov 2026, 04:30 Helsinki.** Arpan decided to merge the frontend part into `main`: vitest 2.1.9 to
4.1.12 and vite 5.4.21 to 6.4.6. That clears the three critical entries and the high `vite` entry. Before the merge,
the change was tested again on CRACI against that day's `main` (branch `deps-vitest4-vite6`): core, backend and
frontend suites passed, the build passed, and a temporary job started the dev server on vite 6.4.6 and fetched ten of
the app's modules through it, all with HTTP 200. The two `export/` overrides (fsspec and torch) are NOT merged: the
torch version is outside the range that lerobot declares, and it was not proven at run time. They stay on the branch
`craci-fix`. The rest of this document describes the branch as it was built.

**Update, Sun 15 Nov 2026, 08:00 Helsinki.** The merge is commit `55968e9` on `main` (04:24). It changes
`frontend/package.json` and `frontend/package-lock.json` only. `main` was then rebuilt on CRACI (lane audit run
43683032712, job 132717637141, commit `b1f9772`). The API returns 24 vulnerability entries for that build, down from
45: 0 critical (3 before), 3 high (4 before), 7 medium, 2 low, 12 unknown. The 3 high entries are `torch` 2.7.1 (1)
and `fsspec` 2025.3.0 (2), the part that did not merge. The suites passed in that build: core 281 passed and 9
skipped, backend 527 passed and 13 skipped, frontend 658 of 658. The demo laptops were not reinstalled after the
merge: the Mac still has vite 5.4.21 and vitest 2.1.9 in `node_modules`. See `docs/CRACI.md`, section 8.

This file records the dependency fix for the CRACI findings on `lane main`.
The branch `craci-fix` itself does not merge into `main`. Only its frontend half merged, as its own commit (see the updates above).

Terms used in this file:

| Term | Meaning |
| --- | --- |
| Advisory | A published record of a vulnerability, for example a GHSA or CVE id. |
| Transitive | A package that another package pulls in. The project does not name it. |
| Override | A rule that forces a version of a transitive package. |
| SBOM | Software bill of materials: the list of packages a CRACI job saw. |
| OSV | The open vulnerability database at api.osv.dev. |

## Scope

CRACI listed six critical and high findings for job `lane main` 132618946275.
That job built main at the time of lane-audit run 43650860815.
Lower severities are out of scope.

## Step 1: bulk sweep

| Ecosystem | Command | Advisories it clears |
| --- | --- | --- |
| npm (`frontend/`) | `npm audit fix` | None. Every fix needs a new major version. |
| PyPI (`export/`) | `uv lock --upgrade` | All but in name only: it moves lerobot 0.3.3 to 0.7.0, and lerobot 0.7.0 needs a source change (see below). |

`npm audit --package-lock-only` marks every in-scope npm fix `isSemVerMajor`.
For PyPI, `lerobot>=0.3.3` allows 0.7.0, so the sweep stays inside the constraint.
The sweep also drops the `datasets` package, because lerobot 0.6 and later move it to the `dataset` extra.
Without `datasets`, `from lerobot.datasets.lerobot_dataset import LeRobotDataset` fails.
With `lerobot[dataset]>=0.6.0`, the export tests fail with a new error:
`TypeError: LeRobotDataset.add_frame() got an unexpected keyword argument 'task'`.
A fix needs an edit in `export/src`, so this route was dropped.

## Step 2: audit table

Sources: OSV records for each GHSA id, `registry.npmjs.org`, `pypi.org/pypi/<package>/json`, `npm audit`, the lock files.

| Package | Installed | Severity | Advisories | Min fixed | Latest in major | Reachable | Risk | Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tinypool | 1.1.1 (transitive, through vitest 2.1.9, `frontend/`) | critical | CVE-2026-104848 (GHSA-5gmw-xhrv-c9v3), CVE-2026-104849 (GHSA-85c8-ppgw-ccpr) | 2.1.2 | 1.1.1 (no fixed 1.x) | No. Only the test runner uses it. An attacker must first pollute `Object.prototype` in the test process. | An override to 2.x is outside the range vitest 2 and 3 declare (`^1`). Vitest 4 drops tinypool. | Fixed by the vitest 4 upgrade. tinypool is gone from the lock. |
| vitest | 2.1.9 (direct, `frontend/package.json`) | critical | CVE-2026-47429 (GHSA-5xrq-8626-4rwp) | 3.2.6 (OSV; the CVE text says 3.2.5) or 4.1.0 | 2.1.9 (no fixed 2.x) | No. The flaw needs the Vitest UI or API server on Windows. `npm test` runs `vitest run`, and `@vitest/ui` is not installed. | Major jump (2 to 4). Vitest 4 needs vite 6 or later and Node 20 or later. | Upgraded to 4.1.12. Lint, 616 tests and build pass. No config change. |
| vite | 5.4.21 (direct in `frontend/package.json`; CRACI says transitive) | high | CVE-2026-112942 (GHSA-587h-7wmj-h5pm, launch-editor in vite) | 6.4.4 | 5.4.21 (no fixed 5.x) | Low. The open-in-editor middleware runs only in `vite` dev, and the flaw needs Windows. Builds and tests do not use it. | Major jump (5 to 6). `@vitejs/plugin-react` 4.7.0 accepts vite 6. | Upgraded to 6.4.6. |
| fsspec | 2025.3.0 (transitive, `export/uv.lock`: lerobot 0.3.3, then datasets 3.6.0, which pins `fsspec<=2025.3.0`) | high | CVE-2026-104851 (GHSA-27vj-qcqg-25rc, PYSEC-2026-4217) | 2026.6.0 | 2026.9.0 (calendar versions) | No. `export/` never opens a `reference://` file system or a Kerchunk JSON file. | The override is outside the range datasets 3.6.0 declares. The export tests show no new failure. | uv override `fsspec[http]>=2026.6.0`. Locked 2026.9.0. |
| torch | 2.7.1 (transitive, `export/uv.lock`, through lerobot 0.3.3, which pins `torch<2.8`; CRACI says direct) | high | CVE-2026-24747 (GHSA-63cw-57p8-fm3p) | 2.10.0 | 2.15.0 | No. `export/` never calls `torch.load`. (`coach_tune/` imports torch, but it has no lock file and CRACI does not install it.) | Same major. The override is outside the range lerobot 0.3.3 declares. torchvision moves from 0.22.1 to 0.29.2 with it. | uv override `torch>=2.10.0`, `torchvision>=0.25.0`. Locked 2.15.0. |

`genui/` holds none of these packages.
`backend/`, `verda/` and `requirements.txt` hold neither torch nor fsspec.

## Shortlist, in order

1. vitest 4.1.12 with vite 6.4.6 in `frontend/`. One change clears three critical advisories and one high advisory.
2. The fsspec override in `export/`.
3. The torch override in `export/`.
4. Later, after the demo: move `export/` to lerobot 0.7 with `lerobot[dataset]`, and drop the overrides. This needs a code change for the new `add_frame()` signature.

## What was applied

| Commit | Change |
| --- | --- |
| 8f02ac1 | `.github/workflows/ci.yml` from `origin/craci` at 0a24711 (Monitored network policy, no caches). The agent_bom test step is removed, because `tools/agent_bom` exists only on `craci`. |
| 1990da6 | `frontend/`: vitest 2.1.9 to 4.1.12, vite 5.4.21 to 6.4.6. |
| 4586680 | `export/`: uv override for fsspec, 2025.3.0 to 2026.9.0. |
| ba42a58 | `export/`: uv override for torch, 2.7.1 to 2.15.0, and torchvision 0.22.1 to 0.29.2. |

No app source file changed. No config file changed, other than the `[tool.uv]` table in `export/pyproject.toml`.

## Status of each advisory

| Advisory | Package | Status | Evidence |
| --- | --- | --- | --- |
| CVE-2026-104848 | tinypool | Gone | tinypool is not in `frontend/package-lock.json`; `npm audit` shows 0 critical. |
| CVE-2026-104849 | tinypool | Gone | Same as above. |
| CVE-2026-47429 | vitest | Gone | vitest 4.1.12 is above both fixed versions. |
| CVE-2026-112942 | vite | Gone | vite 6.4.6 is above 6.4.4. |
| CVE-2026-104851 | fsspec | Gone | `export/uv.lock` locks 2026.9.0. OSV shows no high advisory for the lock. |
| CVE-2026-24747 | torch | Gone | `export/uv.lock` locks 2.15.0. |

## Test suites

| Suite | Local, craci-fix (macOS) | CRACI ci run 43654229444 (craci-fix ba42a58) | CRACI `lane craci-fix` job 132629338604 |
| --- | --- | --- | --- |
| Core (`python -m pytest -q`) | 280 passed, 2 skipped | 275 passed, 7 skipped | 275 passed, 7 skipped |
| Backend (`uv run pytest -q`) | 503 passed, 13 skipped | 503 passed, 13 skipped | 503 passed, 13 skipped |
| Frontend lint | Pass | Pass | Pass |
| Frontend tests | 616 of 616 | 616 of 616 | 616 of 616 |
| Frontend build | Pass | Pass | Pass |
| `export/` tests (not a CI suite) | 5 errors, the same as on main | Not run | Not run |

On CRACI, `lane main` job 132627637904 gave the same core, backend and frontend counts.
Locally, main gave the same frontend counts.
The `export/` tests fail on main too: `ValueError: One or several timestamps unexpectedly violate the tolerance`.
The overrides add no new failure.

Run links:

- ci on craci-fix: https://github.com/Arpan-206/HackJunction2026/actions/runs/43654229444
- lane audit for craci-fix: https://github.com/Arpan-206/HackJunction2026/actions/runs/43654246703
- lane audit rebuild with `lane main`: https://github.com/Arpan-206/HackJunction2026/actions/runs/43653716590

The jobs API shows a CRACI runner (`craci-<n>-<id>`, label `craci`) for every job above.

## Before and after counts

Before: `lane main` job 132627637904 (main at 81d388e).
After: `lane craci-fix` job 132629338604 (craci-fix at ba42a58).
Both jobs ran the lane-audit workflow from `origin/craci` commit 0a24711, with the Monitored network policy.
The SBOM metadata of each job names that commit.

| Count | Source | Before | After |
| --- | --- | --- | --- |
| SBOM components | CRACI API `/v1preview1/sbom` | 460 (npm 290, PyPI 164, GitHub 6) | 460 (npm 286, PyPI 168, GitHub 6) |
| SBOM vulnerability entries, all | CRACI API `/v1preview1/sbom` | 45 | 11 |
| Critical | CRACI API SBOM | 3 | 0 |
| High | CRACI API SBOM | 4 (fsspec has a GHSA and a PYSEC entry) | 0 |
| Medium | CRACI API SBOM | 17 | 5 |
| Low | CRACI API SBOM | 3 | 0 |
| Unknown | CRACI API SBOM | 18 | 6 |
| npm audit, frontend | CRACI job log, `npm ci` summary | 15 (2 critical, 1 high, 12 moderate) | 9 moderate |
| npm audit, frontend | Local `npm audit --package-lock-only` | 15 (2 critical, 1 high, 12 moderate) | 9 moderate |
| OSV, `export/uv.lock` | Local query to api.osv.dev, one count per advisory | 11 (2 high, 3 moderate, 2 low, 4 unrated) | 1 moderate |

The Vulnerabilities tab in the CRACI web app was not read.
Read it on the two job pages:

- Before: https://platform.craci.com/projects/hackjunction2026/jobs/132627637904
- After: https://platform.craci.com/projects/hackjunction2026/jobs/132629338604

The first `lane main` job, 132618946275, ran before the Monitored policy.
Its API SBOM also gives 460 components and 45 vulnerability entries.

The SBOM of the after job lists vite 6.4.6, vitest 4.1.12, fsspec 2026.9.0 and torch 2.15.0.
It does not list tinypool.

## Notes

- `export/` still does not install on Linux on CRACI. evdev 2.0.0 (through pynput, through lerobot 0.3.3) needs Python headers. This was true on main too.
- CRACI still records the `export/` packages, because uv downloads them before the evdev build fails.
- The GitHub job logs show no `cracicorp/setup` step. The runner seems to apply it before the job. The logs alone do not prove the policy.

## Could not determine

| Item | Reason |
| --- | --- |
| The tab counts in the CRACI web app | The web app needs a browser session. Only the API and the logs were read. |
| The CVE record pages on cve.org | OSV records were used. OSV gives the same CVE ids with GHSA aliases. |
| Vitest minimum fixed version, 3.2.5 or 3.2.6 | The CVE text says 3.2.5. The GHSA record in OSV says 3.2.6. The branch uses 4.1.12, so both are cleared. |
| Whether lerobot 0.3.3 works at run time with torch 2.15 | The export tests stop at the same pre-existing timestamp error, before the new code paths. |
| Whether the SBOM completeness result is "Complete" | The SBOM JSON from the API has no completeness field. |
