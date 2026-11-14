"""agent_bom: audit what each agent lane pulled into its build, from CRACI's SBOMs and network traces.

Usage (repo root, Python 3.12, standard library only):

    python -m tools.agent_bom check                 # is the API token set? (never prints it)
    python -m tools.agent_bom report [LANE ...]     # every lane against main, Markdown on stdout
    python -m tools.agent_bom gate LANE             # merge gate: exit 0 pass, 1 block, 2 no evidence
    python -m tools.agent_bom provenance DIGEST     # OCI manifest provenance for an image digest

The token comes from CRACI_API_TOKEN in the environment or in the repo root .env. Raw API answers are cached under
~/.cache/agent_bom so a report can be re-rendered without new calls.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .analyse import Build, LaneDiff, diff, gate, merge
from .client import CraciClient, CraciError, load_token
from .sources import JobRef, audit_jobs, introducing_commit

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPO = "Arpan-206/HackJunction2026"
ALLOWED_HOSTS = Path(__file__).with_name("allowed_hosts.txt")
CACHE = Path.home() / ".cache" / "agent_bom"


def _client() -> CraciClient | None:
    token = load_token(REPO_ROOT / ".env")
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


def _needle(pkg) -> str:
    return pkg.name or pkg.key.rsplit("/", 1)[-1]


def render_lane(d: LaneDiff, job: JobRef, reasons: list[str]) -> str:
    lines = [f"### Lane `{d.lane}`", ""]
    lines.append(f"CRACI job {job.job_id} (run {job.run_id}, build {job.conclusion}).")
    lines.append("")
    if not (d.new_packages or d.new_vulns or d.new_hosts or d.changed_versions):
        lines += ["Clean: no new dependency, no new vulnerability and no new host against main.", ""]
    if d.new_packages:
        lines += ["| New dependency | Version | Ecosystem | Introduced by |", "|---|---|---|---|"]
        for p in d.new_packages:
            sha, subject = introducing_commit(d.lane, _needle(p))
            origin = f"`{sha}` {subject}" if sha else "no lockfile commit found (transitive or unpinned)"
            lines.append(f"| `{p.name or p.key}` | {p.version} | {p.ecosystem} | {origin} |")
        lines.append("")
    if d.changed_versions:
        lines += ["| Changed version | Main | Lane |", "|---|---|---|"]
        for p, old in d.changed_versions:
            lines.append(f"| `{p.name or p.key}` | {old} | {p.version} |")
        lines.append("")
    if d.new_vulns:
        lines += ["| Vulnerability | Severity | Package | Source |", "|---|---|---|---|"]
        for v in d.new_vulns:
            lines.append(f"| {v.id} | {v.severity} | `{v.package_key}` | {v.source or 'CRACI SBOM'} |")
        lines.append("")
    elif not d.has_vuln_data:
        lines += ["The SBOM carried no vulnerability data.", ""]
    if d.new_hosts:
        lines += ["| Host main never contacts |", "|---|"]
        lines += [f"| `{h}` |" for h in d.new_hosts]
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
        reasons = gate(d, allowed)
        high = sum(v.severity in ("high", "critical") for v in d.new_vulns)
        summary.append(
            f"| `{lane}` | {len(d.new_packages)} | {len(d.changed_versions)} | {len(d.new_vulns)} ({high} high or critical)"
            f" | {len(d.new_hosts)} | {'block' if reasons else 'pass'} |"
        )
        sections.append(render_lane(d, jobs[lane], reasons))
        results[lane] = {
            "job_id": jobs[lane].job_id,
            "new_packages": [p.purl or p.key for p in d.new_packages],
            "changed_versions": [[p.key, old, p.version] for p, old in d.changed_versions],
            "new_vulns": [[v.id, v.severity, v.package_key] for v in d.new_vulns],
            "new_hosts": d.new_hosts,
            "gate": reasons,
        }
    print(f"Base: `{args.base}` (CRACI job {jobs[args.base].job_id}), {len(base.packages)} packages, "
          f"{len(base.hosts)} hosts.\n")
    print("| Lane | New dependencies | Changed versions | New vulnerabilities | New hosts | Gate |")
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
        print(f"GATE {args.lane}: no evidence: CRACI_API_TOKEN is missing. Do not merge on this gate.")
        return 2
    jobs = audit_jobs(args.repo)
    for name in (args.base, args.lane):
        if name not in jobs:
            print(f"GATE {args.lane}: no evidence: no finished lane-audit job for {name}. "
                  f"Run: gh workflow run lane-audit.yml --ref craci -f lanes=\"{args.base} {args.lane}\"")
            return 2
    d = diff(args.lane, _build(client, args.repo, jobs[args.base]), _build(client, args.repo, jobs[args.lane]))
    allowed = ALLOWED_HOSTS.read_text().splitlines() if ALLOWED_HOSTS.is_file() else []
    reasons = gate(d, allowed)
    if not d.has_vuln_data:
        print(f"GATE {args.lane}: note: the lane's SBOM carried no vulnerability data.")
    if reasons:
        print(f"GATE {args.lane}: BLOCK")
        for reason in reasons:
            print(f"  - {reason}")
        return 1
    print(f"GATE {args.lane}: PASS ({len(d.new_packages)} new dependencies, {len(d.new_hosts)} new hosts, all allowed)")
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


def cmd_check(_args) -> int:
    print("CRACI_API_TOKEN: set" if load_token(REPO_ROOT / ".env") else "CRACI_API_TOKEN: missing")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m tools.agent_bom", description=__doc__.split("\n\n")[0])
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
    prov = sub.add_parser("provenance")
    prov.add_argument("digest")
    prov.set_defaults(func=cmd_provenance)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
