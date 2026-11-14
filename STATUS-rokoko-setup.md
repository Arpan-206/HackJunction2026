# STATUS-rokoko-setup.md

Lane "rokoko-setup", branch `rokoko-setup`, Sat 14 Nov 2026. Goal: the Rokoko Device SDK is ready on this Mac before the gloves arrive, and one script starts the whole live stack. Slot guide: `docs/GLOVE-SLOT.md`.

## Works, and how to run it

| Item | State | Evidence |
| --- | --- | --- |
| SDK install | Release 2026.10.20, driver 1.9.7.683, in `~/.local/share/rokoko-device-sdk` | Official user-level script from `sdk-downloads.rokoko.com`, read before it ran; checksum OK; no sudo |
| Shell profile | `~/.zshrc` block "Geppetto rokoko-setup" sets `ROKOKO_SDK_HOME` and `PATH` | `zsh -i` finds `rokoko-sdk`, `rkk-hand-solver`, `rokoko` |
| Activation | Done by Arpan (`rokoko signin && rokoko activate && rokoko doctor`); licence to 17 Nov 2026 | Driver starts after it; before it, the driver exited with "SDK not activated" |
| `--help` | Runs for `rokoko-sdk`, `rkk-hand-solver`, `rokoko` | Exit code 0 |
| Driver | `rokoko-sdk --auto-stream-usb` listens on 45451 and 12276 (also UDP 14041) | `lsof` |
| Solver | `rkk-hand-solver --no-driver --emit both --emit-openxr --listen 127.0.0.1:12277` listens on 12277 | `lsof`, solver log |
| Core on the real binaries | `/health`: `rgmp.connected` true, `frames` 0, `devices` {}; `rcsp.connected` true; hands null | No gloves plugged in |
| `rokoko device list` | Prints "No devices found." | Driver running, no gloves |
| `scripts/live.sh WEARER` | Real driver and solver, two raw captures, core, bridge, backend, frontend: all up in about 1 s | Run 13:08; bridge "forwarded 302 frames, 0 backend errors"; `/api/health` through the Vite proxy says `glove_source: external` |
| `scripts/stop.sh` | Stops all eight processes in reverse order; no orphans; all ports free; safe to run twice | `ps` by process group after the stop |
| `--fake-solver --no-web` | Fake solver, core with `--no-rcsp`, both hands tracked, capture 456 KB in 4 s | Run 13:08 |
| Refusals | Busy port: exit 1 with the port list; no wearer: exit 2 | Run 13:08 |
| Fail path | A failed step shows its log and runs stop.sh | First run: the frontend check timed out; stop.sh cleaned up all eight processes |
| Syntax | `bash -n` passes on both scripts | |

## Written but not tested

- Everything with gloves plugged in: device lines in the driver log, `rgmp.devices`, non-empty captures, the bridge with real hands.
- `LLM_PROVIDER=gemini` in live.sh: the key load from the repo-root `.env` is written but not run (no paid calls in tests).
- The core on the default port 8765. Another lane (`robot-view`) holds 8765 with `python -m core --fake`, so every test used `GEPPETTO_CORE_PORT=8775`. live.sh refuses to start while 8765 is in use. Stop that lane's core before the slot.
- shellcheck is not installed, so no lint beyond `bash -n`.

## Choices made

| Choice | Why |
| --- | --- |
| The installer's own `. env` line kept inside a marked block that also exports `ROKOKO_SDK_HOME` and `PATH` | Re-running the installer finds its line and changes nothing; the block is easy to remove |
| Each process in its own process group (`set -m`), stopped by group | `uv run` and `npm run dev` start children; a stop of only the parent pid can leave them running |
| Ctrl-C first, then SIGTERM after 5 s, then SIGKILL after 3 s | Ctrl-C is the documented driver stop; the capture files close on it |
| Port checks on 127.0.0.1 and ::1 | Vite listens on `localhost`, which is ::1 only on this Mac |
| Backend with `GLOVE_SOURCE=external GLOVE_AUTOSTART=off` | The bridge feeds the backend; only live.sh starts the driver, so there is one owner of the gloves |
| `logs/live/.gitignore` with `*`, written by live.sh | Captures stay out of git without an edit to the root `.gitignore` |
| `GEPPETTO_CORE_PORT` override | To test beside another lane's core; the backend and frontend ports are fixed by their own config |

## Side effects outside the repo

- Backups: `~/.zshrc.bak-rokoko-setup-20261114-130258`, and the same suffix for `~/.profile` and `~/.bashrc`.
- The SDK installer also appended one line to `~/.profile` and `~/.bashrc`: `. "$HOME/.local/share/rokoko-device-sdk/env"  # added by rokoko-device-sdk installer`. The installer does this for every rc file it finds. Remove the line to undo it.

## What a human must do next

1. Before the slot, stop the `robot-view` lane's fake core on 8765 (pid 4294 at 13:08, `python -m core --fake`). You can also start live.sh with `GEPPETTO_CORE_PORT=8775`. The frontend reads the backend, not the core, so the app still works on that port.
2. At the slot: plug in both gloves, close Studio, run `scripts/live.sh <wearer>` and follow `docs/GLOVE-SLOT.md` section 4 if a glove is missing.
3. Optional patch for the backend owner (Szymon), not applied: `backend/app/constants.py` uses Windows names `ROKOKO_SOLVER_EXE = "rkk-hand-solver.exe"` and `ROKOKO_DRIVER_EXE = "rokoko-sdk.exe"`. So on macOS `/gloves` shows `sdk_found: false` and its start button cannot find the SDK. Suggested change:

```python
import sys
_EXE = ".exe" if sys.platform == "win32" else ""
ROKOKO_SOLVER_EXE = f"rkk-hand-solver{_EXE}"
ROKOKO_DRIVER_EXE = f"rokoko-sdk{_EXE}"
```

and set `ROKOKO_SDK_DIR=$ROKOKO_SDK_HOME` for the backend. Not needed for live.sh, which starts the driver and solver itself.

4. Observed, not this lane's code: the core POSTs to `generativelanguage.googleapis.com/v1beta/decisions` at start (the decisions lane's adapter, `core/server.py` line 67). It answered 200. Check that this is meant to run during the slot.
