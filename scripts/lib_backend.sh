#!/usr/bin/env bash
# Shared by scripts/coach_up.sh, scripts/coach_down.sh and scripts/lesson_gemma_up.sh (demo day, Sun 15 Nov).
# Source it; do not run it.
#
# It restarts ONLY the backend on port 8000 with the language-model settings the demo-day state asks for:
#   always            GLOVE_SOURCE=external GLOVE_AUTOSTART=off LLM_PROVIDER=gemini
#   COACH_TUNED=1     COACH_MODEL=tuned TUNED_BASE_URL=<trainer> TUNED_API_KEY=<VERDA_INFERENCE_KEY from .env>
#   LESSON_GEMMA_URL  OPENAI_BASE_URL=<url> OPENAI_API_KEY=<same key> OPENAI_MODEL=google/gemma-4-31B-it
#                     LLM_ROUTES=lesson=openai  (lesson writing asks Gemma on Verda first, then the fallback)
# The state is two plain lines in logs/demo_day.state. No secret is written there, echoed or logged.

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${GEPPETTO_REPO:-$(cd "$LIB_DIR/.." && pwd)}"
PY="${VERDA_PY:-$REPO/verda/.venv/bin/python}"
STATE_FILE="$REPO/logs/demo_day.state"
TRAINER_URL="https://containers.datacrunch.io/coach-tune-trainer"
TUNED_MODEL_NAME="geppetto-coach-e2b"
GEMMA_MODEL_NAME="google/gemma-4-31B-it"
BACKEND_PORT=8000
DEADLINE="14:15"
DRY_RUN="${DRY_RUN:-0}"

# The coach_tune scripts change task with this variable (the rep-feedback tuning). Demo day serves the hint coach.
unset COACH_TUNE_TASK

say() { printf '[%s %s] %s\n' "${SCRIPT_TAG:-demo}" "$(date +%H:%M:%S)" "$*"; }
die() { printf '[%s %s] FAILED: %s\n' "${SCRIPT_TAG:-demo}" "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

# run CMD...: run it, or only print it with --dry-run.
run() {
    if [ "$DRY_RUN" = "1" ]; then
        printf '[dry-run] %s\n' "$*"
        return 0
    fi
    "$@"
}

# env_value NAME: the value of NAME in the repo-root .env, for a variable only. Never echo the result.
env_value() {
    [ -f "$REPO/.env" ] || return 1
    grep -E "^$1=" "$REPO/.env" | head -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

state_get() {
    [ -f "$STATE_FILE" ] || return 0
    grep -E "^$1=" "$STATE_FILE" | tail -n 1 | cut -d= -f2-
}

# state_set NAME VALUE (an empty VALUE removes the line).
state_set() {
    if [ "$DRY_RUN" = "1" ] && [ -z "${DRY_STATE_REDIRECTED:-}" ]; then
        # A dry run writes its state to a throwaway copy, so later steps print the settings they would use.
        printf '[dry-run] state: %s=%s in %s\n' "$1" "$2" "$STATE_FILE"
        DRY_STATE_REDIRECTED="$(mktemp)"
        [ -f "$STATE_FILE" ] && cp "$STATE_FILE" "$DRY_STATE_REDIRECTED"
        STATE_FILE="$DRY_STATE_REDIRECTED"
    elif [ "$DRY_RUN" = "1" ]; then
        printf '[dry-run] state: %s=%s\n' "$1" "$2"
    fi
    mkdir -p "$(dirname "$STATE_FILE")"
    touch "$STATE_FILE"
    grep -v -E "^$1=" "$STATE_FILE" > "$STATE_FILE.tmp" || true
    [ -n "$2" ] && printf '%s=%s\n' "$1" "$2" >> "$STATE_FILE.tmp"
    mv "$STATE_FILE.tmp" "$STATE_FILE"
}

backend_pids() { lsof -iTCP:"$BACKEND_PORT" -sTCP:LISTEN -P -n 2>/dev/null | awk 'NR>1{print $2}' | sort -u; }

# backend_env_names: the settings the next backend start gets, names only (for the log and the dry run).
backend_env_names() {
    local names="GLOVE_SOURCE=external GLOVE_AUTOSTART=off LLM_PROVIDER=gemini"
    if [ "$(state_get COACH_TUNED)" = "1" ]; then
        names="$names COACH_MODEL=tuned TUNED_BASE_URL=$TRAINER_URL TUNED_MODEL=$TUNED_MODEL_NAME TUNED_API_KEY=<hidden>"
    fi
    local url
    url="$(state_get LESSON_GEMMA_URL)"
    if [ -n "$url" ]; then
        names="$names OPENAI_BASE_URL=$url OPENAI_MODEL=$GEMMA_MODEL_NAME OPENAI_API_KEY=<hidden> LLM_ROUTES=lesson=openai"
    fi
    printf '%s' "$names"
}

# fill_backend_env: sets the array BACKEND_ENV for the current state. Holds the key; never print it.
fill_backend_env() {
    BACKEND_ENV=(env GLOVE_SOURCE=external GLOVE_AUTOSTART=off LLM_PROVIDER=gemini)
    local key="" url
    if [ "$(state_get COACH_TUNED)" = "1" ] || [ -n "$(state_get LESSON_GEMMA_URL)" ]; then
        key="$(env_value VERDA_INFERENCE_KEY)"
        [ -n "$key" ] || die "VERDA_INFERENCE_KEY is missing or empty in $REPO/.env"
    fi
    if [ "$(state_get COACH_TUNED)" = "1" ]; then
        BACKEND_ENV+=(COACH_MODEL=tuned TUNED_BASE_URL="$TRAINER_URL" TUNED_MODEL="$TUNED_MODEL_NAME" TUNED_API_KEY="$key")
    fi
    url="$(state_get LESSON_GEMMA_URL)"
    if [ -n "$url" ]; then
        BACKEND_ENV+=(OPENAI_BASE_URL="$url" OPENAI_MODEL="$GEMMA_MODEL_NAME" OPENAI_API_KEY="$key" LLM_ROUTES=lesson=openai)
    fi
}

# backend_restart: stop whatever listens on 8000, start the backend with the state's settings, wait for /api/health.
# With a live stack (logs/live/current) the log and the pid go where scripts/live.sh and scripts/stop.sh expect them.
backend_restart() {
    local run_dir log pids_file pid i
    if [ -e "$REPO/logs/live/current" ]; then
        run_dir="$(cd "$REPO/logs/live/current" && pwd -P)"
        log="$run_dir/backend.log"
        pids_file="$run_dir/pids"
    else
        mkdir -p "$REPO/logs"
        log="$REPO/logs/demo_backend.log"
        pids_file=""
        say "no live stack found (no logs/live/current): the backend starts alone, log in $log"
    fi
    say "backend settings: $(backend_env_names)"
    if [ "$DRY_RUN" = "1" ]; then
        printf '[dry-run] stop the process on port %s, then in backend/: uv run uvicorn app.main:app --port %s (log %s)\n' "$BACKEND_PORT" "$BACKEND_PORT" "$log"
        return 0
    fi
    command -v uv >/dev/null || die "uv not found; the backend needs it"
    for pid in $(backend_pids); do kill "$pid" 2>/dev/null || true; done
    for i in $(seq 1 20); do
        [ -z "$(backend_pids)" ] && break
        sleep 0.5
    done
    for pid in $(backend_pids); do kill -9 "$pid" 2>/dev/null || true; done
    fill_backend_env
    ( cd "$REPO/backend" && exec nohup "${BACKEND_ENV[@]}" uv run uvicorn app.main:app --port "$BACKEND_PORT" ) >> "$log" 2>&1 </dev/null &
    pid=$!
    unset BACKEND_ENV
    [ -n "$pids_file" ] && echo "backend $pid" >> "$pids_file"
    for i in $(seq 1 90); do
        if curl -s -m 2 "localhost:$BACKEND_PORT/api/health" | grep -q '"status":"ok"'; then
            say "backend up: $(curl -s -m 2 "localhost:$BACKEND_PORT/api/health")"
            return 0
        fi
        kill -0 "$pid" 2>/dev/null || die "the backend stopped while starting; read $log"
        sleep 1
    done
    die "the backend did not answer /api/health in 90 s; read $log"
}

# health_table: the per-provider and per-role table, with the same settings the backend got.
health_table() {
    if [ "$DRY_RUN" = "1" ]; then
        printf '[dry-run] in backend/: uv run python scripts/llm_health.py (with the backend settings above)\n'
        return 0
    fi
    fill_backend_env
    ( cd "$REPO/backend" && "${BACKEND_ENV[@]}" uv run python scripts/llm_health.py ) || say "the health table reports that no model answered"
    unset BACKEND_ENV
}

# verda_up_list: the names of everything deployed on Verda now, one per line (empty when nothing is up).
verda_up_list() {
    ( cd "$REPO/verda" && "$PY" status.py --json ) | "$PY" -c 'import json,sys; [print(u["name"], u["gpu"], u["status"]) for u in json.load(sys.stdin)["up"]]'
}

deadline_note() {
    say "REMINDER: everything on Verda must be down by $DEADLINE. Stop with: scripts/coach_down.sh"
}
