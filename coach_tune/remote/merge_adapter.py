"""Runs IN the trainer container: merge an uploaded LoRA adapter (/w/adapter) into Gemma 4 E2B for vLLM, with no
training. Use it to serve the tuned coach again after teardown:
    ctl.py upload-adapter; ctl.py exec merge.sh; ctl.py serve tuned
"""

import sys
from pathlib import Path

import torch
from huggingface_hub import snapshot_download
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, "/w")
from train_lora import MODEL_ID, fill_shared_kv

ADAPTER, MERGED = Path("/w/adapter"), Path("/w/merged")
base = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=torch.bfloat16)
merged = PeftModel.from_pretrained(base, str(ADAPTER)).merge_and_unload()
merged.save_pretrained(MERGED, safe_serialization=True)
AutoTokenizer.from_pretrained(MODEL_ID).save_pretrained(MERGED)
src = Path(snapshot_download(MODEL_ID, allow_patterns=["*.json", "*.model", "*.jinja"]))
for f in src.iterdir():
    if f.suffix in (".json", ".model", ".jinja") and not (MERGED / f.name).exists():
        (MERGED / f.name).write_bytes(f.read_bytes())
fill_shared_kv(MERGED, MODEL_ID)
print("merged")
