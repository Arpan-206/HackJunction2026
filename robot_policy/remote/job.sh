#!/bin/bash
# The real job: train on the generated variations, then evaluate on the held-out real takes.
# Huber loss: the squared error up to 3 degrees, linear above, so normal tracking still counts beside the large
# errors of a wrong start or a push.
set -e
cd /w/rp
date
python3 run.py train --envs 32768 --iters 1200 --variations 300 --lr 2e-3 --loss huber --log-every 50
date
python3 run.py eval --rollouts 20000
date
