import type { Finger, GloveFrame, Side, TakeConsistency, TakesModel } from '../api/types';
import { compare, resample, ScoringError, toResult, type Comparison, type Series } from './scoring';
import { FINGER_NAMES } from './synth';

/**
 * Port of backend/app/services/takes.py: several expert takes into one step model ("best take + spread"). The medoid take
 * (smallest total per-finger DTW distance to the others) is the reference; each finger's tolerance is its robust spread
 * around the medoid, scaled and clamped. Keep the constants in step with backend/app/constants.py (TAKES_*).
 */

export const TAKES_HARD_MIN = 2;
export const TAKES_MIN = 3;
export const TAKES_MAX = 5;
export const TAKES_SPREAD_PERCENTILE = 75;
export const TAKES_TOLERANCE_SCALE = 2.5;
export const TAKES_TOLERANCE_FLOOR_DEG = 10;
export const TAKES_TOLERANCE_CEIL_DEG = 36;
export const TAKES_OUTLIER_FACTOR = 2;
export const TAKES_OUTLIER_MIN_DEG = 12;
const DEFAULT_TIMING_MS = 250;

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** numpy.percentile with linear interpolation. */
function percentile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const median = (xs: number[]): number => percentile(xs, 50);

/** One number for how far two takes are apart: the mean over fingers of the DTW total-flexion error, in degrees. */
export function distance(cmp: Comparison): number {
  return mean(FINGER_NAMES.map((f) => cmp.errorDeg[f]));
}

/** Map one finger's spread around the reference to its tolerance: scaled, then clamped to the floor and ceiling. */
export function toleranceFromSpread(spreadDeg: number): number {
  return Math.min(TAKES_TOLERANCE_CEIL_DEG, Math.max(TAKES_TOLERANCE_FLOOR_DEG, spreadDeg * TAKES_TOLERANCE_SCALE));
}

/** The hand to model: the requested one, else the first hand of the first take that every take has. */
export function commonSide(takes: GloveFrame[][], wanted?: Side | null): Side {
  const present = takes.map((frames) => new Set(frames.flatMap((f) => f.hands.map((h) => h.side))));
  if (wanted) {
    if (present.every((p) => p.has(wanted))) return wanted;
    throw new ScoringError(`not every take has a ${wanted} hand`);
  }
  for (const frame of takes[0]) for (const hand of frame.hands) if (present.every((p) => p.has(hand.side))) return hand.side;
  throw new ScoringError('the takes share no hand');
}

function outliers(pairDist: number[][], toReference: Map<number, number>, medoid: number): Set<number> {
  const n = pairDist.length;
  const flagged = new Set<number>();
  if (n < TAKES_MIN) return flagged;
  for (const [k, d] of toReference) {
    const others: number[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (i !== k && j !== k) others.push(pairDist[i][j]);
    if (k !== medoid && d >= TAKES_OUTLIER_MIN_DEG && d > TAKES_OUTLIER_FACTOR * median(others)) flagged.add(k);
  }
  return flagged;
}

const byFinger = (fn: (f: Finger) => number): Record<Finger, number> =>
  Object.fromEntries(FINGER_NAMES.map((f) => [f, fn(f)])) as Record<Finger, number>;

/** Build the model from resampled takes (each (T, 5, 3), as resample returns), in request order (takes.build_model). */
export function buildModel(series: Series[], ids: string[], side: Side, timingMs = DEFAULT_TIMING_MS): TakesModel {
  const n = series.length;
  const pairDist = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = distance(compare(series[i], series[j]));
      pairDist[i][j] = d;
      pairDist[j][i] = d;
    }
  const totals = pairDist.map((row) => row.reduce((s, x) => s + x, 0));
  let medoid = 0;
  for (let i = 1; i < n; i++) if (totals[i] < totals[medoid]) medoid = i;
  const against = new Map<number, Comparison>();
  for (let k = 0; k < n; k++) if (k !== medoid) against.set(k, compare(series[medoid], series[k]));
  const toReference = new Map<number, number>([...against].map(([k, cmp]) => [k, distance(cmp)]));
  const flagged = outliers(pairDist, toReference, medoid);
  // The spread ignores outliers while a steady take remains, so one stray take cannot loosen the whole model.
  let steady = [...against.keys()].filter((k) => !flagged.has(k));
  if (!steady.length) steady = [...against.keys()];
  const spread = byFinger((f) => percentile(steady.map((k) => (against.get(k) as Comparison).errorDeg[f]), TAKES_SPREAD_PERCENTILE));
  const fingers = byFinger((f) => round1(toleranceFromSpread(spread[f])));
  const tolerance = { angle_deg: round1(median(Object.values(fingers))), timing_ms: timingMs, finger_angle_deg: fingers };
  const takes: TakeConsistency[] = ids.map((id, k) => {
    if (k === medoid) {
      return { recording_id: id, is_reference: true, distance_deg: 0, score: 100, error_deg: byFinger(() => 0), worst_finger: null, outlier: false };
    }
    const cmp = against.get(k) as Comparison;
    let worst: Finger = 'thumb';
    for (const f of FINGER_NAMES) if (cmp.errorDeg[f] > cmp.errorDeg[worst]) worst = f;
    return {
      recording_id: id,
      is_reference: false,
      distance_deg: round1(toReference.get(k) as number),
      score: toResult(cmp, tolerance).overall,
      error_deg: byFinger((f) => round1(cmp.errorDeg[f])),
      worst_finger: worst,
      outlier: flagged.has(k),
    };
  });
  const warnings: string[] = [];
  if (n < TAKES_MIN) warnings.push(`Only ${n} takes: record ${TAKES_MIN} to ${TAKES_MAX} so one uneven take cannot set the reference.`);
  for (const k of [...flagged].sort((a, b) => a - b)) {
    warnings.push(`Take ${k + 1} strays from the others, mostly on the ${takes[k].worst_finger}. Record it again or leave it out.`);
  }
  let steadiest: Finger = 'thumb';
  let loosest: Finger = 'thumb';
  for (const f of FINGER_NAMES) {
    if (spread[f] < spread[steadiest]) steadiest = f;
    if (spread[f] > spread[loosest]) loosest = f;
  }
  return {
    side,
    reference_recording_id: ids[medoid],
    take_ids: [...ids],
    tolerance,
    spread_deg: byFinger((f) => round1(spread[f])),
    takes,
    consistency: round1(mean(takes.filter((t) => !t.is_reference).map((t) => t.score))),
    steadiest_finger: steadiest,
    loosest_finger: loosest,
    enough_takes: n >= TAKES_MIN,
    warnings,
  };
}

/** Builds the model straight from stored frames (the mock router's POST /recordings/model). */
export function modelFromFrames(takes: GloveFrame[][], ids: string[], side?: Side | null, timingMs = DEFAULT_TIMING_MS): TakesModel {
  const chosen = commonSide(takes, side);
  return buildModel(
    takes.map((frames) => resample(frames, chosen)),
    ids,
    chosen,
    timingMs,
  );
}
