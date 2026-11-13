/**
 * Wire types. Mirrors docs/CONTRACT.md exactly; change both (and backend/app/schemas) together.
 * Units: seconds, radians, metres. JSON keys are snake_case.
 */

export type Side = 'left' | 'right';
export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
export type GloveSource = 'simulator' | 'rokoko_udp' | 'rokoko_sdk';
export type Skill = 'table_tennis' | 'piano' | 'general';
export type Prop = 'none' | 'racket' | 'keyboard' | 'ball';

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
  | { preset: 'hold_pose'; pose: Record<Finger, number> }
  | { preset: 'idle' };

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
  frames: GloveFrame[];
}

export interface ScoreResult {
  overall: number;
  per_finger: Record<Finger, number>;
  timing: number;
  within_tolerance: boolean;
  worst_finger: Finger;
  hint: string;
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
  attempt_recording_id: string;
  tolerance: Tolerance;
};

export interface CoachHintRequest {
  step_id?: string;
  instruction: string;
  deviations: Record<Finger, number>;
  timing_ms: number;
}

export interface CoachHintResponse {
  hint: string;
  provider: string;
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
