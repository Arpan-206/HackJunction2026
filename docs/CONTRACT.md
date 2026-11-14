# Geppetto: frontend and backend contract

This is the single source of truth for the data shapes and HTTP/WebSocket API shared by `backend/` (FastAPI) and `frontend/` (React + TypeScript). If you change a shape, change it here, in `backend/app/schemas/`, and in `frontend/src/api/types.ts` in the same commit.

Units: time in seconds (float), angles in radians, positions in metres. JSON keys are snake_case on the wire.

## Core types

```ts
type Side = 'left' | 'right';
type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
type GloveSource = 'simulator' | 'rokoko_udp' | 'rokoko_sdk' | 'external';
type Skill = 'table_tennis' | 'piano' | 'finnish_fingerspelling' | 'fingerspelling' | 'shadow_puppets' | 'general';   // the four demo skills shown in the catalogue, plus general; 'fingerspelling' is the American alphabet drill (moves `fs_*`, seed courses), reachable at /apprentice/fingerspelling and not listed in the catalogue
type Prop = 'none' | 'racket' | 'keyboard' | 'ball';   // keyboard: a piano keyboard (or a computer keyboard for the air typing test)
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
// half of the slot, then holds it. Period = sum of keys[].ms. left_keys gives the left hand its own keys (one hand holds
// while the other moves), stretched to the same period; null mirrors `keys`. Wrist angles are radians in hand space: positive pitch lifts
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

// Room for error; defaults 18 deg, 250 ms. finger_angle_deg (optional, from POST /recordings/model) gives fingers their own
// angle band in degrees of total flexion; a finger left out, or the field absent or null, uses angle_deg.
interface Tolerance { angle_deg: number; timing_ms: number; finger_angle_deg?: Partial<Record<Finger, number>> | null }

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
  take_ids?: string[];       // the takes the step's model was built from (POST /recordings/model), at most 5; [] by default
  repetitions: number;       // how many takes the master should record
  tolerance: Tolerance;
  video_url: string | null;  // older single video link; read as a tutorial video at offset 0 when tutorial_video is absent
  weights?: Record<Finger, number> | null;  // how much each finger counts, 0..1; null or absent counts every finger fully
  tutorial_video?: MediaRef | null;  // the expert talking the step through (POST /media), synced to the reference take; null by default
}

// A stored video (POST /media) attached to a step or a take. offset_s is the video time at which the take's frame 0 plays:
// for a tutorial video, where the step's reference take starts; for a take's own webcam, normally about 0 (negative when the
// camera started after the take). Bounded to +-3600 s (MEDIA_MAX_OFFSET_S).
interface MediaRef { media_id: string; url: string; offset_s: number }

interface MediaInfo {        // POST /media
  id: string;
  url: string;               // '/api/media/{id}': serves the file with HTTP range requests (206), so players can seek
  duration_s: number | null; // as the uploader stated it (multipart field duration_s); null when not sent
  content_type: 'video/webm' | 'video/mp4' | 'video/quicktime';
  size_bytes: number;
  created_at: string;
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
  kind: 'table_tennis_rally' | 'piano_play_along' | 'air_typing';  // air_typing: words struck in the air, scored per finger
  opponent: 'bot' | 'two_player';  // two_player = left glove vs right glove
  rounds: number;
}

interface Calibration {
  id: string;
  side: Side;
  flat: Record<Finger, [number, number, number]>;  // averaged flexion with the hand flat
  fist: Record<Finger, [number, number, number]>;  // averaged flexion in a loose fist
  thumb: Record<Finger, [number, number, number]> | null;  // additive: flat hand, thumb folded; null until captured
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
  video: MediaRef | null;    // the webcam filmed during the take (PUT /recordings/{id}/video); null by default
  frames: GloveFrame[];      // smoothed frames as streamed
}

interface RecordingSummary {   // GET /recordings: a Recording without frames
  id: string; lesson_id: string | null; step_id: string | null; started_at: string;
  duration_s: number; fps: number; hands: Side | 'both'; video: MediaRef | null;
  frame_count: number;
}

interface TakesModelRequest {
  recording_ids: string[];   // 2 to 5 distinct ids (3 to 5 recommended); 1 or more than 5 is a 422
  side?: Side;               // the hand to model; default: the first hand every take has (400 when they share none)
  timing_ms?: number;        // copied into the returned tolerance (default 250); timing is not derived from the takes
}

interface TakeConsistency {
  recording_id: string;
  is_reference: boolean;     // the medoid take
  distance_deg: number;      // mean over fingers of the DTW total-flexion error against the reference; 0 for it
  score: number;             // 0..100: the take scored as an attempt against the reference with the derived tolerance
  error_deg: Record<Finger, number>;   // per-finger DTW total-flexion error against the reference
  worst_finger: Finger | null;         // the finger that strays most; null for the reference
  outlier: boolean;          // far from the other takes: suggest recording it again (never with fewer than 3 takes)
}

interface TakesModel {
  side: Side;
  reference_recording_id: string;      // put in Step.reference_recording_id
  take_ids: string[];                  // the request's ids in order; put in Step.take_ids
  tolerance: Tolerance;                // put in Step.tolerance: finger_angle_deg has all five fingers, angle_deg is their median
  spread_deg: Record<Finger, number>;  // each finger's robust spread around the reference, before scaling and clamping
  takes: TakeConsistency[];            // request order
  consistency: number;                 // 0..100: mean score of the non-reference takes
  steadiest_finger: Finger;
  loosest_finger: Finger;
  enough_takes: boolean;               // at least 3 takes
  warnings: string[];                  // plain sentences: too few takes, or which take strays
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
| GET | `/fingerspelling/packs` | | `FingerspellingPack[]` (see Fingerspelling packs) |
| GET | `/fingerspelling/packs/{id}` | | `FingerspellingPack` or 404 |
| GET | `/lessons` | | `Lesson[]` (summaries ok) |
| GET | `/lessons/{id}` | | `Lesson` |
| POST | `/lessons` | `Lesson` without id/created_at | `Lesson` |
| PUT | `/lessons/{id}` | `Lesson` | `Lesson` |
| POST | `/lessons/generate` | `{prompt: string, skill?: Skill}` | `{lesson: Lesson, provider: string, attempts: number}` |
| POST | `/lessons/generate_from_video` | multipart: `video` (mp4, webm or mov, max 50 MB), `prompt?`, `skill?` | `{lesson: Lesson, provider: string, attempts: number}` (413 too large, 415 wrong type; non-Gemini providers return the template with `provider: "fake"` and a summary note) |
| POST | `/calibrations` | `{side, phase: 'flat' or 'fist' or 'thumb', duration_s?: number}` | `Calibration` (partial until both phases captured) |
| GET | `/calibrations/latest?side=right` | | `Calibration` or 404 |
| POST | `/recordings/start` | `{lesson_id?, step_id?, hands?: 'left' or 'right' or 'both'}` (default `both`) | `{recording_id}` |
| POST | `/recordings/{id}/stop` | | `Recording` |
| GET | `/recordings/{id}` | | `Recording` |
| GET | `/recordings?step_id=&lesson_id=` | | `RecordingSummary[]` (no frames), oldest first; both filters optional |
| DELETE | `/recordings/{id}` | | 204; deletes a stored take, or discards one still recording; 404 when unknown |
| PUT | `/recordings/{id}/video` | `{media_id, offset_s?: number}` (default 0, within +-3600) | `RecordingSummary` with `video` set (url filled in by the server); 404 for an unknown take or media id |
| DELETE | `/recordings/{id}/video` | | `RecordingSummary` with `video: null`; the stored file stays until `DELETE /media/{id}` |
| POST | `/media` | multipart: `video` (webm, mp4 or mov; a codecs parameter such as `video/webm;codecs=vp9` is fine; max 200 MB), `duration_s?` (seconds, 0 to 14400) | 201 `MediaInfo` (413 too large, 415 wrong type, 400 bad duration or empty file) |
| GET | `/media/{id}` | | the file with its content type; `Range: bytes=a-b` answers 206 with `Content-Range`; 404 when unknown |
| DELETE | `/media/{id}` | | 204; 404 when unknown. Steps or takes that still point at it show their still instead |
| POST | `/recordings/model` | `TakesModelRequest` | `TakesModel` (see Takes model in the notes); 422 for 1, more than 5 or repeated ids, 404 for an unknown id |
| POST | `/motion/preview` | `{motion: MotionSpec, side: Side, duration_s: number}` | `{frames: GloveFrame[]}` (synthesised guide hands) |
| POST | `/score` | `{reference_recording_id or reference_motion, attempt_recording_id?, attempt_frames?: GloveFrame[], side?: "left" or "right", tolerance, margin?: Margin, use_latest_calibration?: boolean, attempt_calibration_id?: string, reference_calibration_id?: string, weights?: Record<Finger, number> | null}` (at least one attempt source; calibration fields, `margin` and `weights` optional, see notes) | `ScoreResult` |
| POST | `/coach/hint` | `CoachHintRequest`: `{step_id?, instruction, deviations: Record<Finger, number>, timing_ms, move_name?, joint_deviations?: Record<Finger, [knuckle, middle, tip]>, wrist_error_deg?, wrist_axis?: "pitch"\|"yaw"\|"roll", tolerance_deg?, finger_tolerance_deg?: Partial<Record<Finger, number>>, margin?: Margin, attempt?: number, last_hint?: string}` (only the first four are needed) | `{hint, focus_finger: Finger\|null, cue_type: "curl"\|"extend"\|"timing"\|"wrist"\|"praise", severity: "low"\|"medium"\|"high", provider}` |
| POST | `/coach/plan` | `CoachPlanRequest` | `CoachPlanResponse` (Gemini practice plan; fake derives drills from the worst fingers) |
| POST | `/motion/from_text` | `{text: string (max 200 chars), side?: Side}` | `MotionFromTextResponse` (LLM picks a preset; fake uses keyword rules) |
| POST | `/vision/hands` | multipart `image` (jpeg) | `{hands: {side, wrist_pos, landmarks: [x,y,z][]}[]}` (MediaPipe) |
| POST | `/ingest/frames` | one `GloveFrame`, one `HandFrame` (`wrist_quat` defaults to identity) or `{frames: GloveFrame[]}` (max 600); optional `?activate=1` switches the source to `external` first | `{accepted: number}`; 409 if the source is not `external` and `activate` is absent, 422 on an invalid frame |
| GET | `/dev/state` | | `{glove_source, smoothing: {enabled, min_cutoff, beta}, llm_provider, simulator_motion, gemini_budget: {model, rpm_budget, rpm_remaining, rpd_budget, rpd_remaining, free_rpm, free_rpd}[], llm_chain: string[], llm_answered_by: string \| null}` (`gemini_budget`, `llm_chain` and `llm_answered_by` are read-only, ignored on POST; `llm_provider` may also be `openai`) |
| POST | `/dev/state` | partial of the above | new state |
| GET | `/dev/locate?kind=&id=` | | `FileLocation` (see Dev file reveal) without opening anything; 403, 400, 404 and 422 as for `/dev/reveal` |
| POST | `/dev/reveal` | `{kind: FileKind, id: string}` | `FileLocation`; opens the file manager on the backend machine with the file selected (see Dev file reveal) |
| POST | `/dev/glove_compare` | `GloveCompareSave` (see Dev file reveal) | `GloveCompareSaved`; writes one guided capture of the glove compare page; 403 as for `/dev/reveal`, 422 on an unsafe `session` or `slug` |
| GET | `/gloves/status` | | `GloveRigStatus` (see Real gloves) |
| POST | `/gloves/driver` | `{action: 'start' or 'stop'}` | `GloveRigStatus` after the action; 409 while Rokoko Studio is open, 503 when the SDK is not found |
| POST | `/gloves/reinit` | | `{devices: number}`: gloves that accepted RCSP `ReinitAlgo` (0 without a driver) |
| GET | `/gloves/calibrations?wearer=` | | `WearerCalibration[]`, newest first (`wearer` optional, case-insensitive) |
| GET | `/gloves/calibrations/latest?wearer=` | | `WearerCalibration` or 404 |
| POST | `/gloves/calibrations/neutral` | `{wearer, duration_s?: number (default 3, max 10), reinit?: boolean}` | `WearerCalibration` (stored); 400 when no frames arrived |
| POST | `/gloves/calibrations/{id}/finish` | `{range_calibration_ids?: {left?, right?}, verified?: boolean}` | `WearerCalibration`; 400 when a range id is for the other hand, 404 unknown ids |
| POST | `/gloves/drift_check` | `{wearer, duration_s?: number (default 2)}` | `DriftCheckResult`; 404 when the wearer has no calibration |

### Dev file reveal

A developer aid behind the frontend's dev mode (`?dev=1`): "Open file location" and "Copy path" beside each take, lesson, step reference take and newest backup, so a stored file can be sent on.

```ts
type FileKind = 'recording' | 'lesson' | 'draft' | 'export' | 'calibration' | 'media';
interface FileLocation { kind: FileKind; id: string; path: string; opened: boolean }  // path is absolute
```

- Where each kind lives under the data folder (`backend/data/` by default): `recordings/<id>.json`, `lessons/<id>.json`, `drafts/<id>.json`, `calibrations/<id>.json`, `media/<id>.<ext>` (the video file itself). `export` takes a file name in `exports/` (with or without `.geppetto.json`), or a lesson id for that lesson's newest backup (written after every publish).
- `POST /dev/reveal` opens Windows Explorer with the file selected (`explorer /select,<path>`; `open -R` on macOS, `xdg-open` on the folder on Linux) and answers `opened: true`, or `opened: false` when no file manager could be started. `GET /dev/locate` only answers the path.
- Safety: both answer only requests from this machine (client host `127.0.0.1`, `::1` or `localhost`) while `DEV_REVEAL` is on (setting `dev_reveal`, default `DEV_REVEAL_ENABLED = True` in `backend/app/constants.py`; `DEV_REVEAL=false` in `backend/.env` turns it off); otherwise 403. The Vite dev proxy calls from localhost, so a page served by Vite on another device would pass the host check: switch `DEV_REVEAL` off when the dev server is shared on a network. Ids must be safe ids (export names: letters, digits, `_`, `-` and `.`, no `..`), else 400; a path that resolves outside the data folder, or a file that does not exist, is 404; an unknown kind is 422.
- Mock mode answers `mock://<folder>/<id>.json` with `opened: false` and opens nothing; the UI says "Sample data: no file on disk."
- Glove compare (`/dev/glove-compare` in the frontend): `POST /dev/glove_compare` with `GloveCompareSave` writes `glove_compare/<session>/<index as 2 digits>-<slug>.json` under the data folder (the `data` object as is), plus `<same>.png` when `png` is a `data:image/png;base64,` URL, and answers `GloveCompareSaved` with absolute paths. Same localhost and `DEV_REVEAL` guard as the reveal. Mock mode answers `mock://glove_compare/...` paths and writes nothing.

```ts
interface GloveCompareSave { session: string; index: number; slug: string; data: Record<string, unknown>; png?: string | null }  // session, slug: [A-Za-z0-9_-]{1,64}; index 0..99
interface GloveCompareSaved { json_path: string; png_path: string | null }
```

## WebSocket

`/ws/gloves` streams `GloveFrame` JSON at ~60 Hz from the active source after the smoothing stage. The client may send `{"type": "set_motion", "motion": MotionSpec}` to drive the simulator.

`/ws/ingest` (optional `?activate=1`) accepts text messages of the same shapes as `POST /ingest/frames`, for an external pipeline pushing at 60 Hz. Successes are silent; each failure is answered with `{"type": "error", "status": 409 | 422, "detail": string}` and the socket stays open. Ingested frames pass the normal smoothing and leave `/ws/gloves` with `source: "replay"`.

## LLM providers

`fake` (deterministic templates, offline, default in tests), `gemini` (Gemini Flash via google-genai, structured output with the JSON schema of `Lesson`), `openai` (Gemma on Verda via an OpenAI-compatible endpoint). Every provider's output is validated with the same pydantic model and retried up to 2 times with the validation errors fed back; on final failure the `fake` provider's template is returned and `provider` says so.

`/coach/plan` and `/motion/from_text` use the same providers, validation and retry rules; oversize input is a 422, and `provider` is `fake` when the offline fallback answered.

Fallback chain (additive, docs/MODELS.md): every real provider runs in a chain with a short time cap per call (hint 5 s, `openai` 20 s, others 30 s). `gemini` and `openai` (Gemma on Verda, only when `OPENAI_BASE_URL` is set) back each other up, and `LLM_ROUTES` may send a role to `openai` first. `provider` names the provider that answered. When no model answers, `/coach/hint` returns the one-sentence offline note as `hint` with `provider: "offline"` (focus, cue and severity still come from the measurements), and the other routes return their template with `provider: "fake"` without retrying. The UI shows `provider` only through `ModelLabel`: "AI Assistant" or "AI Assistant offline", with model names only in dev mode (`?dev=1`).

## Smoothing

The glove pipeline applies a One Euro filter (Casiez et al. 2012) per joint angle and normalised-lerp smoothing on the wrist quaternion, with a small deadband to remove the natural micro-tremor. Parameters are live-tunable via `/dev/state`. The frontend additionally interpolates between frames for rendering only.

## Backend notes (clarifications added by the backend implementation)

- `POST /score` scores one hand. `side` (optional) names it; clients should send the step's `hands` when it is `left` or `right`. Without `side` the scorer uses the first side present in the attempt (preferring one the reference also has) and reads the reference for that same side, so a two-handed reference never makes a one-handed attempt fail. A missing side in either recording gives 400.
- Hands: `MoveKind.hands` is the catalogue default, `Step.hands` is what the expert chose for the step (one hand left or right, or two), and `POST /recordings/start` with `hands: 'left'` or `'right'` keeps only that hand's frames (others are dropped as they arrive); the stored `Recording.hands` says which. `both` keeps every hand, as before. The learner app scores a two-handed step with one `POST /score` per side and keeps the weaker hand's result (lower overall, timing and per-finger values; within tolerance only if both are; the hint is prefixed with the hand). The live coach on the stage follows one hand at a time, chosen by the learner.
- `POST /score` with `attempt_frames` scores those frames instead of the stored recording (frames win if both are sent). The backend records the unmodified glove stream, so any client-side change (for example the clumsy apprentice simulation) only reaches the scorer through `attempt_frames`. Frame `t` is rebased by the scorer; start the frames at the beat the reference motion starts on, because a `reference_motion` is synthesised from `t = 0`.
- Scoring metric: per finger, the error is the mean absolute difference of the finger's TOTAL flexion (sum of its 3 joints, in degrees) over the DTW-aligned path, the same quantity the frontend live coach compares with `tolerance.angle_deg`. A finger under-curled 25 degrees in total is therefore off at the default 18 degree tolerance, however the 25 is spread over joints. The error maps to 0..100 with `100 * exp(-0.5 * (err / (1.5 * angle_deg))^2)`; `within_tolerance` needs every finger error and the timing error inside tolerance. Hint degrees are the same total-flexion deviation. Calibration normalises per joint before the sum. Held poses: when the reference is a `hold_pose` or `idle` motion, or its total flexion moves less than 12 degrees peak to peak on every finger (`STATIC_REFERENCE_RANGE_DEG`), there is no beat to be early or late for, so the timing offset is taken as 0: `timing` is 100, `within_tolerance` ignores timing, `overall` keeps the same weights, and the hint never mentions early or late.
- Margin of error: `margin` on `POST /score` and `POST /coach/hint` is the learner's own choice of strictness, on top of the expert's `Step.tolerance`. Its multiplier (`MARGIN_MULTIPLIERS` in `app/constants.py`: strict 0.6, standard 1.0, relaxed 1.5, just_trying 2.5) scales `angle_deg` and `timing_ms` before scoring, so the Gaussian, `within_tolerance` and `overall` all use the widened band, and scales every hint threshold (finger 4 degrees, timing 120 ms, wrist 8 degrees, and the tolerances severity is measured against). `relaxed` and `just_trying` are quiet margins: they also raise each hint threshold to its widened tolerance, so a finger, the timing or the wrist inside the band is never corrected and the hint praises instead. Without `margin` (or with `standard`) every number is exactly as before. `ScoreResult.margin` echoes the margin used. Invalid names are a 422. The WebSocket carries no scoring, so it has no margin; the browser's live corrections apply the same multiplier to the step tolerance on the client.
- Takes model (`POST /recordings/model`, `backend/app/services/takes.py`, mirrored in `frontend/src/mock/takes.ts`): "best take + spread". Every pair of takes is compared with the scorer's own per-finger DTW (`compare`), and a pair's distance is the mean over fingers of the total-flexion error. The medoid take (smallest total distance to the others; the first on a tie) becomes the reference, and each other take is compared against it. A take is an outlier when its distance to the reference is at least 12 degrees (`TAKES_OUTLIER_MIN_DEG`) and more than twice (`TAKES_OUTLIER_FACTOR`) the median distance between the other takes; this needs 3 takes. Each finger's spread is the 75th percentile (`TAKES_SPREAD_PERCENTILE`) of its error against the reference over the non-outlier takes (all takes when every one is an outlier), and its tolerance is spread x 2.5 (`TAKES_TOLERANCE_SCALE`) clamped to 10..36 degrees (`TAKES_TOLERANCE_FLOOR_DEG`, `TAKES_TOLERANCE_CEIL_DEG`), rounded to 0.1: a finger the expert holds steady is judged strictly, a finger that varies gets room. `tolerance.angle_deg` is the median of the five, for anything that reads one number. Two takes are accepted with `enough_takes: false` and a warning. All constants are in `backend/app/constants.py` (`TAKES_*`).
- Per-finger tolerance: with `Tolerance.finger_angle_deg`, `POST /score` scores each finger with its own band (Gaussian and `within_tolerance`), the margin of error multiplies every band, `worst_finger` is the finger with the largest error relative to its own band, and the hint names the finger furthest outside its own band among those past their own threshold. `POST /coach/hint` does the same with `finger_tolerance_deg`. With every band equal to `angle_deg`, or the field absent, every number is exactly as before. The lesson generator never fills `take_ids` or `finger_angle_deg` (they are left out of the schema sent to the model). The core's live score and ghost (`core/`, `/ws`) do not read them.
- `POST /coach/hint`: `deviations` are signed degrees of TOTAL finger flexion per finger (positive = curled more than the reference); `timing_ms` is positive when the learner is late; `wrist_error_deg` is signed about `wrist_axis` (pitch positive = too high, yaw positive = turned too far right, roll positive = rolled clockwise). `hint` is one imperative sentence of at most 14 words naming one finger or the wrist and one direction, for example "Lift your index finger slightly." `cue_type` is `extend` when the finger is curled too much, `curl` when too straight. `provider` is `fake`, `algorithmic` (the model failed, was rejected or nothing needed fixing), `gemini`, `openai`, or `fake (rate limited)` when the Gemini budget was spent. Identical requests within 60 s are served from a cache; pass the previous `hint` as `last_hint` so the wording changes.
- Gemini free tier budget: the backend spends at most about 80 percent of the free RPM and RPD per model (limits in `app/constants.py`), persists the day count in `DATA_DIR/gemini_usage.json`, and when spent answers with the offline fallback and provider `fake (rate limited)` (also on `/lessons/generate`, `/coach/plan`, `/motion/from_text`). Hints use `GEMINI_HINT_MODEL` (default `gemini-3.5-flash-lite`), everything else `GEMINI_MODEL` (default also `gemini-3.5-flash-lite`, 500 requests per day free; both share its budget).
- Calibrated scoring: with `attempt_calibration_id` (or `use_latest_calibration: true`, which uses the latest calibration for the attempt's side), each attempt joint is normalised to 0..1 as `(x - flat) / (fist - flat)`, clipped, then mapped into the reference's angle space using `reference_calibration_id` if given, otherwise the nominal range (flat and fist of the guide hand at curl 0 and 1). The reference is never altered. Joints with a calibrated range under 0.05 rad, or a calibration with an uncaptured phase, are left uncalibrated and a message is added to `ScoreResult.warnings`. Without these fields scoring is unchanged. `reference_calibration_id` has no effect on its own. Unknown ids give 404.
- Step weights (additive): `weights` on `/score` (the step's `Step.weights`) are clipped to 0..1. The finger part of `overall` becomes their weighted mean, a finger with weight 0 never breaks `within_tolerance`, and `worst_finger` and `hint` only name a finger weighted at least 0.3 (`FOCUS_MIN_WEIGHT`; with none that heavy, the heaviest non-zero fingers). With an attempt calibration, joints it cannot read (range under 0.05 rad) leave the finger's total flexion on both sides, and a finger with no readable joint gets weight 0 plus a warning. Without `weights` and with every joint readable, scoring is unchanged.
- `POST /lessons/generate_from_video` stores nothing: the upload goes to a temporary file that is deleted after the call. Gemini uploads the file, waits until it is ACTIVE (60 s), then generates with a 120 s budget; on timeout or repeated invalid output it falls back to the fake template. Gemma on Verda and fake cannot read video.
- Expert media: videos live in `DATA_DIR/media` as `{id}.{webm|mp4|mov}` plus `{id}.json` (`MediaInfo`), limits in `app/constants.py` (`MEDIA_*`). Two kinds per step, both optional. A tutorial video (`Step.tutorial_video`): the expert talking, shown on the learner's Tutorial beside the chalk hand playing the step's reference take at `video time - offset_s` (clamped at 0, the take looping while the video runs on). A take video (`Recording.video`): the webcam filmed during that take, so it is synced by construction; the practice screen plays the reference take's video small beside the stage in lockstep with the ghost. `Step.video_url` stays for older lessons and is read as a tutorial video at offset 0 when `tutorial_video` is absent. The lesson generator never fills `tutorial_video` (left out of the model's schema). Deleting a take or a lesson does not delete its media. In mock mode the clips live in the browser (IndexedDB, falling back to memory) and the player gets an object URL for `/api/media/{id}` (`useMediaSrc` in `frontend/src/api/media.ts`).
- `POST /lessons/generate` returns an unsaved lesson (it has an `id` and `created_at`). `PUT /lessons/{id}` creates the lesson if the id is unknown, so the generated lesson can be saved after editing. `POST /lessons` returns 201.
- Step ids are optional in `POST`/`PUT` bodies (the server assigns them); `Step.tolerance`, `repetitions`, `hands` and `prop` have defaults.
- `/vision/hands` `wrist_pos` and `landmarks` are MediaPipe normalised image coordinates (not metres).
- `POST /calibrations` captures from the live stream for `duration_s`; the phase not yet captured is returned as zeros. The `thumb` phase (added 14 Nov for the demo kiosk, additive) is a flat hand with the thumb folded across the palm: the thumb barely moves between flat and a loose fist, so this pose holds its real range. It is stored as `thumb` (null until captured) and nothing scores with it yet.
- Errors are `{detail: string}` with 404 (missing), 501 (rokoko_sdk stub), 503 (optional dependency or LLM provider missing), 409 (UDP port busy, or ingest while the source is not `external`), 422 (invalid ingested frame).

## Real gloves: status, calibration area, demo mode

Added 14 Nov 2026 at the user's request (additive; nothing above changed). The core (`core/`, SPEC.md) stays the only glove data path: it reads the solver on 12277 and `tools/ingest_bridge.py` pushes its hands into `/ws/ingest`. These routes only watch it: process and port checks, the driver's RCSP device list and events (read-only; `ReinitAlgo` is the one command sent, from the calibration area), and STATUS_FLAGS read from the driver's RGMP (12276) by a diagnostic tap that never produces hands.

```ts
type Connection = 'usb' | 'wifi' | 'emulated' | 'unknown';  // RCSP Serial, UDP, Emulated, Unknown
type GloveIssueCode = 'studio_running' | 'device_busy' | 'driver_not_running' | 'solver_not_running' | 'no_usb_devices'
  | 'glove_missing' | 'not_streaming' | 'no_frames' | 'low_frame_rate' | 'saturation' | 'heading_unreliable';
  // 'saturation' and 'heading_unreliable' are kept in the union for old clients but are no longer raised (14 Nov):
  // the glove compass settles once the wearer moves, so it never shows as an issue or downgrades a calibration.

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
- Neutral pose: hands flat on the table, thumbs together, still. `offsets` are the mean joint flexion (radians, the `/ws/gloves` joints), `yaw_zero_deg` the circular mean wrist heading (rotation about +y of the fingers' -z), `noise_deg` the mean per-joint standard deviation in degrees. Quality grades noise and bias by the bands in `backend/app/constants.py` (`QUALITY_*`); `heading_reliable` is reported but not graded. Smartgloves have no calibrate command over RCSP; `reinit: true` sends the documented `ReinitAlgo` first and waits `REINIT_SETTLE_S`.
- Drift check: mean absolute joint flexion change per hand against the saved offsets, and the wrist heading change; `ok` when every streaming hand is within both thresholds.

## Fingerspelling packs

Added by lane fingerspelling-packs (additive). Letters live in packs, one alphabet per pack. The file is `backend/app/data/fingerspelling_packs.json`, copied verbatim to `frontend/src/mock/data/fingerspelling-packs.json`. The slot kit's step 9 (`pack_letters`, `scripts/slot/slot_letters.py`) writes recorded letters into both.

```ts
type PackLetterStatus = 'recorded' | 'not_recorded';
interface PackReference { label: string; url: string }
interface PackLetter {
  letter: string;              // one upper-case character, e.g. 'A' or 'Ä'
  status: PackLetterStatus;
  recorded_by: string | null;  // the name typed at recording time; "seeded from written sources" for the ASL letters
  reference: string | null;    // the URL or document name the letter was held against
  recorded_at: string | null;  // ISO date or date-time
  move_id: string | null;      // a MoveKind id (the ASL letters: fs_a..fs_z)
  lesson_id: string | null;    // a core lesson id (a letter recorded through the slot kit or the camera)
  pose: Record<Finger, number> | null;  // held curls, 0 straight to 1 closed
}
interface FingerspellingPack {
  id: string;                  // 'asl', 'fi'
  name: string;                // 'ASL fingerspelling alphabet', 'Finnish fingerspelling (sormiaakkoset)'
  language: string;
  description: string;
  default_reference: PackReference;
  sources: PackReference[];
  letters: PackLetter[];
}
```

- A `recorded` letter has `recorded_by`, `reference`, `recorded_at` and at least one of `move_id`, `lesson_id`, `pose`.
- A `not_recorded` letter has all six of those null. It is shown as "not recorded yet" and is never scored. No placeholder pose exists.

## Expert training persistence: drafts, bundles, backups

Everything an expert records lives on disk under the backend's data folder (`backend/data/`, gitignored), so a page reload, a closed tab, a backend restart or a laptop swap (with a bundle file) loses nothing. Mock mode keeps all of this in browser memory only and says so on the scratch screens.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/drafts/scratch` | | `DraftDoc`, the most recently saved scratch draft; 404 when none |
| GET | `/drafts/scratch/{id}` | | `DraftDoc` or 404 |
| PUT | `/drafts/scratch/{id}` | `{schema_version: number, draft: object}` | `DraftDoc` (one file per draft, `data/drafts/<id>.json`; the oldest beyond `DRAFTS_KEEP` (20) are pruned); 413 over `DRAFT_MAX_BYTES` (512 KB), 400 for an unsafe id |
| DELETE | `/drafts/scratch/{id}` | | 204 (also when already gone) |
| GET | `/calibrations/active` | | `{left: Calibration \| null, right: Calibration \| null, wearer: WearerCalibration \| null}`: the newest saved calibration per hand and the newest per-wearer one, read from disk |
| GET | `/lessons/{id}/export` | | `Bundle` (kind `lessons`) as a download, `Content-Disposition: attachment; filename="<lesson-title>.geppetto.json"`; 404 unknown lesson |
| GET | `/export/lessons?ids=a,b&name=` | | `Bundle` of several lessons (one skill), named `name` or the first title; 404 for an unknown id |
| GET | `/export/all` | | `Bundle` (kind `all`): every lesson, take, calibration, per-wearer calibration and draft, with video records listed but no video bytes |
| POST | `/lessons/import?overwrite=false` | `Bundle` (JSON) | `ImportReport`; 422 for a bundle of a newer `format_version` |

```ts
interface DraftDoc {
  id: string;                 // the draft's own id (safe id: letters, digits, _ and -)
  kind: 'scratch';
  schema_version: number;     // the frontend draft's shape version (ScratchDraft.v)
  updated_at: string;         // set by the server on every PUT
  draft: Record<string, unknown>;  // the frontend's draft object, stored as is
}

interface Bundle {
  format: 'geppetto.bundle';
  format_version: number;     // 1; an importer refuses a newer one
  kind: 'lessons' | 'all';
  name: string;               // the skill or lesson name; the file name is its slug + '.geppetto.json'
  exported_at: string;
  lessons: Lesson[];
  recordings: Recording[];    // every take a step names (reference_recording_id and take_ids), with frames
  takes_models: { lesson_id: string; step_id: string; model: TakesModel }[];  // rebuilt from the takes at export; empty for kind 'all'
  calibrations: Calibration[];          // per take and hand, the newest one saved before the take was recorded
  wearer_calibrations: WearerCalibration[];  // those whose range_calibration_ids point at the calibrations above
  media: { info: MediaInfo; data_base64: string | null }[];  // bytes embedded only up to BUNDLE_MEDIA_EMBED_MAX_BYTES (2 MB)
  drafts: DraftDoc[];         // kind 'all' only
  warnings: string[];         // e.g. a take that is referenced but no longer stored
}

interface ImportReport {
  created: ImportItem[];      // new here
  unchanged: ImportItem[];    // already here, identical
  overwritten: ImportItem[];  // only with overwrite=true
  conflicts: ImportItem[];    // a different local copy with the same id was kept (never replaced silently)
  lesson_ids: string[];       // every lesson of the bundle, now available
  warnings: string[];
}
interface ImportItem { kind: 'lesson' | 'recording' | 'calibration' | 'wearer_calibration' | 'media' | 'draft'; id: string; note: string }
```

- Import is idempotent by id: importing the same file twice creates nothing the second time. A local item that differs from the file's copy is a conflict and is kept, since a lesson or take has no edit time to tell which is newer; `overwrite=true` replaces it and lists it under `overwritten`.
- Backups: after every `POST /lessons` and `PUT /lessons/{id}` the lesson's bundle is written (after the response) to `data/exports/<lesson-title-slug>-<UTC time>.geppetto.json`; the newest `EXPORT_BACKUPS_KEEP` (5) per title are kept. A failed backup is logged and never fails the publish.
- Calibrations are files read on every request, so the newest one per hand is in use straight after a restart (`GET /calibrations/active`); the backend logs which one at start-up. The live `/ws/gloves` stream stays raw: calibration is applied when scoring (`use_latest_calibration`) and by the core, which reads the same files at its start and on its `calibrate` command.
