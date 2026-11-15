"""Pure functions: read CRACI SBOMs and network traces, diff a lane against main, decide the merge gate.

No network and no git here, so the tests run on fixtures.
"""

from __future__ import annotations

import fnmatch
import urllib.parse
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

SEVERITY_ORDER = ["none", "info", "low", "medium", "moderate", "high", "critical"]
GATE_SEVERITIES = {"high", "critical"}


@dataclass(frozen=True)
class Package:
    """One component from a CycloneDX SBOM. `key` is the purl without version, so upgrades are not new packages."""

    key: str
    name: str
    version: str
    ecosystem: str
    purl: str
    bom_ref: str


@dataclass(frozen=True)
class Vulnerability:
    id: str
    severity: str
    package_key: str
    source: str
    version: str = ""


@dataclass
class Build:
    """Everything agent_bom needs from one or more CRACI jobs of the same lane."""

    packages: dict[str, Package] = field(default_factory=dict)
    vulns: list[Vulnerability] = field(default_factory=list)
    hosts: set[str] = field(default_factory=set)
    denied_hosts: set[str] = field(default_factory=set)
    first_seen: dict[str, str] = field(default_factory=dict)
    has_vuln_data: bool = False
    job_ids: list[str] = field(default_factory=list)
    commits: set[str] = field(default_factory=set)


def _purl_parts(purl: str) -> tuple[str, str, str]:
    """Split `pkg:type/namespace/name@version?q#s` into (key, ecosystem, version)."""
    body = purl.split("#", 1)[0].split("?", 1)[0]
    base, _, version = (
        body.rpartition("@") if "@" in body.split("/", 1)[-1] else (body, "", "")
    )
    if not base:
        base = body
    ecosystem = base.removeprefix("pkg:").split("/", 1)[0]
    return urllib.parse.unquote(base).lower(), ecosystem, urllib.parse.unquote(version)


def _walk_components(components: Iterable[dict[str, Any]]) -> Iterable[dict[str, Any]]:
    for comp in components or []:
        yield comp
        yield from _walk_components(comp.get("components") or [])


def parse_sbom(
    doc: dict[str, Any],
) -> tuple[dict[str, Package], list[Vulnerability], bool]:
    """Return packages keyed by versionless purl, vulnerabilities, and whether the SBOM had a vulnerabilities field."""
    packages: dict[str, Package] = {}
    by_ref: dict[str, str] = {}
    # CRACI lists the checked-out repository itself as a pkg:github component whose version is the commit.
    # It differs on every lane, so it is the lane's commit, not a dependency.
    props = {
        p.get("name"): p.get("value")
        for p in (doc.get("metadata") or {}).get("properties") or []
    }
    self_key = f"pkg:github/{props.get('craci:job:repository', '')}".lower()
    for comp in _walk_components(doc.get("components") or []):
        purl = comp.get("purl") or ""
        if purl and _purl_parts(purl)[0] == self_key:
            continue
        name = comp.get("name") or ""
        if purl:
            key, eco, ver = _purl_parts(purl)
        else:
            eco = comp.get("type") or "unknown"
            key, ver = (
                f"{eco}:{comp.get('group', '')}/{name}".lower(),
                comp.get("version") or "",
            )
        ver = comp.get("version") or ver
        pkg = Package(
            key=key,
            name=name,
            version=ver,
            ecosystem=eco,
            purl=purl,
            bom_ref=comp.get("bom-ref") or purl,
        )
        old = packages.get(key)
        if old is not None and ver and ver not in old.version.split(", "):
            # One build can hold several versions of a package (real SBOMs do: minimatch, opencv).
            joined = ", ".join(sorted({*old.version.split(", "), ver} - {""}))
            pkg = Package(
                old.key, old.name, joined, old.ecosystem, old.purl, old.bom_ref
            )
            packages[key] = pkg
        else:
            packages.setdefault(key, pkg)
        if pkg.bom_ref:
            by_ref[pkg.bom_ref] = key
    vulns: list[Vulnerability] = []
    has_vuln_data = "vulnerabilities" in doc
    for vuln in doc.get("vulnerabilities") or []:
        severity = "unknown"
        ranks = [
            str(r.get("severity", "")).lower()
            for r in vuln.get("ratings") or []
            if str(r.get("severity", "")).lower() in SEVERITY_ORDER
        ]
        if ranks:
            severity = max(ranks, key=SEVERITY_ORDER.index)
        source = (vuln.get("source") or {}).get("name", "")
        for affect in vuln.get("affects") or [{"ref": ""}]:
            ref = affect.get("ref", "")
            # Real CRACI SBOMs put the full purl (version and qualifiers included) in affects[].ref.
            key = by_ref.get(ref) or (
                _purl_parts(ref)[0] if ref.startswith("pkg:") else ref
            )
            version = _purl_parts(ref)[2] if ref.startswith("pkg:") else ""
            vulns.append(
                Vulnerability(
                    id=vuln.get("id", "?"),
                    severity=severity,
                    package_key=key,
                    source=source,
                    version=version,
                )
            )
    return packages, vulns, has_vuln_data


def _dns_name(record: str) -> str:
    """The spec says "name and type". Real traces carry only the name with a trailing dot ("pypi.org.").
    Take the first word and drop the dot: that handles both."""
    return record.strip().split()[0].rstrip(".").lower() if record.strip() else ""


def trace_hosts(trace: dict[str, Any]) -> tuple[set[str], set[str]]:
    """Return (hosts contacted, hosts the policy denied) from a NetworkTrace document."""
    hosts: set[str] = set()
    denied: set[str] = set()
    for obs in trace.get("observations") or []:
        proto = obs.get("protocol")
        host, was_denied = "", False
        if proto == "http":
            http = obs.get("http") or {}
            host = (
                urllib.parse.urlsplit(http.get("originUrl", "")).hostname
                or http.get("ipAddress", "")
            ).lower()
            was_denied = bool(http.get("policyDenied"))
        elif proto == "tcp":
            tcp = obs.get("tcp") or {}
            names = [tcp.get("tlsServerName")] + list(tcp.get("resolvedHosts") or [])
            host = next((n for n in names if n), tcp.get("remoteIp", "")).lower()
            was_denied = tcp.get("allowed") is False
        elif proto == "ssh_git":
            ssh = obs.get("sshGit") or {}
            host = str(ssh.get("host", "")).lower()
            was_denied = ssh.get("allowed") is False
        elif proto == "dns":
            host = _dns_name((obs.get("dns") or {}).get("record", ""))
        if host:
            hosts.add(host)
            if was_denied:
                denied.add(host)
    return hosts, denied


def first_seen(trace: dict[str, Any]) -> dict[str, str]:
    """Host -> earliest observedAt (RFC 3339) in the trace, for any protocol."""
    seen: dict[str, str] = {}
    for obs in trace.get("observations") or []:
        hosts, _ = trace_hosts({"observations": [obs]})
        for host in hosts:
            at = obs.get("observedAt", "")
            if at and (host not in seen or at < seen[host]):
                seen[host] = at
    return seen


def step_at(steps: list[dict[str, Any]], at: str) -> str:
    """Name of the GitHub step that was running at time `at` (steps carry started_at and completed_at, UTC)."""
    stamp = at[:19]  # second precision, as the GitHub API gives
    for step in steps:
        start = (step.get("started_at") or "")[:19]
        end = (step.get("completed_at") or "")[:19]
        if start and end and start <= stamp <= end:
            return step.get("name", "")
    return ""


def merge(
    builds: Iterable[tuple[str, dict[str, Any] | None, dict[str, Any] | None]],
) -> Build:
    """Merge (job_id, sbom, trace) triples of one lane into one Build."""
    out = Build()
    for job_id, sbom, trace in builds:
        out.job_ids.append(job_id)
        if sbom is not None:
            pkgs, vulns, has = parse_sbom(sbom)
            for key, pkg in pkgs.items():
                out.packages.setdefault(key, pkg)
            out.vulns.extend(vulns)
            out.has_vuln_data = out.has_vuln_data or has
        if trace is not None:
            hosts, denied = trace_hosts(trace)
            out.hosts |= hosts
            out.denied_hosts |= denied
            for host, at in first_seen(trace).items():
                if host not in out.first_seen or at < out.first_seen[host]:
                    out.first_seen[host] = at
            commit = (trace.get("job") or {}).get("commitSha")
            if commit:
                out.commits.add(commit)
    return out


@dataclass
class LaneDiff:
    lane: str
    new_packages: list[Package]
    changed_versions: list[tuple[Package, str]]
    new_vulns: list[Vulnerability]
    new_hosts: list[str]
    denied_hosts: list[str]
    has_vuln_data: bool


def diff(lane: str, base: Build, head: Build) -> LaneDiff:
    """What the lane's build has that main's build does not."""
    new_pkgs = sorted(
        (p for k, p in head.packages.items() if k not in base.packages),
        key=lambda p: p.key,
    )
    changed = sorted(
        (
            (p, base.packages[k].version)
            for k, p in head.packages.items()
            if k in base.packages and p.version != base.packages[k].version
        ),
        key=lambda pv: pv[0].key,
    )
    base_vuln_ids = {(v.id, v.package_key) for v in base.vulns}
    new_vulns = sorted(
        {v for v in head.vulns if (v.id, v.package_key) not in base_vuln_ids},
        key=lambda v: (
            -SEVERITY_ORDER.index(v.severity) if v.severity in SEVERITY_ORDER else 1,
            v.id,
        ),
    )
    return LaneDiff(
        lane=lane,
        new_packages=new_pkgs,
        changed_versions=changed,
        new_vulns=new_vulns,
        new_hosts=sorted(head.hosts - base.hosts),
        denied_hosts=sorted(head.denied_hosts),
        has_vuln_data=head.has_vuln_data,
    )


def gate(
    d: LaneDiff,
    allowed_hosts: Iterable[str] = (),
    host_steps: dict[str, str] | None = None,
) -> list[str]:
    """Reasons to block the merge. An empty list means the lane passes.

    `host_steps` (host -> GitHub step running when CRACI first saw it) only adds context to the reason.
    """
    host_steps = host_steps or {}
    reasons: list[str] = []
    patterns = [
        p.strip().lower()
        for p in allowed_hosts
        if p.strip() and not p.strip().startswith("#")
    ]
    for v in d.new_vulns:
        if v.severity in GATE_SEVERITIES:
            at = f"@{v.version}" if v.version else ""
            reasons.append(f"{v.severity} vulnerability {v.id} in {v.package_key}{at}")
    for host in d.new_hosts:
        if not any(fnmatch.fnmatch(host, p) for p in patterns):
            where = (
                f", first seen during step '{host_steps[host]}'"
                if host_steps.get(host)
                else ""
            )
            reasons.append(
                f"unexpected host {host}: main's build never contacts it{where}"
            )
    return reasons
