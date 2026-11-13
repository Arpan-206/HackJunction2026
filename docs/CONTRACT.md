# Apprentice: frontend and backend contract

This is the single source of truth for the data shapes and HTTP/WebSocket API shared by `backend/` (FastAPI) and `frontend/` (React + TypeScript). If you change a shape, change it here, in `backend/app/schemas/`, and in `frontend/src/api/types.ts` in the same commit.

Units: time in seconds (float), angles in radians, positions in metres. JSON keys are snake_case on the wire.

## Core types

```ts
type Side = 'left' | 'right';
type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
type GloveSource = 'simulator' | 'rokoko_udp' | 'rokoko_sdk';
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
  timing: number;            // 0..100
  within_tolerance: boolean;
  worst_finger: Finger;
  hint: string;              // algorithmic plain-language tip
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
| POST | `/calibrations` | `{side, phase: 'flat' or 'fist', duration_s?: number}` | `Calibration` (partial until both phases captured) |
| GET | `/calibrations/latest?side=right` | | `Calibration` or 404 |
| POST | `/recordings/start` | `{lesson_id?, step_id?}` | `{recording_id}` |
| POST | `/recordings/{id}/stop` | | `Recording` |
| GET | `/recordings/{id}` | | `Recording` |
| POST | `/motion/preview` | `{motion: MotionSpec, side: Side, duration_s: number}` | `{frames: GloveFrame[]}` (synthesised guide hands) |
| POST | `/score` | `{reference_recording_id or reference_motion, attempt_recording_id, tolerance}` | `ScoreResult` |
| POST | `/coach/hint` | `{step_id?, instruction, deviations: Record<Finger, number>, timing_ms}` | `{hint: string, provider: string}` |
| POST | `/vision/hands` | multipart `image` (jpeg) | `{hands: {side, wrist_pos, landmarks: [x,y,z][]}[]}` (MediaPipe) |
| GET | `/dev/state` | | `{glove_source, smoothing: {enabled, min_cutoff, beta}, llm_provider, simulator_motion}` |
| POST | `/dev/state` | partial of the above | new state |

## WebSocket

`/ws/gloves` streams `GloveFrame` JSON at ~60 Hz from the active source after the smoothing stage. The client may send `{"type": "set_motion", "motion": MotionSpec}` to drive the simulator.

## LLM providers

`fake` (deterministic templates, offline, default in tests), `gemini` (Gemini Flash via google-genai, structured output with the JSON schema of `Lesson`), `ollama` (local Gemma 4 via Ollama `format` = JSON schema). Every provider's output is validated with the same pydantic model and retried up to 2 times with the validation errors fed back; on final failure the `fake` provider's template is returned and `provider` says so.

## Smoothing

The glove pipeline applies a One Euro filter (Casiez et al. 2012) per joint angle and normalised-lerp smoothing on the wrist quaternion, with a small deadband to remove the natural micro-tremor. Parameters are live-tunable via `/dev/state`. The frontend additionally interpolates between frames for rendering only.

## Backend notes (clarifications added by the backend implementation)

- `POST /coach/hint` `deviations` are signed degrees per finger (positive = curled more than the reference); `timing_ms` is positive when the learner is late.
- `POST /lessons/generate` returns an unsaved lesson (it has an `id` and `created_at`). `PUT /lessons/{id}` creates the lesson if the id is unknown, so the generated lesson can be saved after editing. `POST /lessons` returns 201.
- Step ids are optional in `POST`/`PUT` bodies (the server assigns them); `Step.tolerance`, `repetitions`, `hands` and `prop` have defaults.
- `/vision/hands` `wrist_pos` and `landmarks` are MediaPipe normalised image coordinates (not metres).
- `POST /calibrations` captures from the live stream for `duration_s`; the phase not yet captured is returned as zeros.
- Errors are `{detail: string}` with 404 (missing), 501 (rokoko_sdk stub), 503 (optional dependency or LLM provider missing), 409 (UDP port busy).
