# Apprentice: frontend and backend contract

This is the single source of truth for the data shapes and HTTP/WebSocket API shared by `backend/` (FastAPI) and `frontend/` (React + TypeScript). If you change a shape, change it here, in `backend/app/schemas/`, and in `frontend/src/api/types.ts` in the same commit.

Units: time in seconds (float), angles in radians, positions in metres. JSON keys are snake_case on the wire.

## Core types

```ts
type Side = 'left' | 'right';
type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
type GloveSource = 'simulator' | 'rokoko_udp' | 'rokoko_sdk' | 'external';
type Skill = 'table_tennis' | 'piano' | 'general';
type Prop = 'none' | 'racket' | 'keyboard' | 'ball';

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
  | { preset: 'hold_pose'; pose: Record<Finger, number> }                               // 0 open .. 1 curled
  | { preset: 'idle' };

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
| POST | `/recordings/start` | `{lesson_id?, step_id?}` | `{recording_id}` |
| POST | `/recordings/{id}/stop` | | `Recording` |
| GET | `/recordings/{id}` | | `Recording` |
| POST | `/motion/preview` | `{motion: MotionSpec, side: Side, duration_s: number}` | `{frames: GloveFrame[]}` (synthesised guide hands) |
| POST | `/score` | `{reference_recording_id or reference_motion, attempt_recording_id?, attempt_frames?: GloveFrame[], side?: "left" or "right", tolerance, use_latest_calibration?: boolean, attempt_calibration_id?: string, reference_calibration_id?: string}` (at least one attempt source; calibration fields optional, see notes) | `ScoreResult` |
| POST | `/coach/hint` | `CoachHintRequest`: `{step_id?, instruction, deviations: Record<Finger, number>, timing_ms, move_name?, joint_deviations?: Record<Finger, [knuckle, middle, tip]>, wrist_error_deg?, wrist_axis?: "pitch"\|"yaw"\|"roll", tolerance_deg?, attempt?: number, last_hint?: string}` (only the first four are needed) | `{hint, focus_finger: Finger\|null, cue_type: "curl"\|"extend"\|"timing"\|"wrist"\|"praise", severity: "low"\|"medium"\|"high", provider}` |
| POST | `/coach/plan` | `CoachPlanRequest` | `CoachPlanResponse` (Gemini practice plan; fake derives drills from the worst fingers) |
| POST | `/motion/from_text` | `{text: string (max 200 chars), side?: Side}` | `MotionFromTextResponse` (LLM picks a preset; fake uses keyword rules) |
| POST | `/vision/hands` | multipart `image` (jpeg) | `{hands: {side, wrist_pos, landmarks: [x,y,z][]}[]}` (MediaPipe) |
| POST | `/ingest/frames` | one `GloveFrame`, one `HandFrame` (`wrist_quat` defaults to identity) or `{frames: GloveFrame[]}` (max 600); optional `?activate=1` switches the source to `external` first | `{accepted: number}`; 409 if the source is not `external` and `activate` is absent, 422 on an invalid frame |
| GET | `/dev/state` | | `{glove_source, smoothing: {enabled, min_cutoff, beta}, llm_provider, simulator_motion, gemini_budget: {model, rpm_budget, rpm_remaining, rpd_budget, rpd_remaining, free_rpm, free_rpd}[]}` (`gemini_budget` is read-only, ignored on POST) |
| POST | `/dev/state` | partial of the above | new state |

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
- `POST /score` with `attempt_frames` scores those frames instead of the stored recording (frames win if both are sent). The backend records the unmodified glove stream, so any client-side change (for example the clumsy apprentice simulation) only reaches the scorer through `attempt_frames`. Frame `t` is rebased by the scorer; start the frames at the beat the reference motion starts on, because a `reference_motion` is synthesised from `t = 0`.
- Scoring metric: per finger, the error is the mean absolute difference of the finger's TOTAL flexion (sum of its 3 joints, in degrees) over the DTW-aligned path, the same quantity the frontend live coach compares with `tolerance.angle_deg`. A finger under-curled 25 degrees in total is therefore off at the default 18 degree tolerance, however the 25 is spread over joints. The error maps to 0..100 with `100 * exp(-0.5 * (err / (1.5 * angle_deg))^2)`; `within_tolerance` needs every finger error and the timing error inside tolerance. Hint degrees are the same total-flexion deviation. Calibration normalises per joint before the sum. Held poses: when the reference is a `hold_pose` or `idle` motion, or its total flexion moves less than 12 degrees peak to peak on every finger (`STATIC_REFERENCE_RANGE_DEG`), there is no beat to be early or late for, so the timing offset is taken as 0: `timing` is 100, `within_tolerance` ignores timing, `overall` keeps the same weights, and the hint never mentions early or late.
- `POST /coach/hint`: `deviations` are signed degrees of TOTAL finger flexion per finger (positive = curled more than the reference); `timing_ms` is positive when the learner is late; `wrist_error_deg` is signed about `wrist_axis` (pitch positive = too high, yaw positive = turned too far right, roll positive = rolled clockwise). `hint` is one imperative sentence of at most 14 words naming one finger or the wrist and one direction, for example "Lift your index finger slightly." `cue_type` is `extend` when the finger is curled too much, `curl` when too straight. `provider` is `fake`, `algorithmic` (the model failed, was rejected or nothing needed fixing), `gemini`, `ollama`, or `fake (rate limited)` when the Gemini budget was spent. Identical requests within 60 s are served from a cache; pass the previous `hint` as `last_hint` so the wording changes.
- Gemini free tier budget: the backend spends at most about 80 percent of the free RPM and RPD per model (limits in `app/constants.py`), persists the day count in `DATA_DIR/gemini_usage.json`, and when spent answers with the offline fallback and provider `fake (rate limited)` (also on `/lessons/generate`, `/coach/plan`, `/motion/from_text`). Hints use `GEMINI_HINT_MODEL` (default `gemini-3.5-flash-lite`), everything else `GEMINI_MODEL` (`gemini-3.8-flash`).
- Calibrated scoring: with `attempt_calibration_id` (or `use_latest_calibration: true`, which uses the latest calibration for the attempt's side), each attempt joint is normalised to 0..1 as `(x - flat) / (fist - flat)`, clipped, then mapped into the reference's angle space using `reference_calibration_id` if given, otherwise the nominal range (flat and fist of the guide hand at curl 0 and 1). The reference is never altered. Joints with a calibrated range under 0.05 rad, or a calibration with an uncaptured phase, are left uncalibrated and a message is added to `ScoreResult.warnings`. Without these fields scoring is unchanged. `reference_calibration_id` has no effect on its own. Unknown ids give 404.
- `POST /lessons/generate_from_video` stores nothing: the upload goes to a temporary file that is deleted after the call. Gemini uploads the file, waits until it is ACTIVE (60 s), then generates with a 120 s budget; on timeout or repeated invalid output it falls back to the fake template. Ollama and fake cannot read video.
- `POST /lessons/generate` returns an unsaved lesson (it has an `id` and `created_at`). `PUT /lessons/{id}` creates the lesson if the id is unknown, so the generated lesson can be saved after editing. `POST /lessons` returns 201.
- Step ids are optional in `POST`/`PUT` bodies (the server assigns them); `Step.tolerance`, `repetitions`, `hands` and `prop` have defaults.
- `/vision/hands` `wrist_pos` and `landmarks` are MediaPipe normalised image coordinates (not metres).
- `POST /calibrations` captures from the live stream for `duration_s`; the phase not yet captured is returned as zeros.
- Errors are `{detail: string}` with 404 (missing), 501 (rokoko_sdk stub), 503 (optional dependency or LLM provider missing), 409 (UDP port busy, or ingest while the source is not `external`), 422 (invalid ingested frame).
