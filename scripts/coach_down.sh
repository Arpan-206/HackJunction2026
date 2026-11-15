#!/usr/bin/env bash
# Demo day: stop everything we run on Verda and put the backend back on the plain chain.
#
#   scripts/coach_down.sh            stop the tuned coach and the 31B lesson endpoint, check Verda is empty,
#                                    restart the backend without COACH_MODEL=tuned (LLM_PROVIDER=gemini stays)
#   scripts/coach_down.sh --dry-run  print every step, call nothing
#
# Safe to run twice: a deployment that is gone is reported, not an error. Peer review ends 14:00; run this by 14:15.
# Exit code 1 when something is still listed on Verda after the teardown.

set -uo pipefail
SCRIPT_TAG=coach-down
source "$(cd "$(dirname "$0")" && pwd)/lib_backend.sh"

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "coach_down.sh: unknown option $arg" >&2; exit 2 ;;
    esac
done

say "start. Now $(date '+%H:%M on %a %d %b')."
[ -x "$PY" ] || die "no Python at $PY (run 'uv sync' in verda/, or set VERDA_PY)"
cd "$REPO" || die "cannot enter $REPO"
PROBLEM=0

say "1 of 4: tuned coach container down (waits until Verda no longer lists it, 1 to 3 minutes)"
run "$PY" coach_tune/trainer_up.py --down || { say "trainer_up.py --down reported an error"; PROBLEM=1; }

say "2 of 4: 31B lesson endpoint down (nothing to delete if it was never started)"
if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] in verda/: %s teardown.py --name geppetto-gemma\n' "$PY"
else
    ( cd "$REPO/verda" && "$PY" teardown.py --name geppetto-gemma ) || { say "teardown.py reported an error"; PROBLEM=1; }
fi

say "3 of 4: check that nothing is left on Verda"
if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] in verda/: %s status.py --json; delete coach-tune-teacher with coach_tune/teacher_up.py --down if listed; fail if anything stays\n' "$PY"
else
    left="$(verda_up_list)" || { say "could not read the Verda status"; PROBLEM=1; left=""; }
    if printf '%s\n' "$left" | grep -q '^coach-tune-teacher '; then
        say "the teacher container is still up: deleting it"
        "$PY" coach_tune/teacher_up.py --down || PROBLEM=1
        left="$(verda_up_list)" || left=""
    fi
    if [ -n "$left" ]; then
        say "STILL UP ON VERDA (billed every minute):"
        printf '%s\n' "$left" | sed 's/^/    /'
        say "delete each one in the Verda console, or with: (cd verda && $PY teardown.py --name NAME)"
        PROBLEM=1
    else
        say "Verda is empty: no deployment is up"
    fi
    ( cd "$REPO/verda" && "$PY" status.py ) || true
fi

say "4 of 4: backend back to the plain chain"
state_set COACH_TUNED ""
state_set LESSON_GEMMA_URL ""
if [ "$DRY_RUN" = "1" ] || [ -n "$(backend_pids)" ]; then
    backend_restart
else
    say "no backend runs on port $BACKEND_PORT: nothing to restart"
fi

if [ "$PROBLEM" = "1" ]; then
    say "FINISHED WITH A PROBLEM: read the lines above. Something may still be billed on Verda."
    exit 1
fi
say "done. Now $(date +%H:%M). Nothing of ours runs on Verda."
