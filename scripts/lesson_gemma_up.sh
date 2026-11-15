#!/usr/bin/env bash
# Demo day, step C: after the tuned coach is up, try to start Gemma 4 31B on Verda for the expert flow
# (a recording becomes a lesson). If Verda has no GPU for it, give up and leave lesson writing on the fallback.
#
#   scripts/lesson_gemma_up.sh            try it
#   scripts/lesson_gemma_up.sh --dry-run  print every step, call nothing
#
# Rules:
#   - No GPU granted within 10 minutes (GRANT_MINUTES): give up, delete the deployment if one was made, and change
#     nothing in the backend. Lesson writing stays on the fallback: Gemini, then the template.
#   - GPU granted: the 62 GB of weights load in about 7.6 minutes. Wait up to 20 minutes more (LOAD_MINUTES). Not
#     healthy by then: delete the deployment and change nothing in the backend.
#   - Up: restart only the backend with OPENAI_BASE_URL set to the endpoint and LLM_ROUTES=lesson=openai, so lesson
#     writing asks Gemma on Verda first and falls back to Gemini. The tuned coach settings stay as they are.
#
# Cost: 1x H200 at 7.37 USD an hour (or an H100 at 5.77) until scripts/coach_down.sh runs. Down by 14:15.

set -uo pipefail
SCRIPT_TAG=gemma-up
source "$(cd "$(dirname "$0")" && pwd)/lib_backend.sh"

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "lesson_gemma_up.sh: unknown option $arg" >&2; exit 2 ;;
    esac
done
GRANT_MINUTES="${GRANT_MINUTES:-10}"
LOAD_MINUTES="${LOAD_MINUTES:-20}"

say "start. Now $(date '+%H:%M on %a %d %b')."
deadline_note
[ -x "$PY" ] || die "no Python at $PY (run 'uv sync' in verda/, or set VERDA_PY)"
[ -n "$(env_value VERDA_INFERENCE_KEY)" ] || die "VERDA_INFERENCE_KEY is missing or empty in $REPO/.env"
if [ "$(state_get COACH_TUNED)" != "1" ]; then
    say "note: the tuned coach is not marked as up (scripts/coach_up.sh comes first); going on anyway"
fi

say "1 of 3: ask Verda for a GPU (give up after $GRANT_MINUTES minutes without one; then up to $LOAD_MINUTES minutes to load)"
OUT_FILE="$REPO/logs/demo_gemma_up.log"
if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] in verda/: %s demo_gemma.py --grant-minutes %s --load-minutes %s (log %s)\n' "$PY" "$GRANT_MINUTES" "$LOAD_MINUTES" "$OUT_FILE"
    rc=0
    url="https://containers.datacrunch.io/geppetto-gemma"
else
    mkdir -p "$REPO/logs"
    ( cd "$REPO/verda" && "$PY" demo_gemma.py --grant-minutes "$GRANT_MINUTES" --load-minutes "$LOAD_MINUTES" ) 2>&1 | tee "$OUT_FILE"
    rc=${PIPESTATUS[0]}
    url="$(grep -E '^BASE_URL=' "$OUT_FILE" | tail -n 1 | cut -d= -f2-)"
fi

case "$rc" in
    0) ;;
    3)
        say "GAVE UP: no GPU was free within $GRANT_MINUTES minutes. Nothing of the 31B runs on Verda."
        say "Lesson writing stays on the fallback (Gemini, then the template). The backend was not touched."
        exit 3 ;;
    4)
        say "GAVE UP: a GPU was granted but the model was not healthy within $LOAD_MINUTES minutes. The deployment was deleted."
        say "Lesson writing stays on the fallback (Gemini, then the template). The backend was not touched."
        exit 4 ;;
    *)
        say "FAILED with exit code $rc (read $OUT_FILE). A deployment may be up and billed: run scripts/coach_down.sh, it deletes it."
        say "Lesson writing stays on the fallback. The backend was not touched."
        exit 1 ;;
esac
[ -n "$url" ] || die "the endpoint came up but printed no BASE_URL (read $OUT_FILE); stop it with scripts/coach_down.sh"

say "2 of 3: backend: lesson writing asks Gemma 4 31B on Verda first (only the backend restarts)"
state_set LESSON_GEMMA_URL "$url"
backend_restart

say "3 of 3: the health table"
health_table

say "done. Now $(date +%H:%M). The 31B is billed every minute it is up."
deadline_note
