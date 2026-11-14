"""Runs IN the trainer container after the merge. Gemma 4 E2B shares KV between layers; the transformers save drops
the k_norm weights of the sharing layers, and vLLM refuses a checkpoint without them. The LoRA never touches them,
so copy every tensor the base checkpoint has and the merged one lacks, under the same name."""

import glob
import json
import os

from huggingface_hub import snapshot_download
from safetensors import safe_open
from safetensors.torch import save_file

MERGED = "/w/merged/model.safetensors"
base_dir = snapshot_download("google/gemma-4-E2B-it", allow_patterns=["*.safetensors", "*.json"])
with safe_open(MERGED, "pt") as m:
    merged = {k: m.get_tensor(k) for k in m.keys()}
    meta = m.metadata()
added = []
for f in sorted(glob.glob(os.path.join(base_dir, "*.safetensors"))):
    with safe_open(f, "pt") as b:
        for k in b.keys():
            if k not in merged:
                merged[k] = b.get_tensor(k)
                added.append(k)
print(json.dumps({"added": len(added), "sample": added[:5], "total": len(merged)}))
save_file(merged, MERGED + ".tmp", metadata=meta or {"format": "pt"})
os.replace(MERGED + ".tmp", MERGED)
print("fixed")
