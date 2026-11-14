import { FINGERS, type Finger } from '../../../../api/types';
import { bandFor, type FingerValues, type ToleranceBand } from './deviation';

export const FINGER_LABEL: Record<Finger, string> = {
  thumb: 'Thumb',
  index: 'Index finger',
  middle: 'Middle finger',
  ring: 'Ring finger',
  little: 'Little finger',
};

export const FINGER_NUMBER: Record<Finger, number> = { thumb: 1, index: 2, middle: 3, ring: 4, little: 5 };

/**
 * The finger furthest outside its tolerance, or null when all are inside. With a band per finger the furthest is measured
 * against each finger's own band (deviation over band), as the scorer picks its worst finger; with one band for every
 * finger that is simply the largest deviation. Light fingers (step weights) are never named.
 */
export function worstFinger(
  deviation: FingerValues,
  tolerance: ToleranceBand,
  light: readonly Finger[] = [],
): { finger: Finger; deviationDeg: number } | null {
  let best: Finger | null = null;
  let ratio = 1;
  for (const f of FINGERS) {
    if (light.includes(f)) continue;
    const r = Math.abs(deviation[f]) / bandFor(tolerance, f);
    if (r > ratio) {
      ratio = r;
      best = f;
    }
  }
  return best ? { finger: best, deviationDeg: deviation[best] } : null;
}

/** Plain-language tip for one finger; a positive deviation means curled more than the expert. */
export function fingerTip(finger: Finger, deviationDeg: number, tolerance: ToleranceBand): string {
  const lots = Math.abs(deviationDeg) > bandFor(tolerance, finger) * 2.2;
  const action = deviationDeg > 0 ? (lots ? 'open it out much more' : 'uncurl a little') : lots ? 'curl it much more' : 'curl a little more';
  return `${FINGER_LABEL[finger]}: ${action}`;
}

/** The coaching tip for the worst finger, a timing tip when only timing is off, or null when all is well. */
export function algorithmicTip(
  deviation: FingerValues,
  tolerance: ToleranceBand,
  lagMs: number,
  timingMs: number,
  light: readonly Finger[] = [],
): string | null {
  const w = worstFinger(deviation, tolerance, light);
  if (w) return fingerTip(w.finger, w.deviationDeg, tolerance);
  if (Math.abs(lagMs) > timingMs) return lagMs > 0 ? 'Good shape. Start a touch sooner to stay with the expert.' : 'Good shape. Wait for the expert a touch longer.';
  return null;
}
