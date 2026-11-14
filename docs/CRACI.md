# Who checked what the agents shipped? Geppetto on CRACI

**Most interesting real finding.** One line added by the `worktree-export` lane, `lerobot>=0.3.3` in `export/pyproject.toml`, locks 98 packages that neither the core nor the backend locks (`export/uv.lock`). With it, `export/` fails to install on Linux in 23 of 23 lane builds that contain it. Every failure is the same: `evdev` 2.0.0 builds from source and finds no `Python.h`. `evdev` is an input-device library: it reads Linux input devices. uv names the chain in the log: `geppetto-export` depends on `lerobot`, which depends on `pynput`, which depends on `evdev`. The CRACI SBOMs show the cost even though the install fails. Builds that contain `export/` record 95 more PyPI packages and 15 more vulnerability entries than builds without it. Three of those entries are `high`: `torch` 2.7.1 (GHSA-63cw-57p8-fm3p) and `fsspec` 2025.3.0 (GHSA-27vj-qcqg-25rc, PYSEC-2026-4217). `export/` is already in `main`, so these entries are now part of `main`'s baseline. A gate that only blocks new vulnerabilities cannot see them. Sources: lane audit run 43650860815 (job logs and CRACI SBOMs), `export/uv.lock` on `origin/main` at `45e0489`.

Status on Sun 15 Nov 2026, written by the `craci` lane. Every number names its source. The CRACI API token arrived at 01:19 Helsinki time. All API results below are real responses from `api.craci.com`.

Words used here:

- **CRACI**: a CI service. It runs GitHub Actions jobs on its own Linux machines and records what each job downloads and contacts.
- **Lane**: one AI coding agent on its own git branch.
- **SBOM (software bill of materials)**: the list of every package a build used. CRACI writes one per job, in CycloneDX 1.7 format.
- **Network trace**: the list of network accesses (HTTP, DNS, TCP, SSH git) of one job, as CRACI observed them.
- **Merge gate**: a check the dispatcher runs before a lane merges into `main`.
- **Digest**: the sha256 hash that names one exact container image. A tag such as `v0.29.0` can move; a digest cannot.

## 1. What runs on CRACI

| Workflow | Trigger | Jobs | Purpose |
|---|---|---|---|
| `.github/workflows/craci-hello.yml` | push to `craci`, manual | 1 | First run, for CRACI onboarding |
| `.github/workflows/ci.yml` | push to any branch (`'**'`), manual | 3: `core`, `backend`, `frontend` | The three test suites, unchanged commands |
| `.github/workflows/lane-audit.yml` | manual, or a change to the file on `craci` | 1 + one per lane | Checks out every lane at its tip, installs and tests it, caches off |
| `.github/workflows/model-image.yml` | manual, or a change to the file on `craci` | 1 | Resolves the coach image digest through CRACI |

`ci.yml` only runs on a branch that contains it. Lane branches get it when they next merge `main`. Until then, `lane-audit.yml` covers them from the `craci` branch, so no lane branch is touched.

The lane audit also installs the three side projects that have their own lockfiles: `verda/`, `export/` and `genui/`. `ci.yml` does not build them.

## 2. First run

| Item | Value | Source |
|---|---|---|
| Run | GitHub run 43650216740, job 132616780656, `success`, 20 s | `gh run view 43650216740` |
| Runner | `craci-3-7d9afbca`, label `craci` | GitHub jobs API |
| CRACI link in the job log | `platform.craci.com/projects/hackjunction2026/jobs/132616780656` | job log, "Set up job" |
| Machine | Ubuntu 24.04.4 LTS, x86_64 | job log, `uname -a` and `/etc/os-release` |
| Queue time | about 5 s (created 22:50:57 UTC, started 22:51:02 UTC) | GitHub jobs API |

## 3. Builds on CRACI

Counted on Sat 14 Nov 23:15 UTC from the GitHub Actions API. Every job below ran on a runner with the label `craci`. Later pushes to `craci` added more `craci-hello` and `ci` runs.

| Workflow | Runs | Jobs that got a CRACI runner | Jobs that succeeded | Note |
|---|---|---|---|---|
| `craci-hello` | 7 | 7 | 7 | one per push to `craci` |
| `ci` | 6 | 18 | 18 | core, backend, frontend on each push to `craci` |
| `lane-audit` (first run, 43650356405) | 1 | 18 of 30 | 10 | cancelled, replaced by the run below |
| `lane-audit` (full, 43650860815) | 1 | 30 | 30 | 1 list job + 29 lane jobs (28 lane branches and `main`), 22:59 to 23:12 UTC |
| `model-image` | 1 | 1 | 1 | |
| Total | 16 | 74 | 66 | 8 more were cancelled while running |

A lane job is green even when a step inside it fails, because the audit steps use `continue-on-error`. `python3 -m tools.agent_bom steps 43650860815` reads the step failures from the job logs.

| Step | Lanes where the step ran | Passed | Failed | Failure |
|---|---|---|---|---|
| Core install and tests | 29 | 29 | 0 | |
| Backend install and tests | 29 | 29 | 0 | |
| Frontend install, lint, tests and build | 29 | 28 | 1 | `robot-extras-wip`: 1 of 286 tests, `robotUrdf.test.ts` "the served copies are identical to the core files" (line endings `\n` against `\r\n`) |
| `verda/` install | 18 | 18 | 0 | |
| `export/` install | 23 | 0 | 23 | `evdev` 2.0.0 source build: `Python.h: No such file or directory` |
| `genui/` install | 29 | 29 | 0 | |

`npm ci` in `frontend/` printed the same audit line in all 29 builds: "15 vulnerabilities (12 moderate, 1 high, 2 critical)". `genui/` printed "found 0 vulnerabilities".

## 4. Per-lane audit (CRACI API)

`python3 -m tools.agent_bom report`, run Sun 15 Nov 01:22 Helsinki time. It made 58 API calls (one SBOM and one network trace for each of the 29 lane jobs), and all 58 returned 200. The baseline is `lane main`, CRACI job 132618946275.

### Every lane build, as the API returned it

| Lane | CRACI job | Packages | PyPI | npm | Vulnerability entries | High or critical | Hosts | Trace observations |
|---|---|---|---|---|---|---|---|---|
| `main` | 132618946275 | 441 | 162 | 274 | 45 | 7 | 15 | 863 |
| `arkit-app` | 132618946171 | 441 | 162 | 274 | 45 | 7 | 15 | 853 |
| `coach-tune` | 132618946104 | 441 | 162 | 274 | 45 | 7 | 15 | 862 |
| `core-calibration` | 132618946144 | 438 | 159 | 274 | 45 | 7 | 15 | 839 |
| `core-overnight` | 132618946181 | 346 | 67 | 274 | 30 | 4 | 15 | 641 |
| `craci` | 132618946132 | 441 | 162 | 274 | 45 | 7 | 15 | 862 |
| `demo-mode` | 132618946140 | 441 | 162 | 274 | 45 | 7 | 15 | 861 |
| `expert-priors` | 132618946162 | 441 | 162 | 274 | 45 | 7 | 15 | 865 |
| `fingerspelling-packs` | 132618946198 | 441 | 162 | 274 | 45 | 7 | 15 | 864 |
| `frontend-updates` | 132618946153 | 441 | 162 | 274 | 45 | 7 | 15 | 859 |
| `hand-root` | 132618946097 | 441 | 162 | 274 | 45 | 7 | 15 | 861 |
| `hand-round-2` | 132618946569 | 346 | 67 | 274 | 30 | 4 | 15 | 635 |
| `lidar` | 132618946194 | 441 | 162 | 274 | 45 | 7 | 15 | 855 |
| `merge-main` | 132618946182 | 441 | 162 | 274 | 45 | 7 | 15 | 859 |
| `models` | 132618946191 | 441 | 162 | 274 | 45 | 7 | 15 | 854 |
| `replay-demo` | 132618946157 | 441 | 162 | 274 | 45 | 7 | 15 | 866 |
| `robot-extras-wip` | 132618946202 | 346 | 67 | 274 | 30 | 4 | 15 | 638 |
| `robot-view` | 132618946230 | 346 | 67 | 274 | 30 | 4 | 15 | 642 |
| `rokoko-setup` | 132618947169 | 438 | 159 | 274 | 45 | 7 | 15 | 843 |
| `shadows` | 132618947166 | 441 | 162 | 274 | 45 | 7 | 15 | 858 |
| `slot-kit` | 132618947240 | 441 | 162 | 274 | 45 | 7 | 15 | 866 |
| `submission` | 132618947351 | 441 | 162 | 274 | 45 | 7 | 15 | 865 |
| `szymon-frontend` | 132618947331 | 438 | 159 | 274 | 45 | 7 | 15 | 846 |
| `thumb-align` | 132618947343 | 441 | 162 | 274 | 45 | 7 | 15 | 859 |
| `typing` | 132618947355 | 438 | 159 | 274 | 45 | 7 | 15 | 839 |
| `verda` | 132618947370 | 352 | 73 | 274 | 30 | 4 | 15 | 664 |
| `weights` | 132618947367 | 438 | 159 | 274 | 45 | 7 | 17 | 859 |
| `worktree-decisions` | 132618947733 | 346 | 67 | 274 | 30 | 4 | 15 | 644 |
| `worktree-export` | 132618948132 | 438 | 159 | 274 | 45 | 7 | 15 | 845 |

"Packages" counts distinct package names (purl without version). "Vulnerability entries" counts distinct (advisory, package) pairs. The npm side is identical in all 29 builds: 274 packages.

The split is clean. The 23 builds with `export/` have 438 to 441 packages, 45 entries and 7 high or critical. The 6 builds without `export/` have 346 to 352 packages, 30 entries and 4 high or critical. That difference is the `lerobot` line (opening finding).

### Summary against `main`

| Lane | New dependencies | Changed versions | New vulnerabilities | New hosts | Gate exit code |
|---|---|---|---|---|---|
| `arkit-app` | 0 | 0 | 0 | 0 | 0 PASS |
| `coach-tune` | 0 | 0 | 0 | 0 | 0 PASS |
| `core-calibration` | 0 | 1 | 0 | 0 | 0 PASS |
| `core-overnight` | 0 | 0 | 0 | 0 | 0 PASS |
| `craci` | 0 | 0 | 0 | 0 | 0 PASS |
| `demo-mode` | 0 | 0 | 0 | 0 | 0 PASS |
| `expert-priors` | 0 | 0 | 0 | 0 | 0 PASS |
| `fingerspelling-packs` | 0 | 0 | 0 | 0 | 0 PASS |
| `frontend-updates` | 0 | 0 | 0 | 0 | 0 PASS |
| `hand-root` | 0 | 0 | 0 | 0 | 0 PASS |
| `hand-round-2` | 0 | 0 | 0 | 0 | 0 PASS |
| `lidar` | 0 | 0 | 0 | 0 | 0 PASS |
| `merge-main` | 0 | 0 | 0 | 0 | 0 PASS |
| `models` | 0 | 0 | 0 | 0 | 0 PASS |
| `replay-demo` | 0 | 0 | 0 | 0 | 0 PASS |
| `robot-extras-wip` | 0 | 0 | 0 | 0 | 0 PASS |
| `robot-view` | 0 | 0 | 0 | 0 | 0 PASS |
| `rokoko-setup` | 0 | 1 | 0 | 0 | 0 PASS |
| `shadows` | 0 | 0 | 0 | 0 | 0 PASS |
| `slot-kit` | 0 | 0 | 0 | 0 | 0 PASS |
| `submission` | 0 | 0 | 0 | 0 | 0 PASS |
| `szymon-frontend` | 0 | 1 | 0 | 0 | 0 PASS |
| `thumb-align` | 0 | 0 | 0 | 0 | 0 PASS |
| `typing` | 0 | 1 | 0 | 0 | 0 PASS |
| `verda` | 0 | 1 | 0 | 0 | 0 PASS |
| `weights` | 0 | 1 | 0 | 2 | 1 BLOCK |
| `worktree-decisions` | 0 | 0 | 0 | 0 | 0 PASS |
| `worktree-export` | 0 | 1 | 0 | 0 | 0 PASS |

No lane adds a dependency that `main`'s build lacks. That is expected: 21 of 28 lanes have no commit that `main` lacks, and none of the 7 others changes a dependency file.

The changed version is the same package in all 7 lanes: `opencv-python-headless`. `main`'s build installs two versions, 4.11.0.86 (locked by `backend/uv.lock`) and 5.0.0.93 (from `verda/uv.lock`). Six lanes install only 4.11.0.86. `verda` installs only 5.0.0.93.

### The one block: `weights`

| Host | Step running when CRACI first saw it | Requests |
|---|---|---|
| `copilot-proxy.githubusercontent.com` | Set up job | DNS lookups and one `GET /_dns` |
| `pkg.github.com` | Set up job | DNS lookups and one `GET /_dns` |

Both requests came at 23:08:52 UTC, during job setup, next to the same `GET /_dns` probes to `github.com`, `api.github.com` and `codeload.github.com`. That is before `actions/checkout` placed the lane's code on the machine. So the lane's code did not make them. They look like a connectivity check by the GitHub runner. Only 1 of 29 traces contains them. The gate still blocks, because it has no rule for runner traffic. A person decides: add both hosts to `tools/agent_bom/allowed_hosts.txt` with this reason, or re-run the `weights` build.

### Hosts every build contacts

All 29 traces share the same 15 hosts. No request was denied (the default CRACI policy observes and allows).

| Kind | Hosts |
|---|---|
| Package registries | `pypi.org`, `files.pythonhosted.org`, `registry.npmjs.org`, `registry.yarnpkg.com` (one download, `yarn-1.22.22.tgz`, during `actions/setup-node`) |
| GitHub source and API | `github.com`, `api.github.com`, `codeload.github.com`, `release-assets.githubusercontent.com` |
| GitHub Actions service | `broker.`, `launch.`, `results-receiver.`, `run.`, `run-actions-3-azure-eastus.`, `token.actions.githubusercontent.com`, `productionresultssa12.blob.core.windows.net` |

### `main`'s own high and critical entries (the baseline the gate cannot see)

| Severity | Package | Advisory | Ecosystem | Brought in by |
|---|---|---|---|---|
| critical | `tinypool@1.1.1` | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr | npm | `0681d64`, direct to `main` (frontend rework) |
| critical | `vitest@2.1.9` | GHSA-5xrq-8626-4rwp | npm | `0681d64`, direct to `main` |
| high | `vite@5.4.21` | GHSA-587h-7wmj-h5pm | npm | `2c7ff54`, direct to `main` (frontend scaffold) |
| high | `torch@2.7.1` | GHSA-63cw-57p8-fm3p | PyPI | `f2df0fd`, lane `worktree-export` (cherry-picked) |
| high | `fsspec@2025.3.0` | GHSA-27vj-qcqg-25rc, PYSEC-2026-4217 | PyPI | `f2df0fd`, lane `worktree-export` (cherry-picked) |

Source: CRACI SBOM of job 132618946275, `vulnerabilities[]` (source `osv`). "Brought in by": `python3 -m tools.agent_bom history`. The gate now prints this list as a note on every verdict.

## 5. Which lane brought each package into main (git)

`python3 -m tools.agent_bom history` walks the history of every lockfile on `main`. It finds the first commit that locked each package, then the first-parent merge that brought the commit into `main`. A commit that reached `main` by cherry-pick is matched to its lane by its subject.

| Lane that brought it into main | Lockfile | Packages | First commit |
|---|---|---|---|
| `main` (direct, frontend scaffold) | `frontend/package-lock.json` | 287 | `2c7ff54` |
| `main` (direct, frontend rework) | `frontend/package-lock.json` | 30 | `0681d64` |
| `worktree-export` (cherry-picked) | `export/uv.lock` | 132 | `f2df0fd` |
| `main` (direct, backend scaffold) | `backend/uv.lock` | 66 | `6852a30` |
| `verda` | `verda/uv.lock` | 50 | `b8c8e71` |
| `core-overnight` | `requirements.txt` | 10 | `b798106` |
| `main` (direct, genui prototype) | `genui/package-lock.json` | 7 | `efc0465` |

Only 8 commits on `main` ever changed a core, backend or frontend dependency file. The lanes added dependencies mostly by starting side projects, not by growing the main ones.

The core's `requirements.txt` has no versions and no lockfile. The CRACI SBOM of a core job is the only record of what it installed. For example, it installed `opencv-contrib-python` 5.0.0.93.

## 6. Merge gate

The gate fails closed. It blocks a lane when the lane's CRACI build:

1. adds a package with a `high` or `critical` vulnerability that `main`'s build does not have, or
2. contacts a host that `main`'s build never contacts, and the host is not in `tools/agent_bom/allowed_hosts.txt`.

It gives "no evidence" when the token or a lane build is missing. "No evidence" is not a pass. Each block reason names the step that was running when CRACI first saw the host. Each verdict also prints `main`'s own high and critical entries.

Result on Sun 15 Nov, 01:23 to 01:27 Helsinki time: 27 lanes PASS (exit 0), 1 lane BLOCK (exit 1, `weights`, two hosts during job setup, see section 4), 0 lanes NO EVIDENCE.

### Text for the dispatcher's merge notes (`briefs/LAUNCH.md`, `RUNBOOK.md`)

```text
CRACI merge gate (run before every lane merge; owner: dispatcher)

1. Make sure the lane and main have a CRACI build of their current tips:
     gh workflow run lane-audit.yml --repo Arpan-206/HackJunction2026 --ref craci -f lanes="main <lane>"
     gh run watch --repo Arpan-206/HackJunction2026 $(gh run list --repo Arpan-206/HackJunction2026 --workflow lane-audit.yml --limit 1 --json databaseId --jq '.[0].databaseId')
2. From a checkout that has tools/agent_bom (the craci branch until it merges), at the repo root:
     python3 -m tools.agent_bom gate <lane>
3. Read the exit code:
     0  PASS          merge.
     1  BLOCK         do not merge. Each printed line is one reason:
                      "<severity> vulnerability <id> in <package>@<version>" or
                      "unexpected host <host>: main's build never contacts it, first seen during step '<step>'".
                      Send the reasons to the lane. To accept a host on purpose, add it to
                      tools/agent_bom/allowed_hosts.txt in its own commit, with the reason.
     2  NO EVIDENCE   the token (CRACI_API_TOKEN in .env) or a lane build is missing.
                      Not a pass. Fix the cause (step 1) and run the gate again.
4. Paste the gate output into the merge commit message.
5. Never merge a dependency upgrade into main before the demo, whatever the gate says.
```

## 7. AI fix

The CRACI API has no fix endpoint. I checked the OpenAPI spec again on Sun 15 Nov (version `2026-09-11`, 9 operations: SBOM, OCI manifest SBOM, three artifact provenance lookups, job logs, active jobs, network trace, usage). It has no fix, remediation or vulnerability operation. So the AI fix runs from the CRACI web app, and Arpan triggers it himself.

**No dependency upgrade merges into `main` before the demo.** A fix branch stays unmerged. This lane does not propose one for merge.

### Steps for Arpan

1. Open `platform.craci.com/projects/hackjunction2026/jobs/132618946275` (job `lane main`, run 43650860815; URL pattern from the first run's log).
2. Open its vulnerability list. Pick `vitest@2.1.9` or `tinypool@1.1.1` (critical) or `vite@5.4.21` (high).
3. Use the AI fix action. Let it write to its own branch, for example `craci-ai-fix`. Do not let it open a merge into `main`, or leave any such pull request as a draft.
4. Tell the `craci` lane the branch name. The lane then runs `gh workflow run lane-audit.yml --ref craci -f lanes="main craci-ai-fix"`, then `python3 -m tools.agent_bom report craci-ai-fix`, and writes the after report below.

### Before report (main, Sun 15 Nov)

| Source | Result |
|---|---|
| npm audit line in the CRACI job log | 15 vulnerabilities (12 moderate, 1 high, 2 critical) |
| CRACI SBOM, npm entries | 30 entries: 3 critical, 1 high, 13 medium, 1 low, 12 unknown |
| CRACI SBOM, all entries | 45 entries: 3 critical, 4 high, 17 medium, 3 low, 18 unknown |

CRACI SBOM entries per npm package on `main` (job 132618946275):

| Package | Entries | High or critical advisories |
|---|---|---|
| `tinypool@1.1.1` | 2 critical, 1 unknown | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr |
| `vitest@2.1.9` | 1 critical, 1 medium, 2 unknown | GHSA-5xrq-8626-4rwp |
| `vite@5.4.21` | 1 high, 6 medium, 1 low, 3 unknown | GHSA-587h-7wmj-h5pm |
| `@vitest/mocker@2.1.9` | 2 medium | |
| `react-router@6.30.6` | 2 medium | |
| `esbuild@0.21.5` | 1 medium | |
| `minimatch@10.2.6` | 1 medium, 1 unknown | |
| `minimatch@3.1.5`, `debug@4.4.3` | 2 unknown each | |
| `ms@2.1.3` | 1 unknown | |

"unknown" entries are TuxCare `CLSA-*` advisories from OSV that carry no severity.

npm's own proposal, for comparison only (not CRACI's): major upgrades to `vitest@5.1.0` and `vite@8.3.8`. Not applied.

### After report

Not run. At the time box no fix branch or pull request from CRACI existed on origin (checked with `git branch -r` and `gh pr list`).

## 8. Model server image provenance

| Item | Value | Source |
|---|---|---|
| Image the coach runs on Verda | `docker.io/vllm/vllm-openai:v0.29.0` (a tag) | `verda/deploy.py` `DEFAULT_IMAGE`, `docs/VERDA.md` |
| Index digest on Sat 14 Nov 22:55 UTC | `sha256:c2914767605584b6d8f45686b82de173ecc99e781897aa3d0a66dacd72c51ae1` | CRACI job 132617975360 (run 43650602941), `docker buildx imagetools inspect` |
| linux/amd64 manifest | `sha256:082ca6f035279109041ffd3fe0695cb568b29bc580b35c4f297a66a08b216c1b` | same job |
| linux/arm64 manifest | `sha256:18372a7224938643461b846fb64c5c9d3d6e9727e82caf2dc3043e620c9d4d7a` | same job |
| `GET /v1preview1/artifact-provenance/oci_manifest`, index digest | 404 "the requested artifact was not found" | API, Sun 15 Nov 01:24 |
| Same call, amd64 manifest digest | 404 "the requested artifact was not found" | API |
| `GET /v1experimental1/sbom/oci_manifest`, index digest | 404 "the manifest or index was not recorded for your organization" | API |

CRACI records provenance for artifacts that CRACI jobs create or push. vLLM's image is built elsewhere, and our job only read its manifest. So CRACI has no record of it. The model server is the one part of the coach with no build record we control. The deploy also uses the tag, not the digest: if the tag moves, the coach changes with no commit. Pinning the digest in `verda/deploy.py` is a change for the `verda` lane owner, after the demo.

## 9. How tools/agent_bom works

| File | Role |
|---|---|
| `tools/agent_bom/client.py` | CRACI API client. Only endpoints from the OpenAPI spec. Reads the token from the environment or a `.env` file (the worktree's, then the main checkout's); never prints it |
| `tools/agent_bom/sources.py` | GitHub job ids per lane (through `gh`), lockfile history and lane attribution (through git), step failures from job logs |
| `tools/agent_bom/analyse.py` | SBOM and trace parsing, diff against `main`, host first-seen times, the gate rule. No network, no git |
| `tools/agent_bom/__main__.py` | Commands: `check`, `report`, `gate`, `provenance` (CRACI API); `history`, `steps` (git and GitHub only) |
| `tools/agent_bom/tests/test_agent_bom.py` | 6 tests: 5 on spec-shaped fixtures (hand-written, marked as fixtures; no result here comes from them), 1 on real merge subjects from `main` |

The CRACI API looks a job up by its GitHub job id. Its job list only shows active jobs, so `agent_bom` finds finished jobs through the GitHub Actions API, by the job name `lane <branch>`.

### What the real responses taught us

| Assumption before the token | Real response | Change to the tool |
|---|---|---|
| The SBOM may carry a `vulnerabilities` list | It does: 45 entries on `main`, all `source.name` = `osv`, one rating each. 18 have severity `unknown` | Kept; `unknown` stays below `low` and never blocks |
| `affects[].ref` points at a component `bom-ref` | It is a full purl with version and qualifiers, for example `pkg:pypi/torch@2.7.1?file_name=...whl` | The tool strips qualifiers and keeps the version for the report |
| DNS `record` is "name and type" (spec) | Only the name, with a trailing dot: `pypi.org.` | First word, trailing dot removed: handles both |
| One version per package | `main` holds two versions of `minimatch`, `opencv-python-headless` and 14 more | Versions are now a set per package |
| Components carry `version` | They do not. The version is only in the purl | Version read from the purl |
| Every component is a dependency | The checked-out repository itself is a `pkg:github` component, with the job's commit as version | Skipped by the tool (read from `metadata.properties` `craci:job:repository`) |
| `job.commitSha` in the trace is the lane's commit | It is the workflow commit on `craci`. The lane commit is in the SBOM's `pkg:github` component | Lane identity comes from the job name |

Other API calls: `GET /v1preview1/jobs?status=active` returned 0 active jobs. `GET /v1preview1/usage` returned 503 "billing usage is temporarily unavailable".

## 10. Unverified

| Item | Why |
|---|---|
| The `weights` hosts come from the GitHub runner | Timing and the `/_dns` probe pattern only. The GitHub steps API gives whole seconds, so "Set up job" and the start of `actions/checkout` overlap |
| The `export/` failure on GitHub's own Ubuntu image | Seen only on CRACI's default image, which has no Python headers |
| Lane attribution of cherry-picked commits | Matched by commit subject. Two lanes with the same subject would collide |
| The demo uses the Vite dev server | Only CLAUDE.md says it runs `npm run dev` |

## Appendix: `agent_bom report` output, one table per lane

Generated by `python3 -m tools.agent_bom report` on Sun 15 Nov 01:22 Helsinki time. Lines that say "no commit that main lacks" mean the lane is behind `main`.

#### Lane `arkit-app`

CRACI job 132618946171 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `coach-tune`

CRACI job 132618946104 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `core-calibration`

CRACI job 132618946144 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

Gate: pass.

#### Lane `core-overnight`

CRACI job 132618946181 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `craci`

CRACI job 132618946132 (run 43650860815, build success).

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `demo-mode`

CRACI job 132618946140 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `expert-priors`

CRACI job 132618946162 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `fingerspelling-packs`

CRACI job 132618946198 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `frontend-updates`

CRACI job 132618946153 (run 43650860815, build success).

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `hand-root`

CRACI job 132618946097 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `hand-round-2`

CRACI job 132618946569 (run 43650860815, build success).

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `lidar`

CRACI job 132618946194 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `merge-main`

CRACI job 132618946182 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `models`

CRACI job 132618946191 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `replay-demo`

CRACI job 132618946157 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `robot-extras-wip`

CRACI job 132618946202 (run 43650860815, build success).

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `robot-view`

CRACI job 132618946230 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `rokoko-setup`

CRACI job 132618947169 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

Gate: pass.

#### Lane `shadows`

CRACI job 132618947166 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `slot-kit`

CRACI job 132618947240 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `submission`

CRACI job 132618947351 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `szymon-frontend`

CRACI job 132618947331 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

Gate: pass.

#### Lane `thumb-align`

CRACI job 132618947343 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `typing`

CRACI job 132618947355 (run 43650860815, build success).

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

Gate: pass.

#### Lane `verda`

CRACI job 132618947370 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 5.0.0.93 |

Gate: pass.

#### Lane `weights`

CRACI job 132618947367 (run 43650860815, build success).

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

| Host main never contacts | Step running when CRACI first saw it |
|---|---|
| `copilot-proxy.githubusercontent.com` | Set up job |
| `pkg.github.com` | Set up job |

Gate: BLOCK: unexpected host copilot-proxy.githubusercontent.com: main's build never contacts it, first seen during step 'Set up job'; unexpected host pkg.github.com: main's build never contacts it, first seen during step 'Set up job'.

#### Lane `worktree-decisions`

CRACI job 132618947733 (run 43650860815, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `worktree-export`

CRACI job 132618948132 (run 43650860815, build success).

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

Gate: pass.
