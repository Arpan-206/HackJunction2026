"""agent_bom: audit what each agent lane pulled into its build, from CRACI's SBOMs and network traces.

Usage (repo root, Python 3.12, standard library only):

    python -m tools.agent_bom check                 # is the API token set? (never prints it)
    python -m tools.agent_bom report [LANE ...]     # every lane against main, Markdown on stdout
    python -m tools.agent_bom gate LANE             # merge gate: exit 0 pass, 1 block, 2 no evidence
    python -m tools.agent_bom provenance DIGEST     # OCI manifest provenance for an image digest
    python -m tools.agent_bom history               # git only: which lane first locked each package into main
    python -m tools.agent_bom steps RUN_ID          # GitHub logs only: failed steps and npm audit per lane

The token comes from CRACI_API_TOKEN in the environment or in the repo root .env. Raw API answers are cached under
~/.cache/agent_bom so a report can be re-rendered without new calls.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from .analyse import GATE_SEVERITIES, Build, LaneDiff, diff, gate, merge, step_at
from .client import CraciClient, CraciError, load_token
from .sources import (
    JobRef,
    attribute,
    audit_jobs,
    introducing_commit,
    lockfile_history,
    run_log_summary,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPO = "Arpan-206/HackJunction2026"
ALLOWED_HOSTS = Path(__file__).with_name("allowed_hosts.txt")
CACHE = Path.home() / ".cache" / "agent_bom"


def _env_files() -> list[Path]:
    """The repo root .env, then the main checkout's .env when this runs in a git worktree."""
    files = [REPO_ROOT / ".env"]
    common = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        check=False,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    ).stdout.strip()
    if common:
        files.append(Path(common).parent / ".env")
    return files


def _token() -> str | None:
    for env_file in _env_files():
        token = load_token(env_file)
        if token:
            return token
    return None


def _client() -> CraciClient | None:
    token = _token()
    return CraciClient(token) if token else None


def _cached(kind: str, job_id: str, fetch) -> dict | None:
    path = CACHE / f"{kind}-{job_id}.json"
    if path.is_file():
        return json.loads(path.read_text())
    try:
        doc = fetch()
    except CraciError as err:
        print(f"  {kind} for job {job_id}: {err}", file=sys.stderr)
        return None
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc))
    return doc


def _build(client: CraciClient, repo: str, job: JobRef) -> Build:
    sbom = _cached("sbom", job.job_id, lambda: client.sbom(repo, job.job_id))
    trace = _cached("trace", job.job_id, lambda: client.network_trace(repo, job.job_id))
    build = merge([(job.job_id, sbom, trace)])
    if job.head_sha and not build.commits:
        build.commits.add(job.head_sha)
    return build


def _host_steps(
    repo: str, job: JobRef, build: Build, hosts: list[str]
) -> dict[str, str]:
    """For each host, the GitHub step that was running when CRACI first observed it."""
    if not hosts:
        return {}
    out = subprocess.run(
        ["gh", "api", f"repos/{repo}/actions/jobs/{job.job_id}"],
        check=False,
        capture_output=True,
        text=True,
    ).stdout
    steps = json.loads(out).get("steps", []) if out.strip() else []
    return {h: step_at(steps, build.first_seen.get(h, "")) for h in hosts}


def _baseline_note(base: Build) -> str:
    """main's own high and critical findings, so "no new vulnerability" never reads as "clean"."""
    bad = sorted(
        {
            (v.severity, v.id, v.package_key, v.version)
            for v in base.vulns
            if v.severity in GATE_SEVERITIES
        }
    )
    if not bad:
        return "main itself: no high or critical vulnerability in its SBOM."
    items = "; ".join(f"{s} {i} in {k}@{ver}" for s, i, k, ver in bad)
    return f"main itself carries {len(bad)} high or critical vulnerability entries (not caused by this lane): {items}"


def _needle(pkg) -> str:
    return pkg.name or pkg.key.rsplit("/", 1)[-1]


def render_lane(
    d: LaneDiff,
    job: JobRef,
    reasons: list[str],
    host_steps: dict[str, str] | None = None,
) -> str:
    host_steps = host_steps or {}
    lines = [f"### Lane `{d.lane}`", ""]
    lines.append(f"CRACI job {job.job_id} (run {job.run_id}, build {job.conclusion}).")
    ahead = subprocess.run(
        ["git", "rev-list", "--count", f"origin/main..origin/{d.lane}"],
        check=False,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if ahead == "0":
        lines.append(
            "The lane has no commit that main lacks: differences are older versions that main has changed."
        )
    lines.append("")
    if not (d.new_packages or d.new_vulns or d.new_hosts or d.changed_versions):
        lines += [
            "Clean: no new dependency, no new vulnerability and no new host against main.",
            "",
        ]
    if d.new_packages:
        lines += [
            "| New dependency | Version | Ecosystem | Introduced by |",
            "|---|---|---|---|",
        ]
        for p in d.new_packages:
            sha, subject = introducing_commit(d.lane, _needle(p))
            origin = f"`{sha}` {subject} (lane-only commit)" if sha else ""
            if not origin:
                lane, sha, subject = attribute(
                    _needle(p), p.ecosystem, f"origin/{d.lane}"
                )
                origin = f"`{sha}` {subject} (via {lane})" if sha else ""
            origin = (
                origin or "no lockfile commit found (unpinned, or installed by a tool)"
            )
            lines.append(
                f"| `{p.name or p.key}` | {p.version} | {p.ecosystem} | {origin} |"
            )
        lines.append("")
    if d.changed_versions:
        lines += ["| Changed version | Main | Lane |", "|---|---|---|"]
        for p, old in d.changed_versions:
            lines.append(f"| `{p.name or p.key}` | {old} | {p.version} |")
        lines.append("")
    if d.new_vulns:
        lines += [
            "| Vulnerability | Severity | Package | Source |",
            "|---|---|---|---|",
        ]
        for v in d.new_vulns:
            lines.append(
                f"| {v.id} | {v.severity} | `{v.package_key}@{v.version}` | {v.source or 'CRACI SBOM'} |"
            )
        lines.append("")
    elif not d.has_vuln_data:
        lines += ["The SBOM carried no vulnerability data.", ""]
    if d.new_hosts:
        lines += [
            "| Host main never contacts | Step running when CRACI first saw it |",
            "|---|---|",
        ]
        lines += [f"| `{h}` | {host_steps.get(h) or 'unknown'} |" for h in d.new_hosts]
        lines.append("")
    lines.append(f"Gate: {'BLOCK: ' + '; '.join(reasons) if reasons else 'pass'}.")
    lines.append("")
    return "\n".join(lines)


def cmd_report(args) -> int:
    client = _client()
    if client is None:
        print("not run: token missing (CRACI_API_TOKEN)", file=sys.stderr)
        return 2
    jobs = audit_jobs(args.repo)
    if args.base not in jobs:
        print(f"no finished lane-audit job for base {args.base}", file=sys.stderr)
        return 2
    base = _build(client, args.repo, jobs[args.base])
    lanes = args.lanes or sorted(lane for lane in jobs if lane != args.base)
    allowed = ALLOWED_HOSTS.read_text().splitlines() if ALLOWED_HOSTS.is_file() else []
    summary, sections, results = [], [], {}
    for lane in lanes:
        if lane not in jobs:
            summary.append(f"| `{lane}` | no build | | | | |")
            continue
        head = _build(client, args.repo, jobs[lane])
        d = diff(lane, base, head)
        steps = _host_steps(args.repo, jobs[lane], head, d.new_hosts)
        reasons = gate(d, allowed, steps)
        high = sum(v.severity in ("high", "critical") for v in d.new_vulns)
        summary.append(
            f"| `{lane}` | {len(d.new_packages)} | {len(d.changed_versions)} | {len(d.new_vulns)} ({high} high or critical)"
            f" | {len(d.new_hosts)} | {'block' if reasons else 'pass'} |"
        )
        sections.append(render_lane(d, jobs[lane], reasons, steps))
        results[lane] = {
            "job_id": jobs[lane].job_id,
            "new_packages": [p.purl or p.key for p in d.new_packages],
            "changed_versions": [
                [p.key, old, p.version] for p, old in d.changed_versions
            ],
            "new_vulns": [[v.id, v.severity, v.package_key] for v in d.new_vulns],
            "new_hosts": d.new_hosts,
            "gate": reasons,
        }
    print(
        f"Base: `{args.base}` (CRACI job {jobs[args.base].job_id}), {len(base.packages)} packages, "
        f"{len(base.vulns)} vulnerability entries, {len(base.hosts)} hosts.\n"
    )
    print(_baseline_note(base) + "\n")
    print(
        "| Lane | New dependencies | Changed versions | New vulnerabilities | New hosts | Gate |"
    )
    print("|---|---|---|---|---|---|")
    print("\n".join(summary))
    print()
    print("\n".join(sections))
    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=2))
    return 0


def cmd_gate(args) -> int:
    client = _client()
    if client is None:
        print(
            f"GATE {args.lane}: no evidence: CRACI_API_TOKEN is missing. Do not merge on this gate."
        )
        return 2
    jobs = audit_jobs(args.repo)
    for name in (args.base, args.lane):
        if name not in jobs:
            print(
                f"GATE {args.lane}: no evidence: no finished lane-audit job for {name}. "
                f'Run: gh workflow run lane-audit.yml --ref craci -f lanes="{args.base} {args.lane}"'
            )
            return 2
    base = _build(client, args.repo, jobs[args.base])
    head = _build(client, args.repo, jobs[args.lane])
    d = diff(args.lane, base, head)
    allowed = ALLOWED_HOSTS.read_text().splitlines() if ALLOWED_HOSTS.is_file() else []
    reasons = gate(
        d, allowed, _host_steps(args.repo, jobs[args.lane], head, d.new_hosts)
    )
    print(
        f"GATE {args.lane}: CRACI jobs {jobs[args.base].job_id} (main) and {jobs[args.lane].job_id} (lane)"
    )
    print(f"GATE {args.lane}: note: {_baseline_note(base)}")
    if not d.has_vuln_data:
        print(f"GATE {args.lane}: note: the lane's SBOM carried no vulnerability data.")
    if reasons:
        print(f"GATE {args.lane}: BLOCK")
        for reason in reasons:
            print(f"  - {reason}")
        return 1
    print(
        f"GATE {args.lane}: PASS ({len(d.new_packages)} new dependencies, {len(d.new_hosts)} new hosts, all allowed)"
    )
    return 0


def cmd_provenance(args) -> int:
    client = _client()
    if client is None:
        print("not run: token missing (CRACI_API_TOKEN)", file=sys.stderr)
        return 2
    try:
        print(json.dumps(client.oci_manifest_provenance(args.digest), indent=2))
    except CraciError as err:
        print(str(err))
        return 1
    return 0


def cmd_history(args) -> int:
    """Git only: which lane first put each locked package into main. Needs no token."""
    from collections import Counter

    rows = lockfile_history(f"origin/{args.base}")
    counts = Counter((r["lane"] or "unknown", r["file"]) for r in rows)
    print("| Lane that brought it into main | Lockfile | Packages |")
    print("|---|---|---|")
    for (lane, path), n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"| `{lane}` | `{path}` | {n} |")
    if args.json:
        Path(args.json).write_text(json.dumps(rows, indent=1))
    return 0


def cmd_steps(args) -> int:
    """GitHub logs only: failed steps and npm audit lines per lane of one lane-audit run. Needs no CRACI token."""
    rows = run_log_summary(args.repo, args.run_id)
    print("| Lane | Failed steps | npm audit (frontend) |")
    print("|---|---|---|")
    for lane in sorted(rows):
        row = rows[lane]
        failed = ", ".join(f"`{s}`" for s in row["failed_steps"]) or "none"
        audit = next(
            (v for k, v in row["npm_audit"].items() if k.startswith("Frontend")), ""
        )
        print(f"| `{lane}` | {failed} | {audit} |")
    return 0


def cmd_check(_args) -> int:
    print("CRACI_API_TOKEN: set" if _token() else "CRACI_API_TOKEN: missing")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tools.agent_bom", description=__doc__.split("\n\n")[0]
    )
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--base", default="main")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check").set_defaults(func=cmd_check)
    rep = sub.add_parser("report")
    rep.add_argument("lanes", nargs="*")
    rep.add_argument("--json", help="also write the raw results here")
    rep.set_defaults(func=cmd_report)
    g = sub.add_parser("gate")
    g.add_argument("lane")
    g.set_defaults(func=cmd_gate)
    steps = sub.add_parser("steps")
    steps.add_argument("run_id")
    steps.set_defaults(func=cmd_steps)
    hist = sub.add_parser("history")
    hist.add_argument("--json", help="also write one row per package here")
    hist.set_defaults(func=cmd_history)
    prov = sub.add_parser("provenance")
    prov.add_argument("digest")
    prov.set_defaults(func=cmd_provenance)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
