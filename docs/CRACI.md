# Who checked what the agents shipped? Geppetto on CRACI

**Most interesting real finding.** One line added by the `worktree-export` lane, `lerobot>=0.3.3` in `export/pyproject.toml`, locks 98 packages that neither the core nor the backend locks (`export/uv.lock`). With it, `export/` fails to install on Linux in 23 of 23 lane builds that contain it, in both audit runs. Every failure is the same: `evdev` 2.0.0 builds from source and finds no `Python.h`. `evdev` is an input-device library: it reads Linux input devices. uv names the chain in the log: `geppetto-export` depends on `lerobot`, which depends on `pynput`, which depends on `evdev`. The CRACI SBOMs show the cost even though the install fails. Builds that contain `export/` record 95 more PyPI packages and 15 more vulnerability entries than builds without it. Three of those entries are `high`: `torch` 2.7.1 (GHSA-63cw-57p8-fm3p) and `fsspec` 2025.3.0 (GHSA-27vj-qcqg-25rc, PYSEC-2026-4217). `export/` is already in `main`, so these entries are part of `main`'s baseline, where a gate that only blocks new vulnerabilities cannot see them. Sources: lane audit run 43653716590 (job logs and CRACI SBOMs), `export/uv.lock` on `origin/main`.

Status on Sun 15 Nov 2026, written by the `craci` lane. Every number names its source. All API results are real responses from `api.craci.com`. Unless a table says otherwise, it comes from the rebuild under the Monitored policy: lane audit run 43653716590 (23:32 to 23:49 UTC, Sat 14 Nov).

Words used here:

- **CRACI**: a CI service. It runs GitHub Actions jobs on its own Linux machines and records what each job downloads and contacts.
- **Lane**: one AI coding agent on its own git branch.
- **SBOM (software bill of materials)**: the list of every package a build used. CRACI writes one per job, in CycloneDX 1.7 format.
- **Network trace**: the list of network accesses (HTTP, DNS, TCP, SSH git) of one job, as CRACI observed them.
- **Network policy**: the rules that say which hosts a CRACI job may reach. "Monitored" means all built-in presets on and unmatched traffic blocked (`default: deny`).
- **Merge gate**: a check the dispatcher runs before a lane merges into `main`.
- **Digest**: the sha256 hash that names one exact container image. A tag such as `v0.29.0` can move; a digest cannot.

## 1. What runs on CRACI

| Workflow | Trigger | Jobs | Purpose |
|---|---|---|---|
| `.github/workflows/craci-hello.yml` | push to `craci`, manual | 1 | First run, for CRACI onboarding |
| `.github/workflows/ci.yml` | push to any branch (`'**'`), manual | 3: `core`, `backend`, `frontend` | The three test suites, unchanged commands |
| `.github/workflows/lane-audit.yml` | manual, or a change to the file on `craci` | 1 + one per lane | Checks out every lane at its tip, installs and tests it |
| `.github/workflows/model-image.yml` | manual, or a change to the file on `craci` | 1 | Resolves the coach image digest through CRACI |
| `.github/workflows/policy-check.yml` | manual, or a change to the file on `craci` | 1 | Passes only if CRACI blocks a host that no preset covers |

Every job starts with `cracicorp/setup@v1` and `network: default: deny`, with presets omitted (so all built-in presets are on). No job uses a cache: a restored cache carries the producing job's SBOM, and a legacy cache has no evidence (docs.craci.com, "Understand job and cache SBOM completeness").

`ci.yml` only runs on a branch that contains it. Lane branches get it when they next merge `main`. Until then, `lane-audit.yml` covers them from the `craci` branch, so no lane branch is touched. The lane audit also installs the three side projects that have their own lockfiles: `verda/`, `export/` and `genui/`.

## 2. First run

| Item | Value | Source |
|---|---|---|
| Run | GitHub run 43650216740, job 132616780656, `success`, 20 s | `gh run view 43650216740` |
| Runner | `craci-3-7d9afbca`, label `craci` | GitHub jobs API |
| CRACI link in the job log | `platform.craci.com/projects/hackjunction2026/jobs/132616780656` | job log, "Set up job" |
| Machine | Ubuntu 24.04.4 LTS, x86_64 | job log, `uname -a` and `/etc/os-release` |
| Queue time | about 5 s (created 22:50:57 UTC, started 22:51:02 UTC) | GitHub jobs API |

## 3. The SBOM count scare, and the policy change

For a time on Sun 15 Nov the CRACI web app showed 0 packages for the `lane main` job, with a warning that the network policy allowed unmatched traffic and the SBOM was incomplete. The API returned 460 components for the same job (132618946275), and the web view later showed 460 as well. We switched every workflow to the Monitored policy anyway, at commit `0a24711`, and rebuilt every lane.

| Job | Before: default policy | After: Monitored policy |
|---|---|---|
| `lane main` (lane audit) | 460 components, job 132618946275 | 460 components, job 132627637904 |
| `ci` core | 55 components, job 132626747599 | 55 components, job 132627550946 |
| `ci` backend | 52 components, job 132626747539 | 52 components, job 132627550698 |
| `ci` frontend | 289 components, job 132626747427 | 289 components, job 132627550937 |

The counts did not change. Every rebuilt lane job passed, and no trace has a denied observation.

### Is `default: deny` applied? Not proven, and one test says no

The `cracicorp/setup` step does not appear in the GitHub step list or the job log. The docs say CRACI reads the step's inputs when it schedules the job. So the logs alone cannot prove the policy.

To test it, `policy-check.yml` requests `https://example.com/`, which no preset covers, under `default: deny`. Result (run 43655101763, job 132631785839, 23:49 UTC): the request **succeeded** with HTTP 200, and the job failed as designed. The CRACI trace of that job records the request with `policyDenied: false` and no `matchedRule`. The log has no warning about an invalid setup input. So in this job the deny policy was not enforced. We do not know why: an organization runner template, or the setup step not being read, are both possible. The lane traces agree. In 59 lane traces from both audit runs, every HTTP request matched a preset rule except the runner's `GET /_dns` probes to `pkg.github.com` and `copilot-proxy.githubusercontent.com` (section 5). Those probes have no `matchedRule`, and they were allowed in 7 rebuilt jobs that ran under `default: deny`. Arpan should check **Settings, Runner templates** in the CRACI web app. The SBOMs are not affected by this question: every package download matched a preset rule under both policies.

## 4. Builds on CRACI

| Workflow run | Jobs | Succeeded | Note |
|---|---|---|---|
| Lane audit 43650860815 (default policy) | 30 | 30 | 22:59 to 23:12 UTC; tables in an earlier version of this file came from it |
| Lane audit 43653716590 (Monitored policy) | 30 | 30 | 23:32 to 23:49 UTC; the tables below come from it |
| All runs on `craci` up to 23:15 UTC | 74 jobs got a CRACI runner | 66 | 8 cancelled while running |

Later pushes to `craci` added more `craci-hello`, `ci`, `model-image` and `policy-check` runs. Every `ci` run on `craci` passed.

A lane job is green even when a step inside it fails, because the audit steps use `continue-on-error`. `python3 -m tools.agent_bom steps 43653716590` reads the step failures from the job logs:

| Step | Lanes where the step ran | Passed | Failed | Failure |
|---|---|---|---|---|
| Core install and tests | 29 | 29 | 0 | |
| Backend install and tests | 29 | 29 | 0 | |
| Frontend install, lint, tests and build | 29 | 28 | 1 | `robot-extras-wip`: 1 of 286 tests, `robotUrdf.test.ts` (line endings `\n` against `\r\n` in a copied robot model file) |
| `verda/` install | 18 | 18 | 0 | |
| `export/` install | 23 | 0 | 23 | `evdev` 2.0.0 source build: `Python.h: No such file or directory` |
| `genui/` install | 29 | 29 | 0 | |

`npm ci` in `frontend/` printed the same audit line in all 29 builds: "15 vulnerabilities (12 moderate, 1 high, 2 critical)".

## 5. Per-lane audit (CRACI API)

### Every lane build, as the API returned it

`python3 -m tools.agent_bom inventory`, Sun 15 Nov 01:52 Helsinki time. 60 API calls (one SBOM and one trace per lane job), all returned 200. `craci-fix` comes from its own run (43654246703), the AI fix branch (section 8).

| Lane | CRACI job | SBOM components | Packages | PyPI | npm | Vulnerability entries | High or critical | Hosts | Trace observations | Denied |
|---|---|---|---|---|---|---|---|---|---|---|
| `main` | 132627637904 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 872 | 0 |
| `arkit-app` | 132627637847 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 861 | 0 |
| `coach-tune` | 132627637823 | 460 | 441 | 162 | 274 | 45 | 7 | 17 | 876 | 0 |
| `core-calibration` | 132627637807 | 456 | 438 | 159 | 274 | 45 | 7 | 15 | 841 | 0 |
| `core-overnight` | 132627637792 | 364 | 346 | 67 | 274 | 30 | 4 | 15 | 632 | 0 |
| `craci` | 132627637789 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 874 | 0 |
| `craci-fix` | 132629338604 | 460 | 441 | 166 | 270 | 11 | 0 | 15 | 863 | 0 |
| `demo-mode` | 132627637839 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 866 | 0 |
| `expert-priors` | 132627637854 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 855 | 0 |
| `fingerspelling-packs` | 132627637830 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 860 | 0 |
| `frontend-updates` | 132627637845 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 866 | 0 |
| `hand-root` | 132627637886 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 856 | 0 |
| `hand-round-2` | 132627637803 | 364 | 346 | 67 | 274 | 30 | 4 | 17 | 665 | 0 |
| `lidar` | 132627637885 | 459 | 440 | 161 | 274 | 45 | 7 | 17 | 877 | 0 |
| `merge-main` | 132627637993 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 863 | 0 |
| `models` | 132627638001 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 858 | 0 |
| `replay-demo` | 132627637931 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 866 | 0 |
| `robot-extras-wip` | 132627638011 | 364 | 346 | 67 | 274 | 30 | 4 | 15 | 634 | 0 |
| `robot-view` | 132627638043 | 364 | 346 | 67 | 274 | 30 | 4 | 15 | 646 | 0 |
| `rokoko-setup` | 132627638933 | 456 | 438 | 159 | 274 | 45 | 7 | 15 | 845 | 0 |
| `shadows` | 132627638942 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 865 | 0 |
| `slot-kit` | 132627639041 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 860 | 0 |
| `submission` | 132627639042 | 460 | 441 | 162 | 274 | 45 | 7 | 17 | 870 | 0 |
| `szymon-frontend` | 132627639058 | 456 | 438 | 159 | 274 | 45 | 7 | 17 | 848 | 0 |
| `thumb-align` | 132627639116 | 460 | 441 | 162 | 274 | 45 | 7 | 15 | 862 | 0 |
| `typing` | 132627639257 | 456 | 438 | 159 | 274 | 45 | 7 | 17 | 854 | 0 |
| `verda` | 132627639096 | 370 | 352 | 73 | 274 | 30 | 4 | 15 | 655 | 0 |
| `weights` | 132627639137 | 456 | 438 | 159 | 274 | 45 | 7 | 15 | 839 | 0 |
| `worktree-decisions` | 132627639181 | 364 | 346 | 67 | 274 | 30 | 4 | 17 | 658 | 0 |
| `worktree-export` | 132627639830 | 456 | 438 | 159 | 274 | 45 | 7 | 15 | 843 | 0 |

"Packages" counts distinct package names (purl without version). "Vulnerability entries" counts distinct (advisory, package) pairs.

The split is clean. The 23 builds with `export/` have 438 to 441 packages, 45 entries and 7 high or critical. The 6 builds without `export/` have 346 to 352 packages, 30 entries and 4 high or critical. That difference is the `lerobot` line (opening finding).

### Summary against `main`, with the gate result

`python3 -m tools.agent_bom report` and `python3 -m tools.agent_bom gate <lane>` for every lane, Sun 15 Nov about 01:55 Helsinki time.

| Lane | New dependencies | Changed versions | New vulnerabilities (high or critical) | New hosts | Gate exit code |
|---|---|---|---|---|---|
| `arkit-app` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `coach-tune` | 0 | 0 | 0 (0) | 2 | 1 BLOCK |
| `core-calibration` | 0 | 1 | 0 (0) | 0 | 0 PASS |
| `core-overnight` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `craci` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `craci-fix` | 22 | 21 | 0 (0) | 2 | 1 BLOCK |
| `demo-mode` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `expert-priors` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `fingerspelling-packs` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `frontend-updates` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `hand-root` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `hand-round-2` | 0 | 0 | 0 (0) | 2 | 1 BLOCK |
| `lidar` | 0 | 0 | 0 (0) | 2 | 1 BLOCK |
| `merge-main` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `models` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `replay-demo` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `robot-extras-wip` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `robot-view` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `rokoko-setup` | 0 | 1 | 0 (0) | 0 | 0 PASS |
| `shadows` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `slot-kit` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `submission` | 0 | 0 | 0 (0) | 2 | 1 BLOCK |
| `szymon-frontend` | 0 | 1 | 0 (0) | 2 | 1 BLOCK |
| `thumb-align` | 0 | 0 | 0 (0) | 0 | 0 PASS |
| `typing` | 0 | 1 | 0 (0) | 2 | 1 BLOCK |
| `verda` | 0 | 1 | 0 (0) | 0 | 0 PASS |
| `weights` | 0 | 1 | 0 (0) | 0 | 0 PASS |
| `worktree-decisions` | 0 | 0 | 0 (0) | 2 | 1 BLOCK |
| `worktree-export` | 0 | 1 | 0 (0) | 0 | 0 PASS |

Result: 21 lanes PASS (exit 0), 8 BLOCK (exit 1), 0 NO EVIDENCE (exit 2). Every block is a host, none is a vulnerability.

No merged lane adds a dependency that `main`'s build lacks. That is expected: 21 of 28 lane branches have no commit that `main` lacks, and none of the other 7 changes a dependency file. The changed version in 7 lanes is the same package, `opencv-python-headless`: `main`'s build installs 4.11.0.86 (`backend/uv.lock`) and 5.0.0.93 (`verda/uv.lock`), and those lanes install only one of them.

### Why 8 lanes block: runner traffic, not lane code

| Lanes | Hosts | Step running when CRACI first saw them |
|---|---|---|
| `coach-tune`, `hand-round-2`, `lidar`, `submission`, `szymon-frontend`, `typing`, `worktree-decisions` | `copilot-proxy.githubusercontent.com`, `pkg.github.com` | Set up job, or the start of `actions/checkout` |
| `craci-fix` | `productionresultssa30.blob.core.windows.net`, `run-actions-3-azure-eastus.actions.githubusercontent.com` | `actions/checkout`, or none recorded |

The first pair are `GET /_dns` probes made next to the same probes to `github.com`, `api.github.com` and `codeload.github.com`, before the lane's code is on the machine. They come and go between runs: `weights` had them in the first audit and not in the rebuild, and 7 other lanes have them now. The second pair are GitHub Actions service hosts in another region. None of this is lane code. The gate still blocks, because it has no rule for runner traffic yet. A person decides whether to add these four hosts to `tools/agent_bom/allowed_hosts.txt`.

### Hosts every build contacts

| Kind | Hosts |
|---|---|
| Package registries | `pypi.org`, `files.pythonhosted.org`, `registry.npmjs.org`, `registry.yarnpkg.com` (one download, `yarn-1.22.22.tgz`, during `actions/setup-node`) |
| GitHub source and API | `github.com`, `api.github.com`, `codeload.github.com`, `release-assets.githubusercontent.com` |
| GitHub Actions service | `broker.`, `launch.`, `results-receiver.`, `run.`, `run-actions-3-azure-eastus.`, `token.actions.githubusercontent.com`, `productionresultssa12.blob.core.windows.net` |

### `main`'s own high and critical entries (the baseline the gate cannot see)

| Severity | Package | Advisory | Brought in by |
|---|---|---|---|
| critical | `tinypool@1.1.1` | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr | `0681d64`, direct to `main` (frontend rework) |
| critical | `vitest@2.1.9` | GHSA-5xrq-8626-4rwp | `0681d64`, direct to `main` |
| high | `vite@5.4.21` | GHSA-587h-7wmj-h5pm | `2c7ff54`, direct to `main` (frontend scaffold) |
| high | `torch@2.7.1` | GHSA-63cw-57p8-fm3p | `f2df0fd`, lane `worktree-export` (cherry-picked) |
| high | `fsspec@2025.3.0` | GHSA-27vj-qcqg-25rc, PYSEC-2026-4217 | `f2df0fd`, lane `worktree-export` (cherry-picked) |

Source: CRACI SBOM of job 132627637904, `vulnerabilities[]` (source `osv`). "Brought in by": `python3 -m tools.agent_bom history`. Every gate verdict now prints this list as a note.

## 6. Which lane brought each package into main (git)

`python3 -m tools.agent_bom history` walks the history of every lockfile on `main`. It finds the first commit that locked each package, then the first-parent merge that brought the commit into `main`. A cherry-picked commit is matched to its lane by its subject.

| Lane that brought it into main | Lockfile | Packages | First commit |
|---|---|---|---|
| `main` (direct, frontend scaffold) | `frontend/package-lock.json` | 287 | `2c7ff54` |
| `main` (direct, frontend rework) | `frontend/package-lock.json` | 30 | `0681d64` |
| `worktree-export` (cherry-picked) | `export/uv.lock` | 132 | `f2df0fd` |
| `main` (direct, backend scaffold) | `backend/uv.lock` | 66 | `6852a30` |
| `verda` | `verda/uv.lock` | 50 | `b8c8e71` |
| `core-overnight` | `requirements.txt` | 10 | `b798106` |
| `main` (direct, genui prototype) | `genui/package-lock.json` | 7 | `efc0465` |

Only 8 commits on `main` ever changed a core, backend or frontend dependency file. The lanes added dependencies mostly by starting side projects. The core's `requirements.txt` has no versions and no lockfile, so the CRACI SBOM of a core job is the only record of what it installed.

## 7. Merge gate

The gate fails closed. It blocks a lane when the lane's CRACI build:

1. adds a package with a `high` or `critical` vulnerability that `main`'s build does not have, or
2. contacts a host that `main`'s build never contacts, and the host is not in `tools/agent_bom/allowed_hosts.txt`.

It gives "no evidence" when the token or a lane build is missing. "No evidence" is not a pass. Each block reason names the step that was running when CRACI first saw the host. Each verdict also prints `main`'s own high and critical entries.

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
     1  BLOCK         do not merge yet. Each printed line is one reason:
                      "<severity> vulnerability <id> in <package>@<version>" or
                      "unexpected host <host>: main's build never contacts it, first seen during step '<step>'".
                      A host first seen during "Set up job" or "actions/checkout" is runner traffic,
                      not lane code: re-run the lane audit, or accept the host on purpose in
                      tools/agent_bom/allowed_hosts.txt (own commit, with the reason).
     2  NO EVIDENCE   the token (CRACI_API_TOKEN in .env) or a lane build is missing.
                      Not a pass. Fix the cause (step 1) and run the gate again.
4. Paste the gate output into the merge commit message.
5. Never merge a dependency upgrade into main before the demo, whatever the gate says.
   The branch craci-fix never merges.
```

## 8. AI fix

**The fix was applied on an unmerged branch, `craci-fix` (draft PR #14, "DO NOT MERGE before the demo"). It never merges, before or after the demo.** The full write-up is `docs/CRACI_FIX.md` on that branch, by a second agent. This section only summarises it.

The CRACI API has no fix endpoint: the OpenAPI spec (version `2026-09-11`, 9 operations) has no fix, remediation or vulnerability operation. The AI fix in CRACI is a prompt that the web app generates for the user to hand to a coding agent. Arpan copied that prompt from the web app for the `lane main` build. It listed 6 critical and high advisories. No agent read the web app's Vulnerabilities tab.

| Item | Before (`lane main`, job 132627637904) | After (`lane craci-fix`, job 132629338604) |
|---|---|---|
| CRACI SBOM components | 460 | 460 |
| Vulnerability entries | 45 | 11 |
| Critical | 3 | 0 |
| High | 4 | 0 |
| npm audit line in the job log | 15 (2 critical, 1 high, 12 moderate) | 9 moderate |

What the fix changed (from `docs/CRACI_FIX.md`): `vitest` 2.1.9 to 4.1.12 and `vite` 5.4.21 to 6.4.6 in `frontend/` (`tinypool` drops out with vitest 4); in `export/`, uv overrides `fsspec` to 2026.9.0 and `torch` to 2.15.0. `npm audit fix` cleared none, because every npm fix needs a major version. Suites on CRACI (ci run 43654229444): core 275 passed and 7 skipped, backend 503 passed and 13 skipped, frontend 616 of 616 with lint and build.

What `agent_bom` adds about the fix itself (report above, lane `craci-fix`): it brings **22 new dependencies** and 21 changed versions. 18 of the new ones are NVIDIA CUDA 13 wheels and CUDA bindings, pulled by the `torch` 2.15.0 override (commit `ba42a58`). 4 are small npm packages from vitest 4 (commit `1990da6`). The fix removes every high and critical entry, and it also grows the export project's download. That is the kind of trade a person should see before any merge.

## 9. Model server image provenance

| Item | Value | Source |
|---|---|---|
| Image the coach runs on Verda | `docker.io/vllm/vllm-openai:v0.29.0` (a tag) | `verda/deploy.py` `DEFAULT_IMAGE`, `docs/VERDA.md` |
| Index digest on Sat 14 Nov 22:55 UTC | `sha256:c2914767605584b6d8f45686b82de173ecc99e781897aa3d0a66dacd72c51ae1` | CRACI job 132617975360, `docker buildx imagetools inspect` |
| linux/amd64 manifest | `sha256:082ca6f035279109041ffd3fe0695cb568b29bc580b35c4f297a66a08b216c1b` | same job |
| linux/arm64 manifest | `sha256:18372a7224938643461b846fb64c5c9d3d6e9727e82caf2dc3043e620c9d4d7a` | same job |
| SBOM of that job | 3 components, all `pkg:oci/vllm-openai@sha256:...` with `repository_url=registry-1.docker.io/vllm/vllm-openai`: the index and both manifests | API, job 132617975360 (and 132627549352 under the Monitored policy) |
| `GET /v1preview1/artifact-provenance/oci_manifest`, index and amd64 digests | 404 "the requested artifact was not found" | API, Sun 15 Nov 01:24 |
| `GET /v1experimental1/sbom/oci_manifest`, index digest | 404 "the manifest or index was not recorded for your organization" | API |

So CRACI records that our job read the image (the SBOM names all three digests), but it has no provenance for it: vLLM's image was not built or pushed by a CRACI job. The model server is the one part of the coach with no build record we control. The deploy also uses the tag, not the digest. Pinning the digest in `verda/deploy.py` is for the `verda` lane owner, after the demo.

## 10. The public tour publishes its own SBOM

The public tour is a static site. It lets anyone see Geppetto with no gloves, no login and no backend. It lives on
the branch `public-tour`, which is built on CRACI and never merges into `main`.

The build job records every package that it downloads. After the build job ends, a second job gets the SBOM of the
build job from the CRACI API. An SBOM is a list of packages in the CycloneDX format. The second job puts the SBOM and a
short summary into the site. A link on every stop, "What's in this site", opens a plain page. The page shows the
commit, the CRACI job link, the number of packages and the known vulnerabilities by severity. It also gives the SBOM
file for download. The list includes the build tools and the test tools. It is not the list of code inside the page.
If the SBOM is empty, incomplete or not available, the page says so and gives the reason.

The build that we published on 15 Nov 2026:

| Item | Value |
|---|---|
| Commit | `5fb1337` on `public-tour` |
| Run and build job | run 43664418557, job 132660526152 |
| CRACI job page | `https://platform.craci.com/projects/hackjunction2026/jobs/132660526152` |
| Packages in the SBOM file | 339: 287 npm, 48 Ubuntu (deb), 4 GitHub |
| Vulnerability entries | 133: critical 5, high 43, medium 60, low 7, unknown 18 |

Where the critical and high entries are:

| Package | Critical | High | Why the build has it |
|---|---|---|---|
| `xvfb` and `xserver-common` (Ubuntu) | 2 | 42 | The browser check needs a display on a runner that has no screen |
| `tinypool` and `vitest` (npm) | 3 | 0 | The frontend test tools; the same entries as on `main` |
| `vite` (npm) | 0 | 1 | The build tool; the same entry as on `main` |

None of these packages is inside the page that a visitor loads. We show the numbers as they are, and we upgrade
nothing: the fix for the three npm packages is on the unmerged branch `craci-fix` (section 8).

Two limits, stated plainly:

- In the workflow, the second job got HTTP 403 from the CRACI API with the token from the repository secret. We
  checked three things. The secret is the right token: its SHA-256 fingerprint and length equal those of the token
  that works on a laptop. The network policy did not block the call: the job's own network trace shows the connection
  to `api.craci.com` on port 443 as allowed, with bytes in both directions. The authentication guide names no scope,
  no address list and no runner limit. So the API itself refused a request that came from inside a CRACI runner,
  while the same request from a laptop works. This is a question for CRACI. For the published build the SBOM was
  fetched on a laptop after the run and added to the site, and the leak check ran again on the final folder.
- The first summary in the site said 338 packages while the SBOM file holds 339. The one left out was the checked-out
  repository itself. The page now counts every component in the file, and a check compares the page with the file.

## 11. How tools/agent_bom works

| File | Role |
|---|---|
| `tools/agent_bom/client.py` | CRACI API client. Only endpoints from the OpenAPI spec. Reads the token from the environment or a `.env` file (the worktree's, then the main checkout's); never prints it |
| `tools/agent_bom/sources.py` | GitHub job ids per lane (through `gh`), lockfile history and lane attribution (through git), step failures from job logs |
| `tools/agent_bom/analyse.py` | SBOM and trace parsing, diff against `main`, host first-seen times, the gate rule. No network, no git |
| `tools/agent_bom/__main__.py` | Commands: `check`, `inventory`, `report`, `gate`, `provenance` (CRACI API); `history`, `steps` (git and GitHub only) |
| `tools/agent_bom/tests/test_agent_bom.py` | 7 tests: 5 on spec-shaped fixtures and 1 on a fixture in the real response shape (all hand-written and marked as fixtures; no result here comes from them), 1 on real merge subjects from `main`. They run in the `ci` core job on CRACI |

### What the real responses taught us

| Assumption before the token | Real response | Change to the tool |
|---|---|---|
| The SBOM may carry a `vulnerabilities` list | It does: 45 entries on `main`, all `source.name` = `osv`, one rating each. 18 have severity `unknown` | Kept; `unknown` never blocks |
| `affects[].ref` points at a component `bom-ref` | It is a full purl with version and qualifiers | The tool strips qualifiers and keeps the version |
| DNS `record` is "name and type" (spec) | Only the name, with a trailing dot: `pypi.org.` | First word, trailing dot removed |
| One version per package | `main` holds two versions of 16 packages, for example `minimatch` and `opencv-python-headless` | Versions are a set per package |
| Components carry `version` | They do not; the version is only in the purl | Version read from the purl |
| Every component is a dependency | The checked-out repository is a `pkg:github` component, with the commit as version | Skipped (read from `metadata.properties` `craci:job:repository`) |
| `job.commitSha` in the trace is the lane's commit | It is the workflow commit on `craci` | Lane identity comes from the job name |

Other API calls: `GET /v1preview1/jobs?status=active` returned 0 active jobs. `GET /v1preview1/usage` returned 503 "billing usage is temporarily unavailable".

## 12. Unverified

| Item | Why |
|---|---|
| Why `default: deny` did not block `example.com` | One test job only (section 3). An organization runner template is a possible cause; not checked |
| The `copilot-proxy` and `pkg.github.com` probes come from the GitHub runner | Timing and the `/_dns` pattern only. The GitHub steps API gives whole seconds |
| The `export/` failure on GitHub's own Ubuntu image | Seen only on CRACI's default image, which has no Python headers |
| Lane attribution of cherry-picked commits | Matched by commit subject |
| The demo uses the Vite dev server | Only CLAUDE.md says it runs `npm run dev` |

## Appendix: `agent_bom report` output, one table per lane (run 43653716590)

Generated by `python3 -m tools.agent_bom report` on Sun 15 Nov about 01:55 Helsinki time. "No commit that main lacks" means the lane is behind `main`.

#### Lane `arkit-app`

CRACI job 132627637847 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `coach-tune`

CRACI job 132627637823 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Host main never contacts | Step running when CRACI first saw it |
|---|---|
| `copilot-proxy.githubusercontent.com` | Set up job |
| `pkg.github.com` | Set up job |

Gate: BLOCK: unexpected host copilot-proxy.githubusercontent.com: main's build never contacts it, first seen during step 'Set up job'; unexpected host pkg.github.com: main's build never contacts it, first seen during step 'Set up job'.

#### Lane `core-calibration`

CRACI job 132627637807 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

Gate: pass.

#### Lane `core-overnight`

CRACI job 132627637792 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `craci`

CRACI job 132627637789 (run 43653716590, build success).

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `craci-fix`

CRACI job 132629338604 (run 43654246703, build success).

| New dependency | Version | Ecosystem | Introduced by |
|---|---|---|---|
| `@standard-schema/spec` | 1.1.0 | npm | `1990da6` frontend: vitest 2.1.9 to 4.1.12, vite 5.4.21 to 6.4.6 (CRACI critical and high) (lane-only commit) |
| `@types/chai` | 5.2.3 | npm | `1990da6` frontend: vitest 2.1.9 to 4.1.12, vite 5.4.21 to 6.4.6 (CRACI critical and high) (lane-only commit) |
| `@types/deep-eql` | 4.0.2 | npm | `1990da6` frontend: vitest 2.1.9 to 4.1.12, vite 5.4.21 to 6.4.6 (CRACI critical and high) (lane-only commit) |
| `obug` | 2.2.1 | npm | `1990da6` frontend: vitest 2.1.9 to 4.1.12, vite 5.4.21 to 6.4.6 (CRACI critical and high) (lane-only commit) |
| `cuda-bindings` | 13.5.0 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `cuda-pathfinder` | 1.9.0 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `cuda-toolkit` | 13.2.2 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cublas` | 13.4.1.3 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cuda-cccl` | 13.3.5.0.6 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cuda-cupti` | 13.2.86 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cuda-nvrtc` | 13.2.86 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cuda-runtime` | 13.2.86 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cudnn-cu13` | 9.26.0.51 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cufft` | 12.2.0.57 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cufile` | 1.17.1.22 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cusolver` | 12.2.0.11 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cusparse` | 12.7.10.12 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-cusparselt-cu13` | 0.8.1 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-nccl-cu13` | 2.30.7 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-nvjitlink` | 13.5.37 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-nvshmem-cu13` | 3.7.2 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |
| `nvidia-nvtx` | 13.2.86 | pypi | `ba42a58` export: override torch 2.7.1 to 2.15.0 (CRACI high, CVE-2026-24747) (via craci-fix (cherry-picked)) |

| Changed version | Main | Lane |
|---|---|---|
| `@esbuild/linux-x64` | 0.21.5 | 0.25.12 |
| `@vitest/expect` | 2.1.9 | 4.1.12 |
| `@vitest/mocker` | 2.1.9 | 4.1.12 |
| `@vitest/pretty-format` | 2.1.9 | 4.1.12 |
| `@vitest/runner` | 2.1.9 | 4.1.12 |
| `@vitest/snapshot` | 2.1.9 | 4.1.12 |
| `@vitest/spy` | 2.1.9 | 4.1.12 |
| `@vitest/utils` | 2.1.9 | 4.1.12 |
| `chai` | 5.3.3 | 6.3.0 |
| `es-module-lexer` | 1.7.0 | 2.3.2 |
| `esbuild` | 0.21.5 | 0.25.12 |
| `pathe` | 1.1.2 | 2.0.3 |
| `std-env` | 3.10.0 | 4.3.0 |
| `tinyexec` | 0.3.2 | 1.3.1 |
| `tinyrainbow` | 1.2.0 | 3.2.0 |
| `vite` | 5.4.21 | 6.4.6 |
| `vitest` | 2.1.9 | 4.1.12 |
| `fsspec` | 2025.3.0 | 2026.9.0 |
| `torch` | 2.7.1 | 2.15.0 |
| `torchvision` | 0.22.1 | 0.29.2 |
| `triton` | 3.3.1 | 3.9.0 |

| Host main never contacts | Step running when CRACI first saw it |
|---|---|
| `productionresultssa30.blob.core.windows.net` | Run actions/checkout@v4 |
| `run-actions-3-azure-eastus.actions.githubusercontent.com` | unknown |

Gate: BLOCK: unexpected host productionresultssa30.blob.core.windows.net: main's build never contacts it, first seen during step 'Run actions/checkout@v4'; unexpected host run-actions-3-azure-eastus.actions.githubusercontent.com: main's build never contacts it.

#### Lane `demo-mode`

CRACI job 132627637839 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `expert-priors`

CRACI job 132627637854 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `fingerspelling-packs`

CRACI job 132627637830 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `frontend-updates`

CRACI job 132627637845 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `hand-root`

CRACI job 132627637886 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `hand-round-2`

CRACI job 132627637803 (run 43653716590, build success).

| Host main never contacts | Step running when CRACI first saw it |
|---|---|
| `copilot-proxy.githubusercontent.com` | Set up job |
| `pkg.github.com` | Set up job |

Gate: BLOCK: unexpected host copilot-proxy.githubusercontent.com: main's build never contacts it, first seen during step 'Set up job'; unexpected host pkg.github.com: main's build never contacts it, first seen during step 'Set up job'.

#### Lane `lidar`

CRACI job 132627637885 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Host main never contacts | Step running when CRACI first saw it |
|---|---|
| `copilot-proxy.githubusercontent.com` | Set up job |
| `pkg.github.com` | Set up job |

Gate: BLOCK: unexpected host copilot-proxy.githubusercontent.com: main's build never contacts it, first seen during step 'Set up job'; unexpected host pkg.github.com: main's build never contacts it, first seen during step 'Set up job'.

#### Lane `merge-main`

CRACI job 132627637993 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `models`

CRACI job 132627638001 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `replay-demo`

CRACI job 132627637931 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `robot-extras-wip`

CRACI job 132627638011 (run 43653716590, build success).

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `robot-view`

CRACI job 132627638043 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `rokoko-setup`

CRACI job 132627638933 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

Gate: pass.

#### Lane `shadows`

CRACI job 132627638942 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `slot-kit`

CRACI job 132627639041 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `submission`

CRACI job 132627639042 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Host main never contacts | Step running when CRACI first saw it |
|---|---|
| `copilot-proxy.githubusercontent.com` | Set up job |
| `pkg.github.com` | Run actions/checkout@v4 |

Gate: BLOCK: unexpected host copilot-proxy.githubusercontent.com: main's build never contacts it, first seen during step 'Set up job'; unexpected host pkg.github.com: main's build never contacts it, first seen during step 'Run actions/checkout@v4'.

#### Lane `szymon-frontend`

CRACI job 132627639058 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

| Host main never contacts | Step running when CRACI first saw it |
|---|---|
| `copilot-proxy.githubusercontent.com` | Set up job |
| `pkg.github.com` | Set up job |

Gate: BLOCK: unexpected host copilot-proxy.githubusercontent.com: main's build never contacts it, first seen during step 'Set up job'; unexpected host pkg.github.com: main's build never contacts it, first seen during step 'Set up job'.

#### Lane `thumb-align`

CRACI job 132627639116 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

Clean: no new dependency, no new vulnerability and no new host against main.

Gate: pass.

#### Lane `typing`

CRACI job 132627639257 (run 43653716590, build success).

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

| Host main never contacts | Step running when CRACI first saw it |
|---|---|
| `copilot-proxy.githubusercontent.com` | Run actions/checkout@v4 |
| `pkg.github.com` | Run actions/checkout@v4 |

Gate: BLOCK: unexpected host copilot-proxy.githubusercontent.com: main's build never contacts it, first seen during step 'Run actions/checkout@v4'; unexpected host pkg.github.com: main's build never contacts it, first seen during step 'Run actions/checkout@v4'.

#### Lane `verda`

CRACI job 132627639096 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 5.0.0.93 |

Gate: pass.

#### Lane `weights`

CRACI job 132627639137 (run 43653716590, build success).

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

Gate: pass.

#### Lane `worktree-decisions`

CRACI job 132627639181 (run 43653716590, build success).
The lane has no commit that main lacks: differences are older versions that main has changed.

| Host main never contacts | Step running when CRACI first saw it |
|---|---|
| `copilot-proxy.githubusercontent.com` | Set up job |
| `pkg.github.com` | Set up job |

Gate: BLOCK: unexpected host copilot-proxy.githubusercontent.com: main's build never contacts it, first seen during step 'Set up job'; unexpected host pkg.github.com: main's build never contacts it, first seen during step 'Set up job'.

#### Lane `worktree-export`

CRACI job 132627639830 (run 43653716590, build success).

| Changed version | Main | Lane |
|---|---|---|
| `opencv-python-headless` | 4.11.0.86, 5.0.0.93 | 4.11.0.86 |

Gate: pass.
