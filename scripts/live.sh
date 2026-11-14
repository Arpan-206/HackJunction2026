#!/usr/bin/env bash
# Start the whole Geppetto live stack for a glove slot, in order:
#   1. Rokoko driver  rokoko-sdk --auto-stream-usb     (RCSP 45451, RGMP 12276)
#   2. Hand solver    rkk-hand-solver --no-driver ...  (RGMP 12277)
#   3. Raw capture    tools.rgmp_tee on 12277 and 12276 (timestamped folder)
#   4. Core           python -m core --wearer NAME     (:8765, /health)
#   5. Ingest bridge  python -m tools.ingest_bridge    (core -> backend)
#   6. Backend        uvicorn on :8000, GLOVE_SOURCE=external
#   7. Frontend       npm run dev on :5173
#
# Usage:
#   scripts/live.sh WEARER [--fake-solver] [--no-capture] [--no-web]
#
#   WEARER         name for the core's per-wearer calibration (--wearer).
#   --fake-solver  no gloves: tools.fake_rgmp_server on 12277 replaces the
#                  driver and the solver; the core runs with --no-rcsp.
#   --no-capture   skip the raw RGMP capture.
#   --no-web       stop after the bridge (no backend, no frontend).
#
# Environment (all optional):
#   LLM_PROVIDER    backend language model, default "fake". For "gemini" the
#                   key is loaded from the repo-root .env, never printed.
#   GEPPETTO_REPO   repo root (default: the folder above this script).
#   GEPPETTO_PY     Python with the core's deps (default: $GEPPETTO_REPO/.venv/bin/python).
#   CORE_EXTRA_ARGS extra words for the core command, for example
#                   "--root --depth-host 127.0.0.1:7700" for the phone's depth over the cable (iproxy 7700:7700 first).
#   GEPPETTO_RUN    run folder for logs and captures (default: logs/live/<time>).
#   ROKOKO_SDK_HOME SDK folder (default: ~/.local/share/rokoko-device-sdk).
#   GEPPETTO_CORE_PORT core port (default 8765). Change it only when another
#                   core already holds 8765; the backend and frontend ports
#                   are fixed by their own config.
#
# Stop everything with scripts/stop.sh. Each process runs in its own process
# group; the pids are in <run folder>/pids, and logs/live/current points at
# the newest run folder.

set -euo pipefail

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

WEARER=""
FAKE=0
CAPTURE=1
WEB=1
for arg in "$@"; do
    case "$arg" in
        --fake-solver) FAKE=1 ;;
        --no-capture) CAPTURE=0 ;;
        --no-web) WEB=0 ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "live.sh: unknown option $arg" >&2; usage >&2; exit 2 ;;
        *)
            if [ -n "$WEARER" ]; then echo "live.sh: one wearer only" >&2; exit 2; fi
            WEARER="$arg" ;;
    esac
done
if [ -z "$WEARER" ]; then
    echo "live.sh: give the wearer name, for example: scripts/live.sh arpan" >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="${GEPPETTO_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PY="${GEPPETTO_PY:-$REPO/.venv/bin/python}"
ROKOKO_SDK_HOME="${ROKOKO_SDK_HOME:-$HOME/.local/share/rokoko-device-sdk}"
CORE_EXTRA_ARGS="${CORE_EXTRA_ARGS:-}"
SDK_BIN="$ROKOKO_SDK_HOME/bin"
STAMP="$(date +%Y%m%d-%H%M%S)"
LIVE_ROOT="$REPO/logs/live"
RUN="${GEPPETTO_RUN:-$LIVE_ROOT/$STAMP}"
PIDS="$RUN/pids"

HOST=127.0.0.1
RCSP_PORT=45451
DRIVER_PORT=12276
SOLVER_PORT=12277
CORE_PORT="${GEPPETTO_CORE_PORT:-8765}"
BACKEND_PORT=8000
FRONTEND_PORT=5173

say() { printf '[live %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { say "FAILED: $*"; say "logs: $RUN"; say "stopping what started"; "$SCRIPT_DIR/stop.sh" "$RUN" || true; exit 1; }

port_open() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1 || nc -z ::1 "$1" >/dev/null 2>&1; }

# wait_port PORT SECONDS NAME PID
wait_port() {
    local port=$1 secs=$2 name=$3 pid=$4 i=0
    while [ "$i" -lt $((secs * 5)) ]; do
        if port_open "$port"; then say "$name listens on $port"; return 0; fi
        if ! kill -0 "$pid" 2>/dev/null; then
            say "$name exited early; last lines of its log:"
            tail -n 15 "$RUN/$name.log" | sed 's/\x1b\[[0-9;]*m//g' || true
            return 1
        fi
        sleep 0.2
        i=$((i + 1))
    done
    say "$name did not open $port within $secs s"
    return 1
}

# start NAME DIR CMD... : run in the background, in its own process group
# (job control is on below), log to $RUN/NAME.log, record "NAME PID" in $PIDS.
start() {
    local name=$1 dir=$2
    shift 2
    ( cd "$dir" && exec "$@" ) >"$RUN/$name.log" 2>&1 </dev/null &
    local pid=$!
    echo "$name $pid" >>"$PIDS"
    LAST_PID=$pid
    # never log a secret: env words like GEMINI_API_KEY=... are redacted before they reach the run log
    say "started $name (pid $pid): $(printf '%s ' "$@" | sed -E 's/([A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*=)[^ ]*/\1<hidden>/g')"
}

# --- checks before anything starts ------------------------------------------

[ -x "$PY" ] || { echo "live.sh: no Python at $PY (run: uv venv --python 3.12 && uv pip install -r requirements.txt, or set GEPPETTO_PY)" >&2; exit 1; }
if [ "$FAKE" -eq 0 ]; then
    for b in rokoko-sdk rkk-hand-solver; do
        [ -x "$SDK_BIN/$b" ] || { echo "live.sh: $SDK_BIN/$b not found; install the Rokoko Device SDK (docs/GLOVE-SLOT.md)" >&2; exit 1; }
    done
fi
if [ "$WEB" -eq 1 ]; then
    command -v uv >/dev/null || { echo "live.sh: uv not found" >&2; exit 1; }
    command -v npm >/dev/null || { echo "live.sh: npm not found" >&2; exit 1; }
    [ -d "$REPO/frontend/node_modules" ] || { echo "live.sh: run 'npm install' in $REPO/frontend first" >&2; exit 1; }
fi

busy=""
for p in $RCSP_PORT $DRIVER_PORT $SOLVER_PORT $CORE_PORT $BACKEND_PORT $FRONTEND_PORT; do
    if port_open "$p"; then busy="$busy $p"; fi
done
if [ -n "$busy" ]; then
    echo "live.sh: ports already in use:$busy" >&2
    echo "  run scripts/stop.sh, or find the owner with: lsof -nP -iTCP:<port> -sTCP:LISTEN" >&2
    exit 1
fi

mkdir -p "$RUN"
# Keep raw captures and logs out of git without touching the root .gitignore.
mkdir -p "$LIVE_ROOT"
[ -f "$LIVE_ROOT/.gitignore" ] || printf '*\n' >"$LIVE_ROOT/.gitignore"
: >"$PIDS"
if [ -z "${GEPPETTO_RUN:-}" ]; then ln -sfn "$RUN" "$LIVE_ROOT/current"; fi
{
    echo "started $STAMP"
    echo "wearer $WEARER"
    echo "fake_solver $FAKE"
    echo "repo $REPO"
    echo "core_port $CORE_PORT"
} >"$RUN/run.info"

set -m   # each background job gets its own process group, so stop.sh can end children too
trap 'say "interrupted"; "$SCRIPT_DIR/stop.sh" "$RUN" || true; exit 130' INT TERM

say "run folder: $RUN"

# --- 1 and 2: driver and solver --------------------------------------------

if [ "$FAKE" -eq 1 ]; then
    start fake-solver "$REPO" "$PY" -m tools.fake_rgmp_server --host "$HOST" --port "$SOLVER_PORT"
    wait_port "$SOLVER_PORT" 15 fake-solver "$LAST_PID" || die "fake solver"
else
    start driver "$REPO" "$SDK_BIN/rokoko-sdk" --auto-stream-usb
    DRIVER_PID=$LAST_PID
    wait_port "$RCSP_PORT" 20 driver "$DRIVER_PID" || die "driver (if the log says 'not activated', run: rokoko signin && rokoko activate)"
    wait_port "$DRIVER_PORT" 20 driver "$DRIVER_PID" || die "driver RGMP port"
    start solver "$REPO" "$SDK_BIN/rkk-hand-solver" --no-driver --emit both --emit-openxr --listen "$HOST:$SOLVER_PORT"
    wait_port "$SOLVER_PORT" 20 solver "$LAST_PID" || die "solver"
fi

# --- 3: raw capture ---------------------------------------------------------

if [ "$CAPTURE" -eq 1 ]; then
    start capture-solver "$REPO" "$PY" -m tools.rgmp_tee --from "$HOST:$SOLVER_PORT" --out "$RUN/solver_$SOLVER_PORT.rgmp"
    if [ "$FAKE" -eq 0 ]; then
        start capture-driver "$REPO" "$PY" -m tools.rgmp_tee --from "$HOST:$DRIVER_PORT" --out "$RUN/driver_$DRIVER_PORT.rgmp"
    fi
fi

# --- 4: core ----------------------------------------------------------------

if [ "$FAKE" -eq 1 ]; then
    # shellcheck disable=SC2086
    start core "$REPO" "$PY" -m core --solver "$HOST:$SOLVER_PORT" --no-rcsp --wearer "$WEARER" --port "$CORE_PORT" $CORE_EXTRA_ARGS
else
    # shellcheck disable=SC2086
    start core "$REPO" "$PY" -m core --solver "$HOST:$SOLVER_PORT" --rcsp "$HOST:$RCSP_PORT" --wearer "$WEARER" --port "$CORE_PORT" $CORE_EXTRA_ARGS
fi
wait_port "$CORE_PORT" 40 core "$LAST_PID" || die "core"
health=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
    health="$(curl -fsS "http://$HOST:$CORE_PORT/health" 2>/dev/null || true)"
    [ -n "$health" ] && break
    sleep 0.5
done
[ -n "$health" ] || die "core /health did not answer"
printf '%s\n' "$health" >"$RUN/core_health_start.json"
say "core health: $(printf '%s' "$health" | "$PY" -c 'import json,sys; h=json.load(sys.stdin); print({k: h.get(k) for k in ("rgmp","rcsp","hands")})' 2>/dev/null || echo "$health")"

# --- 5: bridge (it retries every 2 s until the backend is up) ---------------

start bridge "$REPO" "$PY" -m tools.ingest_bridge \
    --core "ws://localhost:$CORE_PORT/ws/gloves" \
    --backend "ws://localhost:$BACKEND_PORT/ws/ingest?activate=1"

# --- 6 and 7: backend and frontend ------------------------------------------

if [ "$WEB" -eq 1 ]; then
    LLM="${LLM_PROVIDER:-fake}"
    backend_env=(env GLOVE_SOURCE=external GLOVE_AUTOSTART=off LLM_PROVIDER="$LLM")
    if [ "$LLM" = "gemini" ]; then
        [ -f "$REPO/.env" ] || die "LLM_PROVIDER=gemini needs GEMINI_API_KEY in $REPO/.env"
        # Load the key into the backend's environment only; never echo it.
        key="$(grep -E '^GEMINI_API_KEY=' "$REPO/.env" | head -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
        [ -n "$key" ] || die "GEMINI_API_KEY is empty in $REPO/.env"
        backend_env+=(GEMINI_API_KEY="$key")
        unset key
    fi
    start backend "$REPO/backend" "${backend_env[@]}" uv run uvicorn app.main:app --port "$BACKEND_PORT"
    wait_port "$BACKEND_PORT" 90 backend "$LAST_PID" || die "backend"
    start frontend "$REPO/frontend" npm run dev
    wait_port "$FRONTEND_PORT" 60 frontend "$LAST_PID" || die "frontend"
fi

say "all up. Health: curl localhost:$CORE_PORT/health   Debug view: http://localhost:$CORE_PORT/debug"
[ "$WEB" -eq 1 ] && say "app: http://localhost:$FRONTEND_PORT   gloves screen: http://localhost:$FRONTEND_PORT/gloves"
say "logs and captures: $RUN"
say "stop with: scripts/stop.sh"
