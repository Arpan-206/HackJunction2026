import type { GloveFrame, HandFrame, MotionSpec, Side } from '../../../../api/types';
import { handAt, framesDuration } from '../../../shared/playback';
import { restFrame, synthFrame } from '../../../../three/motion';
import { keysPeriod } from '../../../../mock/synth';
import { flexionDegrees, type FingerValues } from './deviation';

/** Seconds a static hold pose is practised for. */
const HOLD_PERIOD_S = 6;

/** Length in seconds of one cycle of a mock-guide motion. */
export function motionPeriod(spec: MotionSpec | null): number {
  if (!spec) return HOLD_PERIOD_S;
  switch (spec.preset) {
    case 'finger_sequence':
      return Math.max(1, (spec.beat_ms / 1000) * Math.max(1, spec.sequence.length));
    case 'grip_and_swing':
    case 'pinch':
      return Math.max(0.6, spec.beat_ms / 1000);
    case 'keyframes':
      return Math.max(0.6, keysPeriod(spec.keys));
    default:
      return HOLD_PERIOD_S;
  }
}

/** A master reference, either a stored recording or a mock-guide motion, sampled by looping time. */
export interface ReferenceTrack {
  source: 'recording' | 'guide';
  /** Length of one cycle in seconds. */
  period: number;
  side: Side;
  /** Whether the motion has a repeating beat the simulator can be phase-locked to. */
  periodic: boolean;
  /** Reference hand at a time in seconds; wraps around the period. */
  handAt: (t: number) => HandFrame;
  /** Reference total flexion per finger in degrees. */
  flexionAt: (t: number) => FingerValues;
}

function wrap(t: number, period: number): number {
  return ((t % period) + period) % period;
}

/** Builds a track from recording frames. */
export function trackFromFrames(frames: GloveFrame[], side: Side): ReferenceTrack {
  const period = Math.max(0.5, framesDuration(frames));
  const hand = (t: number) => handAt(frames, wrap(t, period), side) ?? restFrame(side);
  return { source: 'recording', period, side, periodic: false, handAt: hand, flexionAt: (t) => flexionDegrees(hand(t)) };
}

/** Builds a track from a mock-guide motion (local preview synthesiser; used for guidance only, never for scoring). */
export function trackFromMotion(spec: MotionSpec | null, side: Side): ReferenceTrack {
  const motion: MotionSpec = spec ?? { preset: 'idle' };
  const period = motionPeriod(motion);
  const hand = (t: number): HandFrame => synthFrame(motion, wrap(t, period), side);
  return { source: 'guide', period, side, periodic: motion.preset !== 'hold_pose' && motion.preset !== 'idle', handAt: hand, flexionAt: (t) => flexionDegrees(hand(t)) };
}
