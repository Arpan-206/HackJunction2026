#!/usr/bin/env bash
# Play a real glove capture through the whole Geppetto stack at real speed,
# looping, with no gloves: the core reads the capture as if it were the hand
# solver, so the viewer, the scorer, the robot twin and /demo behave as live.
#
#   1. Core      python -m core --replay CAPTURE --replay-loop --replay-continuous
#   2. Bridge    python -m tools.ingest_bridge   (core -> backend)
#   3. Backend   uvicorn, GLOVE_SOURCE=external
#   4. Frontend  npm run dev
#
# Every screen shows a REPLAY corner mark while this runs (the core's own
# /ws/gloves says source "replay"); nothing in the app can hide it.
#
# Usage:
#   scripts/replay_demo.sh CAPTURE [--start S] [--seconds D] [--speed X]
#                          [--wearer NAME | --no-calibration] [--no-web]
#
#   CAPTURE        a raw solver capture (.rgmp), or a run folder holding
#                  solver_12277.rgmp (logs/live/<time>/). Read in place, never
#                  copied. The driver capture (driver_12276.rgmp) holds raw
#                  sensors, not solved hands, and is refused.
#   --start S      start S seconds into the capture (capture seconds, as in the
#                  inventory in STATUS-replay-demo.md). Default 0.
#   --seconds D    play D seconds from --start, then loop. Without --start and
#                  --seconds the whole capture plays, streamed from disk.
#   --speed X      playback speed, default 1.0 (real time).
#   --wearer NAME  calibrate with this wearer's saved flat and fist (default
#                  "arpan", who wore the gloves in the Saturday captures).
#   --no-calibration  score on raw angles.
#   --no-web       core and nothing else (no bridge, backend or frontend).
#
# Environment (all optional):
#   GEPPETTO_REPO          repo root (default: the folder above this script).
#   GEPPETTO_PY            Python with the core's deps (default: $GEPPETTO_REPO/.venv/bin/python,
#                          then the main checkout's .venv for a worktree).
#   GEPPETTO_CAL_DIR       the backend data dir holding calibrations/ and
#                          glove_calibrations/ (default: $GEPPETTO_REPO/backend/data).
#   GEPPETTO_CORE_PORT     default 8765
#   GEPPETTO_BACKEND_PORT  default 8000
#   GEPPETTO_FRONTEND_PORT default 5173
#   LLM_PROVIDER           backend language model, default "fake".
#   GEPPETTO_RUN           run folder (default: logs/replay/<time>).
#
# Ctrl-C stops everything in reverse order through scripts/stop.sh. From
# another terminal: scripts/stop.sh logs/replay/current.

set -euo pipefail

usage() { sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; }

CAPTURE=""
START=""
SECONDS_ARG=""
SPEED="1.0"
WEARER="arpan"
CALIBRATE=1
WEB=1
while [ $# -gt 0 ]; do
    case "$1" in
        --start) START="${2:?--start needs a value}"; shift 2 ;;
        --seconds) SECONDS_ARG="${2:?--seconds needs a value}"; shift 2 ;;
        --speed) SPEED="${2:?--speed needs a value}"; shift 2 ;;
        --wearer) WEARER="${2:?--wearer needs a value}"; shift 2 ;;
        --no-calibration) CALIBRATE=0; shift ;;
        --no-web) WEB=0; shift ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "replay_demo.sh: unknown option $1" >&2; usage >&2; exit 2 ;;
        *)
            if [ -n "$CAPTURE" ]; then echo "replay_demo.sh: one capture only" >&2; exit 2; fi
            CAPTURE="$1"; shift ;;
    esac
done
if [ -z "$CAPTURE" ]; then
    echo "replay_demo.sh: give a capture, for example: scripts/replay_demo.sh logs/live/20261114-131952 --start 1500 --seconds 60" >&2
    exit 2
fi
num() { [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]; }
for v in "$START" "$SECONDS_ARG"; do
    if [ -n "$v" ] && ! num "$v"; then echo "replay_demo.sh: --start and --seconds take seconds, got '$v'" >&2; exit 2; fi
done
num "$SPEED" || { echo "replay_demo.sh: --speed takes a number, got '$SPEED'" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="${GEPPETTO_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
if [ -d "$CAPTURE" ]; then CAPTURE="$CAPTURE/solver_12277.rgmp"; fi
[ -f "$CAPTURE" ] || { echo "replay_demo.sh: no capture at $CAPTURE" >&2; exit 1; }
CAPTURE="$(cd "$(dirname "$CAPTURE")" && pwd)/$(basename "$CAPTURE")"
case "$(basename "$CAPTURE")" in
    driver_*) echo "replay_demo.sh: $CAPTURE is the driver's raw sensor stream; give the solver capture (solver_12277.rgmp)" >&2; exit 2 ;;
esac

# A worktree has no venv of its own: fall back to the main checkout's.
MAIN_REPO="$(cd "$REPO" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's#/\.git$##' || true)"
PY="${GEPPETTO_PY:-}"
if [ -z "$PY" ]; then
    for cand in "$REPO/.venv/bin/python" "${MAIN_REPO:-/nonexistent}/.venv/bin/python"; do
        if [ -x "$cand" ]; then PY="$cand"; break; fi
    done
fi
[ -n "$PY" ] && [ -x "$PY" ] || { echo "replay_demo.sh: no Python with the core's deps (set GEPPETTO_PY)" >&2; exit 1; }
CAL_DIR="${GEPPETTO_CAL_DIR:-$REPO/backend/data}"

CORE_PORT="${GEPPETTO_CORE_PORT:-8765}"
BACKEND_PORT="${GEPPETTO_BACKEND_PORT:-8000}"
FRONTEND_PORT="${GEPPETTO_FRONTEND_PORT:-5173}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ROOT="$REPO/logs/replay"
RUN="${GEPPETTO_RUN:-$ROOT/$STAMP}"
PIDS="$RUN/pids"

say() { printf '[replay %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
port_open() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1 || nc -z ::1 "$1" >/dev/null 2>&1; }

STOPPED=0
stop_all() {
    [ "$STOPPED" -eq 1 ] && return 0
    STOPPED=1
    say "stopping the replay stack"
    "$SCRIPT_DIR/stop.sh" "$RUN" >"$RUN/stop.log" 2>&1 || true
    grep -v "ports still in use\|find the owner\|all stack ports" "$RUN/stop.log" | sed 's/^/  /' || true
    local busy="" p
    for p in $CORE_PORT $BACKEND_PORT $FRONTEND_PORT; do
        if port_open "$p"; then busy="$busy $p"; fi
    done
    if [ -n "$busy" ]; then say "ports still in use:$busy"; else say "ports $CORE_PORT $BACKEND_PORT $FRONTEND_PORT are free"; fi
}
die() { say "FAILED: $*"; say "logs: $RUN"; stop_all; exit 1; }

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

start() {
    local name=$1 dir=$2
    shift 2
    ( cd "$dir" && exec "$@" ) >"$RUN/$name.log" 2>&1 </dev/null &
    local pid=$!
    echo "$name $pid" >>"$PIDS"
    LAST_PID=$pid
    say "started $name (pid $pid)"
}

# --- checks -----------------------------------------------------------------

if [ "$WEB" -eq 1 ]; then
    command -v uv >/dev/null || { echo "replay_demo.sh: uv not found" >&2; exit 1; }
    command -v npm >/dev/null || { echo "replay_demo.sh: npm not found" >&2; exit 1; }
    [ -e "$REPO/frontend/node_modules" ] || { echo "replay_demo.sh: run 'npm install' in $REPO/frontend first (or symlink the main checkout's node_modules)" >&2; exit 1; }
fi
busy=""
ports="$CORE_PORT"
[ "$WEB" -eq 1 ] && ports="$ports $BACKEND_PORT $FRONTEND_PORT"
for p in $ports; do
    if port_open "$p"; then busy="$busy $p"; fi
done
if [ -n "$busy" ]; then
    echo "replay_demo.sh: ports already in use:$busy" >&2
    echo "  stop the other stack (scripts/stop.sh), or pick ports with GEPPETTO_CORE_PORT, GEPPETTO_BACKEND_PORT, GEPPETTO_FRONTEND_PORT" >&2
    exit 1
fi

mkdir -p "$RUN"
[ -f "$ROOT/.gitignore" ] || printf '*\n' >"$ROOT/.gitignore"
: >"$PIDS"
if [ -z "${GEPPETTO_RUN:-}" ]; then ln -sfn "$RUN" "$ROOT/current"; fi
{
    echo "started $STAMP"
    echo "capture $CAPTURE"
    echo "start ${START:-0}"
    echo "seconds ${SECONDS_ARG:-all}"
    echo "speed $SPEED"
    echo "wearer $([ "$CALIBRATE" -eq 1 ] && echo "$WEARER" || echo none)"
    echo "core_port $CORE_PORT"
    echo "backend_port $BACKEND_PORT"
    echo "frontend_port $FRONTEND_PORT"
} >"$RUN/run.info"

set -m   # each background job gets its own process group, so stop.sh can end children too
trap 'echo; say "interrupted"; stop_all; exit 130' INT TERM
trap 'stop_all' EXIT

say "run folder: $RUN"
say "capture: $CAPTURE (read in place)"

# --- 1: core on the capture ------------------------------------------------

core_args=(-m core --replay "$CAPTURE" --replay-loop --replay-continuous --replay-speed "$SPEED" --port "$CORE_PORT")
if [ -n "$START" ] || [ -n "$SECONDS_ARG" ]; then
    [ -n "$START" ] && core_args+=(--replay-start "$START")
    [ -n "$SECONDS_ARG" ] && core_args+=(--replay-seconds "$SECONDS_ARG")
else
    core_args+=(--replay-stream)
fi
if [ "$CALIBRATE" -eq 1 ]; then
    core_args+=(--wearer "$WEARER" --calibration-dir "$CAL_DIR")
else
    core_args+=(--no-calibration)
fi
say "core cuts the window from the capture; a window late in the hour takes up to a minute to find"
start core "$REPO" "$PY" "${core_args[@]}"
wait_port "$CORE_PORT" 180 core "$LAST_PID" || die "core"
health=""
for _ in $(seq 1 30); do
    health="$(curl -fsS "http://127.0.0.1:$CORE_PORT/health" 2>/dev/null || true)"
    if [ -n "$health" ] && printf '%s' "$health" | grep -q '"tracked": *true\|"tracked":true'; then break; fi
    sleep 0.5
done
[ -n "$health" ] || die "core /health did not answer"
printf '%s\n' "$health" >"$RUN/core_health_start.json"
say "core health: $(printf '%s' "$health" | "$PY" -c 'import json,sys; h=json.load(sys.stdin); print({k: h.get(k) for k in ("rgmp","hands","calibration")})' 2>/dev/null || echo "$health")"

# --- 2 to 4: bridge, backend, frontend --------------------------------------

if [ "$WEB" -eq 1 ]; then
    start bridge "$REPO" "$PY" -m tools.ingest_bridge \
        --core "ws://localhost:$CORE_PORT/ws/gloves" \
        --backend "ws://localhost:$BACKEND_PORT/ws/ingest?activate=1"
    LLM="${LLM_PROVIDER:-fake}"
    backend_env=(env GLOVE_SOURCE=external GLOVE_AUTOSTART=off LLM_PROVIDER="$LLM")
    if [ "$LLM" = "gemini" ]; then
        [ -f "$REPO/.env" ] || die "LLM_PROVIDER=gemini needs GEMINI_API_KEY in $REPO/.env"
        key="$(grep -E '^GEMINI_API_KEY=' "$REPO/.env" | head -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
        [ -n "$key" ] || die "GEMINI_API_KEY is empty in $REPO/.env"
        backend_env+=(GEMINI_API_KEY="$key")
        unset key
    fi
    start backend "$REPO/backend" "${backend_env[@]}" uv run uvicorn app.main:app --port "$BACKEND_PORT"
    wait_port "$BACKEND_PORT" 90 backend "$LAST_PID" || die "backend"
    start frontend "$REPO/frontend" env \
        GEPPETTO_BACKEND_PORT="$BACKEND_PORT" \
        VITE_CORE_WS="ws://localhost:$CORE_PORT/ws" \
        VITE_ROBOT_WS="ws://localhost:$CORE_PORT/ws/robot" \
        npm run dev -- --port "$FRONTEND_PORT" --strictPort
    wait_port "$FRONTEND_PORT" 60 frontend "$LAST_PID" || die "frontend"
fi

say "all up, looping the capture at speed $SPEED. Debug view: http://localhost:$CORE_PORT/debug"
if [ "$WEB" -eq 1 ]; then
    say "app: http://localhost:$FRONTEND_PORT   demo table: http://localhost:$FRONTEND_PORT/demo   robot: http://localhost:$FRONTEND_PORT/robot"
fi
say "logs: $RUN   stop with Ctrl-C"

# --- stay in front until Ctrl-C, or until a part dies -----------------------

while true; do
    while read -r n p; do
        [ -n "${n:-}" ] && [ -n "${p:-}" ] || continue
        if ! kill -0 "$p" 2>/dev/null; then
            say "$n stopped on its own; last lines of its log:"
            tail -n 15 "$RUN/$n.log" | sed 's/\x1b\[[0-9;]*m//g' || true
            stop_all
            exit 1
        fi
    done <"$PIDS"
    sleep 1
done
