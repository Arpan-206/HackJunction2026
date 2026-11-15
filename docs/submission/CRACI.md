# Geppetto: entry for "Best use of CRACI"

## Submission text

**Geppetto on CRACI: who checked what the agents shipped?**

Geppetto teaches hand skills. An expert records a skill with Rokoko gloves, and a learner trains against it in 3D. About 28 AI coding agents built it during the hackathon, each in its own lane. A lane is one AI coding agent on its own git branch.

Every lane could add packages, and no person read every lockfile. So we made CRACI the auditor of the fleet. All our tests run on CRACI. One audit build for each lane gives us an SBOM and a network trace. Our tool, `tools/agent_bom`, compares each lane with `main`. It names the agent that brought in each package and the hosts that each build contacted. The same tool is our merge gate.

What it found:

- One line from one lane, `lerobot>=0.3.3`, locked 98 extra packages. It broke the install of that project on Linux in 23 of 23 builds.
- The gate was blind to `main` itself. `main` already had 7 high or critical entries, so no lane added a new one. Every verdict now prints that baseline.
- We ran CRACI's AI fix on a branch, then audited the fix. It cleared all 7 entries. It also added 22 dependencies, 18 of them NVIDIA packages. We merged the cheap half, the test and build tools, after a CRACI test. We declined the costly half. A new CRACI build of `main` shows 3 high or critical entries, down from 7. It shows 24 entries in total, down from 45.
- 21 lanes pass the gate and 8 block. Every block is runner traffic before checkout, not lane code.

Our public tour is built on CRACI. It publishes the SBOM of its own build, bad numbers included: https://the-geppetto-bodega.netlify.app/sbom.html

Two results may be our own configuration. `default: deny` did not block an unmatched host in our test. The API answered 403 from inside a CRACI runner.

Tour: https://the-geppetto-bodega.netlify.app

Repository: https://github.com/Arpan-206/HackJunction2026

## Supporting detail

Every fact below names its source. All CRACI API results are real responses from `api.craci.com`. They come from the lane audit run 43653716590 (Sat 14 Nov) unless a line says otherwise. The numbers for `main` after the frontend upgrade come from run 43683032712 (Sun 15 Nov, job 132717637141). Full results: [docs/CRACI.md](../CRACI.md).

## Which CRACI features we use, and how

| CRACI feature | How we use it | Where |
|---|---|---|
| `runs-on: craci` runners | All CI runs on CRACI: core, backend and frontend suites on every push to `main` and every lane, plus one audit build per lane | `.github/workflows/ci.yml`, `lane-audit.yml` |
| Network policy (`cracicorp/setup`, `default: deny`, all presets) and no caches | The documented route to a complete SBOM. We also test it: `policy-check.yml` passes only if an unmatched host is blocked | all workflows, `policy-check.yml` |
| Per-job SBOM (`GET /v1preview1/sbom`) | 30 SBOMs, one per lane build. We diff each lane against `main` and read the `vulnerabilities` list (OSV advisories) | `tools/agent_bom/client.py`, `analyse.py` |
| Network trace (`GET /v1preview1/network-trace`) | 30 traces, 632 to 877 observations each. We list hosts that `main` never contacts, and name the build step that was running when CRACI first saw each one | `tools/agent_bom/analyse.py` |
| SBOM metadata (`craci:job:*` properties, the `pkg:github` component) | We tie each SBOM to its repository and commit, then git finds the commit and lane that first locked each package | `tools/agent_bom/sources.py` |
| Artifact provenance and OCI SBOM (`/v1preview1/artifact-provenance/oci_manifest`, `/v1experimental1/sbom/oci_manifest`) | We resolved the coach's model server image through CRACI and asked who built it. The job SBOM names all three image digests; provenance answers 404 | `.github/workflows/model-image.yml`, `agent_bom provenance` |
| The AI fix prompt from the web app | Arpan copied it for the `main` build; a second agent applied it on the branch `craci-fix`; `agent_bom` audited the result; the frontend half merged into `main` (commit `55968e9`), the `export/` half did not | branch `craci-fix`, PR #14; `docs/CRACI.md` section 8 |

The lane audit is one workflow on the `craci` branch. It checks out every lane branch at its tip and runs the same installs as CI. Each job is named `lane <branch>`. So we audit 28 branches without pushing anything to them.

## The public tour shows its own SBOM

We also publish a public tour of Geppetto, built on CRACI. After the build job ends, a second job gets that job's
SBOM from the CRACI API and puts it into the site. A link on every stop, "What's in this site", opens a plain page with
the commit, the CRACI job link, the number of packages, the known vulnerabilities by severity and the CycloneDX file.
The first build we published had 339 packages and 133 vulnerability entries, 5 critical and 43 high. The build
that is live now (commit `dff4ff7`, job 132700812365) has 335 packages and 112 entries, 2 critical and 42 high. The
difference is the frontend upgrade: the `tinypool`, `vitest` and `vite` entries are gone. Every critical and high
entry that stays is in `xvfb` and `xserver-common`, the display tool that the browser check needs on a runner with no
screen. None is inside the page that a visitor loads, and the page says so. If the SBOM is empty, incomplete or not
available, the page says that too. The SBOM is fetched in a job on a GitHub-hosted runner, because the CRACI API
answered 403 from inside a CRACI runner. Details: `docs/CRACI.md`, section 10.

## Findings

| # | Finding | Source |
|---|---|---|
| 1 | The lead finding above: one `lerobot` line, 98 extra locked packages, `export/` fails on Linux in 23 of 23 builds, and 3 high vulnerability entries in every build that contains it. | `export/uv.lock`; run 43653716590 logs and CRACI SBOMs |
| 2 | The gate is blind to what is already merged. Before the fix, `main`'s own SBOM had 7 high or critical entries: `tinypool` and `vitest` (critical), `vite`, `torch` and `fsspec` (high). Two of the five packages came from the export lane. No lane added a new one, so the vulnerability rule passed every lane. Every gate verdict now prints `main`'s own list. After the merge in finding 3, a new build of `main` has 3 high entries and no critical entry. | CRACI SBOMs of jobs 132627637904 (before) and 132717637141 (now); `agent_bom history` |
| 3 | We ran the fix, audited its cost, merged the cheap half and declined the costly half. On the branch `craci-fix` the whole fix takes high and critical entries from 7 to 0 and all entries from 45 to 11, with all suites green on CRACI. `agent_bom` shows its cost: 22 new dependencies, 18 of them NVIDIA CUDA 13 wheels pulled by the `torch` 2.15.0 override, 4 of them small npm packages from vitest 4. Merged into `main` with Arpan's approval, after a CRACI test: the frontend half, `vitest` 2.1.9 to 4.1.12 and `vite` 5.4.21 to 6.4.6 (commit `55968e9`). Not merged: the `export/` overrides of `torch` and `fsspec` and their 18 NVIDIA packages. Result on `main`, from the API: 7 high or critical to 3, 45 entries to 24. The 3 that stay are `torch` (1) and `fsspec` (2). | jobs 132627637904, 132629338604 and 132717637141; `docs/CRACI_FIX.md`; `docs/CRACI.md` section 8 |
| 4 | Gate results: 21 lanes pass, 8 block, 0 have no evidence. Every block is a host, not a vulnerability. All 8 are runner traffic seen during job setup or checkout, before the lane's code is on the machine (`GET /_dns` probes to `pkg.github.com` and `copilot-proxy.githubusercontent.com`, or GitHub Actions hosts in another region). They come and go between runs. | `agent_bom gate <lane>` for every lane |
| 5 | `default: deny` did not block an unmatched host in our test: `policy-check` reached `https://example.com/` with HTTP 200, and the trace shows `policyDenied: false`. The runner's `/_dns` probes were also allowed unmatched under `deny`. Every package download matched a preset, so the SBOMs are not affected. | run 43655101763, job 132631785839 |
| 6 | The coach's model server runs from the mutable tag `vllm/vllm-openai:v0.29.0`. CRACI's job SBOM records its three digests (index `sha256:c2914767...51ae1`), but CRACI has no provenance for it (404): the model server is the one part of the coach with no build record we control. | job 132617975360; API |

## AI fix

The CRACI API has no fix endpoint. The AI fix in CRACI is a prompt that the web app generates for the user to hand to a coding agent. Arpan copied it from the web app for the `main` build; no agent read the web app's Vulnerabilities tab. A second agent applied it on its own branch, `craci-fix` (draft PR #14, still open).

| | What | State |
|---|---|---|
| Merged into `main` | The frontend half: `vitest` 2.1.9 to 4.1.12, `vite` 5.4.21 to 6.4.6. Commit `55968e9`, Sun 15 Nov 04:24, approved by Arpan, tested on CRACI first (three suites, the build, and a dev-server check on vite 6.4.6) | On `main` |
| Not merged | The `export/` half: uv overrides `torch` 2.15.0 and `fsspec` 2026.9.0, and the 18 NVIDIA packages that the `torch` override pulls. `torch` 2.15.0 is outside the range that `lerobot` declares and was not proven at run time | Only on `craci-fix`. The branch never merges |

## Questions for CRACI

Two results that we cannot explain. Each one may be our configuration and not a fault in CRACI. Details: `docs/CRACI.md`, section 13.

1. `default: deny` did not block an unmatched host. `policy-check.yml` reached `https://example.com/` with HTTP 200, and the trace shows `policyDenied: false` (run 43655101763, job 132631785839). We ran it once.
2. The CRACI API answered HTTP 403 to a call from inside a CRACI runner. The same call with the same token works from a laptop and from a GitHub-hosted runner (tour runs 43664418557 to 43667497387).

Also unverified: the web app showed 40 vulnerability entries for the `main` build, and the API returned 45 (44 different ids). We could not find the reason.

## What we would build next

1. Run the gate as a required GitHub check on every lane pull request, not only as a dispatcher command.
2. Teach the gate which hosts belong to the runner itself, so a host contacted before checkout is reported but does not block (finding 4).
3. Report the cost of a fix next to its benefit: new dependencies and download size, not only vulnerabilities removed (finding 3).
4. Find out why `default: deny` did not block in our test, then make the policy check part of every build (finding 5).
5. Install every side project in `ci.yml` too, so a lockfile that does not install on Linux fails on the push that adds it (finding 1).
6. After the demo: pin the model server image by digest in `verda/deploy.py`.
