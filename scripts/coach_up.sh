#!/usr/bin/env bash
# Demo day, step A: start our tuned coach on Verda and point the backend at it.
#
#   scripts/coach_up.sh                 the whole path (about 6 to 8 minutes)
#   scripts/coach_up.sh --backend-only  the endpoint is already up: only check it and restart the backend
#                                       (use this after scripts/live.sh, which starts a backend without the tuned coach)
#   scripts/coach_up.sh --dry-run       print every step, call nothing
#
# Steps (the tested "Serve it again" path of docs/COACH_MODEL.md):
#   1. container up     coach_tune/trainer_up.py --gpu H100 --no-base   (refuses if 3 hours would break the 50 floor)
#   2. adapter up       coach_tune/ctl.py upload-adapter                (coach_tune/out/adapter, 95 MB)
#   3. merge            coach_tune/ctl.py exec merge.sh, then wait until the container reports it done
#   4. serve            coach_tune/ctl.py serve tuned, then ctl.py wait-vllm
#   5. proof            one real completion from geppetto-coach-e2b
#   6. backend          restart only the backend with COACH_MODEL=tuned (scripts/lib_backend.sh)
#   7. report           one live hint through the backend, then the health table
#
# Cost: 1x H100 at 5.77 USD an hour until scripts/coach_down.sh runs. It must be down by 14:15.
# Environment: COACH_GPU (default H100), VERDA_PY (default verda/.venv/bin/python).

set -uo pipefail
SCRIPT_TAG=coach-up
source "$(cd "$(dirname "$0")" && pwd)/lib_backend.sh"

BACKEND_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --backend-only) BACKEND_ONLY=1 ;;
        -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "coach_up.sh: unknown option $arg" >&2; exit 2 ;;
    esac
done
GPU="${COACH_GPU:-H100}"
ADAPTER="$REPO/coach_tune/out/adapter"
STARTED=0

fail() {
    printf '[coach-up %s] FAILED at: %s\n' "$(date +%H:%M:%S)" "$*" >&2
    if [ "$STARTED" = "1" ]; then
        printf '[coach-up] The container may be running and billed. Stop it now with: scripts/coach_down.sh\n' >&2
    fi
    exit 1
}

say "start. Now $(date '+%H:%M on %a %d %b')."
deadline_note

# --- checks before anything starts on Verda ---------------------------------
[ -x "$PY" ] || fail "no Python at $PY (run 'uv sync' in verda/, or set VERDA_PY)"
[ -f "$ADAPTER/adapter_model.safetensors" ] || fail "no adapter at $ADAPTER/adapter_model.safetensors (the saved hint coach)"
[ -f "$ADAPTER/adapter_config.json" ] || fail "no adapter_config.json in $ADAPTER"
[ -n "$(env_value VERDA_INFERENCE_KEY)" ] || fail "VERDA_INFERENCE_KEY is missing or empty in $REPO/.env"
[ -n "$(env_value VERDA_CLOUD_CLIENT_ID)" ] || fail "VERDA_CLOUD_CLIENT_ID is missing or empty in $REPO/.env"
[ -n "$(env_value VERDA_CLOUD)" ] || fail "VERDA_CLOUD is missing or empty in $REPO/.env"
say "checks passed: adapter found, Verda names set in .env"

cd "$REPO" || fail "cannot enter $REPO"

already_serving() {
    [ "$DRY_RUN" = "1" ] && return 1
    "$PY" scripts/demo_probe.py "$TRAINER_URL" "$TUNED_MODEL_NAME" --tries 1 >/dev/null 2>&1
}

# wait_merge: poll the container until merge.sh is done (it runs in the background there).
wait_merge() {
    local i phase
    for i in $(seq 1 90); do
        phase="$("$PY" coach_tune/ctl.py status 2>/dev/null | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("phase",""))' 2>/dev/null)"
        case "$phase" in
            done:merge.sh) say "merge done"; return 0 ;;
            failed:merge.sh) "$PY" coach_tune/ctl.py status | tail -n 25 >&2; return 1 ;;
        esac
        sleep 10
    done
    say "merge not done after 15 minutes (last phase: ${phase:-unknown})"
    return 1
}

if [ "$BACKEND_ONLY" = "1" ]; then
    say "backend only: the endpoint must answer already"
    run "$PY" scripts/demo_probe.py "$TRAINER_URL" "$TUNED_MODEL_NAME" --tries 3 --gap 5 || fail "the tuned coach does not answer at $TRAINER_URL; run scripts/coach_up.sh without --backend-only"
elif already_serving; then
    STARTED=1
    say "the tuned coach already answers at $TRAINER_URL: skipping steps 1 to 4"
else
    say "1 of 7: container up on 1x $GPU (about 1 minute)"
    run "$PY" coach_tune/trainer_up.py --gpu "$GPU" --no-base || fail "trainer_up.py (if it says the GPU is not free, try: COACH_GPU=H200 scripts/coach_up.sh; if it says 'refused', the balance floor stopped it)"
    STARTED=1
    say "2 of 7: adapter up (about 1 minute)"
    run "$PY" coach_tune/ctl.py upload-adapter || fail "ctl.py upload-adapter"
    say "3 of 7: merge the adapter into Gemma 4 E2B (about 1 minute)"
    run "$PY" coach_tune/ctl.py exec merge.sh || fail "ctl.py exec merge.sh"
    if [ "$DRY_RUN" = "1" ]; then
        printf '[dry-run] poll %s coach_tune/ctl.py status until phase is done:merge.sh (15 minute cap)\n' "$PY"
    else
        wait_merge || fail "the merge on the container (see the log lines above)"
    fi
    say "4 of 7: serve the tuned model (2 to 3 minutes)"
    run "$PY" coach_tune/ctl.py serve tuned || fail "ctl.py serve tuned"
    run "$PY" coach_tune/ctl.py wait-vllm || fail "ctl.py wait-vllm (vLLM did not come up in 20 minutes)"
    say "5 of 7: one real completion from $TUNED_MODEL_NAME"
    run "$PY" scripts/demo_probe.py "$TRAINER_URL" "$TUNED_MODEL_NAME" --tries 12 --gap 10 || fail "the model lists but does not answer a completion"
fi

say "6 of 7: backend to COACH_MODEL=tuned (only the backend restarts)"
state_set COACH_TUNED 1
backend_restart

say "7 of 7: one live hint through the backend, then the health table"
if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] POST localhost:%s/api/coach/hint up to 3 times; expect provider "tuned"\n' "$BACKEND_PORT"
else
    provider=""
    for try in 1 2 3; do
        # A new deviation each try, so the backend's hint cache cannot answer for the model.
        body="{\"instruction\":\"Hold the racket like a handshake.\",\"move_name\":\"Shakehand grip\",\"deviations\":{\"index\":-$((28 + try * 4))},\"timing_ms\":0}"
        answer="$(curl -s -m 15 -X POST "localhost:$BACKEND_PORT/api/coach/hint" -H 'content-type: application/json' -d "$body")"
        provider="$(printf '%s' "$answer" | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("provider",""))' 2>/dev/null)"
        say "hint try $try: provider=${provider:-none}  $(printf '%s' "$answer" | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("hint",""))' 2>/dev/null)"
        [ "$provider" = "tuned" ] && break
        sleep 2
    done
    if [ "$provider" = "tuned" ]; then
        say "OK: live hints come from our tuned coach on Verda"
    else
        say "WARNING: the backend did not answer from the tuned coach in 3 tries (the first call on a new connection can pass the 2 s cap). Try a rep in the app and check again with: scripts/coach_up.sh --backend-only"
    fi
fi
health_table

say "done. Now $(date +%H:%M). The H100 is billed at 5.77 USD an hour while it is up."
deadline_note
