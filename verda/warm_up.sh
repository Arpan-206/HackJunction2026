#!/usr/bin/env bash
# Bring the Gemma endpoint up before a demo and prove it answers. Run it about 15 minutes before you need it.
# Tear it down right after with: uv run python teardown.py
#
#   ./warm_up.sh              # H200, the default model
#   ./warm_up.sh --gpu H100   # any deploy.py flag passes through
set -euo pipefail
cd "$(dirname "$0")"
uv run python deploy.py "$@"
echo
echo "Endpoint is warm. The GPU is billed every minute it stays up; stop it when the demo ends:"
echo "    uv run python teardown.py"
