"""Find the GitHub job ids of a lane's CRACI builds (through `gh`) and the commit that introduced a package (git).

CRACI's API looks jobs up by GitHub job id. Its listJobs operation only lists active jobs, so finished jobs come
from the GitHub Actions API instead.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass

LOCKFILES = [
    "requirements.txt",
    "pyproject.toml",
    "backend/pyproject.toml",
    "backend/uv.lock",
    "frontend/package.json",
    "frontend/package-lock.json",
    ".github/workflows",
]


@dataclass(frozen=True)
class JobRef:
    job_id: str
    run_id: str
    name: str
    conclusion: str
    head_sha: str


def _gh(args: list[str]) -> object:
    out = subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout
    return json.loads(out) if out.strip() else None


def audit_jobs(repo: str, workflow: str = "lane-audit.yml", runs: int = 5) -> dict[str, JobRef]:
    """Newest finished `lane <name>` job per lane, from the last few runs of the lane-audit workflow."""
    found: dict[str, JobRef] = {}
    run_list = _gh(
        ["run", "list", "--repo", repo, "--workflow", workflow, "--limit", str(runs), "--json", "databaseId,status"]
    )
    for run in run_list or []:
        jobs = _gh(["api", f"repos/{repo}/actions/runs/{run['databaseId']}/jobs?per_page=100"]) or {}
        for job in jobs.get("jobs", []):
            name = job.get("name", "")
            if not name.startswith("lane ") or job.get("status") != "completed":
                continue
            lane = name.removeprefix("lane ").strip()
            if lane not in found:  # runs come newest first
                found[lane] = JobRef(
                    str(job["id"]), str(run["databaseId"]), name, job.get("conclusion") or "", job.get("head_sha", "")
                )
    return found


def branch_jobs(repo: str, branch: str, workflow: str = "ci.yml") -> list[JobRef]:
    """Finished jobs of the newest completed ci run on a branch (core, backend, frontend)."""
    run_list = _gh(
        [
            "run", "list", "--repo", repo, "--workflow", workflow, "--branch", branch,
            "--status", "completed", "--limit", "1", "--json", "databaseId",
        ]
    )
    if not run_list:
        return []
    run_id = run_list[0]["databaseId"]
    jobs = _gh(["api", f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100"]) or {}
    return [
        JobRef(str(j["id"]), str(run_id), j["name"], j.get("conclusion") or "", j.get("head_sha", ""))
        for j in jobs.get("jobs", [])
        if j.get("status") == "completed"
    ]


def introducing_commit(lane: str, needle: str, base: str = "origin/main", remote: str = "origin") -> tuple[str, str]:
    """Oldest lane-only commit whose lockfile diff adds or removes `needle`. Returns (short sha, subject) or ("", "")."""
    if not needle:
        return "", ""
    out = subprocess.run(
        [
            "git", "log", "--reverse", "--format=%h%x09%s", f"-S{needle}",
            f"{base}..{remote}/{lane}", "--", *LOCKFILES,
        ],
        capture_output=True,
        text=True,
    ).stdout
    first = out.splitlines()[0] if out.strip() else ""
    sha, _, subject = first.partition("\t")
    return sha, subject
