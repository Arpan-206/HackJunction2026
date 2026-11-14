#!/usr/bin/env bash
# Runs ON the Verda VM. Starts one vLLM OpenAI-compatible server in Docker on port 8001.
#   serve.sh teacher   Gemma 4 31B (labels and the teacher column of the evaluation)
#   serve.sh base      Gemma 4 E2B, untuned
#   serve.sh tuned     Gemma 4 E2B with our LoRA merged (/data/merged)
# Only one server runs at a time; the old one is stopped first. Weights cache in /data/hf.
set -euo pipefail
IMAGE=docker.io/vllm/vllm-openai:v0.29.0
which="${1:?teacher|base|tuned}"
docker rm -f coach-vllm >/dev/null 2>&1 || true
case "$which" in
  teacher) model=google/gemma-4-31B-it; name=google/gemma-4-31B-it; extra=(--max-model-len 4096 --gpu-memory-utilization 0.92 --max-num-seqs 128) ;;
  base)    model=google/gemma-4-E2B-it; name=google/gemma-4-E2B-it; extra=(--max-model-len 2048 --gpu-memory-utilization 0.85) ;;
  tuned)   model=/data/merged;          name=geppetto-coach-e2b;   extra=(--max-model-len 2048 --gpu-memory-utilization 0.85) ;;
  *) echo "unknown: $which" >&2; exit 2 ;;
esac
mkdir -p /data/hf
docker run -d --name coach-vllm --gpus all --ipc=host -p 8001:8000 \
  -v /data:/data -e HF_HOME=/data/hf \
  "$IMAGE" "$model" --served-model-name "$name" --port 8000 \
  --limit-mm-per-prompt '{"image":0,"audio":0}' "${extra[@]}"
echo "waiting for $name ..."
for i in $(seq 1 240); do
  if curl -sf localhost:8001/health >/dev/null; then echo "healthy after $((i * 5)) s"; exit 0; fi
  if ! docker ps -q -f name=coach-vllm | grep -q .; then docker logs --tail 50 coach-vllm; exit 1; fi
  sleep 5
done
echo "not healthy after 20 min" >&2; docker logs --tail 50 coach-vllm; exit 1
