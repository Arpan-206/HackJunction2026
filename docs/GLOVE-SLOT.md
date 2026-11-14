# Glove slot: start, check, stop

Use this page when the Rokoko Smartgloves II arrive. Everything runs on this Mac over USB.

Terms:

- **Driver**: `rokoko-sdk`, the Rokoko program that finds the gloves. It serves commands (RCSP) and raw data (RGMP).
- **Solver**: `rkk-hand-solver`. It turns the raw data into 26 hand joints.
- **RGMP**: Rokoko's binary motion stream over TCP. **RCSP**: Rokoko's command protocol over TCP.
- **Core**: our glove engine, `python -m core`.

## 1. Once per machine

The SDK is installed in `~/.local/share/rokoko-device-sdk` (release 2026.10.20, driver 1.9.7.683). `~/.zshrc` sets `ROKOKO_SDK_HOME` and puts its `bin` folder on `PATH`. The workstation is activated. The licence is valid until 17 Nov 2026.

If a new terminal does not find `rokoko-sdk`, run `source ~/.zshrc`. If the driver says "SDK not activated", run this in your own terminal:

```bash
rokoko signin && rokoko activate && rokoko doctor
```

## 2. Start and stop

Plug in both gloves by USB. Close Rokoko Studio. Then, from the repo root:

```bash
scripts/live.sh WEARER          # WEARER is the name from the calibration screen
scripts/stop.sh                 # stops everything live.sh started
```

| Process | Command live.sh runs | Port |
| --- | --- | --- |
| 1. Driver | `rokoko-sdk --auto-stream-usb` | RCSP 45451, RGMP 12276 |
| 2. Solver | `rkk-hand-solver --no-driver --emit both --emit-openxr --listen 127.0.0.1:12277` | 12277 |
| 3. Raw capture | `python -m tools.rgmp_tee --from 127.0.0.1:PORT --out RUN/...` (one per port) | reads 12277 and 12276 |
| 4. Core | `python -m core --solver 127.0.0.1:12277 --rcsp 127.0.0.1:45451 --wearer WEARER --port 8765` | 8765 |
| 5. Bridge | `python -m tools.ingest_bridge` | core to backend |
| 6. Backend | `GLOVE_SOURCE=external GLOVE_AUTOSTART=off LLM_PROVIDER=fake uv run uvicorn app.main:app --port 8000` | 8000 |
| 7. Frontend | `npm run dev` | 5173 |

Options:

| Option | Effect |
| --- | --- |
| `--fake-solver` | No gloves. A fake solver serves port 12277. The core runs with `--no-rcsp`. |
| `--no-capture` | Do not write raw captures. |
| `--no-web` | Do not start the backend or the frontend. |
| `LLM_PROVIDER=gemini` | The backend uses Gemini. The key comes from the repo-root `.env`. The script never prints it. |
| `GEPPETTO_CORE_PORT=8775` | Use this only when another core already holds 8765. |

Each run writes to `logs/live/<date-time>/`. `logs/live/current` points at the newest run. The folder has one log per process, `pids`, `run.info`, `core_health_start.json`, `solver_12277.rgmp` and `driver_12276.rgmp`. Replay a capture with `python -m core --replay logs/live/current/solver_12277.rgmp`.

live.sh refuses to start when any stack port is in use. If one step fails, it shows that log and stops the processes it started. stop.sh stops the processes in reverse order. It sends Ctrl-C first, SIGTERM after 5 s, then SIGKILL. At the end it reports any port that is still open.

## 3. What a healthy start looks like

This start used the real driver and solver with no gloves plugged in (Sat 14 Nov, 13:08). The core ran on 8775 because another lane held 8765. Paths are shortened.

```
[live 13:08:27] run folder: .../logs/live/20261114-130827
[live 13:08:27] started driver (pid 37689): .../rokoko-device-sdk/bin/rokoko-sdk --auto-stream-usb
[live 13:08:27] driver listens on 45451
[live 13:08:27] driver listens on 12276
[live 13:08:27] started solver (pid 37705): .../rkk-hand-solver --no-driver --emit both --emit-openxr --listen 127.0.0.1:12277
[live 13:08:27] solver listens on 12277
[live 13:08:27] started capture-solver (pid 37709): .../python -m tools.rgmp_tee --from 127.0.0.1:12277 --out .../solver_12277.rgmp
[live 13:08:27] started capture-driver (pid 37711): .../python -m tools.rgmp_tee --from 127.0.0.1:12276 --out .../driver_12276.rgmp
[live 13:08:27] started core (pid 37713): .../python -m core --solver 127.0.0.1:12277 --rcsp 127.0.0.1:45451 --wearer slottest --port 8775
[live 13:08:28] core listens on 8775
[live 13:08:28] core health: {'rgmp': {'connected': True, 'frames': 0, 'devices': {}}, 'rcsp': {'connected': True}, 'hands': {'left': None, 'right': None}}
[live 13:08:28] started bridge (pid 37732): .../python -m tools.ingest_bridge --core ws://localhost:8775/ws/gloves --backend ws://localhost:8000/ws/ingest?activate=1
[live 13:08:28] started backend (pid 37734): env GLOVE_SOURCE=external GLOVE_AUTOSTART=off LLM_PROVIDER=fake uv run uvicorn app.main:app --port 8000
[live 13:08:28] backend listens on 8000
[live 13:08:28] started frontend (pid 37750): npm run dev
[live 13:08:28] frontend listens on 5173
[live 13:08:28] all up. Health: curl localhost:8775/health   Debug view: http://localhost:8775/debug
[live 13:08:28] app: http://localhost:5173   gloves screen: http://localhost:5173/gloves
```

Healthy signs, with no gloves and with gloves:

| Check | No gloves | Both gloves |
| --- | --- | --- |
| `curl localhost:8765/health`, field `rgmp` | `connected: true`, `frames: 0`, `devices: {}` | `frames` climbs; `devices` lists `left` and `right` |
| field `rcsp` | `connected: true` | `connected: true` |
| field `hands` | `left: null`, `right: null` | both `tracked: true`, `source: glove` |
| `driver.log` | version line, then "used under a Rokoko license" | device lines for both gloves |
| `solver.log` | "serving solved hands on rgmp://127.0.0.1:12277" | the same |
| `bridge.log` | "forwarded N frames, 0 backend errors" every 5 s | the same |
| `curl localhost:5173/api/health` | `glove_source: external` | the same |
| `solver_12277.rgmp` | 0 bytes (no devices, no data) | grows every second |

Measured rates on Szymon's gloves: 83.39 Hz per group per glove, zero gaps (STATUS.md).

## 4. A glove does not appear: check in this order

1. **USB.** Use a data cable, not a charge-only cable. If you can, plug straight into the Mac. Wait 5 s.
2. **Driver log.** Run `tail -f logs/live/current/driver.log`. "SDK not activated" means: do section 1. If no device line appears, unplug and plug in again.
3. **Device list.** Run `rokoko device list`. It asks the driver over RCSP. With no gloves it prints "No devices found." Both gloves must be in the list.
4. **Rokoko Studio.** Studio must be closed. It competes for the gloves.
5. **Auto stream.** The driver sends data only with `--auto-stream-usb` or after an RCSP `SubscribeToData`. live.sh uses the flag. If you start the driver by hand, add it.
6. **Solver.** If `rgmp.devices` is empty but `rokoko device list` shows the gloves, read `solver.log`. Restart the stack with `scripts/stop.sh` and `scripts/live.sh WEARER`.
7. **Hands swapped or one missing.** Read `rgmp.devices` in `/health`. Known ids: left 1572077328, right 2811174587 (Szymon's pair).
8. **Wrist points the wrong way.** This is expected until calibration. Send the core's `calibrate` command, or calibrate in the app at `/gloves/calibrate`.
9. **Port in use.** live.sh names the port. Run `lsof -nP -iTCP:<port> -sTCP:LISTEN` to find the owner.

Do not run `rokoko-sdk` network configuration commands (GetNetworkConfiguration). They print WiFi credentials.

## 5. Known notes

- The driver listens on all network interfaces (`*:45451`, `*:12276`, UDP 14041). Other machines on the LAN can reach it.
- On Ctrl-C the driver sometimes prints `libc++abi: terminating` and exits with code 134 (abort). The ports close and nothing is left running.
- Python tools print a `KeyboardInterrupt` traceback when stop.sh ends them. The capture files still close cleanly.
- The backend's `/gloves` status shows `sdk_found: false` on macOS. It looks for Windows `.exe` names. It does not matter here, because live.sh starts the driver and the solver.
