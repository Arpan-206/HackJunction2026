# STATUS: typing lane

Branch `typing`, from `origin/main` at `7be4387`. The lane teaches touch typing. The keyboard gives the key. The glove gives the finger. Together they can say "right key, wrong finger".

## What works

| Part | Where | What it does |
|---|---|---|
| Typing task | `core/tasks/typing.py` | Keeps a short flexion history of all ten fingers. Runs the piano `PressDetector` on each hand. Judges each keydown against the QWERTY touch-typing chart |
| Commands | `keystroke {key, t?}`, `typing_reset` | `keystroke` queues one keydown and acks with an id. The verdict follows about 120 ms later as a `keystroke` event |
| Verdicts | `keystroke` event data | `good`, `wrong_finger` or `unclear` (reason `no_press` or `ambiguous`), with the expected and detected finger |
| Frame state | `frame.task` when the task is `typing` | Per-finger tally, totals, last verdict, pending count, detector state |
| Fake mode | `set_task typing` with `config.simulate: true` on `--fake` | The core imagines one press per keydown. 80% land on the chart finger, 15% on a neighbour, 5% nowhere. Ignored without `--fake` |
| Screen | `/typing`, `frontend/src/features/typing/` | Drill text, keyboard coloured by finger, next key outlined, one plain line per key, per-finger tally. Seven drills: home row first, then words |
| Accuracy tool | `tools/typing_accuracy.py` | Replays a capture plus a keystroke log through the same `TypingTask`. Reports match rate per finger and a confusion list |
| Key logger | `tools/keylog.py` | Adopted from the dispatcher. Writes `{t_ms, wall_us, key}` per keydown typed into a terminal |
| Thresholds | `config.toml` `[typing]` | Detector and window settings for typing, apart from `[piano]` |

How a keystroke is judged:

1. The window is 150 ms before the keydown to 120 ms after it. A key every 200 ms (60 words a minute) keeps neighbours apart.
2. Candidates are the fingers the detector saw press in the window, plus any finger whose flexion speed passed 40 deg/s.
3. The fastest candidate wins. It must be 1.5 times faster than every other finger, or the verdict is `unclear`.
4. Space accepts either thumb. Shift is not judged. "A" counts as "a".

## How to run

| Step | Command |
|---|---|
| Core without gloves | `python -m core --fake` (repo root, venv on) |
| Core with gloves | `python -m core --solver HOST:12277 --rcsp HOST:45451` |
| Screen | In `frontend/`: `npm run dev`, then open `http://localhost:5173/typing` |
| Core on another port | `VITE_CORE_WS=ws://localhost:8785/ws npm run dev` |
| Accuracy, synthetic log | `python -m tools.typing_accuracy CAPTURE.rgmp[.gz] --synth` |
| Accuracy, real log | `python -m tools.typing_accuracy CAPTURE.rgmp --keys keys.jsonl --capture-start-wall-us N --from-s A --to-s B [--sweep-s 4]` |
| Browser walk | `TYPING_CORE=1 TYPING_CORE_PORT=8765 node e2e/typing-walk.mjs` (needs Playwright, see below) |

The screen switches the core to the `typing` task when it connects. It puts the previous task back when it closes. A task config (for example a piano piece) is not restored.

Without a core, the screen still checks keys and names the chart finger. The finger columns then show "-".

## Test results

| Check | Result |
|---|---|
| `python -m pytest -q` (repo root) | 117 passed (typing: 19) |
| `npm run lint` | clean |
| `npm test` | 20 files, 282 tests passed (typing: 5) |
| `npx tsc -b`, `npx vite build` | clean |
| Live probe over `/ws`, `--fake` on port 8785, 18 keys | 18 verdicts: 13 good, 3 wrong finger, 2 unclear. These match the simulator's seeded choices |

## Real-glove accuracy

Real-glove accuracy is unknown. No clean capture exists yet.

| Data | Result | What it means |
|---|---|---|
| `worn_solver.rgmp.gz`, `--synth` | 5 presses, all `unclear` (ambiguous) | The capture holds whole-hand moves, not typing. All fingers move together, so "unclear" is the right answer |
| `logs/live/20261114-131952/solver_12277.rgmp` with `keys.jsonl`, window 1891 s to 1955 s, `[typing]` thresholds, lag fitted at -160 ms | 58 chart keys. 16 keys within 120 ms of a press. 3 good, 22 wrong finger, 33 unclear. Match 12% | Near chance (1 in 9). Not a valid accuracy figure, see below |

Why the real capture does not count:

1. The key log overlapped a held-fist scoring check on the right hand (13:51:41 to 13:52:04).
2. No clock marker was typed. The capture holds device clocks, not wall time. The start time is known only to about one second.
3. With the `[piano]` thresholds (250 deg/s, 12 deg) the detector found 2 presses in 64 s. The `[typing]` thresholds (60 deg/s, 4 deg) found 46. The dispatcher measured both.

## Choices made

| Choice | Reason |
|---|---|
| The core stamps a keystroke with its own arrival time | The browser and core clocks differ. On one machine the network delay is a few ms. `lag_ms` in the task config shifts it |
| Verdict comes as an event, not in the ack | The flexion peak lands after the keydown. The core must wait `post_ms` |
| Flexion speed is the mean over the finger's joints | Typing bends the middle joint as much as the knuckle. The detector itself still reads the knuckle only, as in piano |
| Simulated presses ride on a still hand | The `--fake` hands sway through the fake lesson. That motion made two of 18 verdicts wrong in the first probe |
| Wrong key does not move the cursor | The learner must type the right key. The line names the right key and finger |
| Screen tally counts this run only | The core's own tally (`frame.task.tally`) counts every key since the task started. The screen resets it on a new drill |
| Chart kept twice (Python and TypeScript) | `tests/test_typing.py` reads `chart.ts` and fails if the two disagree |
| Finger colours: mirrored muted tones | Gold, vermilion and malachite keep their theme meaning. Vermilion marks only a wrong key or finger |

## Edits outside the lane's new files

| File | Edit |
|---|---|
| `core/session.py` | Import `TypingTask`; `self.typing`; build it in `_reset_task`; `_typing_tick` in `tick`; `cmd_keystroke`; `cmd_typing_reset` |
| `core/tasks/__init__.py` | `typing` in `TASKS`; `task_state` branch |
| `schema/cmd.json` | `keystroke` and `typing_reset` in the command enum |
| `schema/event.json` | `keystroke` in the event enum |
| `config.toml` | New `[typing]` section (asked for by the dispatcher). `[piano]` is unchanged |
| `frontend/src/app/App.tsx` | Lazy `TypingScreen` and the `/typing` route |

New files: `core/tasks/typing.py`, `tests/test_typing.py`, `tools/typing_accuracy.py`, `tools/keylog.py`, `frontend/src/features/typing/*`, `frontend/tests/typing.test.ts`, `frontend/e2e/typing-walk.mjs`.

## Written but untested

| Item | Why untested |
|---|---|
| `/typing` in a browser | Playwright is not installed (`genui/node_modules` is absent), so `e2e/typing-walk.mjs` has not run. The build and type check pass |
| Live gloves on `/typing` | No clean typing capture or glove session yet |
| `[typing]` thresholds | Taken from one noisy capture |
| Two-hand ambiguity on Shift plus a letter | Shift is not sent, but the Shift finger still moves and may compete |

## What a human must do next

1. Install Playwright for the walks: in `genui/`, run `npm install`. Then run `node e2e/typing-walk.mjs` and `TYPING_CORE=1 node e2e/typing-walk.mjs` with `python -m core --fake` up.
2. Record a clean typing capture. Follow the procedure below.
3. Run the accuracy tool on it. Tune `[typing]` if needed. Write the match rate into this note.
4. Add a rail entry for `/typing`. Patch for `frontend/src/app/AppShell.tsx`, in `links`, after the Robot entry: `{ to: "/typing", label: "Typing", icon: <IconRobot />, end: false },` (or a keyboard icon).
5. Optional: add `"typing": ["typing", "touch typing", "keyboard", "type"]` to the task keywords in `core/coach.py`, so `describe_task` can pick it. `piano` already claims "keyboard", so check the order.
6. Review and merge the `typing` branch.

### Clean capture procedure

1. Start the core and the glove capture (`tools/rgmp_tee.py`). Note the capture file's birth time: `stat -f %B FILE` gives unix seconds.
2. Start `python -m tools.keylog --out logs/live/<run>/keys.jsonl` in a terminal.
3. Clock marker: rest both hands still for 3 s. Then press Space three times, one second apart, with the right thumb only. Rest 3 s again.
4. Type the drill text at a calm pace. Do no other glove task during the log.
5. Type the marker again at the end. Press Esc.
6. Convert times: `--capture-start-wall-us` is the birth time times 1,000,000. `--from-s` and `--to-s` cut the capture around the log (log wall time minus capture start, in seconds, with 10 s spare).
7. Run with `--sweep-s 3`. Check that the fitted lag puts the three marker Spaces on right-thumb presses. Then rerun with `--lag-ms` set to that lag and without `--sweep-s`, so the number is not fitted on the whole log.

## Real-glove measurement (Sat 14:13, guided key log, both gloves on, calibration loaded)

Clean run: no other glove task during the log, marker typed, lag fitted by
the tool (+540 ms). Data: `logs/live/20261114-131952/keys2.jsonl` (112 keys,
101 on the chart) against the solver capture window 14:10:28 to 14:13:08.

| Measure | Value |
| --- | --- |
| Keys with any detected press within 120 ms | 15 of 101 |
| Keys with a clear finger | 17 of 101 (17%) |
| Clear keys where the finger matched the chart | 1 of 17 (6%) |
| Detected finger when wrong | mostly right little and right thumb, on keys of other fingers |

Reading: with the `[typing]` thresholds (60 deg/s, 4 deg) the solver's finger
angles at 83 Hz do not show a distinct flexion event for most keystrokes, and
when something is detected it is usually a stray motion of the little finger
or thumb. The keyboard side works; the glove side does not identify the
typing finger at this sensitivity. Before claiming "right key, wrong finger"
in a demo: try the raw driver stream on 12276 (per-sensor orientations and
hub acceleration, unsmoothed; the same run's `driver_12276.rgmp` holds it),
or judge the finger by hand pose instead of a press (which finger is lowest
or most bent at the keydown), and re-measure. The typist typed with 25 slips
on the home row and 9 on the words, so the chart finger itself was not
always used; a drill with an expert typist would set a cleaner upper bound.

Second clean run (14:18 to 14:19, 153 keys, 146 on the chart, 1 slip on the
words): clear finger 31%, match 4% (2 of 45), the wrong finger most often the
left thumb. Same conclusion, with a better typist.
