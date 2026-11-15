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
    out = subprocess.run(
        ["gh", *args], check=True, capture_output=True, text=True
    ).stdout
    return json.loads(out) if out.strip() else None


def audit_jobs(
    repo: str, workflow: str = "lane-audit.yml", runs: int = 5
) -> dict[str, JobRef]:
    """Newest finished `lane <name>` job per lane, from the last few runs of the lane-audit workflow."""
    found: dict[str, JobRef] = {}
    run_list = _gh(
        [
            "run",
            "list",
            "--repo",
            repo,
            "--workflow",
            workflow,
            "--limit",
            str(runs),
            "--json",
            "databaseId,status",
        ]
    )
    for run in run_list or []:
        jobs = (
            _gh(
                [
                    "api",
                    f"repos/{repo}/actions/runs/{run['databaseId']}/jobs?per_page=100",
                ]
            )
            or {}
        )
        for job in jobs.get("jobs", []):
            name = job.get("name", "")
            if (
                not name.startswith("lane ")
                or job.get("status") != "completed"
                or job.get("conclusion") == "cancelled"
            ):
                continue
            lane = name.removeprefix("lane ").strip()
            if lane not in found:  # runs come newest first
                found[lane] = JobRef(
                    str(job["id"]),
                    str(run["databaseId"]),
                    name,
                    job.get("conclusion") or "",
                    job.get("head_sha", ""),
                )
    return found


def branch_jobs(repo: str, branch: str, workflow: str = "ci.yml") -> list[JobRef]:
    """Finished jobs of the newest completed ci run on a branch (core, backend, frontend)."""
    run_list = _gh(
        [
            "run",
            "list",
            "--repo",
            repo,
            "--workflow",
            workflow,
            "--branch",
            branch,
            "--status",
            "completed",
            "--limit",
            "1",
            "--json",
            "databaseId",
        ]
    )
    if not run_list:
        return []
    run_id = run_list[0]["databaseId"]
    jobs = _gh(["api", f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100"]) or {}
    return [
        JobRef(
            str(j["id"]),
            str(run_id),
            j["name"],
            j.get("conclusion") or "",
            j.get("head_sha", ""),
        )
        for j in jobs.get("jobs", [])
        if j.get("status") == "completed"
    ]


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], check=False, capture_output=True, text=True
    ).stdout


def lock_needles(name: str, ecosystem: str) -> list[tuple[str, list[str]]]:
    """Exact strings that mark a package in our lockfiles, with the files to search. Lockfiles hold transitive deps."""
    if ecosystem == "npm":
        return [
            (
                f'"node_modules/{name}"',
                ["frontend/package-lock.json", "genui/package-lock.json"],
            ),
            (f'"{name}"', ["frontend/package.json", "genui/package.json"]),
        ]
    if ecosystem == "pypi":
        return [
            (
                f'name = "{name}"',
                ["backend/uv.lock", "verda/uv.lock", "export/uv.lock"],
            ),
            (name, ["requirements.txt", "pyproject.toml"]),
        ]
    return [(name, LOCKFILES)]


def first_commit_on(ref: str, needle: str, paths: list[str]) -> str:
    """Oldest commit reachable from `ref` whose diff of `paths` changes the count of `needle` (git pickaxe)."""
    out = _git(
        "log", "--reverse", "--format=%H", f"-S{needle}", ref, "--", *paths
    ).split()
    return out[0] if out else ""


def lane_of(sha: str, main: str = "origin/main") -> tuple[str, str]:
    """Which lane brought `sha` into main: the first first-parent commit of main that contains it.

    Returns (lane, merge subject). A merge subject names the lane ("Merge lane X", "Merge remote-tracking branch
    'origin/X'", "Merge branch 'X'", "Merge pull request #1 from owner/X"). A plain commit means "direct to main".
    """
    chain = _git("rev-list", "--first-parent", "--reverse", main).split()
    lo, hi = 0, len(chain) - 1
    if (
        not chain
        or subprocess.run(
            ["git", "merge-base", "--is-ancestor", sha, chain[hi]], check=False
        ).returncode
        != 0
    ):
        return "", ""
    while lo < hi:  # ancestry is monotone along the first-parent chain
        mid = (lo + hi) // 2
        if (
            subprocess.run(
                ["git", "merge-base", "--is-ancestor", sha, chain[mid]], check=False
            ).returncode
            == 0
        ):
            hi = mid
        else:
            lo = mid + 1
    subject = _git("log", "-1", "--format=%s", chain[lo]).strip()
    parents = _git("rev-list", "--parents", "-n1", chain[lo]).split()
    if len(parents) <= 2:
        picked = _cherry_pick_sources().get(
            _git("log", "-1", "--format=%s", sha).strip()
        )
        return (f"{picked} (cherry-picked)" if picked else "main (direct)"), subject
    return lane_from_merge_subject(subject), subject


_PICKS: dict[str, str] | None = None


def _cherry_pick_sources(main: str = "origin/main") -> dict[str, str]:
    """Subject -> lane, for commits that exist only on a lane. A main commit with the same subject was copied over."""
    global _PICKS
    if _PICKS is None:
        _PICKS = {}
        for ref in _git(
            "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"
        ).split():
            lane = ref.removeprefix("origin/")
            if lane in ("HEAD", "main", "origin") or ref == "origin":
                continue
            for subj in _git("log", "--format=%s", ref, "--not", main).splitlines():
                _PICKS.setdefault(subj.strip(), lane)
    return _PICKS


def lane_from_merge_subject(subject: str) -> str:
    import re

    for pattern in (
        r"Merge remote-tracking branch 'origin/([^']+)'",
        r"Merge branch '([^']+)'",
        r"Merge pull request #\d+ from [^/\s]+/(\S+)",
        r"Merge lane [^(:]*\(([^)]+)\)",
        r"Merge lane ([\w.-]+)",
        r"Merge ([\w.-]+) ",
    ):
        m = re.search(pattern, subject)
        if m:
            return m.group(1)
    return "merge: " + subject[:40]


def attribute(
    name: str, ecosystem: str, ref: str = "origin/main"
) -> tuple[str, str, str]:
    """(lane, short sha, subject) of the commit that first put `name` into a lockfile or manifest on `ref`."""
    for needle, paths in lock_needles(name, ecosystem):
        sha = first_commit_on(ref, needle, paths)
        if sha:
            lane, _ = lane_of(sha, ref)
            return lane, sha[:7], _git("log", "-1", "--format=%s", sha).strip()
    return "", "", ""


def _parse_npm_lock(text: str) -> set[str]:
    try:
        packages = json.loads(text).get("packages", {})
    except ValueError:
        return set()
    return {k.rsplit("node_modules/", 1)[-1] for k in packages if k}


def _parse_uv_lock(text: str) -> set[str]:
    import re

    return set(
        re.findall(r'^\[\[package\]\]\s*\nname = "([^"]+)"', text, flags=re.MULTILINE)
    )


def _parse_requirements(text: str) -> set[str]:
    import re

    names = set()
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if line and not line.startswith("-"):
            names.add(re.split(r"[\s\[<>=!~;]", line, maxsplit=1)[0].lower())
    return names


MANIFESTS = {
    "frontend/package-lock.json": ("npm", _parse_npm_lock),
    "backend/uv.lock": ("pypi", _parse_uv_lock),
    "requirements.txt": ("pypi", _parse_requirements),
    # Side projects agents added with their own lockfiles; ci.yml does not build them, lane-audit installs them.
    "verda/uv.lock": ("pypi", _parse_uv_lock),
    "export/uv.lock": ("pypi", _parse_uv_lock),
    "genui/package-lock.json": ("npm", _parse_npm_lock),
}


def lockfile_history(ref: str = "origin/main") -> list[dict[str, str]]:
    """Every package in our lockfiles at `ref`, with the commit and lane that first added it. Git only, no API.

    Walks each lockfile's history oldest first and records the first commit where each name appears.
    """
    rows: list[dict[str, str]] = []
    lane_cache: dict[str, tuple[str, str]] = {}
    for path, (eco, parse) in MANIFESTS.items():
        seen: dict[str, str] = {}
        for sha in _git("log", "--reverse", "--format=%H", ref, "--", path).split():
            text = subprocess.run(
                ["git", "show", f"{sha}:{path}"],
                check=False,
                capture_output=True,
                text=True,
            ).stdout
            for name in parse(text):
                seen.setdefault(name, sha)
        current = parse(
            subprocess.run(
                ["git", "show", f"{ref}:{path}"],
                check=False,
                capture_output=True,
                text=True,
            ).stdout
        )
        for name in sorted(current):
            sha = seen.get(name, "")
            if sha not in lane_cache:
                lane_cache[sha] = lane_of(sha, ref) if sha else ("", "")
            rows.append(
                {
                    "file": path,
                    "ecosystem": eco,
                    "name": name,
                    "commit": sha[:7],
                    "lane": lane_cache[sha][0],
                }
            )
    return rows


def run_log_summary(repo: str, run_id: str) -> dict[str, dict[str, object]]:
    """Per lane job of one lane-audit run: failed steps and the npm audit line, read from the GitHub job logs.

    Audit steps use continue-on-error, so a job is green even when a step fails. Only the log shows the failure.
    """
    import re

    log = subprocess.run(
        ["gh", "run", "view", run_id, "--repo", repo, "--log"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    out: dict[str, dict[str, object]] = {}
    for line in log.splitlines():
        job, _, rest = line.partition("\t")
        step, _, text = rest.partition("\t")
        if not job.startswith("lane "):
            continue
        lane = job.removeprefix("lane ").strip()
        row = out.setdefault(lane, {"failed_steps": [], "npm_audit": {}})
        if "##[error]" in text and step not in row["failed_steps"]:
            row["failed_steps"].append(step)
        m = re.search(r"(\d+ vulnerabilities \([^)]*\)|found 0 vulnerabilities)", text)
        if m:
            row["npm_audit"].setdefault(step, m.group(1))
    return out


def introducing_commit(
    lane: str, needle: str, base: str = "origin/main", remote: str = "origin"
) -> tuple[str, str]:
    """Oldest lane-only commit whose lockfile diff adds or removes `needle`. Returns (short sha, subject) or ("", "")."""
    if not needle:
        return "", ""
    out = subprocess.run(
        [
            "git",
            "log",
            "--reverse",
            "--format=%h%x09%s",
            f"-S{needle}",
            f"{base}..{remote}/{lane}",
            "--",
            *LOCKFILES,
        ],
        check=False,
        capture_output=True,
        text=True,
    ).stdout
    first = out.splitlines()[0] if out.strip() else ""
    sha, _, subject = first.partition("\t")
    return sha, subject
