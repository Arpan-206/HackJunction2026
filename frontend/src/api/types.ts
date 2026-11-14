/**
 * Wire types. Mirrors docs/CONTRACT.md exactly; change both (and backend/app/schemas) together.
 * Units: seconds, radians, metres. JSON keys are snake_case.
 */

export type Side = 'left' | 'right';
export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
export type GloveSource = 'simulator' | 'rokoko_udp' | 'rokoko_sdk' | 'external';
export type Skill = 'table_tennis' | 'piano' | 'shadow_puppets' | 'surgical_grips' | 'crochet' | 'general';
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
  repetitions: number;
  tolerance: Tolerance;
  video_url: string | null;
}

export interface TestSpec {
  kind: 'table_tennis_rally' | 'piano_play_along';
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
  provider: string;
  attempts: number;
}

export interface CalibrationRequest {
  side: Side;
  phase: 'flat' | 'fist';
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
};

export interface CoachHintRequest {
  step_id?: string;
  instruction: string;
  deviations: Record<Finger, number>;
  timing_ms: number;
  /** The step's own angle tolerance (before the margin); default 18. */
  tolerance_deg?: number;
  /** The learner's margin of error; omit for standard. */
  margin?: Margin;
}

export interface CoachHintResponse {
  hint: string;
  provider: string;
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
  provider: string;
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
  provider: string;
}

/** Optional fields of POST /api/lessons/generate_from_video next to the video itself. */
export interface GenerateFromVideoOptions {
  prompt?: string;
  skill?: Skill;
}

export interface VisionHandsResponse {
  hands: { side: Side; wrist_pos: [number, number, number] | null; landmarks: [number, number, number][] }[];
}

export type LlmProvider = 'fake' | 'gemini' | 'ollama';

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
}

export type DevStatePatch = Partial<Omit<DevState, 'smoothing'>> & { smoothing?: Partial<SmoothingState> };

/** Client to server WebSocket message on /ws/gloves. */
export interface SetMotionMessage {
  type: 'set_motion';
  motion: MotionSpec;
}

/* ---- Frontend constants derived from the contract ---- */

export const FINGERS: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
