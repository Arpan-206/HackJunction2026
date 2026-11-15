#!/bin/bash
# The MuJoCo check of the trained policy, on the container's CPU (the laptop stays free).
set -e
cd /w/rp
pip install -q mujoco
date
python3 mujoco_check.py eval --rollouts 200
date
