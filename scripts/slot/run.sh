#!/usr/bin/env bash
# Geppetto glove slot kit: one command for the next glove slot.
#
#   scripts/slot/run.sh                  real slot: gloves, phone, live stack
#   scripts/slot/run.sh --dry-run        no gloves, no phone: fakes only
#   scripts/slot/run.sh --only 2,3       just these steps (the stack check always runs)
#   scripts/slot/run.sh --help           every option
#
# Steps, in order: 0 stack check, 1 depth clip, 2 right thumb recalibration,
# 3 left glove recalibration, 4 button, LED, mirror and duel, 5 yaw,
# 6 piano press, 7 robot twin flex direction, 8 demo lessons, 9 fingerspelling
# letters into a pack (--pack fi, --pack-letters S,U,Ä, --recorded-by NAME).
# Each step prints what to do, waits for Enter, runs its check, shows the
# result and asks pass, fail, skip or retry. Every result, with its commands
# and their output, goes to logs/slot/<time>/results.jsonl and summary.md.
#
# Python: the active venv if there is one, else <repo>/.venv, else the main
# checkout's .venv (for worktrees). Override with GEPPETTO_PY.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -n "${GEPPETTO_PY:-}" ]; then
    PY="$GEPPETTO_PY"
elif [ -n "${VIRTUAL_ENV:-}" ] && [ -x "$VIRTUAL_ENV/bin/python" ]; then
    PY="$VIRTUAL_ENV/bin/python"
elif [ -x "$REPO/.venv/bin/python" ]; then
    PY="$REPO/.venv/bin/python"
else
    main="$(git -C "$REPO" worktree list --porcelain 2>/dev/null | awk 'NR==1 && $1=="worktree" {print $2}')"
    if [ -n "$main" ] && [ -x "$main/.venv/bin/python" ]; then
        PY="$main/.venv/bin/python"
    else
        echo "run.sh: no Python venv found; activate it (source .venv/bin/activate) or set GEPPETTO_PY" >&2
        exit 1
    fi
fi

cd "$REPO"
export PYTHONPATH="$REPO${PYTHONPATH:+:$PYTHONPATH}"
exec "$PY" "$SCRIPT_DIR/slot_main.py" "$@"
