# Geppetto: frontend and backend contract

This is the single source of truth for the data shapes and HTTP/WebSocket API shared by `backend/` (FastAPI) and `frontend/` (React + TypeScript). If you change a shape, change it here, in `backend/app/schemas/`, and in `frontend/src/api/types.ts` in the same commit.

Units: time in seconds (float), angles in radians, positions in metres. JSON keys are snake_case on the wire.

## Core types

```ts
type Side = 'left' | 'right';
type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
type GloveSource = 'simulator' | 'rokoko_udp' | 'rokoko_sdk' | 'external';
type Skill = 'table_tennis' | 'piano' | 'shadow_puppets' | 'surgical_grips' | 'crochet' | 'general';
type Prop = 'none' | 'racket' | 'keyboard' | 'ball';
type Hands = Side | 'both';   // one hand (left or right) or two

// One hand at one instant. Flexion per joint: [MCP, PIP, DIP] for fingers, [CMC, MCP, IP] for the thumb.
// 0 = straight, positive = curled. Spread (abduction) is optional, 0 = neutral, positive = away from the middle finger.
interface HandFrame {
  side: Side;
  wrist_quat: [number, number, number, number];   // x, y, z, w; hand orientation in world space
  wrist_pos: [number, number, number] | null;      // metres; null unless a webcam (MediaPipe) or Coil Pro gives position
  flexion: Record<Finger, [number, number, number]>;
  spread?: Record<Finger, number>;
}

// What the glove stream emits, ~60 Hz.
interface GloveFrame {
  t: number;                 // seconds since stream start
  source: GloveSource | 'replay';
  hands: HandFrame[];        // 0, 1 or 2 hands
}

// A parametric motion the simulator (and the LLM) can describe without raw frames.
type MotionSpec =
  | { preset: 'finger_sequence'; sequence: (1 | 2 | 3 | 4 | 5)[]; beat_ms: number }  // 1 thumb .. 5 little
  | { preset: 'grip_and_swing'; grip: 'shakehand' | 'penhold'; swing: 'forehand' | 'backhand'; beat_ms: number }
  | { preset: 'pinch'; fingers: (2 | 3)[]; beat_ms: number }
  | { preset: 'hold_pose'; pose: Record<Finger, number>; left_pose?: Record<Finger, number> | null }  // 0 open .. 1 curled
  | { preset: 'keyframes'; keys: Keyframe[]; left_keys?: Keyframe[] | null }
  | { preset: 'idle' };

// hold_pose.left_pose: the left hand's shape when the two hands differ (the snail's shell); null mirrors `pose`.
// keyframes: loop through key poses. Each key owns a slot of `ms`; the hand eases in from the previous key over the first
// half of the slot, then holds it. Period = sum of keys[].ms. left_keys gives the left hand its own keys (crochet's yarn
// hand), stretched to the same period; null mirrors `keys`. Wrist angles are radians in hand space: positive pitch lifts
// the fingers, positive roll turns the thumb down (pronation of the right hand).
interface Keyframe { pose: Record<Finger, number>; ms: number; yaw?: number; pitch?: number; roll?: number }

// A move the master can pick in "Start from scratch". Catalog served by GET /api/moves.
interface MoveKind {
  id: string;                // 'tt_forehand_swing'
  skill: Skill;
  name: string;              // 'Forehand swing'
  description: string;
  hands: Side | 'both';
  prop: Prop;
  default_motion: MotionSpec; // used for mock/guide hands
  default_repetitions: number;
}

interface Tolerance { angle_deg: number; timing_ms: number }   // room for error; defaults 18 deg, 250 ms

// The learner's margin of error: multiplies the step's Tolerance and the hint thresholds (see Backend notes).
// strict x0.6, standard x1 (the default, unchanged behaviour), relaxed x1.5, just_trying x2.5.
type Margin = 'strict' | 'standard' | 'relaxed' | 'just_trying';

interface Step {
  id: string;
  title: string;             // 'Lesson 1: Grip'
  instruction: string;       // plain-language coaching text
  move_id: string | null;    // MoveKind.id when picked from the catalog
  hands: Side | 'both';
  prop: Prop;
  motion: MotionSpec | null; // mock guide motion (generated or from the move catalog)
  reference_recording_id: string | null;  // master's chosen take; null until recorded
  repetitions: number;       // how many takes the master should record
  tolerance: Tolerance;
  video_url: string | null;  // optional master video for this step (future)
  weights?: Record<Finger, number> | null;  // additive (lane weights): how much each finger counts, 0..1; null or absent counts every finger fully
}

interface Lesson {
  id: string;
  title: string;
  skill: Skill;
  summary: string;
  master_name: string;
  source: 'scratch' | 'generated' | 'seed';
  steps: Step[];
  test: TestSpec | null;     // the "Test your skills" finale
  created_at: string;        // ISO 8601
}

interface TestSpec {
  kind: 'table_tennis_rally' | 'piano_play_along';
  opponent: 'bot' | 'two_player';  // two_player = left glove vs right glove
  rounds: number;
}

interface Calibration {
  id: string;
  side: Side;
  flat: Record<Finger, [number, number, number]>;  // averaged flexion with the hand flat
  fist: Record<Finger, [number, number, number]>;  // averaged flexion in a loose fist
  created_at: string;
}

interface Recording {
  id: string;
  lesson_id: string | null;
  step_id: string | null;
  started_at: string;
  duration_s: number;
  fps: number;
  hands: Side | 'both';      // what the take captured; a one-handed take holds only that hand. Default 'both'.
  frames: GloveFrame[];      // smoothed frames as streamed
}

interface ScoreResult {
  overall: number;           // 0..100
  per_finger: Record<Finger, number>;   // 0..100
  timing: number;            // 0..100; always 100 for a held pose (see Scoring metric), never early or late
  within_tolerance: boolean;
  worst_finger: Finger;
  hint: string;              // algorithmic plain-language tip
  warnings: string[];        // e.g. an incomplete calibration was ignored; empty normally
  margin: Margin;            // the margin of error it was judged with; 'standard' unless the request chose one
}

interface CoachPlanRequest {
  lesson_title: string;
  steps: { step_id: string; title: string }[];            // at most 20
  attempts: { step_id: string; score: ScoreResult }[];    // at most 60
}

interface Drill {
  step_id: string;
  focus_finger: Finger | null;
  exercise: string;
}

interface CoachPlanResponse {
  summary: string;           // at most 60 words, second person
  drills: Drill[];           // 1 to 4
  master_note: string;       // where this learner struggles, for the master
  provider: string;
}

interface MotionFromTextResponse {
  motion: MotionSpec;
  explanation: string;
  provider: string;          // 'fake' when the keyword rules answered
}
```

## HTTP API (prefix `/api`)

Routes are thin: validate input, call one service, return a schema. No business logic in routes.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | `{status: 'ok', glove_source, llm_provider}` |
| GET | `/moves?skill=table_tennis` | | `MoveKind[]` |
| GET | `/lessons` | | `Lesson[]` (summaries ok) |
| GET | `/lessons/{id}` | | `Lesson` |
| POST | `/lessons` | `Lesson` without id/created_at | `Lesson` |
| PUT | `/lessons/{id}` | `Lesson` | `Lesson` |
| POST | `/lessons/generate` | `{prompt: string, skill?: Skill}` | `{lesson: Lesson, provider: string, attempts: number}` |
| POST | `/lessons/generate_from_video` | multipart: `video` (mp4, webm or mov, max 50 MB), `prompt?`, `skill?` | `{lesson: Lesson, provider: string, attempts: number}` (413 too large, 415 wrong type; non-Gemini providers return the template with `provider: "fake"` and a summary note) |
| POST | `/calibrations` | `{side, phase: 'flat' or 'fist', duration_s?: number}` | `Calibration` (partial until both phases captured) |
| GET | `/calibrations/latest?side=right` | | `Calibration` or 404 |
| POST | `/recordings/start` | `{lesson_id?, step_id?, hands?: 'left' or 'right' or 'both'}` (default `both`) | `{recording_id}` |
| POST | `/recordings/{id}/stop` | | `Recording` |
| GET | `/recordings/{id}` | | `Recording` |
| POST | `/motion/preview` | `{motion: MotionSpec, side: Side, duration_s: number}` | `{frames: GloveFrame[]}` (synthesised guide hands) |
| POST | `/score` | `{reference_recording_id or reference_motion, attempt_recording_id?, attempt_frames?: GloveFrame[], side?: "left" or "right", tolerance, margin?: Margin, use_latest_calibration?: boolean, attempt_calibration_id?: string, reference_calibration_id?: string, weights?: Record<Finger, number> | null}` (at least one attempt source; calibration fields, `margin` and `weights` optional, see notes) | `ScoreResult` |
| POST | `/coach/hint` | `CoachHintRequest`: `{step_id?, instruction, deviations: Record<Finger, number>, timing_ms, move_name?, joint_deviations?: Record<Finger, [knuckle, middle, tip]>, wrist_error_deg?, wrist_axis?: "pitch"\|"yaw"\|"roll", tolerance_deg?, margin?: Margin, attempt?: number, last_hint?: string}` (only the first four are needed) | `{hint, focus_finger: Finger\|null, cue_type: "curl"\|"extend"\|"timing"\|"wrist"\|"praise", severity: "low"\|"medium"\|"high", provider}` |
| POST | `/coach/plan` | `CoachPlanRequest` | `CoachPlanResponse` (Gemini practice plan; fake derives drills from the worst fingers) |
| POST | `/motion/from_text` | `{text: string (max 200 chars), side?: Side}` | `MotionFromTextResponse` (LLM picks a preset; fake uses keyword rules) |
| POST | `/vision/hands` | multipart `image` (jpeg) | `{hands: {side, wrist_pos, landmarks: [x,y,z][]}[]}` (MediaPipe) |
| POST | `/ingest/frames` | one `GloveFrame`, one `HandFrame` (`wrist_quat` defaults to identity) or `{frames: GloveFrame[]}` (max 600); optional `?activate=1` switches the source to `external` first | `{accepted: number}`; 409 if the source is not `external` and `activate` is absent, 422 on an invalid frame |
| GET | `/dev/state` | | `{glove_source, smoothing: {enabled, min_cutoff, beta}, llm_provider, simulator_motion, gemini_budget: {model, rpm_budget, rpm_remaining, rpd_budget, rpd_remaining, free_rpm, free_rpd}[]}` (`gemini_budget` is read-only, ignored on POST) |
| POST | `/dev/state` | partial of the above | new state |
| GET | `/gloves/status` | | `GloveRigStatus` (see Real gloves) |
| POST | `/gloves/driver` | `{action: 'start' or 'stop'}` | `GloveRigStatus` after the action; 409 while Rokoko Studio is open, 503 when the SDK is not found |
| POST | `/gloves/reinit` | | `{devices: number}`: gloves that accepted RCSP `ReinitAlgo` (0 without a driver) |
| GET | `/gloves/calibrations?wearer=` | | `WearerCalibration[]`, newest first (`wearer` optional, case-insensitive) |
| GET | `/gloves/calibrations/latest?wearer=` | | `WearerCalibration` or 404 |
| POST | `/gloves/calibrations/neutral` | `{wearer, duration_s?: number (default 3, max 10), reinit?: boolean}` | `WearerCalibration` (stored); 400 when no frames arrived |
| POST | `/gloves/calibrations/{id}/finish` | `{range_calibration_ids?: {left?, right?}, verified?: boolean}` | `WearerCalibration`; 400 when a range id is for the other hand, 404 unknown ids |
| POST | `/gloves/drift_check` | `{wearer, duration_s?: number (default 2)}` | `DriftCheckResult`; 404 when the wearer has no calibration |

## WebSocket

`/ws/gloves` streams `GloveFrame` JSON at ~60 Hz from the active source after the smoothing stage. The client may send `{"type": "set_motion", "motion": MotionSpec}` to drive the simulator.

`/ws/ingest` (optional `?activate=1`) accepts text messages of the same shapes as `POST /ingest/frames`, for an external pipeline pushing at 60 Hz. Successes are silent; each failure is answered with `{"type": "error", "status": 409 | 422, "detail": string}` and the socket stays open. Ingested frames pass the normal smoothing and leave `/ws/gloves` with `source: "replay"`.

## LLM providers

`fake` (deterministic templates, offline, default in tests), `gemini` (Gemini Flash via google-genai, structured output with the JSON schema of `Lesson`), `ollama` (local Gemma 4 via Ollama `format` = JSON schema). Every provider's output is validated with the same pydantic model and retried up to 2 times with the validation errors fed back; on final failure the `fake` provider's template is returned and `provider` says so.

`/coach/plan` and `/motion/from_text` use the same providers, validation and retry rules; oversize input is a 422, and `provider` is `fake` when the offline fallback answered.

## Smoothing

The glove pipeline applies a One Euro filter (Casiez et al. 2012) per joint angle and normalised-lerp smoothing on the wrist quaternion, with a small deadband to remove the natural micro-tremor. Parameters are live-tunable via `/dev/state`. The frontend additionally interpolates between frames for rendering only.

## Backend notes (clarifications added by the backend implementation)

- `POST /score` scores one hand. `side` (optional) names it; clients should send the step's `hands` when it is `left` or `right`. Without `side` the scorer uses the first side present in the attempt (preferring one the reference also has) and reads the reference for that same side, so a two-handed reference never makes a one-handed attempt fail. A missing side in either recording gives 400.
- Hands: `MoveKind.hands` is the catalogue default, `Step.hands` is what the expert chose for the step (one hand left or right, or two), and `POST /recordings/start` with `hands: 'left'` or `'right'` keeps only that hand's frames (others are dropped as they arrive); the stored `Recording.hands` says which. `both` keeps every hand, as before. The learner app scores a two-handed step with one `POST /score` per side and keeps the weaker hand's result (lower overall, timing and per-finger values; within tolerance only if both are; the hint is prefixed with the hand). The live coach on the stage follows one hand at a time, chosen by the learner.
- `POST /score` with `attempt_frames` scores those frames instead of the stored recording (frames win if both are sent). The backend records the unmodified glove stream, so any client-side change (for example the clumsy apprentice simulation) only reaches the scorer through `attempt_frames`. Frame `t` is rebased by the scorer; start the frames at the beat the reference motion starts on, because a `reference_motion` is synthesised from `t = 0`.
- Scoring metric: per finger, the error is the mean absolute difference of the finger's TOTAL flexion (sum of its 3 joints, in degrees) over the DTW-aligned path, the same quantity the frontend live coach compares with `tolerance.angle_deg`. A finger under-curled 25 degrees in total is therefore off at the default 18 degree tolerance, however the 25 is spread over joints. The error maps to 0..100 with `100 * exp(-0.5 * (err / (1.5 * angle_deg))^2)`; `within_tolerance` needs every finger error and the timing error inside tolerance. Hint degrees are the same total-flexion deviation. Calibration normalises per joint before the sum. Held poses: when the reference is a `hold_pose` or `idle` motion, or its total flexion moves less than 12 degrees peak to peak on every finger (`STATIC_REFERENCE_RANGE_DEG`), there is no beat to be early or late for, so the timing offset is taken as 0: `timing` is 100, `within_tolerance` ignores timing, `overall` keeps the same weights, and the hint never mentions early or late.
- Margin of error: `margin` on `POST /score` and `POST /coach/hint` is the learner's own choice of strictness, on top of the expert's `Step.tolerance`. Its multiplier (`MARGIN_MULTIPLIERS` in `app/constants.py`: strict 0.6, standard 1.0, relaxed 1.5, just_trying 2.5) scales `angle_deg` and `timing_ms` before scoring, so the Gaussian, `within_tolerance` and `overall` all use the widened band, and scales every hint threshold (finger 4 degrees, timing 120 ms, wrist 8 degrees, and the tolerances severity is measured against). `relaxed` and `just_trying` are quiet margins: they also raise each hint threshold to its widened tolerance, so a finger, the timing or the wrist inside the band is never corrected and the hint praises instead. Without `margin` (or with `standard`) every number is exactly as before. `ScoreResult.margin` echoes the margin used. Invalid names are a 422. The WebSocket carries no scoring, so it has no margin; the browser's live corrections apply the same multiplier to the step tolerance on the client.
- `POST /coach/hint`: `deviations` are signed degrees of TOTAL finger flexion per finger (positive = curled more than the reference); `timing_ms` is positive when the learner is late; `wrist_error_deg` is signed about `wrist_axis` (pitch positive = too high, yaw positive = turned too far right, roll positive = rolled clockwise). `hint` is one imperative sentence of at most 14 words naming one finger or the wrist and one direction, for example "Lift your index finger slightly." `cue_type` is `extend` when the finger is curled too much, `curl` when too straight. `provider` is `fake`, `algorithmic` (the model failed, was rejected or nothing needed fixing), `gemini`, `ollama`, or `fake (rate limited)` when the Gemini budget was spent. Identical requests within 60 s are served from a cache; pass the previous `hint` as `last_hint` so the wording changes.
- Gemini free tier budget: the backend spends at most about 80 percent of the free RPM and RPD per model (limits in `app/constants.py`), persists the day count in `DATA_DIR/gemini_usage.json`, and when spent answers with the offline fallback and provider `fake (rate limited)` (also on `/lessons/generate`, `/coach/plan`, `/motion/from_text`). Hints use `GEMINI_HINT_MODEL` (default `gemini-3.5-flash-lite`), everything else `GEMINI_MODEL` (default also `gemini-3.5-flash-lite`, 500 requests per day free; both share its budget).
- Calibrated scoring: with `attempt_calibration_id` (or `use_latest_calibration: true`, which uses the latest calibration for the attempt's side), each attempt joint is normalised to 0..1 as `(x - flat) / (fist - flat)`, clipped, then mapped into the reference's angle space using `reference_calibration_id` if given, otherwise the nominal range (flat and fist of the guide hand at curl 0 and 1). The reference is never altered. Joints with a calibrated range under 0.05 rad, or a calibration with an uncaptured phase, are left uncalibrated and a message is added to `ScoreResult.warnings`. Without these fields scoring is unchanged. `reference_calibration_id` has no effect on its own. Unknown ids give 404.
- Step weights (additive): `weights` on `/score` (the step's `Step.weights`) are clipped to 0..1. The finger part of `overall` becomes their weighted mean, a finger with weight 0 never breaks `within_tolerance`, and `worst_finger` and `hint` only name a finger weighted at least 0.3 (`FOCUS_MIN_WEIGHT`; with none that heavy, the heaviest non-zero fingers). With an attempt calibration, joints it cannot read (range under 0.05 rad) leave the finger's total flexion on both sides, and a finger with no readable joint gets weight 0 plus a warning. Without `weights` and with every joint readable, scoring is unchanged.
- `POST /lessons/generate_from_video` stores nothing: the upload goes to a temporary file that is deleted after the call. Gemini uploads the file, waits until it is ACTIVE (60 s), then generates with a 120 s budget; on timeout or repeated invalid output it falls back to the fake template. Ollama and fake cannot read video.
- `POST /lessons/generate` returns an unsaved lesson (it has an `id` and `created_at`). `PUT /lessons/{id}` creates the lesson if the id is unknown, so the generated lesson can be saved after editing. `POST /lessons` returns 201.
- Step ids are optional in `POST`/`PUT` bodies (the server assigns them); `Step.tolerance`, `repetitions`, `hands` and `prop` have defaults.
- `/vision/hands` `wrist_pos` and `landmarks` are MediaPipe normalised image coordinates (not metres).
- `POST /calibrations` captures from the live stream for `duration_s`; the phase not yet captured is returned as zeros.
- Errors are `{detail: string}` with 404 (missing), 501 (rokoko_sdk stub), 503 (optional dependency or LLM provider missing), 409 (UDP port busy, or ingest while the source is not `external`), 422 (invalid ingested frame).

## Real gloves: status, calibration area, demo mode

Added 14 Nov 2026 at the user's request (additive; nothing above changed). The core (`core/`, SPEC.md) stays the only glove data path: it reads the solver on 12277 and `tools/ingest_bridge.py` pushes its hands into `/ws/ingest`. These routes only watch it: process and port checks, the driver's RCSP device list and events (read-only; `ReinitAlgo` is the one command sent, from the calibration area), and STATUS_FLAGS read from the driver's RGMP (12276) by a diagnostic tap that never produces hands.

```ts
type Connection = 'usb' | 'wifi' | 'emulated' | 'unknown';  // RCSP Serial, UDP, Emulated, Unknown
type GloveIssueCode = 'studio_running' | 'device_busy' | 'driver_not_running' | 'solver_not_running' | 'no_usb_devices'
  | 'glove_missing' | 'not_streaming' | 'no_frames' | 'low_frame_rate' | 'saturation' | 'heading_unreliable';

interface GloveRigStatus {
  checked_at: string;        // ISO 8601
  source: GloveSource;       // what feeds /ws/gloves now; 'simulator' frames never count as glove frames
  ready: boolean;            // at least one glove connected and no blocking issue
  driver: {
    driver_running: boolean; driver_port_open: boolean;   // rokoko-sdk, RGMP 12276
    solver_running: boolean; solver_port_open: boolean;   // rkk-hand-solver, RGMP 12277
    rcsp_connected: boolean;                               // RCSP 45451
    studio_running: boolean;                               // "Rokoko Studio.exe" holds the USB devices
    managed: boolean;        // this backend started the solver and stops it on shutdown
    autostart: boolean;      // GLOVE_AUTOSTART: 'auto' (only with GLOVE_SOURCE=external), 'on', 'off'
    sdk_found: boolean;
    last_error: string | null;
  };
  gloves: GloveDeviceStatus[];   // always [left, right]
  issues: GloveIssue[];          // most important first
}

interface GloveDeviceStatus {
  side: Side;
  connected: boolean;
  device_id: number | null;
  connection: Connection | null;
  fps: number | null;              // frames per second of this hand reaching the app (null on the simulator)
  driver_fps: number | null;       // the driver's rate for this glove (about 83 for Smartgloves)
  streaming: boolean | null;       // false: the driver sent the definition but no data (nobody subscribed), not a glove fault
  last_frame_age_ms: number | null;
  battery_pct: number | null;      // null: the driver reports no battery (true for driver 1.9.7), shown as "battery: unknown"
  heading_reliable: boolean | null;  // hub is_heading_reliable over the last second; null when unknown
  sensors: { name: 'thumb' | 'index' | 'middle' | 'ring' | 'little' | 'arm' | 'hub'; saturated: string[] }[];
}

interface GloveIssue {
  code: GloveIssueCode;
  side: Side | null;
  blocking: boolean;         // blocking issues stop the gloves; the rest are warnings
  title: string;
  fix: string;               // the fix step to show, plain words, may name a command in backticks
}

interface WearerCalibration {
  id: string;
  wearer: string;            // trimmed, at most 40 characters
  created_at: string;
  neutral: { side: Side; offsets: Record<Finger, [number, number, number]>; yaw_zero_deg: number; noise_deg: number; yaw_spread_deg: number; frames: number }[];
  range_calibration_ids: Partial<Record<Side, string>>;   // ids from POST /calibrations (flat and fist)
  quality: { noise_deg: number | null; bias_deg: number | null; heading_reliable: number | null; grade: 'good' | 'fair' | 'poor'; notes: string[] };
  reinit: boolean;           // RCSP ReinitAlgo was accepted before the capture
  verified: boolean;         // the hand on screen followed open and close
}

interface DriftCheckResult {
  ok: boolean;
  calibration_id: string;
  hands: { side: Side; flex_drift_deg: number; yaw_drift_deg: number }[];
  max_flex_deg: number;      // DRIFT_MAX_FLEX_DEG
  max_yaw_deg: number;       // DRIFT_MAX_YAW_DEG
  message: string;
}
```

- Saturation and heading flags are looked up by name in each STATUS_FLAGS stream's `bit_mapping` (`is_magnetometer_saturated`, `is_accelerometer_saturated`, `is_gyroscope_saturated`, `is_emf_saturated`, `is_heading_reliable`), never by bit position. Coil Pro streams are ignored. A flag counts for 5 s after it was last set, and RCSP `EmfSaturated`, `GyrSaturated` and `AccSaturated` events mark the hub. `driver_fps` counts only the first group (`default`); the driver also sends `emf_only` at the same rate.
- The driver (1.9.7) sends a glove's RGMP definition to any client but data frames only while some RCSP client holds `SubscribeToData` for it (the core does this when it runs with `--rcsp`). A glove whose definition arrived but no data for `ROKOKO_SUBSCRIBE_GRACE_S` (2 s) has `streaming: false` and gives one `not_streaming` step that says so; it never shows as `no_frames` or `low_frame_rate`. The backend never subscribes itself.
- Neutral pose: hands flat on the table, thumbs together, still. `offsets` are the mean joint flexion (radians, the `/ws/gloves` joints), `yaw_zero_deg` the circular mean wrist heading (rotation about +y of the fingers' -z), `noise_deg` the mean per-joint standard deviation in degrees. Quality bands are in `backend/app/constants.py` (`QUALITY_*`). Smartgloves have no calibrate command over RCSP; `reinit: true` sends the documented `ReinitAlgo` first and waits `REINIT_SETTLE_S`.
- Drift check: mean absolute joint flexion change per hand against the saved offsets, and the wrist heading change; `ok` when every streaming hand is within both thresholds.
