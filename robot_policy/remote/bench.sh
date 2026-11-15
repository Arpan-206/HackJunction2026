#!/bin/bash
# A short test on the GPU before the real job: a tiny training and a tiny evaluation, to catch errors early.
set -e
cd /w/rp && nvidia-smi --query-gpu=name,memory.total --format=csv,noheader && python3 -c "import torch,numpy;print(torch.__version__, numpy.__version__, torch.cuda.is_available())" && python3 run.py train --envs 4096 --iters 8 --variations 10 --log-every 4 && python3 run.py eval --rollouts 64 --tag bench
