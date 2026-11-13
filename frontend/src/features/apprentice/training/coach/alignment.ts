import { FINGERS } from '../../../../api/types';
import { zeroValues, type FingerValues } from './deviation';

export interface AlignedDeviation {
  /** Signed deviation in degrees (positive: learner curled more than the reference) at the best alignment. */
  deviation: FingerValues;
  /** Lateness in milliseconds per finger (positive: the learner is behind the reference). */
  lagMs: FingerValues;
}

/**
 * Compares the learner with the reference at the best moment within plus or minus `windowS` seconds of `t`, per finger,
 * so a learner who is slightly early or late is not punished. Ties prefer the smallest shift.
 * `refAt` returns reference flexion in degrees at a time, or null when unavailable.
 */
export function alignedDeviation(
  learner: FingerValues,
  refAt: (t: number) => FingerValues | null,
  t: number,
  windowS: number,
  samples = 9,
): AlignedDeviation | null {
  const deviation = zeroValues();
  const lagMs = zeroValues();
  const n = Math.max(1, samples);
  const cache: (FingerValues | null)[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : -windowS + (2 * windowS * i) / (n - 1);
    offsets.push(off);
    cache.push(refAt(t + off));
  }
  if (cache.every((c) => c === null)) return null;
  for (const f of FINGERS) {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const ref = cache[i];
      if (!ref) continue;
      const d = learner[f] - ref[f];
      const cost = Math.abs(d) + Math.abs(offsets[i]) * 1e-3;
      if (cost < best) {
        best = cost;
        deviation[f] = d;
        lagMs[f] = -offsets[i] * 1000;
      }
    }
  }
  return { deviation, lagMs };
}

/** Mean lateness in milliseconds across the fingers that are being moved, as one timing figure. */
export function meanLagMs(lagMs: FingerValues): number {
  let sum = 0;
  let count = 0;
  for (const f of FINGERS) {
    if (lagMs[f] !== 0) {
      sum += lagMs[f];
      count += 1;
    }
  }
  return count ? sum / count : 0;
}
