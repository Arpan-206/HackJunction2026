# Who checked what the agents shipped? Geppetto on CRACI

**Most interesting real finding.** One line that an agent wrote, `lerobot>=0.3.3` in `export/pyproject.toml` (lane `worktree-export`), locks 98 packages that neither the core nor the backend locks. They include a keyboard and mouse listener (`pynput` 1.8.2, which pulls `evdev` and `python-xlib`), a telemetry SDK (`wandb` 0.31.0, which pulls four OpenTelemetry exporter packages), `torch` 2.7.1 and 12 NVIDIA CUDA wheels. No CI job built `export/` before this lane. Source: `export/uv.lock` on `origin/main` at `45e0489`, read by `python -m tools.agent_bom history`. This finding comes from git, not from the CRACI API: the API results wait for the token (section 4).

Status on Sun 15 Nov 2026, written by the `craci` lane. Every number below names its source. "Not run: token missing" means the CRACI API was not called, because `CRACI_API_TOKEN` is not in `.env` yet.

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

The lane audit also installs the three side projects that agents added with their own lockfiles: `verda/`, `export/` and `genui/`. `ci.yml` does not build them.

## 2. First run

| Item | Value | Source |
|---|---|---|
| Run | GitHub run 43650216740, job 132616780656, `success`, 20 s | `gh run view 43650216740` |
| Runner | `craci-3-7d9afbca`, label `craci` | GitHub jobs API |
| CRACI link in the job log | `platform.craci.com/projects/hackjunction2026/jobs/132616780656` | job log, "Set up job" |
| Machine | Ubuntu 24.04.4 LTS, x86_64 | job log, `uname -a` and `/etc/os-release` |
| Queue time | about 5 s (created 22:50:57 UTC, started 22:51:02 UTC) | GitHub jobs API |

## 3. Builds on CRACI

The lane audit run 43650860815 was still running when this section was written. Counts follow when it ends.

## 4. Per-lane audit (CRACI API)

Not run: token missing. `tools/agent_bom report` needs `CRACI_API_TOKEN`. Every CRACI build it needs already exists (section 3), so the report needs no new build.

When the token exists, run this from the repo root on the `craci` branch:

```sh
python3 -m tools.agent_bom check
python3 -m tools.agent_bom report --json /tmp/agent_bom.json > /tmp/agent_bom.md
```

Then paste the summary table and one table per lane here.

| Lane | New dependencies | Changed versions | New vulnerabilities | New hosts | Gate |
|---|---|---|---|---|---|
| every lane | not run: token missing | not run: token missing | not run: token missing | not run: token missing | not run: token missing |

### What the report contains per lane

| Column | Meaning | API field |
|---|---|---|
| New dependency | A package (purl without version) in the lane's SBOM and not in `main`'s | SBOM `components[].purl` |
| Introduced by | The commit and lane that first locked the package, from git | git history of the lockfiles |
| Changed version | Same package, other version | SBOM `components[].version` |
| Vulnerability | An entry in the SBOM's `vulnerabilities` list, highest rating | SBOM `vulnerabilities[].ratings[].severity` |
| New host | A host the lane's build contacted and `main`'s build did not | trace `http.originUrl`, `tcp.tlsServerName` or `resolvedHosts`, `dns.record`, `sshGit.host` |

Most lanes have no commit that `main` lacks, and sit behind `main` (git `rev-list --count origin/main..origin/<lane>`: 21 of 28 lanes give 0). For them, "new" against `main` means "an older version that `main` has since changed". Seven lanes have commits that `main` does not have: `craci`, `frontend-updates`, `hand-round-2`, `robot-extras-wip`, `typing`, `weights`, `worktree-export`. None of these seven changes a core, backend or frontend dependency file. `worktree-export` carries its own copy of `export/pyproject.toml` and `export/uv.lock`.

## 5. Which lane brought each package into main (git, no token)

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

Only 8 commits on `main` ever changed a core, backend or frontend dependency file. The agent lanes added dependencies mostly by starting new side projects, not by growing the main ones.

Note: the core's `requirements.txt` has no versions and no lockfile. Each core build can install different versions. The CRACI SBOM of a core job is the only record of what it installed.

## 6. Merge gate

The gate fails closed. It blocks a lane when the lane's CRACI build:

1. adds a package with a `high` or `critical` vulnerability that `main`'s build does not have, or
2. contacts a host that `main`'s build never contacts, and the host is not in `tools/agent_bom/allowed_hosts.txt`.

It gives "no evidence" when the token or a lane build is missing. "No evidence" is not a pass.

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
                      "<severity> vulnerability <id> in <package>" or
                      "unexpected host <host>: main's build never contacts it".
                      Send the reasons to the lane. To accept a host on purpose, add it to
                      tools/agent_bom/allowed_hosts.txt in its own commit, with the reason.
     2  NO EVIDENCE   the token (CRACI_API_TOKEN in .env) or a lane build is missing.
                      Not a pass. Fix the cause (step 1) and run the gate again.
4. Paste the gate output into the merge commit message.
```

## 7. AI fix

Not run. Two reasons:

1. No vulnerability is known yet: the SBOMs were not read (token missing).
2. The CRACI API (OpenAPI version `2026-09-11`) has no fix or vulnerability endpoint. Its nine operations are: SBOM, OCI manifest SBOM, three artifact provenance lookups, job logs, active jobs, network trace and usage. The docs mention a list of vulnerabilities in the CRACI web app. An AI fix, if CRACI offers one, is in the web app, not the API.

When the report shows a real `high` or `critical` vulnerability: open the job in the CRACI web app, use its fix action, copy the proposal into this section, apply it on a branch `craci-fix-<package>`, and run the report before and after.

## 8. Model server image provenance

| Item | Value | Source |
|---|---|---|
| Image the coach runs on Verda | `docker.io/vllm/vllm-openai:v0.29.0` (a tag) | `verda/deploy.py` `DEFAULT_IMAGE`, `docs/VERDA.md` |
| Index digest on Sat 14 Nov 22:55 UTC | `sha256:c2914767605584b6d8f45686b82de173ecc99e781897aa3d0a66dacd72c51ae1` | CRACI job 132617975360 (run 43650602941), `docker buildx imagetools inspect` |
| linux/amd64 manifest | `sha256:082ca6f035279109041ffd3fe0695cb568b29bc580b35c4f297a66a08b216c1b` | same job |
| linux/arm64 manifest | `sha256:18372a7224938643461b846fb64c5c9d3d6e9727e82caf2dc3043e620c9d4d7a` | same job |
| CRACI provenance (`GET /v1preview1/artifact-provenance/oci_manifest`) | not run: token missing | |

Expected answer: CRACI records provenance for artifacts that CRACI jobs create. vLLM's image is built elsewhere, so `jobs_created_in` will most likely be empty, or the call returns 404. That answer is still useful: it shows the model server is the one part of the coach with no build record we control. Run `python3 -m tools.agent_bom provenance sha256:c2914767605584b6d8f45686b82de173ecc99e781897aa3d0a66dacd72c51ae1`.

The deploy uses the tag, not the digest. If the tag moves, the coach changes with no commit. Pinning the digest in `verda/deploy.py` is a change for the `verda` lane owner, not this lane.

## 9. How tools/agent_bom works

| File | Role |
|---|---|
| `tools/agent_bom/client.py` | CRACI API client. Only endpoints from the OpenAPI spec. Reads the token from the environment or `.env`; never prints it |
| `tools/agent_bom/sources.py` | GitHub job ids per lane (through `gh`), lockfile history and lane attribution (through git) |
| `tools/agent_bom/analyse.py` | SBOM and trace parsing, diff against `main`, the gate rule. No network, no git |
| `tools/agent_bom/__main__.py` | Commands: `check`, `report`, `gate`, `history`, `provenance` |
| `tools/agent_bom/tests/test_agent_bom.py` | 5 tests on spec-shaped fixtures (hand-written, marked as fixtures; no result here comes from them) |

The CRACI API looks a job up by its GitHub job id. Its job list only shows active jobs, so `agent_bom` finds finished jobs through the GitHub Actions API, by the job name `lane <branch>`.

## 10. Unverified

| Item | Why |
|---|---|
| The SBOM carries a `vulnerabilities` list | The spec says "CycloneDX 1.7 SBOM" with no schema. `agent_bom` reads the list if present, and says so if absent |
| The DNS `record` format | The spec says "record name and type". `agent_bom` takes the first word |
| Lane attribution of cherry-picked commits | Matched by commit subject. Two lanes with the same subject would collide |
