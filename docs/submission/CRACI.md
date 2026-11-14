# Geppetto: entry for "Best use of CRACI" (draft)

Draft by the `craci` lane, Sun 15 Nov 2026. Every fact names its source. All CRACI API results are real responses from `api.craci.com`. Full results: [docs/CRACI.md](../CRACI.md).

Words used below:

- **CRACI**: a CI service. It runs GitHub Actions jobs on its own Linux machines and records what each job downloads and contacts.
- **Lane**: one AI coding agent working on its own git branch. Geppetto was built by about 28 lanes in parallel.
- **SBOM (software bill of materials)**: the list of every package a build used. CRACI writes it in CycloneDX format.
- **Network trace**: the list of every host a build contacted. CRACI records it per job.
- **Merge gate**: a check that must pass before a lane's branch goes into `main`.

## Lead finding

One line added by the export lane, `lerobot>=0.3.3`, locks 98 extra packages and makes `export/` fail to install on Linux in 23 of 23 lane builds. The failure is always `evdev` 2.0.0, an input-device library (it reads Linux input devices), which builds from source and finds no `Python.h`. uv's own log names the chain: `lerobot`, then `pynput`, then `evdev`. Even with the failed install, CRACI's SBOMs record the downloads: builds with `export/` carry 95 more PyPI packages and 15 more vulnerability entries, 3 of them high (`torch` 2.7.1, `fsspec` 2025.3.0). Sources: `export/uv.lock`; lane audit run 43650860815 job logs and CRACI SBOMs.

## The idea in two sentences

Geppetto was written by a fleet of AI agents, each on its own branch and each free to add packages. We use CRACI as the auditor of that fleet: every lane gets its own CRACI build, and `tools/agent_bom` turns the SBOMs and network traces into "which agent brought in what, and what did its build talk to", with a merge gate on top.

## Which CRACI features we use, and how

| CRACI feature | How we use it | Where |
|---|---|---|
| `runs-on: craci` runners | All CI runs on CRACI: core, backend and frontend suites on every push to `main` and every lane. 74 jobs got a CRACI runner on the first night | `.github/workflows/ci.yml`, `lane-audit.yml` |
| Per-job SBOM (`GET /v1preview1/sbom`) | One SBOM per lane build, 29 in total. We diff each lane against `main` and read the `vulnerabilities` list (OSV advisories) | `tools/agent_bom/client.py`, `analyse.py` |
| Network trace (`GET /v1preview1/network-trace`) | 29 traces, 635 to 866 observations each. We list hosts that `main` never contacts, and name the build step that was running when CRACI first saw each one | `tools/agent_bom/analyse.py` (`trace_hosts`, `first_seen`, `step_at`) |
| SBOM metadata (`craci:job:*` properties, the `pkg:github` component) | We tie each SBOM to its repository and commit, then git finds the commit and lane that first locked each package | `tools/agent_bom/sources.py` |
| Artifact provenance (`GET /v1preview1/artifact-provenance/oci_manifest`, `GET /v1experimental1/sbom/oci_manifest`) | We resolved the coach's model server image digest through CRACI and asked who built it. Answer: 404, no record | `.github/workflows/model-image.yml`, `agent_bom provenance` |
| Clean SBOMs per lane | The lane audit turns every cache off, so no lane inherits another lane's packages through a restored cache | `.github/workflows/lane-audit.yml` |

The lane audit is one workflow on the `craci` branch. It checks out every lane branch at its tip and runs the same installs as CI. Each job is named `lane <branch>`. So we audit 28 branches without pushing anything to them.

## Findings

| # | Finding | Source |
|---|---|---|
| 1 | The lead finding above: one `lerobot` line, 98 extra locked packages, `export/` fails on Linux in 23 of 23 builds, and 3 high vulnerability entries in every build that contains it. | `export/uv.lock`; run 43650860815 logs and CRACI SBOMs |
| 2 | The gate is blind to what is already merged. `main`'s own SBOM has 7 high or critical entries: `tinypool` and `vitest` (critical), `vite`, `torch` and `fsspec` (high). Two of the five packages came from the export lane. All 28 lanes add 0 new vulnerabilities, so the gate passes them. So every gate verdict now prints `main`'s own list. | CRACI SBOM of job 132618946275; `agent_bom history` |
| 3 | The network traces are uniform. All 29 builds contact the same 15 hosts: package registries, GitHub and the GitHub Actions service. Only `weights` adds two (`copilot-proxy.githubusercontent.com`, `pkg.github.com`). CRACI saw them during job setup, before the lane's code was on the machine. The gate blocks `weights` until a person accepts them. | CRACI network traces; GitHub step times |
| 4 | Gate results: 27 lanes pass, 1 blocks (`weights`), 0 have no evidence. | `python3 -m tools.agent_bom gate <lane>` for every lane |
| 5 | The coach's model server runs from the mutable tag `vllm/vllm-openai:v0.29.0`. A CRACI job resolved it to `sha256:c2914767605584b6d8f45686b82de173ecc99e781897aa3d0a66dacd72c51ae1`. CRACI's provenance API has no record of it (404). It is the one part of the coach with no build record we control. | job 132617975360; API, Sun 15 Nov |
| 6 | Core and backend suites pass on all 29 lanes. `robot-extras-wip` fails 1 of 286 frontend tests on line endings in a copied robot model file. | run 43650860815 |

## AI fix

The CRACI API has no fix endpoint, so Arpan triggers the AI fix in the CRACI web app. Its proposal goes on its own branch, which is built and tested on CRACI with a before and after report in `docs/CRACI.md` section 7. No dependency upgrade merges into `main` before the demo.

## What we would build next

1. Run the gate as a required GitHub check on every lane pull request, not only as a dispatcher command.
2. Give each lane a CRACI network policy (`default: deny` with the package presets). An agent that adds an unexpected host then fails at build time, not at review time.
3. Teach the gate which hosts belong to the runner itself, so a host contacted before checkout is reported but does not block (finding 3).
4. Feed the gate's verdict back to the agent that owns the lane, so the agent fixes its own dependency before a person sees it.
5. Install every side project in `ci.yml` too, so a lockfile that does not install on Linux fails on the push that adds it (finding 1).
6. After the demo: pin the model server image by digest in `verda/deploy.py`.
