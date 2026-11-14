# STATUS: robot-view lane

Branch `robot-view`. All work is in `frontend/`. No change to `core/`, `docs/CONTRACT.md` or `SPEC.md`.

## What works

The frontend draws the Unitree Dex3-1 robot hand and drives it from the core's `/ws/robot`.

| Part | Where | What it does |
|---|---|---|
| Robot screen | `/robot` (rail entry "Robot") | Robot twin, source switch, fidelity per finger, joint table |
| Training room pane | `/apprentice/lessons/.../steps/N` | Twin beside the stage, small panel in the side column, "Show the robot hand" switch in Room settings |
| Expert studio fold | `/expert/scratch` | Twin under the live stage, follows the expert glove |
| Robot model | `src/three/robot/` | Reads the URDF from `public/models/robots/dex3_1/`, draws capsules per link, turns joints about their URDF axes |
| Strings | `src/three/robot/RobotStrings.tsx` | One thread from each human fingertip to the robot fingertip. Ring and little finger threads hang loose with a bead |
| Socket client | `src/api/useRobotStream.ts`, `src/api/robot.ts` | One shared socket, reconnects, sends `set_robot_source` and waits for the ack |
| Human hand from the core | `src/api/useCoreGloves.ts` | When a real core drives the robot, the twin reads the human hand from that core's `/ws/gloves`. Hand and robot always come from one engine |
| Mock robot | `src/mock/robot.ts` | Port of `core/robot.py` for mock mode. Answers only this origin's `/ws/robot` |

Endpoint order (first one that sends a hello wins):

1. `VITE_ROBOT_WS`, if set.
2. `ws://<page host>:8765/ws/robot` (the core).
3. This origin's `/ws/robot` (the mock, in mock mode).

### Tests

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npx tsc -b` | clean |
| `npm test` | 19 files, 277 tests pass (robot: 24) |
| `node e2e/robot-walk.mjs` (mock) | OK |
| `ROBOT_CORE=1 node e2e/robot-walk.mjs` against `python -m core --fake` | OK |
| `ROBOT_CORE=1 node e2e/robot-walk.mjs` against `--replay worn_solver.rgmp --replay-loop` | OK |

Probe of `/ws/robot` (2 s per source):

| Core run | master | learner | lesson | off |
|---|---|---|---|---|
| `--fake` | 0 messages | 61 | 60 | 0 |
| `--replay` worn_solver | 0 messages | 61 | 0 | 0 |

"master" sends nothing because no hand has the master role in these runs. "lesson" sends nothing in replay because no lesson is loaded. The panel says so in one line.

Screenshots: `frontend/docs/screens/robot-{mock,core}-0{1..4}-*.png`. The `core` set comes from the real capture.

### How to run

1. In the repo root: `source .venv/bin/activate`, then `python -m core --fake` (or `--replay FILE --replay-loop`, or real gloves).
2. In `frontend/`: `npm run dev`, then open `http://localhost:5173/robot`.
3. Pick "Apprentice glove". The robot follows the learner hand.

Walk against a core on another port: `ROBOT_CORE=1 ROBOT_CORE_PORT=8775 node e2e/robot-walk.mjs`.

## Choices made

| Choice | Reason |
|---|---|
| Robot shown in a handshake pose (palm towards the human hand) | The Dex3-1 thumb grows out of the palm face. Palm down puts the thumb through the bench and hides the curled fingers under the palm |
| Both hands lifted 0.6 units in the twin | The strings sag below their ends. At bench height the bench top hid every string |
| Light steel colour | Dark iron vanished on the walnut bench |
| Capsules only, no meshes | The STL meshes are not in the repo (`models/robots/dex3_1/` holds URDFs only) |
| Camera pulls back in tall panes | The training room pane is portrait. Without it both hands were cut off |
| Mock walk pins the robot socket to the mock | Without it, a mock walk switched the source of any core that ran on 8765 |
| No Claude trailer in commits | Repo CLAUDE.md rule 7 |

## Written but untested

| Item | Why untested |
|---|---|
| Live real gloves | Only the recorded capture was used |
| Left-hand robot | The capture and the fake drive the right hand as learner |
| "Expert glove" source with live targets | Needs a hand with the master role (`set_roles`) |
| "Lesson" source with a lesson loaded in the core | Needs `--lesson ID --mode learn` |
| Frame rate on the demo laptop | Tested only on the software renderer in headless Chrome |

## What a human must do next

1. Review and merge the draft PR for `robot-view`.
2. Before the demo, run the core on the same machine as the browser. If not, set `VITE_ROBOT_WS=ws://HOST:8765/ws/robot` before `npm run dev`.
3. Test with live gloves on `/robot`. Check that a fist closes the robot fingers in the same direction. `STATUS.md` (root) lists the Dex3-1 rotation direction as unverified.
4. For the expert source, give one glove the master role in the core (`set_roles`).
5. Decide on the small-caps section labels in the robot panel ("Who drives the robot", "How much of each finger it copies"). Design rule 5 forbids kicker labels. They may count as kickers.
6. The rail's glove status reads the backend (it can say "Gloves simulated"). The twin's human hand reads the core. With no backend these two can disagree.

## Notes for other lanes

- During testing, one mock walk switched the source of another lane's fake core on port 8765 to "learner". I set it back to "off" at once. The walk can no longer do this.
- Commit `1e9b2c4` "Changed things" sits under this branch. It is already on `origin/main`, so it is not part of this lane.
