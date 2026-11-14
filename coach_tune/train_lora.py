"""LoRA fine-tune of Gemma 4 E2B on the filtered coaching lines, then merge for vLLM. Runs on the Verda VM.

    python train_lora.py --data /data/work/sft --out /data/adapter --merged /data/merged

`--data` holds train.jsonl and val.jsonl from make_sft.py: {"messages": [system, user], "completion": line}.
A plain PyTorch loop (no trl): loss only on the completion tokens. Writes config.json with every setting and the seed,
and metrics.json with the loss curve.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, get_cosine_schedule_with_warmup

MODEL_ID = "google/gemma-4-E2B-it"
TARGETS = r"^(?!.*(vision|audio)).*\.(q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)$"


def load_rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def encode(tok, row: dict, max_len: int) -> tuple[list[int], list[int]]:
    prompt = tok.apply_chat_template(row["messages"], tokenize=False, add_generation_prompt=True)
    p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
    end = "<end_of_turn>" if "<end_of_turn>" in tok.get_vocab() else (tok.eos_token or "")
    c_ids = tok(row["completion"] + end, add_special_tokens=False)["input_ids"]
    ids = (p_ids + c_ids)[:max_len]
    labels = ([-100] * len(p_ids) + c_ids)[:max_len]
    return ids, labels


def batches(items: list, size: int, rng: random.Random | None):
    order = list(range(len(items)))
    if rng is not None:
        rng.shuffle(order)
    for i in range(0, len(order), size):
        yield [items[j] for j in order[i : i + size]]


def collate(batch, pad_id: int, device):
    n = max(len(ids) for ids, _ in batch)
    ids = torch.full((len(batch), n), pad_id, dtype=torch.long)
    lab = torch.full((len(batch), n), -100, dtype=torch.long)
    att = torch.zeros((len(batch), n), dtype=torch.long)
    for i, (x, y) in enumerate(batch):
        ids[i, : len(x)] = torch.tensor(x)
        lab[i, : len(y)] = torch.tensor(y)
        att[i, : len(x)] = 1
    return ids.to(device), att.to(device), lab.to(device)


@torch.no_grad()
def val_loss(model, data, bs, pad_id, device) -> float:
    model.eval()
    tot, n = 0.0, 0
    for b in batches(data, bs, None):
        ids, att, lab = collate(b, pad_id, device)
        tot += model(input_ids=ids, attention_mask=att, labels=lab).loss.item() * len(b)
        n += len(b)
    model.train()
    return tot / max(1, n)


@torch.no_grad()
def samples(model, tok, rows: list[dict], device) -> list[dict]:
    """Greedy lines for a few validation prompts: the sanity check that the text is sane after training."""
    model.eval()
    out = []
    for r in rows:
        prompt = tok.apply_chat_template(r["messages"], tokenize=False, add_generation_prompt=True)
        ids = tok(prompt, add_special_tokens=False, return_tensors="pt").to(device)
        gen = model.generate(**ids, max_new_tokens=40, do_sample=False)
        text = tok.decode(gen[0, ids["input_ids"].shape[1]:], skip_special_tokens=True).strip()
        out.append({"expected": r["completion"], "generated": text})
        print(json.dumps(out[-1], ensure_ascii=False), flush=True)
    model.train()
    return out


def fill_shared_kv(merged_dir: Path, model_id: str) -> int:
    """Gemma 4 E2B shares KV between layers. The transformers save drops the k_norm, k_proj and v_proj weights of the
    sharing layers, and vLLM refuses a checkpoint without them. They are unused at run time, so copy them from the
    base checkpoint under the same names (same as remote/fix_merged.py, which patched the 14 Nov run)."""
    from huggingface_hub import snapshot_download
    from safetensors import safe_open
    from safetensors.torch import save_file

    path = merged_dir / "model.safetensors"
    with safe_open(str(path), "pt") as m:
        tensors = {k: m.get_tensor(k) for k in m.keys()}
        meta = m.metadata()
    base = Path(snapshot_download(model_id, allow_patterns=["*.safetensors"]))
    added = 0
    for f in sorted(base.glob("*.safetensors")):
        with safe_open(str(f), "pt") as b:
            for k in b.keys():
                if k not in tensors:
                    tensors[k] = b.get_tensor(k)
                    added += 1
    if added:
        save_file(tensors, str(path) + ".tmp", metadata=meta or {"format": "pt"})
        Path(str(path) + ".tmp").replace(path)
    print(json.dumps({"filled_from_base": added}), flush=True)
    return added


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--merged", type=Path, required=True)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--epochs", type=float, default=3)
    ap.add_argument("--bs", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--r", type=int, default=16)
    ap.add_argument("--alpha", type=int, default=32)
    ap.add_argument("--dropout", type=float, default=0.05)
    ap.add_argument("--max-len", type=int, default=512)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--max-steps", type=int, default=0, help="stop after N steps (smoke test); 0 runs every epoch")
    ap.add_argument("--no-merge", action="store_true", help="skip the merge (smoke test)")
    a = ap.parse_args()

    random.seed(a.seed)
    torch.manual_seed(a.seed)
    device = torch.device("cuda")
    tok = AutoTokenizer.from_pretrained(a.model)
    pad_id = tok.pad_token_id if tok.pad_token_id is not None else 0
    model = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=torch.bfloat16).to(device)
    lora = LoraConfig(r=a.r, lora_alpha=a.alpha, lora_dropout=a.dropout, target_modules=TARGETS, task_type="CAUSAL_LM")
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    train = [encode(tok, r, a.max_len) for r in load_rows(a.data / "train.jsonl")]
    val = [encode(tok, r, a.max_len) for r in load_rows(a.data / "val.jsonl")]
    steps = math.ceil(len(train) / a.bs) * math.ceil(a.epochs)
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=a.lr, weight_decay=0.0)
    sched = get_cosine_schedule_with_warmup(opt, int(0.05 * steps), steps)
    rng = random.Random(a.seed)
    curve, step, t0 = [], 0, time.time()
    config = {**{k: (str(v) if isinstance(v, Path) else v) for k, v in vars(a).items()}, "targets": TARGETS,
              "n_train": len(train), "n_val": len(val), "steps": steps, "torch": torch.__version__}
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "config.json").write_text(json.dumps(config, indent=2))
    model.train()
    for epoch in range(math.ceil(a.epochs)):
        for b in batches(train, a.bs, rng):
            ids, att, lab = collate(b, pad_id, device)
            loss = model(input_ids=ids, attention_mask=att, labels=lab).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
            step += 1
            if not math.isfinite(loss.item()):
                raise SystemExit(f"loss is not finite at step {step}: {loss.item()}")
            if a.max_steps and step >= a.max_steps:
                break
            if step % 10 == 0:
                curve.append({"step": step, "loss": round(loss.item(), 4), "t_s": round(time.time() - t0)})
                print(json.dumps(curve[-1]), flush=True)
        if a.max_steps and step >= a.max_steps:
            curve.append({"step": step, "loss": round(loss.item(), 4), "t_s": round(time.time() - t0), "smoke": True})
            print(json.dumps(curve[-1]), flush=True)
            break
        v = val_loss(model, val, a.bs, pad_id, device)
        curve.append({"epoch": epoch + 1, "val_loss": round(v, 4), "t_s": round(time.time() - t0)})
        print(json.dumps(curve[-1]), flush=True)
    (a.out / "samples.json").write_text(json.dumps(samples(model, tok, load_rows(a.data / "val.jsonl")[:5], device), indent=2,
                                                   ensure_ascii=False))
    model.save_pretrained(a.out)
    tok.save_pretrained(a.out)
    (a.out / "metrics.json").write_text(json.dumps({"curve": curve, "train_s": round(time.time() - t0)}, indent=2))
    if a.no_merge:
        print("done (no merge)", json.dumps({"train_s": round(time.time() - t0), "steps": step}))
        return 0
    merged = model.merge_and_unload()
    merged.save_pretrained(a.merged, safe_serialization=True)
    tok.save_pretrained(a.merged)
    # vLLM needs the processor and generation files of the base model too.
    from huggingface_hub import snapshot_download

    base = Path(snapshot_download(a.model, allow_patterns=["*.json", "*.model", "*.jinja"]))
    for f in base.iterdir():
        if f.suffix in (".json", ".model", ".jinja") and not (a.merged / f.name).exists():
            (a.merged / f.name).write_bytes(f.read_bytes())
    fill_shared_kv(a.merged, a.model)
    print("done", json.dumps({"train_s": round(time.time() - t0), "steps": step}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
