import type { MotionSpec, MoveKind, Prop, Side, Skill, Step, Tolerance } from '../../api';

export const SKILLS: { id: Skill; label: string }[] = [
  { id: 'table_tennis', label: 'Table Tennis' },
  { id: 'piano', label: 'Piano' },
  { id: 'general', label: 'General' },
];

export const skillLabel = (s: Skill): string => SKILLS.find((k) => k.id === s)?.label ?? s;

export const DEFAULT_TOLERANCE: Tolerance = { angle_deg: 18, timing_ms: 250 };

/** Seconds a calibration phase captures for. */
export const CALIBRATION_SECONDS = 2;

/** Used when the backend is offline so the studio still shows previews. */
export const LOCAL_MOVES: MoveKind[] = [
  { id: 'tt_shakehand_grip', skill: 'table_tennis', name: 'Shakehand grip', description: 'Hold the racket like a handshake.', hands: 'right', prop: 'racket', default_repetitions: 3, default_motion: { preset: 'hold_pose', pose: { thumb: 0.62, index: 0.8, middle: 0.84, ring: 0.86, little: 0.88 } } },
  { id: 'tt_forehand_swing', skill: 'table_tennis', name: 'Forehand swing', description: 'Backswing, drive through the ball and follow through.', hands: 'right', prop: 'racket', default_repetitions: 5, default_motion: { preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: 1500 } },
  { id: 'tt_backhand_swing', skill: 'table_tennis', name: 'Backhand swing', description: 'Push through the ball with a compact stroke.', hands: 'right', prop: 'racket', default_repetitions: 5, default_motion: { preset: 'grip_and_swing', grip: 'shakehand', swing: 'backhand', beat_ms: 1500 } },
  { id: 'piano_five_finger_scale', skill: 'piano', name: 'Five-finger scale', description: 'Press each finger in turn, thumb to little finger.', hands: 'right', prop: 'keyboard', default_repetitions: 4, default_motion: { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 620 } },
  { id: 'general_pinch', skill: 'general', name: 'Pinch', description: 'Bring thumb and index finger together.', hands: 'right', prop: 'none', default_repetitions: 4, default_motion: { preset: 'pinch', fingers: [2], beat_ms: 900 } },
];

/** Stable id for a move the master invents ("Free move"). */
export function freeMoveId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `free_${slug || 'move'}`;
}

export function newStepId(): string {
  return `s_${Math.random().toString(36).slice(2, 10)}`;
}

/** A blank step for "Add step". */
export function blankStep(): Step {
  return {
    id: newStepId(),
    title: 'New step',
    instruction: '',
    move_id: null,
    hands: 'right',
    prop: 'none',
    motion: { preset: 'idle' },
    reference_recording_id: null,
    repetitions: 3,
    tolerance: { ...DEFAULT_TOLERANCE },
    video_url: null,
  };
}

export function formatDuration(s: number): string {
  return `${s.toFixed(1)} s`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function motionLabel(m: MotionSpec | null): string {
  if (!m) return 'No guide';
  switch (m.preset) {
    case 'finger_sequence':
      return 'Finger sequence';
    case 'grip_and_swing':
      return `${m.swing} swing`;
    case 'pinch':
      return 'Pinch';
    case 'hold_pose':
      return 'Held pose';
    default:
      return 'Rest';
  }
}

/** What the master is currently recording: a catalogue move or a free-form one. */
export interface MoveChoice {
  /** Slot key for takes: the catalogue move id, or a free_* id. */
  id: string;
  moveId: string | null;
  name: string;
  description: string;
  skill: Skill;
  hands: Side | 'both';
  prop: Prop;
  motion: MotionSpec | null;
  repetitions: number;
}

export function choiceFromMove(m: MoveKind): MoveChoice {
  return {
    id: m.id,
    moveId: m.id,
    name: m.name,
    description: m.description,
    skill: m.skill,
    hands: m.hands,
    prop: m.prop,
    motion: m.default_motion,
    repetitions: m.default_repetitions,
  };
}

export function freeChoice(name: string, skill: Skill): MoveChoice {
  const label = name.trim() || 'Free move';
  return { id: freeMoveId(label), moveId: null, name: label, description: 'A movement of your own, recorded as you perform it.', skill, hands: 'right', prop: 'none', motion: null, repetitions: 3 };
}

/** The side a step's guide or live hand should use. */
export const primarySide = (hands: Side | 'both'): Side => (hands === 'left' ? 'left' : 'right');

export function stepFromChoice(c: MoveChoice, referenceId: string | null): Step {
  return {
    id: newStepId(),
    title: c.name,
    instruction: c.description,
    move_id: c.moveId,
    hands: c.hands,
    prop: c.prop,
    motion: c.motion,
    reference_recording_id: referenceId,
    repetitions: c.repetitions,
    tolerance: { ...DEFAULT_TOLERANCE },
    video_url: null,
  };
}
