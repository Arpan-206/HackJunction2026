"""Demo day: try to bring Gemma 4 31B up for the expert flow, and give up cleanly when Verda has no GPU.

    cd verda && .venv/bin/python demo_gemma.py [--grant-minutes 10] [--load-minutes 20] [--gpu H200]

Two phases, because a cold start takes about 7.6 minutes once a GPU is granted (docs/VERDA.md):

1. Grant: wait up to --grant-minutes for a free single GPU (H200, then H100) and for the deployment to leave
   `quota_reached`. No GPU in that time: the deployment is deleted if it was created, and the exit code is 3.
2. Load: the GPU is ours and vLLM loads the weights. Wait up to --load-minutes more for `healthy`, then run the smoke
   test. Not healthy in that time: the deployment is deleted, and the exit code is 4.

Exit code 0 means the endpoint answered; the last line is `BASE_URL=<url>`. Everything is recorded like deploy.py does
(out/endpoint.json, out/deploy_log.jsonl), so teardown.py and status.py work as usual.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any

import paths
import deploy
import teardown
from verda.containers import ContainerDeploymentStatus

from verda import VerdaClient

GRANT_POLL_S = 20
NO_GPU = 3
NOT_HEALTHY = 4


def free_gpu(client: VerdaClient, wanted: str) -> str | None:
    """The wanted single GPU if one is free, else the first free fallback, else None (deploy.pick_gpu without the exit)."""
    free = {r.name for r in client.containers.get_compute_resources() if r.size == 1 and r.is_available}
    for name in (wanted, *deploy.FALLBACK_GPUS):
        if name in free:
            return name
    return None


def granted(status: str) -> bool:
    """A replica has a GPU once the deployment is past `quota_reached`."""
    return status != ContainerDeploymentStatus.QUOTA_REACHED.value


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--name", default=deploy.DEFAULT_NAME)
    ap.add_argument("--gpu", default=deploy.DEFAULT_GPU)
    ap.add_argument("--grant-minutes", type=float, default=10.0)
    ap.add_argument("--load-minutes", type=float, default=20.0)
    a = ap.parse_args(argv)

    secrets = paths.load_secrets()
    paths.require(secrets, "VERDA_CLOUD_CLIENT_ID", "VERDA_CLOUD", "VERDA_INFERENCE_KEY")
    client = VerdaClient(
        secrets["VERDA_CLOUD_CLIENT_ID"], secrets["VERDA_CLOUD"], inference_key=secrets["VERDA_INFERENCE_KEY"]
    )

    t0 = time.monotonic()
    created = a.name in {d.name for d in client.containers.get_deployments()}
    if created:
        print(f"deployment {a.name} exists already: reusing it", flush=True)
    status = "none"
    while True:
        waited = time.monotonic() - t0
        if not created:
            gpu = free_gpu(client, a.gpu)
            if gpu:
                print(f"{waited:5.0f} s  a single {gpu} is free: creating {a.name}", flush=True)
                try:
                    deploy.main(["--name", a.name, "--gpu", gpu, "--no-wait"])
                    created = True
                except SystemExit as exc:  # the GPU went to someone else between the check and the create
                    print(f"{waited:5.0f} s  create refused ({exc}); trying again", flush=True)
            else:
                print(f"{waited:5.0f} s  no single GPU free among {a.gpu} and {deploy.FALLBACK_GPUS}", flush=True)
        if created:
            status = deploy.raw_status(client, a.name)
            if granted(status):
                print(f"{waited:5.0f} s  GPU granted (status {status})", flush=True)
                break
            print(f"{waited:5.0f} s  status {status}: no GPU yet", flush=True)
        if waited >= a.grant_minutes * 60:
            print(f"no GPU within {a.grant_minutes:g} minutes: giving up", file=sys.stderr, flush=True)
            if created:
                teardown.main(["--name", a.name])
            return NO_GPU
        time.sleep(GRANT_POLL_S)

    print(f"waiting up to {a.load_minutes:g} minutes for the weights to load (about 7.6 minutes on 14 Nov)...", flush=True)
    t1 = time.monotonic()
    try:
        history = deploy.wait_healthy(client, a.name, limit_s=a.load_minutes * 60)
    except SystemExit as exc:
        print(f"not healthy in time ({exc}): deleting the deployment", file=sys.stderr, flush=True)
        teardown.main(["--name", a.name])
        return NOT_HEALTHY

    info: dict[str, Any] = (
        json.loads(deploy.ENDPOINT_FILE.read_text(encoding="utf-8")) if deploy.ENDPOINT_FILE.exists() else {}
    )
    base_url = (info.get("base_url") or f"{deploy.GATEWAY}/{a.name}").rstrip("/")
    model = info.get("model") or deploy.DEFAULT_MODEL
    try:
        smoke = deploy.smoke(base_url, secrets["VERDA_INFERENCE_KEY"], model)
    except Exception as exc:  # noqa: BLE001 - a healthy container that cannot answer is no use on stage
        print(f"healthy but the smoke test failed ({type(exc).__name__}): deleting the deployment", file=sys.stderr)
        teardown.main(["--name", a.name])
        return NOT_HEALTHY
    info.update(
        {
            "name": a.name,
            "base_url": base_url,
            "model": model,
            "status_history": history,
            "healthy_after_s": round(time.monotonic() - t1),
            "healthy_at": deploy.now_iso(),
            "smoke": smoke,
        }
    )
    for stale in ("torn_down_at", "hours", "estimated_usd", "balance_after"):
        info.pop(stale, None)
    deploy.ENDPOINT_FILE.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    deploy.append_log(
        {"event": "healthy", "t": info["healthy_at"], "name": a.name, "healthy_after_s": info["healthy_after_s"], "smoke": smoke}
    )
    print(f"up after {time.monotonic() - t0:.0f} s in all; smoke reply {smoke.get('reply')!r}")
    print(f"BASE_URL={base_url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
