"""The deployment the deploy script asks Verda for, checked offline."""

import pytest
from verda.containers import ComputeResource

import deploy


def test_deployment_shape():
    dep = deploy.build_deployment("geppetto-gemma", "google/gemma-4-31B-it", "H200")
    d = dep.to_dict()
    assert d["name"] == "geppetto-gemma" and d["compute"] == {"name": "H200", "size": 1, "is_available": None}
    assert d["is_spot"] is False
    [container] = d["containers"]
    assert container["image"] == deploy.DEFAULT_IMAGE and container["exposed_port"] == 8000
    assert container["healthcheck"] == {"enabled": True, "port": 8000, "path": "/health"}
    over = container["entrypoint_overrides"]
    assert over["enabled"] and over["entrypoint"] == ["vllm", "serve"]
    assert over["cmd"][0] == "google/gemma-4-31B-it"
    assert "--max-model-len" in over["cmd"] and '{"image": 8}' in over["cmd"]
    assert container["env"] is None
    assert d["scaling"]["min_replica_count"] == 1 and d["scaling"]["max_replica_count"] == 1


def test_scale_to_zero_and_spot_pass_through():
    dep = deploy.build_deployment("x", "m", "H100", min_replicas=0, max_replicas=2, spot=True)
    assert dep.scaling.min_replica_count == 0 and dep.scaling.max_replica_count == 2 and dep.is_spot


def test_pick_gpu_prefers_wanted_then_falls_back():
    resources = [
        ComputeResource(name="H200", size=1, is_available=False),
        ComputeResource(name="H100", size=1, is_available=True),
        ComputeResource(name="H100", size=2, is_available=True),
        ComputeResource(name="L40S", size=1, is_available=True),
    ]
    assert deploy.pick_gpu(resources, "H200") == "H100"
    assert deploy.pick_gpu(resources, "L40S") == "L40S"
    resources[1].is_available = False
    with pytest.raises(SystemExit):
        deploy.pick_gpu(resources, "H200")


def test_prices_cover_the_single_gpus_verda_offers():
    assert set(deploy.FALLBACK_GPUS) <= set(deploy.PRICE_USD_PER_H)
    assert deploy.PRICE_USD_PER_H["H200"] > deploy.PRICE_USD_PER_H["H100"]
