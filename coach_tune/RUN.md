# coach_tune: how to run the Verda steps

All commands from the worktree root. `PY=/Users/arpanpandey/Code/Junction/repo/verda/.venv/bin/python` (it has the
`verda` SDK and httpx). `KEY=~/.ssh/geppetto_coach_tune` (made by `vm_up.py`). `IP` is in `coach_tune/out/instance.json`.

| Step | Command | Expected time |
| --- | --- | --- |
| 0. Dataset (local) | `/Users/arpanpandey/Code/Junction/repo/.venv/bin/python coach_tune/build_dataset.py` | 20 s |
| 1. Start the VM (checks the 50 floor) | `$PY coach_tune/vm_up.py --hours 3` | 2 to 5 min |
| 2. Copy the scripts | `scp -i $KEY coach_tune/remote/*.sh coach_tune/train_lora.py root@$IP:/data/work/` (after `ssh -i $KEY root@$IP mkdir -p /data/work`) | seconds |
| 3. Pull the image and both models | `ssh -i $KEY root@$IP bash /data/work/setup.sh` | 10 to 15 min |
| 4. Teacher up, tunnel open | `ssh -i $KEY root@$IP bash /data/work/serve.sh teacher`, then `ssh -i $KEY -N -L 8001:localhost:8001 root@$IP &` | 5 min |
| 5. Labels | `$PY coach_tune/label.py` | 10 to 20 min |
| 6. Teacher evaluation | `$PY coach_tune/evaluate.py --system teacher` | 5 min |
| 7. Untuned evaluation | `ssh ... serve.sh base`, then `$PY coach_tune/evaluate.py --system untuned` | 5 min |
| 8. Training data up | `$PY coach_tune/make_sft.py`, then `scp -i $KEY -r coach_tune/out/sft root@$IP:/data/work/` | seconds |
| 9. LoRA and merge | `ssh -i $KEY root@$IP bash /data/work/train.sh` | 10 to 20 min |
| 10. Tuned evaluation and serving | `ssh ... serve.sh tuned`, then `$PY coach_tune/evaluate.py --system tuned`, then `--report` | 5 min |
| 11. Adapter home | `scp -i $KEY -r root@$IP:/data/adapter coach_tune/out/adapter` | 1 min |
| 12. Tear down | `$PY coach_tune/vm_down.py` | 1 min |

Backend with the tuned coach while the VM serves it (tunnel open):
`COACH_MODEL=tuned TUNED_BASE_URL=http://localhost:8001 uv run uvicorn app.main:app --port 8000` in `backend/`.
