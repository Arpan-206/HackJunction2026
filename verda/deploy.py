"""Deploy Gemma 4 behind vLLM on a Verda serverless container and wait until it answers.

    uv run python deploy.py [--gpu H200] [--model google/gemma-4-31B-it] [--name geppetto-gemma] [--no-wait] [--spot]

Reuses the deployment if one with that name exists. Writes out/endpoint.json (base URL, model, GPU, timings) and
appends one record to out/deploy_log.jsonl. Prices are USD per hour on demand from https://verda.com/pricing, read on
14 Nov 2026; the live balance comes from the API before and after.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from typing import Any

import httpx
import paths
from verda.containers import (
    ComputeResource,
    Container,
    ContainerDeploymentStatus,
    Deployment,
    EntrypointOverridesSettings,
    EnvVar,
    EnvVarType,
    HealthcheckSettings,
    QueueLoadScalingTrigger,
    ScalingOptions,
    ScalingPolicy,
    ScalingTriggers,
    UtilizationScalingTrigger,
)

from verda import VerdaClient

DEFAULT_NAME = "geppetto-gemma"
DEFAULT_MODEL = "google/gemma-4-31B-it"
# The tag Verda's own vLLM tutorial recommends (docs.verda.com, containers, "Deploy with vLLM"); Gemma 4 landed in vLLM
# in April 2026, long before v0.29.0 (September 2026).
DEFAULT_IMAGE = "docker.io/vllm/vllm-openai:v0.29.0"
DEFAULT_GPU = "H200"
FALLBACK_GPUS = ("H200", "H100")
PORT = 8000
HEALTH_PATH = "/health"
# Measured on the H100 80 GB: the bf16 weights take 58.99 GiB and leave 8.61 GiB for the KV cache at 0.90 utilisation.
# A 32768 context needs 15.79 GiB and crash-loops; 12288 needs about 5.9 GiB. Our prompts stay under 9k tokens
# (8 pictures at 560 tokens each, about 2.5k tokens of text, 2k of output). On an H200 the longer context fits.
MAX_MODEL_LEN = 12288
GPU_MEMORY_UTILIZATION = 0.92
MAX_IMAGES_PER_PROMPT = 8
POLL_S = 15
WAIT_LIMIT_S = 45 * 60
CONCURRENT_REQUESTS = 8
SCALE_DOWN_DELAY_S = 600
QUEUE_TTL_S = 600
PRICE_USD_PER_H = {
    "H200": 7.37,
    "H100": 5.77,
    "RTX PRO 6000": 3.12,
    "L40S": 2.22,
    "B200": 10.46,
    "B300": 13.65,
}
HF_SECRET_NAME = "geppetto-hf-token"
ENDPOINT_FILE = paths.OUT / "endpoint.json"
LOG_FILE = paths.OUT / "deploy_log.jsonl"
GATEWAY = "https://containers.verda.com"


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def vllm_args(model: str, max_model_len: int = MAX_MODEL_LEN) -> list[str]:
    """The `vllm serve` arguments: one GPU, bf16 weights, up to MAX_IMAGES_PER_PROMPT pictures per request."""
    return [
        model,
        "--port",
        str(PORT),
        "--max-model-len",
        str(max_model_len),
        "--gpu-memory-utilization",
        f"{GPU_MEMORY_UTILIZATION:g}",
        "--limit-mm-per-prompt",
        json.dumps({"image": MAX_IMAGES_PER_PROMPT}),
        "--model-loader-extra-config",
        json.dumps({"enable_multithread_load": True}),
    ]


def build_deployment(
    name: str,
    model: str,
    gpu: str,
    image: str = DEFAULT_IMAGE,
    env: list[EnvVar] | None = None,
    min_replicas: int = 1,
    max_replicas: int = 1,
    spot: bool = False,
    max_model_len: int = MAX_MODEL_LEN,
) -> Deployment:
    """One vLLM container on one GPU, health checked on /health, with the OpenAI API on PORT."""
    container = Container(
        image=image,
        exposed_port=PORT,
        healthcheck=HealthcheckSettings(enabled=True, port=PORT, path=HEALTH_PATH),
        entrypoint_overrides=EntrypointOverridesSettings(
            enabled=True,
            entrypoint=["vllm", "serve"],
            cmd=vllm_args(model, max_model_len),
        ),
        env=env or None,
    )
    scaling = ScalingOptions(
        min_replica_count=min_replicas,
        max_replica_count=max_replicas,
        scale_down_policy=ScalingPolicy(delay_seconds=SCALE_DOWN_DELAY_S),
        scale_up_policy=ScalingPolicy(delay_seconds=0),
        queue_message_ttl_seconds=QUEUE_TTL_S,
        concurrent_requests_per_replica=CONCURRENT_REQUESTS,
        scaling_triggers=ScalingTriggers(
            queue_load=QueueLoadScalingTrigger(threshold=1.0),
            cpu_utilization=UtilizationScalingTrigger(enabled=False),
            gpu_utilization=UtilizationScalingTrigger(enabled=False),
        ),
    )
    return Deployment(
        name=name,
        containers=[container],
        compute=ComputeResource(name=gpu, size=1),
        is_spot=spot,
        scaling=scaling,
    )


def pick_gpu(resources: list[ComputeResource], wanted: str) -> str:
    """The wanted single GPU if Verda has one free, else the first fallback that is; fail if none."""
    free = {r.name for r in resources if r.size == 1 and r.is_available}
    for name in (wanted, *FALLBACK_GPUS):
        if name in free:
            return name
    raise SystemExit(
        f"no single GPU free among {wanted} and {FALLBACK_GPUS}; free now: {sorted(free)}"
    )


def hf_env(client: VerdaClient, secrets: dict[str, str]) -> list[EnvVar]:
    """HF_TOKEN as a Verda secret, when the .env has one. Gemma 4 is ungated, so this only lifts download limits."""
    token = secrets.get("HF_TOKEN")
    if not token:
        return []
    if HF_SECRET_NAME not in {s.name for s in client.containers.get_secrets()}:
        client.containers.create_secret(HF_SECRET_NAME, token)
    return [
        EnvVar(
            name="HF_TOKEN",
            value_or_reference_to_secret=HF_SECRET_NAME,
            type=EnvVarType.SECRET,
        )
    ]


def balance(client: VerdaClient) -> dict[str, Any]:
    b = client.balance.get()
    return {
        "amount": getattr(b, "amount", None),
        "currency": getattr(b, "currency", None),
    }


def raw_status(client: VerdaClient, name: str) -> str:
    """The deployment status as the API spells it. The SDK's enum lacks some values ("terminating"), so read it raw."""
    return str(
        client.containers.client.get(f"/container-deployments/{name}/status")
        .json()
        .get("status", "unknown")
    )


def wait_healthy(
    client: VerdaClient, name: str, limit_s: float = WAIT_LIMIT_S
) -> list[dict[str, Any]]:
    """Poll the status until healthy; print every change with a timestamp. Returns the status history."""
    started = time.monotonic()
    history: list[dict[str, Any]] = []
    last = None
    while True:
        status = raw_status(client, name)
        if status != last:
            history.append(
                {
                    "t": now_iso(),
                    "after_s": round(time.monotonic() - started),
                    "status": status,
                }
            )
            print(f"  {history[-1]['after_s']:5d} s  {status}", flush=True)
            if status == ContainerDeploymentStatus.UNHEALTHY.value:
                print(
                    "  (unhealthy while vLLM loads the weights is normal; `uv run python logs.py` shows progress and crashes)",
                    flush=True,
                )
            if status == ContainerDeploymentStatus.QUOTA_REACHED.value:
                print(
                    "  quota reached: no GPU of this type is free; tear down and try --gpu H100",
                    file=sys.stderr,
                )
            last = status
        if status == ContainerDeploymentStatus.HEALTHY.value:
            return history
        if time.monotonic() - started > limit_s:
            raise SystemExit(
                f"not healthy after {limit_s / 60:.0f} min (last status {status}); tear down or keep waiting"
            )
        time.sleep(POLL_S)


def smoke(base_url: str, api_key: str, model: str) -> dict[str, Any]:
    """GET /v1/models, then one tiny completion: proves the gateway, the key and the model, and times the first answer."""
    headers = {"Authorization": f"Bearer {api_key}"}
    with httpx.Client(timeout=300, headers=headers) as client:
        t0 = time.monotonic()
        models = client.get(base_url + "/v1/models")
        models.raise_for_status()
        served = [m["id"] for m in models.json().get("data", [])]
        body = {
            "model": model,
            "messages": [{"role": "user", "content": "Reply with the single word OK."}],
            "max_tokens": 5,
        }
        t1 = time.monotonic()
        r = client.post(base_url + "/v1/chat/completions", json=body)
        r.raise_for_status()
        text = r.json()["choices"][0]["message"].get("content", "")
    return {
        "served_models": served,
        "models_s": round(t1 - t0, 2),
        "first_completion_s": round(time.monotonic() - t1, 2),
        "reply": text.strip(),
    }


def append_log(record: dict[str, Any]) -> None:
    paths.OUT.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--name", default=DEFAULT_NAME)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--image", default=DEFAULT_IMAGE)
    ap.add_argument(
        "--gpu", default=DEFAULT_GPU, help="H200 (default), H100, RTX PRO 6000, L40S"
    )
    ap.add_argument("--max-model-len", type=int, default=MAX_MODEL_LEN)
    ap.add_argument(
        "--min-replicas",
        type=int,
        default=1,
        help="0 lets Verda scale to zero when idle",
    )
    ap.add_argument("--max-replicas", type=int, default=1)
    ap.add_argument(
        "--spot",
        action="store_true",
        help="spot pricing, about half price, may be preempted",
    )
    ap.add_argument(
        "--no-wait",
        action="store_true",
        help="create and return without waiting for health",
    )
    a = ap.parse_args(argv)

    secrets = paths.load_secrets()
    paths.require(
        secrets, "VERDA_CLOUD_CLIENT_ID", "VERDA_CLOUD", "VERDA_INFERENCE_KEY"
    )
    client = VerdaClient(
        secrets["VERDA_CLOUD_CLIENT_ID"],
        secrets["VERDA_CLOUD"],
        inference_key=secrets["VERDA_INFERENCE_KEY"],
    )
    before = balance(client)
    print(f"balance before: {before['amount']} {before['currency']}")

    existing = {d.name: d for d in client.containers.get_deployments()}
    created_at = now_iso()
    if a.name in existing:
        dep = existing[a.name]
        gpu = dep.compute.name
        created_at = dep.created_at or created_at
        print(f"reusing deployment {a.name} on {gpu} (created {created_at})")
    else:
        gpu = pick_gpu(client.containers.get_compute_resources(), a.gpu)
        price = PRICE_USD_PER_H.get(gpu)
        print(
            f"creating {a.name}: {a.model} on 1x {gpu} ({price} USD/h on demand), image {a.image}"
        )
        dep = client.containers.create_deployment(
            build_deployment(
                a.name,
                a.model,
                gpu,
                a.image,
                hf_env(client, secrets),
                a.min_replicas,
                a.max_replicas,
                a.spot,
                a.max_model_len,
            )
        )
    base_url = (dep.endpoint_base_url or f"{GATEWAY}/{a.name}").rstrip("/")
    info: dict[str, Any] = {
        "name": a.name,
        "base_url": base_url,
        "model": a.model,
        "gpu": gpu,
        "image": a.image,
        "spot": a.spot,
        "price_usd_per_h": PRICE_USD_PER_H.get(gpu),
        "created_at": created_at,
        "balance_before": before,
    }
    paths.OUT.mkdir(parents=True, exist_ok=True)
    ENDPOINT_FILE.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    append_log(
        {
            "event": "deploy",
            "t": created_at,
            **{k: v for k, v in info.items() if k != "balance_before"},
            "balance": before,
        }
    )
    if a.no_wait:
        print(
            f"created; endpoint {base_url}. Run again without --no-wait to wait for health."
        )
        return 0

    print("waiting for the replica (image pull, 62 GB of weights, vLLM start)...")
    t0 = time.monotonic()
    info["status_history"] = wait_healthy(client, a.name)
    info["healthy_after_s"] = round(time.monotonic() - t0)
    info["healthy_at"] = now_iso()
    print("healthy; smoke test...")
    info["smoke"] = smoke(base_url, secrets["VERDA_INFERENCE_KEY"], a.model)
    info["cold_start_to_first_completion_s"] = round(
        info["healthy_after_s"]
        + info["smoke"]["models_s"]
        + info["smoke"]["first_completion_s"]
    )
    ENDPOINT_FILE.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")
    append_log(
        {
            "event": "healthy",
            "t": info["healthy_at"],
            "name": a.name,
            "healthy_after_s": info["healthy_after_s"],
            "smoke": info["smoke"],
        }
    )
    print(
        json.dumps(
            {
                k: info[k]
                for k in (
                    "base_url",
                    "gpu",
                    "healthy_after_s",
                    "cold_start_to_first_completion_s",
                    "smoke",
                )
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
