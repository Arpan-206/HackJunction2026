/**
 * Wire types. Mirrors docs/CONTRACT.md exactly; change both (and backend/app/schemas) together.
 * Units: seconds, radians, metres. JSON keys are snake_case.
 */

export type Side = 'left' | 'right';
export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
export type GloveSource = 'simulator' | 'rokoko_udp' | 'rokoko_sdk' | 'external';
export type Skill = 'table_tennis' | 'piano' | 'finnish_fingerspelling' | 'fingerspelling' | 'shadow_puppets' | 'general';
export type Prop = 'none' | 'racket' | 'keyboard' | 'ball';
/** Which hands a move, step or recording uses: one hand (left or right) or both. */
export type Hands = Side | 'both';

/** Flexion per joint: [MCP, PIP, DIP] for fingers, [CMC, MCP, IP] for the thumb. 0 straight, positive curled. */
export type JointTriple = [number, number, number];

/** One hand at one instant. */
export interface HandFrame {
  side: Side;
  /** x, y, z, w; hand orientation in world space. */
  wrist_quat: [number, number, number, number];
  /** Metres; null unless a webcam (MediaPipe) or Coil Pro gives position. */
  wrist_pos: [number, number, number] | null;
  flexion: Record<Finger, JointTriple>;
  /** Abduction, 0 neutral, positive away from the middle finger. */
  spread?: Record<Finger, number>;
}

/** What the glove stream emits, about 60 Hz. */
export interface GloveFrame {
  /** Seconds since stream start. */
  t: number;
  source: GloveSource | 'replay';
  hands: HandFrame[];
}

/** A parametric motion the simulator (and the LLM) can describe without raw frames. */
export type MotionSpec =
  | { preset: 'finger_sequence'; sequence: (1 | 2 | 3 | 4 | 5)[]; beat_ms: number }
  | { preset: 'grip_and_swing'; grip: 'shakehand' | 'penhold'; swing: 'forehand' | 'backhand'; beat_ms: number }
  | { preset: 'pinch'; fingers: (2 | 3)[]; beat_ms: number }
  | { preset: 'hold_pose'; pose: Record<Finger, number>; left_pose?: Record<Finger, number> | null }
  | { preset: 'keyframes'; keys: Keyframe[]; left_keys?: Keyframe[] | null }
  | { preset: 'idle' };

/**
 * One key of a keyframes motion: curls, reached over the first half of a slot of `ms` and then held. Wrist angles are radians
 * in hand space: positive pitch lifts the fingers, positive roll turns the thumb down (pronation of the right hand).
 */
export interface Keyframe {
  pose: Record<Finger, number>;
  ms: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
}

/** A move the master can pick in "Start from scratch". Catalogue served by GET /api/moves. */
export interface MoveKind {
  id: string;
  skill: Skill;
  name: string;
  description: string;
  hands: Side | 'both';
  prop: Prop;
  default_motion: MotionSpec;
  default_repetitions: number;
}

/** Room for error; defaults 18 deg, 250 ms. */
export interface Tolerance {
  angle_deg: number;
  timing_ms: number;
  /**
   * Per-finger angle tolerance in degrees of total flexion (from POST /api/recordings/model). A finger left out, or the
   * whole field absent or null, uses angle_deg. The margin of error multiplies these too.
   */
  finger_angle_deg?: Partial<Record<Finger, number>> | null;
}

/**
 * The learner's margin of error: multiplies the step's Tolerance and the hint thresholds (strict x0.6, standard x1,
 * relaxed x1.5, just_trying x2.5). Standard is the default and changes nothing. See src/api/margin.ts.
 */
export type Margin = 'strict' | 'standard' | 'relaxed' | 'just_trying';

export interface Step {
  id: string;
  title: string;
  instruction: string;
  move_id: string | null;
  hands: Side | 'both';
  prop: Prop;
  motion: MotionSpec | null;
  reference_recording_id: string | null;
  /** The expert's takes the step's model was built from (POST /api/recordings/model), at most 5; empty or absent for one take. */
  take_ids?: string[];
  repetitions: number;
  tolerance: Tolerance;
  /** Older single video link; read as a tutorial video synced at 0 s when `tutorial_video` is absent (see tutorialVideoOf). */
  video_url: string | null;
  /** How much each finger counts on this step, 0 to 1; null or absent counts every finger fully. */
  weights?: FingerWeights | null;
  /**
   * The expert talking the step through (POST /api/media), with the second at which the reference take starts in it. The
   * learner's Tutorial plays the reference hand in sync with it. Absent or null when there is none.
   */
  tutorial_video?: MediaRef | null;
}

/** A stored video (POST /api/media) attached to a step or a take, with its sync point. */
export interface MediaRef {
  media_id: string;
  /** Where the video is served: /api/media/{media_id} (HTTP range requests supported). */
  url: string;
  /**
   * Seconds into the video at which frame 0 of the take plays (the step's reference take for a tutorial video). Normally
   * about 0 for a take's own webcam; negative when the camera started after the take.
   */
  offset_s: number;
}

/** POST /api/media: a stored video. */
export interface MediaInfo {
  id: string;
  url: string;
  /** Length in seconds as the uploader stated it; null when unknown. */
  duration_s: number | null;
  content_type: 'video/webm' | 'video/mp4' | 'video/quicktime';
  size_bytes: number;
  created_at: string;
}

/** Optional fields of POST /api/media next to the video itself. */
export interface MediaUploadOptions {
  /** Length in seconds, as the browser measured it; stored and returned as is. */
  duration_s?: number;
  /** File name sent with a Blob (a recorded clip has none); the type decides the format, not the name. */
  filename?: string;
}

/** PUT /api/recordings/{id}/video: attach a stored video to a take. */
export interface MediaAttachRequest {
  media_id: string;
  /** Video time at the take's frame 0; default 0. */
  offset_s?: number;
}

/** Per-finger step weights, 0 to 1. A light finger costs less and is never named as the one to fix. */
export type FingerWeights = Record<Finger, number>;

export interface TestSpec {
  kind: 'table_tennis_rally' | 'piano_play_along' | 'air_typing';
  opponent: 'bot' | 'two_player';
  rounds: number;
}

export interface Lesson {
  id: string;
  title: string;
  skill: Skill;
  summary: string;
  master_name: string;
  source: 'scratch' | 'generated' | 'seed';
  steps: Step[];
  test: TestSpec | null;
  /** ISO 8601. */
  created_at: string;
}

export interface Calibration {
  id: string;
  side: Side;
  flat: Record<Finger, JointTriple>;
  fist: Record<Finger, JointTriple>;
  /** Additive (demo kiosk): flat hand, thumb folded across the palm. Null or absent until captured. */
  thumb?: Record<Finger, JointTriple> | null;
  created_at: string;
}

export interface Recording {
  id: string;
  lesson_id: string | null;
  step_id: string | null;
  started_at: string;
  duration_s: number;
  fps: number;
  /** The hands this take captured; a one-handed take stores only that hand's frames. 'both' keeps every hand. */
  hands: Hands;
  /** The webcam filmed during this take (PUT /api/recordings/{id}/video); offset_s is the video time at frame 0. */
  video?: MediaRef | null;
  frames: GloveFrame[];
}

export interface ScoreResult {
  overall: number;
  per_finger: Record<Finger, number>;
  timing: number;
  within_tolerance: boolean;
  worst_finger: Finger;
  hint: string;
  /** Plain notes about the scoring itself, for example an incomplete calibration that was ignored. Empty normally. */
  warnings: string[];
  /** The margin of error the score was judged with. Always sent by the scorer; absent on locally built results (standard). */
  margin?: Margin;
}

/* ---- HTTP request and response bodies (prefix /api) ---- */

export interface HealthResponse {
  status: 'ok';
  glove_source: GloveSource;
  llm_provider: LlmProvider;
}

export type LessonDraft = Omit<Lesson, 'id' | 'created_at'>;

export interface GenerateLessonRequest {
  prompt: string;
  skill?: Skill;
}

export interface GenerateLessonResponse {
  lesson: Lesson;
  provider: ModelProvider;
  attempts: number;
}

/** `thumb` (flat hand, thumb folded) is additive, for the demo kiosk's guest calibration. */
export type CalibrationCapturePhase = 'flat' | 'fist' | 'thumb';

export interface CalibrationRequest {
  side: Side;
  phase: CalibrationCapturePhase;
  duration_s?: number;
}

export interface RecordingStartRequest {
  lesson_id?: string;
  step_id?: string;
  /** Keep only this hand ('left' or 'right'), or every hand ('both', the default). */
  hands?: Hands;
}

export interface RecordingStartResponse {
  recording_id: string;
}

/** GET /api/recordings: a stored take without its frames. */
export type RecordingSummary = Omit<Recording, 'frames'> & { frame_count: number };

/** Query of GET /api/recordings; both filters optional. */
export interface RecordingListQuery {
  step_id?: string;
  lesson_id?: string;
}

/** POST /api/recordings/model: 2 to 5 distinct take ids (3 to 5 recommended). */
export interface TakesModelRequest {
  recording_ids: string[];
  /** The hand to model; omit to use the first hand every take has. */
  side?: Side;
  /** Timing tolerance to put in the returned tolerance; default 250. Not derived from the takes. */
  timing_ms?: number;
}

/** How one take sits against the chosen reference (the medoid take). */
export interface TakeConsistency {
  recording_id: string;
  is_reference: boolean;
  /** Mean over fingers of the DTW total-flexion error against the reference, in degrees; 0 for the reference. */
  distance_deg: number;
  /** 0..100: the take scored as an attempt against the reference with the derived tolerance; 100 for the reference. */
  score: number;
  /** Per-finger DTW total-flexion error against the reference, in degrees. */
  error_deg: Record<Finger, number>;
  /** The finger that strays most; null for the reference. */
  worst_finger: Finger | null;
  /** Far from the other takes: suggest recording it again. Never set with fewer than 3 takes. */
  outlier: boolean;
}

/** The step model built from several takes: best take (the medoid) plus a per-finger tolerance from their spread. */
export interface TakesModel {
  side: Side;
  /** Put this in Step.reference_recording_id. */
  reference_recording_id: string;
  /** The request's ids in order; put them in Step.take_ids. */
  take_ids: string[];
  /** Put this in Step.tolerance: angle_deg is the median of finger_angle_deg, which is always complete here. */
  tolerance: Tolerance & { finger_angle_deg: Record<Finger, number> };
  /** Each finger's robust spread around the reference before scaling and clamping, in degrees. */
  spread_deg: Record<Finger, number>;
  /** One entry per take, in request order. */
  takes: TakeConsistency[];
  /** 0..100: mean score of the non-reference takes. */
  consistency: number;
  steadiest_finger: Finger;
  loosest_finger: Finger;
  /** At least 3 takes, the recommended minimum. */
  enough_takes: boolean;
  /** Plain sentences: too few takes, or which take strays. */
  warnings: string[];
}

export interface MotionPreviewRequest {
  motion: MotionSpec;
  side: Side;
  duration_s: number;
}

export interface MotionPreviewResponse {
  frames: GloveFrame[];
}

export type ScoreRequest = (
  | { reference_recording_id: string; reference_motion?: never }
  | { reference_motion: MotionSpec; reference_recording_id?: never }
) & {
  attempt_recording_id?: string;
  /** Frames to score instead of the stored recording; `t` starts at the reference's first beat. */
  attempt_frames?: GloveFrame[];
  tolerance: Tolerance;
  /** The learner's margin of error; omit for standard. */
  margin?: Margin;
  /** Normalise the attempt with the latest calibration stored for its side. */
  use_latest_calibration?: boolean;
  attempt_calibration_id?: string;
  /** Has no effect on its own; only used together with an attempt calibration. */
  reference_calibration_id?: string;
  /** Which hand to score; omit to let the backend pick. */
  side?: Side;
  /** The step's per-finger weights; omit to count every finger fully. */
  weights?: FingerWeights | null;
};

export interface CoachHintRequest {
  step_id?: string;
  instruction: string;
  deviations: Record<Finger, number>;
  timing_ms: number;
  /** The step's own angle tolerance (before the margin); default 18. */
  tolerance_deg?: number;
  /** The step's per-finger tolerance (Tolerance.finger_angle_deg), before the margin; a finger left out uses tolerance_deg. */
  finger_tolerance_deg?: Partial<Record<Finger, number>> | null;
  /** The learner's margin of error; omit for standard. */
  margin?: Margin;
}

export interface CoachHintResponse {
  /** With provider 'offline' this is the one-sentence offline note. */
  hint: string;
  provider: ModelProvider;
}

export interface CoachPlanRequest {
  lesson_title: string;
  /** At most 20. */
  steps: { step_id: string; title: string }[];
  /** At most 60. */
  attempts: { step_id: string; score: ScoreResult }[];
}

export interface Drill {
  step_id: string;
  focus_finger: Finger | null;
  exercise: string;
}

export interface CoachPlanResponse {
  /** At most 60 words, second person. */
  summary: string;
  /** One to four drills. */
  drills: Drill[];
  /** Where this learner struggles, written for the master. */
  master_note: string;
  provider: ModelProvider;
}

export interface MotionFromTextRequest {
  /** At most 200 characters. */
  text: string;
  side?: Side;
}

export interface MotionFromTextResponse {
  motion: MotionSpec;
  explanation: string;
  /** 'fake' when the keyword rules answered. */
  provider: ModelProvider;
}

/** Optional fields of POST /api/lessons/generate_from_video next to the video itself. */
export interface GenerateFromVideoOptions {
  prompt?: string;
  skill?: Skill;
}

export interface VisionHandsResponse {
  hands: { side: Side; wrist_pos: [number, number, number] | null; landmarks: [number, number, number][] }[];
}

export type LlmProvider = 'fake' | 'gemini' | 'ollama' | 'openai';

/**
 * Who answered a model call (the `provider` field): 'gemini', 'openai' (Gemma on Verda), 'fake' or 'fake (rate limited)'
 * (a template after every model failed), 'offline' (the coach's offline note), 'algorithmic' (the rule-based cue) or
 * 'mock'. Show it with features/shared/ModelLabel, never as raw text in user copy.
 */
export type ModelProvider = 'gemini' | 'openai' | 'ollama' | 'fake' | 'fake (rate limited)' | 'offline' | 'algorithmic' | 'mock' | (string & {});

export interface SmoothingState {
  enabled: boolean;
  min_cutoff: number;
  beta: number;
}

export interface DevState {
  glove_source: GloveSource;
  smoothing: SmoothingState;
  llm_provider: LlmProvider;
  simulator_motion: MotionSpec;
  /** Read-only: the providers the default role tries, in order, and who answered last (a provider name or 'offline'). */
  llm_chain?: string[];
  llm_answered_by?: string | null;
}

export type DevStatePatch = Partial<Omit<DevState, 'smoothing'>> & { smoothing?: Partial<SmoothingState> };

/* ---- Real gloves: status, calibration area, demo mode (docs/CONTRACT.md "Real gloves") ---- */

export type GloveConnection = 'usb' | 'wifi' | 'emulated' | 'unknown';
export type GloveIssueCode =
  | 'studio_running'
  | 'device_busy'
  | 'driver_not_running'
  | 'solver_not_running'
  | 'no_usb_devices'
  | 'glove_missing'
  | 'not_streaming'
  | 'no_frames'
  | 'low_frame_rate'
  | 'saturation'
  | 'heading_unreliable';
export type GloveSensorName = 'thumb' | 'index' | 'middle' | 'ring' | 'little' | 'arm' | 'hub';

export interface GloveSensorStatus {
  name: GloveSensorName;
  /** Saturated parts in plain words, for example "gyroscope"; empty when the sensor reads normally. */
  saturated: string[];
}

export interface GloveDeviceStatus {
  side: Side;
  connected: boolean;
  device_id: number | null;
  connection: GloveConnection | null;
  /** Frames per second of this hand reaching the app; null on the simulator. */
  fps: number | null;
  /** The driver's rate for this glove (about 83 for Smartgloves). */
  driver_fps: number | null;
  /** False when the driver sent this glove's definition but no data: nobody subscribed, not a glove fault. */
  streaming: boolean | null;
  last_frame_age_ms: number | null;
  /** Null when the driver reports no battery level: show "battery: unknown". */
  battery_pct: number | null;
  heading_reliable: boolean | null;
  sensors: GloveSensorStatus[];
}

export interface GloveDriverState {
  driver_running: boolean;
  driver_port_open: boolean;
  solver_running: boolean;
  solver_port_open: boolean;
  rcsp_connected: boolean;
  studio_running: boolean;
  /** This backend started the solver and stops it on shutdown. */
  managed: boolean;
  autostart: boolean;
  sdk_found: boolean;
  last_error: string | null;
}

export interface GloveIssue {
  code: GloveIssueCode;
  side: Side | null;
  /** Blocking issues stop the gloves; the rest are warnings. */
  blocking: boolean;
  title: string;
  /** The fix step, plain words; commands are in backticks. */
  fix: string;
}

export interface GloveRigStatus {
  checked_at: string;
  source: GloveSource;
  ready: boolean;
  driver: GloveDriverState;
  /** Always [left, right]. */
  gloves: GloveDeviceStatus[];
  /** Most important first. */
  issues: GloveIssue[];
}

export interface DriverActionRequest {
  action: 'start' | 'stop';
}

export interface ReinitResult {
  devices: number;
}

export interface NeutralHand {
  side: Side;
  /** Mean joint flexion (radians) with the hands flat. */
  offsets: Record<Finger, JointTriple>;
  yaw_zero_deg: number;
  noise_deg: number;
  yaw_spread_deg: number;
  frames: number;
}

export type QualityGrade = 'good' | 'fair' | 'poor';

export interface CalibrationQuality {
  noise_deg: number | null;
  bias_deg: number | null;
  /** Share 0..1 of the capture with a reliable heading; null when unknown. */
  heading_reliable: number | null;
  grade: QualityGrade;
  notes: string[];
}

export interface WearerCalibration {
  id: string;
  wearer: string;
  created_at: string;
  neutral: NeutralHand[];
  range_calibration_ids: Partial<Record<Side, string>>;
  quality: CalibrationQuality;
  reinit: boolean;
  verified: boolean;
}

export interface NeutralCaptureRequest {
  wearer: string;
  duration_s?: number;
  reinit?: boolean;
}

export interface CalibrationFinishRequest {
  range_calibration_ids?: Partial<Record<Side, string>>;
  verified?: boolean;
}

export interface DriftCheckRequest {
  wearer: string;
  duration_s?: number;
}

export interface DriftHand {
  side: Side;
  flex_drift_deg: number;
  yaw_drift_deg: number;
}

export interface DriftCheckResult {
  ok: boolean;
  calibration_id: string;
  hands: DriftHand[];
  max_flex_deg: number;
  max_yaw_deg: number;
  message: string;
}

/** Client to server WebSocket message on /ws/gloves. */
export interface SetMotionMessage {
  type: 'set_motion';
  motion: MotionSpec;
}

/* ---- Frontend constants derived from the contract ---- */

export const FINGERS: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'] as const;

/* ---- Expert training persistence: drafts on disk, bundle files (docs/CONTRACT.md, "Expert training persistence") ---- */

export type DraftKind = 'scratch';

/** A draft stored by the backend (GET/PUT/DELETE /drafts/scratch[/id]), one file each under data/drafts. */
export interface DraftDoc<T = Record<string, unknown>> {
  id: string;
  kind: DraftKind;
  /** The draft object's shape version (ScratchDraft.v). */
  schema_version: number;
  /** Set by the server on every save. */
  updated_at: string;
  draft: T;
}

/** GET /calibrations/active: the newest saved calibration per hand, read from disk. */
export interface ActiveCalibration {
  left: Calibration | null;
  right: Calibration | null;
  wearer: WearerCalibration | null;
}

export const BUNDLE_FORMAT = 'geppetto.bundle';
export const BUNDLE_FORMAT_VERSION = 1;
export const BUNDLE_FILE_SUFFIX = '.geppetto.json';

/** A `.geppetto.json` file: lessons with every take, takes model, calibration and video they use. */
export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  format_version: number;
  kind: 'lessons' | 'all';
  name: string;
  exported_at: string;
  lessons: Lesson[];
  recordings: Recording[];
  takes_models: { lesson_id: string; step_id: string; model: TakesModel }[];
  calibrations: Calibration[];
  wearer_calibrations: WearerCalibration[];
  media: { info: MediaInfo; data_base64: string | null }[];
  drafts: DraftDoc[];
  warnings: string[];
}

export type ImportItemKind = 'lesson' | 'recording' | 'calibration' | 'wearer_calibration' | 'media' | 'draft';

export interface ImportItem {
  kind: ImportItemKind;
  id: string;
  note: string;
}

/** POST /lessons/import: what was added, what was there already, and what differs here (kept, not overwritten). */
export interface ImportReport {
  created: ImportItem[];
  unchanged: ImportItem[];
  overwritten: ImportItem[];
  conflicts: ImportItem[];
  lesson_ids: string[];
  warnings: string[];
}
