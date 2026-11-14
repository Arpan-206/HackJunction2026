"""agent_bom tests on SPEC-SHAPED FIXTURES, not real CRACI data.

Every document below is hand-written to the shapes in https://api.craci.com/openapi.json (NetworkTrace) and
CycloneDX 1.7 (SBOM). Package names, vulnerability ids and hosts are invented test values. No result in
docs/CRACI.md comes from this file.

Run: python -m pytest -q tools/agent_bom/tests
"""

from __future__ import annotations

from tools.agent_bom.analyse import diff, gate, merge, parse_sbom, trace_hosts
from tools.agent_bom.client import CraciClient, load_token

FIXTURE_MAIN_SBOM = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.7",
    "components": [
        {
            "type": "library",
            "name": "numpy",
            "version": "2.1.0",
            "purl": "pkg:pypi/numpy@2.1.0",
            "bom-ref": "a",
        },
        {
            "type": "library",
            "name": "react",
            "version": "18.3.1",
            "purl": "pkg:npm/react@18.3.1",
            "bom-ref": "b",
        },
    ],
    "vulnerabilities": [],
}

FIXTURE_LANE_SBOM = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.7",
    "components": [
        {
            "type": "library",
            "name": "numpy",
            "version": "2.2.0",
            "purl": "pkg:pypi/numpy@2.2.0",
            "bom-ref": "a",
        },
        {
            "type": "library",
            "name": "react",
            "version": "18.3.1",
            "purl": "pkg:npm/react@18.3.1",
            "bom-ref": "b",
        },
        {
            "type": "library",
            "name": "fixture-pkg",
            "version": "0.0.1",
            "purl": "pkg:pypi/fixture-pkg@0.0.1",
            "bom-ref": "c",
            "components": [
                {
                    "type": "library",
                    "name": "react",
                    "group": "@types",
                    "purl": "pkg:npm/%40types/react@18.3.31",
                }
            ],
        },
    ],
    "vulnerabilities": [
        {
            "id": "FIXTURE-0001",
            "source": {"name": "fixture"},
            "ratings": [{"severity": "medium"}, {"severity": "high"}],
            "affects": [{"ref": "c"}],
        }
    ],
}


def _trace(*obs):
    return {
        "schemaVersion": "fixture",
        "job": {"commitSha": "fixture-sha", "branch": "fixture", "jobId": "1"},
        "observations": list(obs),
    }


FIXTURE_MAIN_TRACE = _trace(
    {
        "sequence": 0,
        "protocol": "http",
        "http": {"originUrl": "https://pypi.org/simple/numpy/", "policyDenied": False},
    },
    {
        "sequence": 1,
        "protocol": "dns",
        "dns": {
            "record": "registry.npmjs.org. A",
            "nameserverIp": "x",
            "response": "y",
        },
    },
)

FIXTURE_LANE_TRACE = _trace(
    {
        "sequence": 0,
        "protocol": "http",
        "http": {"originUrl": "https://pypi.org/simple/numpy/", "policyDenied": False},
    },
    {
        "sequence": 1,
        "protocol": "dns",
        "dns": {
            "record": "registry.npmjs.org. A",
            "nameserverIp": "x",
            "response": "y",
        },
    },
    {
        "sequence": 2,
        "protocol": "tcp",
        "tcp": {
            "remoteIp": "192.0.2.1",
            "resolvedHosts": ["fixture.example"],
            "port": 443,
            "allowed": True,
        },
    },
    {
        "sequence": 3,
        "protocol": "ssh_git",
        "sshGit": {"host": "git.fixture.example", "allowed": False},
    },
)


def test_parse_sbom_walks_nested_components_and_maps_vulns():
    pkgs, vulns, has = parse_sbom(FIXTURE_LANE_SBOM)
    assert set(pkgs) == {
        "pkg:pypi/numpy",
        "pkg:npm/react",
        "pkg:pypi/fixture-pkg",
        "pkg:npm/@types/react",
    }
    assert has
    assert [(v.id, v.severity, v.package_key) for v in vulns] == [
        ("FIXTURE-0001", "high", "pkg:pypi/fixture-pkg")
    ]


def test_trace_hosts_reads_every_protocol():
    hosts, denied = trace_hosts(FIXTURE_LANE_TRACE)
    assert hosts == {
        "pypi.org",
        "registry.npmjs.org",
        "fixture.example",
        "git.fixture.example",
    }
    assert denied == {"git.fixture.example"}


def test_diff_and_gate_block_on_high_vuln_and_new_host():
    base = merge([("1", FIXTURE_MAIN_SBOM, FIXTURE_MAIN_TRACE)])
    head = merge([("2", FIXTURE_LANE_SBOM, FIXTURE_LANE_TRACE)])
    d = diff("fixture-lane", base, head)
    assert [p.key for p in d.new_packages] == [
        "pkg:npm/@types/react",
        "pkg:pypi/fixture-pkg",
    ]
    assert [(p.key, old, p.version) for p, old in d.changed_versions] == [
        ("pkg:pypi/numpy", "2.1.0", "2.2.0")
    ]
    assert d.new_hosts == ["fixture.example", "git.fixture.example"]
    reasons = gate(d)
    assert any("high vulnerability FIXTURE-0001" in r for r in reasons)
    assert any("unexpected host fixture.example" in r for r in reasons)
    assert gate(d, ["*.example", "fixture.example"]) == [
        "high vulnerability FIXTURE-0001 in pkg:pypi/fixture-pkg"
    ]


def test_clean_lane_passes():
    base = merge([("1", FIXTURE_MAIN_SBOM, FIXTURE_MAIN_TRACE)])
    d = diff("same", base, merge([("2", FIXTURE_MAIN_SBOM, FIXTURE_MAIN_TRACE)]))
    assert not d.new_packages and not d.new_hosts and not d.new_vulns
    assert gate(d) == []


def test_token_never_in_repr(tmp_path, monkeypatch):
    monkeypatch.delenv("CRACI_API_TOKEN", raising=False)
    env = tmp_path / ".env"
    env.write_text("OTHER=1\nCRACI_API_TOKEN=fixture-secret\n")
    token = load_token(env)
    assert token == "fixture-secret"
    assert "fixture-secret" not in repr(CraciClient(token))
    assert load_token(tmp_path / "missing.env") is None


def test_lane_from_merge_subject_reads_our_merge_styles():
    from tools.agent_bom.sources import lane_from_merge_subject

    # Subjects copied from real merge commits on main.
    assert (
        lane_from_merge_subject("Merge remote-tracking branch 'origin/lidar'")
        == "lidar"
    )
    assert lane_from_merge_subject("Merge branch 'hand-root'") == "hand-root"
    assert (
        lane_from_merge_subject("Merge pull request #1 from Blacbrd/core-overnight")
        == "core-overnight"
    )
    assert (
        lane_from_merge_subject("Merge lane core (core-calibration): per-wearer flat")
        == "core-calibration"
    )
    assert lane_from_merge_subject("Merge lane verda") == "verda"
    assert (
        lane_from_merge_subject("Merge lane robot-view: Dex3-1 twin from the URDF")
        == "robot-view"
    )


# FIXTURE in the shape of a real CRACI response (Sun 15 Nov): no `version` on components, purl refs with
# qualifiers in `affects`, the repository itself as a pkg:github component, DNS records with a trailing dot.
# Package names and ids below are test values.
FIXTURE_REAL_SHAPE_SBOM = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.7",
    "metadata": {
        "properties": [{"name": "craci:job:repository", "value": "Owner/Repo"}]
    },
    "components": [
        {
            "type": "library",
            "name": "owner/repo",
            "purl": "pkg:github/Owner/Repo@abc123",
            "bom-ref": "x",
        },
        {
            "type": "library",
            "name": "fixture-a",
            "purl": "pkg:npm/fixture-a@1.0.0",
            "bom-ref": "a1",
        },
        {
            "type": "library",
            "name": "fixture-a",
            "purl": "pkg:npm/fixture-a@2.0.0",
            "bom-ref": "a2",
        },
        {
            "type": "library",
            "name": "fixture-b",
            "purl": "pkg:pypi/fixture-b@3.0?file_name=b.whl",
            "bom-ref": "y",
        },
    ],
    "vulnerabilities": [
        {
            "id": "FIXTURE-0002",
            "source": {"name": "osv"},
            "ratings": [{"severity": "unknown"}],
            "affects": [{"ref": "pkg:pypi/fixture-b@3.0?file_name=b.whl"}],
        }
    ],
}


def test_real_shape_sbom_and_dns():
    pkgs, vulns, _ = parse_sbom(FIXTURE_REAL_SHAPE_SBOM)
    assert "pkg:github/owner/repo" not in pkgs
    assert pkgs["pkg:npm/fixture-a"].version == "1.0.0, 2.0.0"
    assert pkgs["pkg:pypi/fixture-b"].version == "3.0"
    assert [(v.package_key, v.version, v.severity) for v in vulns] == [
        ("pkg:pypi/fixture-b", "3.0", "unknown")
    ]
    hosts, _ = trace_hosts(
        {"observations": [{"protocol": "dns", "dns": {"record": "pypi.org."}}]}
    )
    assert hosts == {"pypi.org"}
