"""Thin client for the CRACI API (https://api.craci.com/openapi.json, version 2026-09-11).

Only the endpoints the spec lists are used. The token is read once and never printed or logged.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

BASE_URL = "https://api.craci.com"
TOKEN_NAME = "CRACI_API_TOKEN"
PROVIDER = "github"


class CraciError(RuntimeError):
    """An API call failed. Carries the HTTP status and the Problem title and detail from the spec."""

    def __init__(self, status: int, title: str, detail: str, path: str) -> None:
        super().__init__(f"{path}: HTTP {status} {title}: {detail}")
        self.status = status
        self.title = title
        self.detail = detail
        self.path = path


def load_token(env_file: Path | None = None) -> str | None:
    """Return the token from the environment, else from a dotenv file. Never print the value."""
    value = os.environ.get(TOKEN_NAME)
    if value:
        return value
    if env_file is None or not env_file.is_file():
        return None
    for line in env_file.read_text().splitlines():
        name, sep, rest = line.partition("=")
        if sep and name.strip().removeprefix("export ").strip() == TOKEN_NAME:
            return rest.strip().strip('"').strip("'") or None
    return None


class CraciClient:
    """One method per spec operation that agent_bom needs."""

    def __init__(
        self, token: str, base_url: str = BASE_URL, timeout: float = 60.0
    ) -> None:
        self._token = token
        self._base = base_url.rstrip("/")
        self._timeout = timeout

    def __repr__(self) -> str:  # keep the token out of any repr or traceback
        return f"CraciClient(base_url={self._base!r})"

    def _get(self, path: str, params: dict[str, Any], accept: str) -> bytes:
        query = urllib.parse.urlencode(params, doseq=True)
        req = urllib.request.Request(
            f"{self._base}{path}?{query}",
            headers={"Authorization": f"Bearer {self._token}", "Accept": accept},
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as err:
            body = err.read()
            title, detail = err.reason or "", ""
            try:
                problem = json.loads(body)
                title = problem.get("title", title)
                detail = problem.get("detail", "")
            except (ValueError, AttributeError):
                pass
            raise CraciError(err.code, str(title), str(detail), path) from None

    def _json(
        self, path: str, params: dict[str, Any], accept: str = "application/json"
    ) -> Any:
        return json.loads(self._get(path, params, accept))

    # operationId getSbom
    def sbom(self, repo: str, job_id: str) -> dict[str, Any]:
        return self._json(
            "/v1preview1/sbom",
            {"provider": PROVIDER, "repo": repo, "job_id": job_id},
            accept="application/vnd.cyclonedx+json, application/json",
        )

    # operationId getNetworkTrace
    def network_trace(self, repo: str, job_id: str) -> dict[str, Any]:
        return self._json(
            "/v1preview1/network-trace",
            {"provider": PROVIDER, "repo": repo, "job_id": job_id},
        )

    # operationId listJobs (only status=active exists in the spec)
    def active_jobs(self, since: str | None = None) -> dict[str, Any]:
        params = {"status": "active"}
        if since:
            params["since"] = since
        return self._json("/v1preview1/jobs", params)

    # operationId getOciManifestProvenance
    def oci_manifest_provenance(self, digest: str) -> dict[str, Any]:
        return self._json(
            "/v1preview1/artifact-provenance/oci_manifest", {"digest": digest}
        )

    # operationId getOciManifestSbom
    def oci_manifest_sbom(self, digest: str) -> dict[str, Any]:
        return self._json(
            "/v1experimental1/sbom/oci_manifest",
            {"digest": digest},
            accept="application/vnd.cyclonedx+json, application/json",
        )

    # operationId getUsage
    def usage(self, start: str, end: str) -> dict[str, Any]:
        return self._json("/v1preview1/usage", {"start": start, "end": end})
