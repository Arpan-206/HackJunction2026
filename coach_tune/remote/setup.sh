#!/usr/bin/env bash
# Runs ON the Verda VM once after boot: data dir, image pull, both model downloads in the background (no HF token:
# Gemma 4 E2B and 31B are ungated, checked through the Hugging Face API on 14 Nov 2026).
set -euo pipefail
mkdir -p /data/hf /data/work
cd /data/work
docker pull -q docker.io/vllm/vllm-openai:v0.29.0
# Downloads run inside the vLLM image, which already has huggingface_hub.
docker run --rm -v /data:/data -e HF_HOME=/data/hf --entrypoint hf docker.io/vllm/vllm-openai:v0.29.0 \
  download google/gemma-4-E2B-it >/data/work/dl_e2b.log 2>&1 &
docker run --rm -v /data:/data -e HF_HOME=/data/hf --entrypoint hf docker.io/vllm/vllm-openai:v0.29.0 \
  download google/gemma-4-31B-it >/data/work/dl_31b.log 2>&1 &
wait
nvidia-smi --query-gpu=name,memory.total --format=csv
du -sh /data/hf
echo setup done
