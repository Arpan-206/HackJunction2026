#!/usr/bin/env bash
# Runs ON the Verda VM. LoRA on Gemma 4 E2B inside the vLLM image (torch and transformers already there), then merge.
# Stops any vLLM server first so training has the whole GPU.
set -euo pipefail
docker rm -f coach-vllm >/dev/null 2>&1 || true
docker run --rm --gpus all --ipc=host -v /data:/data -e HF_HOME=/data/hf --entrypoint bash \
  docker.io/vllm/vllm-openai:v0.29.0 -c \
  "pip install -q 'peft>=0.17' 'accelerate>=1.0' && python /data/work/train_lora.py --data /data/work/sft --out /data/adapter --merged /data/merged $*" \
  2>&1 | tee /data/work/train.log
