import { FINGERS, type Finger } from '../../../../api/types';
import type { FingerValues } from './deviation';

export const FINGER_LABEL: Record<Finger, string> = {
  thumb: 'Thumb',
  index: 'Index finger',
  middle: 'Middle finger',
  ring: 'Ring finger',
  little: 'Little finger',
};

export const FINGER_NUMBER: Record<Finger, number> = { thumb: 1, index: 2, middle: 3, ring: 4, little: 5 };

/** The finger furthest outside the tolerance, or null when all are inside. */
export function worstFinger(deviation: FingerValues, toleranceDeg: number): { finger: Finger; deviationDeg: number } | null {
  let best: Finger | null = null;
  let mag = toleranceDeg;
  for (const f of FINGERS) {
    const m = Math.abs(deviation[f]);
    if (m > mag) {
      mag = m;
      best = f;
    }
  }
  return best ? { finger: best, deviationDeg: deviation[best] } : null;
}

/** Plain-language tip for one finger; a positive deviation means curled more than the master. */
export function fingerTip(finger: Finger, deviationDeg: number, toleranceDeg: number): string {
  const lots = Math.abs(deviationDeg) > toleranceDeg * 2.2;
  const action = deviationDeg > 0 ? (lots ? 'open it out much more' : 'uncurl a little') : lots ? 'curl it much more' : 'curl a little more';
  return `${FINGER_LABEL[finger]}: ${action}`;
}

/** The coaching tip for the worst finger, a timing tip when only timing is off, or null when all is well. */
export function algorithmicTip(deviation: FingerValues, toleranceDeg: number, lagMs: number, timingMs: number): string | null {
  const w = worstFinger(deviation, toleranceDeg);
  if (w) return fingerTip(w.finger, w.deviationDeg, toleranceDeg);
  if (Math.abs(lagMs) > timingMs) return lagMs > 0 ? 'Good shape. Start a touch sooner to stay with the master.' : 'Good shape. Wait for the master a touch longer.';
  return null;
}
