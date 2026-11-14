#!/usr/bin/env bash
# Stop the live stack that scripts/live.sh started.
#
# Usage:
#   scripts/stop.sh            stop the newest run (logs/live/current)
#   scripts/stop.sh RUN_DIR    stop the run in that folder
#
# Order: the reverse of the start order (frontend, backend, bridge, core,
# captures, solver, driver), so each consumer goes before its source and the
# capture files close cleanly. Each process gets SIGINT to its whole process
# group (the same as Ctrl-C), then SIGTERM after 5 s, then SIGKILL after 3 s
# more. At the end it reports any of the stack's ports still in use.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="${GEPPETTO_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RUN="${1:-$REPO/logs/live/current}"
PIDS="$RUN/pids"

say() { printf '[stop %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

alive() { kill -0 "$1" 2>/dev/null; }
group_alive() { kill -0 -- "-$1" 2>/dev/null; }

# signal_group SIG PID: the job's process group (pgid = pid under live.sh's
# job control), and the pid itself in case it is not a group leader.
signal_group() {
    kill "-$1" -- "-$2" 2>/dev/null
    kill "-$1" "$2" 2>/dev/null
    return 0
}

stop_one() {
    local name=$1 pid=$2 i
    if ! alive "$pid" && ! group_alive "$pid"; then
        say "$name (pid $pid) already stopped"
        return 0
    fi
    signal_group INT "$pid"
    for i in $(seq 1 25); do
        if ! alive "$pid" && ! group_alive "$pid"; then say "$name stopped"; return 0; fi
        sleep 0.2
    done
    say "$name did not stop on SIGINT; sending SIGTERM"
    signal_group TERM "$pid"
    for i in $(seq 1 15); do
        if ! alive "$pid" && ! group_alive "$pid"; then say "$name stopped"; return 0; fi
        sleep 0.2
    done
    say "$name still running; sending SIGKILL"
    signal_group KILL "$pid"
    sleep 0.3
    if alive "$pid" || group_alive "$pid"; then say "$name (pid $pid) would not die"; return 1; fi
    say "$name killed"
}

if [ ! -f "$PIDS" ]; then
    say "no pid file at $PIDS; nothing started by live.sh to stop"
else
    # Read "name pid" lines, then stop them last first.
    names=()
    pids=()
    while read -r n p; do
        [ -n "${n:-}" ] && [ -n "${p:-}" ] || continue
        names+=("$n")
        pids+=("$p")
    done <"$PIDS"
    status=0
    for ((k = ${#pids[@]} - 1; k >= 0; k--)); do
        stop_one "${names[$k]}" "${pids[$k]}" || status=1
    done
    if [ "$status" -eq 0 ]; then
        : >"$PIDS"
        echo "stopped $(date +%Y%m%d-%H%M%S)" >>"$RUN/run.info" 2>/dev/null || true
    fi
fi

core_port="$(awk '$1 == "core_port" {print $2}' "$RUN/run.info" 2>/dev/null)"
busy=""
for p in 45451 12276 12277 "${core_port:-8765}" 8000 5173; do
    if nc -z 127.0.0.1 "$p" >/dev/null 2>&1 || nc -z ::1 "$p" >/dev/null 2>&1; then busy="$busy $p"; fi
done
if [ -n "$busy" ]; then
    say "ports still in use:$busy (not started by this run, or still closing)"
    say "find the owner with: lsof -nP -iTCP:<port> -sTCP:LISTEN"
    exit 1
fi
say "all stack ports are free"
