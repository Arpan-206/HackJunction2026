import { lerpHand } from '../../shared/playback';
import { restFrame } from '../../../three/motion';
import type { ReferenceTrack } from '../training/coach/reference';

/** Samples taken across one take to judge whether it moves. */
const SAMPLES = 24;
/** Below this range in every finger (degrees of total flexion) a take counts as still. */
const STILL_FLEX_DEG = 4;
/** Below this turn of the wrist (degrees) a take counts as still. */
const STILL_WRIST_DEG = 3;
/** Share of the loop spent forming the shape from a relaxed hand, and where it starts letting go again. */
const FORM_END = 0.35;
const RELEASE_START = 0.85;

const smooth = (k: number) => k * k * (3 - 2 * k);

/** True when a take barely moves over its whole period: a held shape such as a grip or a letter. */
export function isStillTrack(track: ReferenceTrack): boolean {
  const lo: Record<string, number> = {};
  const hi: Record<string, number> = {};
  const q0 = track.handAt(0).wrist_quat;
  let wrist = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (track.period * i) / SAMPLES;
    const flex = track.flexionAt(t);
    for (const [f, v] of Object.entries(flex)) {
      lo[f] = Math.min(lo[f] ?? v, v);
      hi[f] = Math.max(hi[f] ?? v, v);
    }
    const q = track.handAt(t).wrist_quat;
    const dot = Math.min(1, Math.abs(q[0] * q0[0] + q[1] * q0[1] + q[2] * q0[2] + q[3] * q0[3]));
    wrist = Math.max(wrist, (2 * Math.acos(dot) * 180) / Math.PI);
  }
  return wrist < STILL_WRIST_DEG && Object.keys(lo).every((f) => hi[f] - lo[f] < STILL_FLEX_DEG);
}

/** How far into the shape the hand is at `t`: 0 relaxed, 1 the expert's shape. Forms, holds, then lets go before the loop restarts. */
export function formingAmount(t: number, period: number): number {
  if (period <= 0) return 1;
  const p = (((t % period) + period) % period) / period;
  if (p < FORM_END) return smooth(p / FORM_END);
  if (p < RELEASE_START) return 1;
  return smooth(1 - (p - RELEASE_START) / (1 - RELEASE_START));
}

/**
 * The take the tutorial plays. A held shape (a grip, a letter, a hand position) would otherwise sit still for the whole
 * loop, so the learner could not see which fingers close, or tell the tutorial from a frozen screen: the hand forms the
 * shape from relaxed, holds it, and lets go. A take that moves plays as recorded. Scoring and practice never use this.
 */
export function tutorialTrack(track: ReferenceTrack): ReferenceTrack {
  if (!isStillTrack(track)) return track;
  const rest = restFrame(track.side);
  const handAt = (t: number) => lerpHand(rest, track.handAt(t), formingAmount(t, track.period));
  return { ...track, handAt };
}
