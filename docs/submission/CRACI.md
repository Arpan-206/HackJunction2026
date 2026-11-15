# Geppetto: entry for "Best use of CRACI" (draft)

Draft by the `craci` lane, Sun 15 Nov 2026. Every fact names its source. All CRACI API results are real responses from `api.craci.com`, from the lane audit rebuild under the Monitored network policy (run 43653716590) unless a line says otherwise. Full results: [docs/CRACI.md](../CRACI.md).

Words used below:

- **CRACI**: a CI service. It runs GitHub Actions jobs on its own Linux machines and records what each job downloads and contacts.
- **Lane**: one AI coding agent working on its own git branch. Geppetto was built by about 28 lanes in parallel.
- **SBOM (software bill of materials)**: the list of every package a build used. CRACI writes it in CycloneDX format.
- **Network trace**: the list of every host a build contacted. CRACI records it per job.
- **Merge gate**: a check that must pass before a lane's branch goes into `main`.

## Lead finding

One line added by the export lane, `lerobot>=0.3.3`, locks 98 extra packages and makes `export/` fail to install on Linux in 23 of 23 lane builds. The failure is always `evdev` 2.0.0, an input-device library (it reads Linux input devices), which builds from source and finds no `Python.h`. uv's own log names the chain: `lerobot`, then `pynput`, then `evdev`. Even with the failed install, CRACI's SBOMs record the downloads: builds with `export/` carry 95 more PyPI packages and 15 more vulnerability entries, 3 of them high (`torch` 2.7.1, `fsspec` 2025.3.0). Sources: `export/uv.lock`; lane audit job logs and CRACI SBOMs.

## The idea in two sentences

Geppetto was written by a fleet of AI agents, each on its own branch and each free to add packages. We use CRACI as the auditor of that fleet: every lane gets its own CRACI build, and `tools/agent_bom` turns the SBOMs and network traces into "which agent brought in what, and what did its build talk to", with a merge gate on top.

## Which CRACI features we use, and how

| CRACI feature | How we use it | Where |
|---|---|---|
| `runs-on: craci` runners | All CI runs on CRACI: core, backend and frontend suites on every push to `main` and every lane, plus one audit build per lane | `.github/workflows/ci.yml`, `lane-audit.yml` |
| Network policy (`cracicorp/setup`, `default: deny`, all presets) and no caches | The documented route to a complete SBOM. We also test it: `policy-check.yml` passes only if an unmatched host is blocked | all workflows, `policy-check.yml` |
| Per-job SBOM (`GET /v1preview1/sbom`) | 30 SBOMs, one per lane build. We diff each lane against `main` and read the `vulnerabilities` list (OSV advisories) | `tools/agent_bom/client.py`, `analyse.py` |
| Network trace (`GET /v1preview1/network-trace`) | 30 traces, 632 to 877 observations each. We list hosts that `main` never contacts, and name the build step that was running when CRACI first saw each one | `tools/agent_bom/analyse.py` |
| SBOM metadata (`craci:job:*` properties, the `pkg:github` component) | We tie each SBOM to its repository and commit, then git finds the commit and lane that first locked each package | `tools/agent_bom/sources.py` |
| Artifact provenance and OCI SBOM (`/v1preview1/artifact-provenance/oci_manifest`, `/v1experimental1/sbom/oci_manifest`) | We resolved the coach's model server image through CRACI and asked who built it. The job SBOM names all three image digests; provenance answers 404 | `.github/workflows/model-image.yml`, `agent_bom provenance` |
| The AI fix prompt from the web app | Arpan copied it for the `main` build; a second agent applied it on an unmerged branch; `agent_bom` audited the result | branch `craci-fix`, PR #14 |

The lane audit is one workflow on the `craci` branch. It checks out every lane branch at its tip and runs the same installs as CI. Each job is named `lane <branch>`. So we audit 28 branches without pushing anything to them.

## Findings

| # | Finding | Source |
|---|---|---|
| 1 | The lead finding above: one `lerobot` line, 98 extra locked packages, `export/` fails on Linux in 23 of 23 builds, and 3 high vulnerability entries in every build that contains it. | `export/uv.lock`; run 43653716590 logs and CRACI SBOMs |
| 2 | The gate is blind to what is already merged. `main`'s own SBOM has 7 high or critical entries: `tinypool` and `vitest` (critical), `vite`, `torch` and `fsspec` (high). Two of the five packages came from the export lane. No lane adds a new one, so the vulnerability rule passes every lane. Every gate verdict now prints `main`'s own list. | CRACI SBOM of job 132627637904; `agent_bom history` |
| 3 | The AI fix works, and the audit shows its cost. On the unmerged branch `craci-fix`, high and critical entries go from 7 to 0, and all entries from 45 to 11, with all suites green on CRACI. `agent_bom` shows the same fix adds 22 new dependencies, 18 of them NVIDIA CUDA 13 wheels pulled by the `torch` 2.15.0 override. | jobs 132627637904 and 132629338604; `docs/CRACI_FIX.md` on `craci-fix` |
| 4 | Gate results: 21 lanes pass, 8 block, 0 have no evidence. Every block is a host, not a vulnerability. All 8 are runner traffic seen during job setup or checkout, before the lane's code is on the machine (`GET /_dns` probes to `pkg.github.com` and `copilot-proxy.githubusercontent.com`, or GitHub Actions hosts in another region). They come and go between runs. | `agent_bom gate <lane>` for every lane |
| 5 | `default: deny` did not block an unmatched host in our test: `policy-check` reached `https://example.com/` with HTTP 200, and the trace shows `policyDenied: false`. The runner's `/_dns` probes were also allowed unmatched under `deny`. Every package download matched a preset, so the SBOMs are not affected. | run 43655101763, job 132631785839 |
| 6 | The coach's model server runs from the mutable tag `vllm/vllm-openai:v0.29.0`. CRACI's job SBOM records its three digests (index `sha256:c2914767...51ae1`), but CRACI has no provenance for it (404): the model server is the one part of the coach with no build record we control. | job 132617975360; API |

## AI fix

The CRACI API has no fix endpoint. The AI fix in CRACI is a prompt that the web app generates for the user to hand to a coding agent. Arpan copied it from the web app for the `main` build; no agent read the web app's Vulnerabilities tab. A second agent applied it on its own branch, `craci-fix` (draft PR #14). **The fix was applied on an unmerged branch. `craci-fix` never merges, and no dependency upgrade merges into `main` before the demo.**

## What we would build next

1. Run the gate as a required GitHub check on every lane pull request, not only as a dispatcher command.
2. Teach the gate which hosts belong to the runner itself, so a host contacted before checkout is reported but does not block (finding 4).
3. Report the cost of a fix next to its benefit: new dependencies and download size, not only vulnerabilities removed (finding 3).
4. Find out why `default: deny` did not block in our test, then make the policy check part of every build (finding 5).
5. Install every side project in `ci.yml` too, so a lockfile that does not install on Linux fails on the push that adds it (finding 1).
6. After the demo: pin the model server image by digest in `verda/deploy.py`.
