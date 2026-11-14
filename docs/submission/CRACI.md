# Geppetto: entry for "Best use of CRACI" (draft)

Draft by the `craci` lane, Sun 15 Nov 2026. Every fact names its source. Results from the CRACI API are marked "not run: token missing" until `CRACI_API_TOKEN` exists. Full results: [docs/CRACI.md](../CRACI.md).

Words used below:

- **CRACI**: a CI service. It runs GitHub Actions jobs on its own Linux machines and records what each job downloads.
- **Lane**: one AI coding agent working on its own git branch. Geppetto was built by about 28 lanes in parallel.
- **SBOM (software bill of materials)**: the list of every package a build used. CRACI writes it in CycloneDX format.
- **Network trace**: the list of every host a build contacted. CRACI records it per job.
- **Merge gate**: a check that must pass before a lane's branch goes into `main`.

## The idea in two sentences

Geppetto was written by a fleet of AI agents, each on its own branch and each free to add packages. We use CRACI as the auditor of that fleet: every lane gets its own CRACI build, and `tools/agent_bom` turns the SBOMs and network traces into "which agent brought in what, and what did its build talk to", with a merge gate on top.

## Which CRACI features we use, and how

| CRACI feature | How we use it | Where |
|---|---|---|
| `runs-on: craci` runners | All CI runs on CRACI: core, backend and frontend suites on every push to `main` and every lane | `.github/workflows/ci.yml` |
| Per-job SBOM (`GET /v1preview1/sbom`) | One SBOM per lane build. We diff each lane's SBOM against `main`'s | `tools/agent_bom/client.py`, `analyse.py` |
| Network trace (`GET /v1preview1/network-trace`) | We list the hosts each lane's build contacted that `main`'s build never contacts | `tools/agent_bom/analyse.py` (`trace_hosts`) |
| Job identity in the trace (`job.commitSha`, `job.branch`) | We tie each SBOM to the exact lane commit, then git finds the commit and lane that first locked each package | `tools/agent_bom/sources.py` |
| Artifact provenance (`GET /v1preview1/artifact-provenance/oci_manifest`) | We resolve the digest of the coach's model server image through CRACI and ask who built it | `.github/workflows/model-image.yml`, `agent_bom provenance` |
| Clean SBOMs per lane | The lane audit turns every cache off, so no lane inherits another lane's packages through a restored cache (CRACI carries cache SBOMs forward) | `.github/workflows/lane-audit.yml` |

The lane audit is one workflow on the `craci` branch. It checks out every lane branch at its tip and runs the same installs as CI. Each job is named `lane <branch>`. So we audit 28 branches without pushing anything to them.

## Findings

| # | Finding | Source |
|---|---|---|
| 1 | An agent lane shipped a project that never installed on Linux. One line in `export/pyproject.toml` (`lerobot>=0.3.3`, lane `worktree-export`) locks 98 packages that neither the core nor the backend locks. One is `pynput`, a keyboard and mouse listener, which pulls `evdev` on Linux. On CRACI, the `export/` install failed in 23 of 23 lane builds that contain it: `evdev` 2.0.0 found no `Python.h`. On a Mac, `pynput` uses `pyobjc`, so the agent never saw it. | lane audit run 43650860815 job logs; `export/uv.lock` |
| 2 | Every frontend build carries 15 known npm vulnerabilities: 2 critical (`vitest`, `tinypool`), 1 high (`vite`), 12 moderate. The count is identical in all 29 lane builds. So no agent lane added or removed one: they date from the two scaffold commits on `main`. A gate that only blocks new vulnerabilities passes every lane, while `main` itself is not clean. | npm audit line in the CRACI job logs; `npm audit --package-lock-only` on `main` |
| 3 | Three side projects have their own lockfiles (`verda/`, `export/`, `genui/`). CI built none of them. Their lockfiles hold 189 package entries. 102 of the Python entries appear in no core or backend lockfile. The lane audit is the first build that installs them. | git: `export/uv.lock` 132, `verda/uv.lock` 50, `genui/package-lock.json` 7 |
| 4 | The coach's model server runs from the mutable tag `vllm/vllm-openai:v0.29.0` (`verda/deploy.py`). A CRACI job resolved that tag to index digest `sha256:c2914767605584b6d8f45686b82de173ecc99e781897aa3d0a66dacd72c51ae1` on Sat 14 Nov 22:55 UTC. `docs/CRACI.md` records the digest, so a moved tag becomes visible. | job 132617975360 log (GitHub run 43650602941, runner `craci-0-7fb6cb6c`) |
| 5 | 29 lane builds on CRACI in 13 minutes: core and backend suites pass on every lane. One lane (`robot-extras-wip`) fails 1 of 286 frontend tests on line endings in a copied robot model file. | lane audit run 43650860815 |
| 6 | SBOM and network diffs per lane, from the CRACI API | not run: token missing |

## What we would build next

1. Run the gate as a required GitHub check on every lane pull request, not only as a dispatcher command.
2. Give each lane a CRACI network policy (`default: deny` with the package presets). An agent that adds an unexpected host then fails at build time, not at review time.
3. Feed the gate's verdict back to the agent that owns the lane, so the agent fixes its own dependency before a person sees it.
4. Report `main`'s own high and critical vulnerabilities next to every gate verdict, so "no new vulnerability" never reads as "clean" (finding 2).
5. Install every side project in `ci.yml` too, so a lockfile that does not install on Linux fails on the push that adds it (finding 1).
6. Pin the model server image by digest in `verda/deploy.py`, and check its CRACI provenance on every deploy.
