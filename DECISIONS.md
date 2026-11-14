# DECISIONS.md

Choices made overnight without anyone to ask. Each entry says what SPEC.md
said, what was done instead or in addition, and why. Newest at the bottom.

## D1. Commits stay local on `core-overnight`
The brief said "commit small and often, do not push" and also "don't commit
much". Read as: many small local commits, nothing pushed. Nothing touched
under `viewer/`. The teammate's pushes are checked hourly with `git fetch`.

## D2. `source` field on Hand, and `sources` on session
Added `source: "glove" | "camera"` to the Hand object as asked. Also added an
additive `sources: {left, right}` key to the session message so the viewer can
show which source feeds each hand. Viewers ignore unknown keys per SPEC.

## D3. Optional `angles` on Hand and ghost
Hand and ghost messages carry an optional `angles` array (18 degrees). The
scorer does not need it on the wire, but the debug view and anyone tuning
thresholds do. Additive, optional, ignorable.

## D4. Lesson `frame` is nullable, and glove lessons get a sketch
SPEC says each step has `frame: "frames/step_00.jpg"`. With glove-only
recording there is no camera image, so the recorder draws a small sketch of
the key pose (front and top view, OpenCV) into `frames/step_XX.jpg` at save
time so the codex has something to show. `frame` may still be `null` if the
sketch cannot be rendered; the HTTP route returns 404 for a missing file.

## D5. Lesson `source` accepts `fake`
The fake server generates a demo lesson from its own synthetic master trace.
`source` is `glove`, `camera`, `fake` or `dataset:<name>`.

## D6. Hold or move is decided per step at save time
SPEC lists both kinds but not how a recorded step gets one. Rule: a step is
`hold` when the hand is still (all 18 angles change under
`record.still_deg_s`) for at least `record.hold_fraction` of the step,
otherwise `move`. Both numbers live in config.toml.

## D7. Camera hands: metacarpal joints are synthesised
MediaPipe gives 21 landmarks and no carpometacarpal joints for the four
fingers. Each `*_metacarpal` joint is placed `camera.metacarpal_fraction`
(0.25) of the way from the wrist to that finger's knuckle. PIP, DIP, thumb and
spread angles are exact; MCP flexion is an approximation, so camera hands use
the wider `[score.camera]` tolerances.

## D8. Camera wrist position has no depth
With a plain webcam there is no range. The wrist is placed on a fixed plane
in front of the viewer (`camera.plane_*`), from the normalised landmark x, y.
Anchor is reported as `camera`. Orientation comes from the landmark frame.

## D9. RGMP joint mapping is configuration, not code
Rokoko's docs say `joints_openxr` holds 26 `TRANSFORM` entries against
`xr_base`, but do not list the stream names or the left/right field. The
parser is driven by the definition JSON plus `[rgmp]` in config.toml:
which `measure_type` values mean position, orientation or pose, which field
names the joint, and where `hand` lives. First job with real gloves: dump the
definition (it is written to `logs/` on connect) and fix those four settings.

## D10. Extra cmd names and event names
Added `set_sources` (switch a hand between glove and camera at runtime) and
`step_restart` commands, and `step_restarted` and `stuck` events. All additive.

## D11. Coaching is rule lines only
`coach.py` exposes a `CoachClient` protocol with `tip()` and `name_steps()`.
`RuleCoach` implements it with the SPEC's rule lines. No network calls exist
anywhere in the core. `session.gemma` is reported as `off`.

## D12. Commit signing is off for this repo only
Commits are signed with a hardware security key that is not plugged in
overnight. `git config --local commit.gpgsign false` was set in this clone so
work can be committed. The global setting is untouched. Re-sign or squash in
the morning if signed history matters.

## D13. `key_joints` are in the wrist frame
SPEC says `key_joints` are "26 wrist-relative positions". They are stored in
the wrist frame (wrist at the origin, fingers along -Z, back of the hand +Y),
with the master's world wrist orientation kept in `key_wrist_q`. This is what
lets the ghost be glued onto any learner wrist and mirrored by negating x.
`trace.npz` keeps `joints` in `xr_base` as SPEC says; the wrist frame is
recovered from `wrist_q`.

## D14. Move-step matching breaks ties by raw error
Inside the 8-degree dead zone every candidate master sample scores 1.0, so
`timing_ms` would be arbitrary. The best match is the highest score, then the
smallest mean angle error. Scores are unchanged; timing becomes exact.

## D15. Hourly teammate check is done by hand
A scheduled job was set up to fetch `origin` every hour, but scheduled jobs
only fire while this session is idle, and the overnight build is one long
task. The fetch was run by hand about once an hour instead; results are in
STATUS.md under "Teammate activity". Nothing was merged, rebased or pushed.

## D16. Attempt logging landed early
SPEC schedules "visitor attempt logging" for Saturday 21:00. It cost ten
lines, so every step summary (pass, failed attempt, stuck) is appended to
`logs/attempts.jsonl` now. This is the data the "later, if there is time"
per-slot tolerance job would read.

## D17. `tools/ws_log.py` acks every command while replaying
When the viewer runs against a replayed message log there is no core to
answer commands. The replayer answers every `cmd` with `ok: true` and
`result: {"replay": true}` so viewer buttons do not show errors.

## D18. Mirror and duel are minimal
Mirror: reference is the master's live angles 300 ms ago, best match in a
250 ms window, ghost is the master's live hand mirrored onto the learner.
Duel: both non-free hands score the same step; the first to pass wins the
round, `round_won` is emitted, `frame.task.duel` carries the tally, and the
primary `frame.score` is the first learner's while `frame.scores` has both.
Both run in tests on synthetic hands; neither has seen a glove.

## D19. Playback ghost sits at the rest pose
Recorded wrist positions are NaN tonight (no camera anchor), so a playback
ghost is drawn at the master hand's `rest_pose` with the recorded wrist
orientation, placement `recorded`.

## D20. Frame rate: steady at 30 Hz in the foreground
Tick timing measured 33.3 ms median, zero late ticks, with uvicorn and a
connected client, on both the asyncio and uvloop loops. One measurement of a
server launched as a detached background process from a script showed every
seventh tick 33 ms late (26 Hz at the client); macOS timer throttling of
background processes is the suspected cause. `/health` now reports `tick_hz`
so this is visible at a glance. Run the core in a foreground terminal.

## D21. Piano landed early, with the SPEC's numbers untuned
SPEC schedules piano for Saturday 18:00 but the press detector is twenty
lines once angles exist, so it is in. A finger's resting flexion is a slow
running average (2 s) updated only while the finger is up, so the "12 degrees
past rest" rule tracks a drifting hand. Verdict windows: 120 ms `good`,
300 ms `early`/`late`, a different finger inside 300 ms is `wrong_finger`,
nothing inside 300 ms is `miss`. The piece loops after its last beat when
`loop` is on. All numbers are in `[piano]` in config.toml. Which key the
finger is over (wrist x from a camera) is not done; without a camera the
viewer lights the key the note names, as SPEC says.

## D22. A compatibility layer for the teammate's contract, SPEC.md unchanged
At 23:34 on Friday the teammate pushed ten commits to `main`: a React
`frontend/`, a FastAPI `backend/` and `docs/CONTRACT.md`, all written against
a different contract from SPEC.md (REST under `/api` on port 8000, a
`/ws/gloves` stream of per-finger flexion triples in radians, lessons made of
"moves" and "motion specs", scores 0 to 100). Their backend's Rokoko SDK
source is a stub that answers 501; it reads Rokoko Studio's UDP stream
instead. Nobody could be asked which contract wins.

Choice: SPEC.md stays the core's contract and `/ws` is unchanged. In addition
`core/compat.py` serves, side by side on the same port, what the committed
frontend calls: `/ws/gloves` (GloveFrame at the tick rate, hands converted
from the 18 angles) and the `/api/*` routes the core can honour (health,
lessons mapped to their Lesson shape, dev state, calibrations, recordings
start/stop mapped to record mode, coach hint from the rule table). Routes
that need their lesson generator, motion synthesiser or recording store
answer 501 with a message. Running `python -m core --port 8000` lets the
committed frontend's Vite proxy reach the core with no change on their side.

Known limits of the mapping: thumb CMC flexion is the angle between the
thumb and index metacarpals; `spread` is the raw angle between neighbouring
proximal bones, not zeroed at neutral; `wrist_pos` is null for gloves (rest
anchor) and set for camera hands; `Recording.frames` is empty (the lesson's
`trace.npz` holds the data). Nothing under `frontend/`, `backend/`, `docs/`
or `genui/` was touched. The morning decision is whether the frontend
switches to SPEC.md's richer `/ws` (ghost, score, coach, session) or keeps
CONTRACT.md and the core keeps serving both.

## D23. A code review ran before the final commit
A medium-effort review of `main..core-overnight` at 01:50 reported eight
confirmed defects and six smaller ones. All are fixed in the commit after it:
a move step whose ghost time ran past the step end wedged the tick loop;
the glove reader task died on any exception in frame handling; `set_mode`
changed state before rejecting a bad request; the RCSP parser could stall on
a fake marker byte and crash on a non-object body; piano accepted a zero
tempo; two lessons saved in the same minute overwrote each other; a failed
duel step reset only one hand; `set_loop` did not reach the piano piece;
DTW could block the loop for half a second on long steps; the replay tool
paced two-glove captures slowly; the recorded `rate_hz` was a constant.
Seven of these have regression tests in `tests/test_review_fixes.py`.

## D24. Two integration routes, both kept
Their 00:28 push added an `external` glove source to their backend
(`/ws/ingest`), made for a pipeline like this core. `tools/ingest_bridge.py`
forwards this core's hands into it. Route A (core serves their contract,
D22) and route B (core feeds their backend) are both tested and documented
in STATUS.md. Neither was chosen; that is the morning's call. The bridge
drops untracked hands and sends only the five CONTRACT.md keys per hand.

## D25. Robot hand: Dex3-1 from Unitree's own URDF, retarget table in config
The Aalto starter repo (zupermiez/aaltonomous-humanoid) clones Unitree's
`xr_teleoperate` for the G1 URDF and holds no hand URDF itself, so the
Dex3-1 URDFs come from `unitreerobotics/unitree_ros` (BSD-3-Clause), copied
to `models/robots/dex3_1/`. Joint names and limits are read from those files
at startup; a missing or broken URDF disables the robot block with a logged
reason instead of stopping the server. The retarget table lives in
`config.toml`: one entry per robot joint with its human finger, an offset
and weights over the 18 angle features. Flexion sign follows the URDF limit
range (the side with the larger magnitude), with explicit overrides, because
the left and right Dex3-1 files use mirrored ranges. Fidelity per finger is
coverage (robot joints over human flexion joints, so index and middle score
at most 2/3) times one minus the mean clipping loss. CONTRACT.md has no
robot field, so the block is served on its own socket `/ws/robot` as well as
inside `frame` on `/ws`.
