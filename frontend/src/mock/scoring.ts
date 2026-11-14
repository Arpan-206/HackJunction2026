import type { Calibration, Finger, GloveFrame, JointTriple, Margin, ScoreResult, Side, Tolerance } from '../api/types';
import { DEFAULT_MARGIN, MARGIN_MULTIPLIERS, MARGIN_QUIET } from '../api/margin';
import { FINGER_NAMES } from './synth';

/**
 * Pure TypeScript port of backend/app/services/scoring.py and hints.py: per-finger DTW with a Sakoe-Chiba band,
 * error on TOTAL finger flexion, Gaussian mapping to 0..100, timing scored separately. Keep the constants in step
 * with backend/app/constants.py.
 */

export const SCORE_FPS = 30;
export const DTW_WINDOW_FRACTION = 0.25;
export const DTW_MIN_WINDOW = 5;
export const MAX_FLEXION_RAD = 2.2;
export const SCORE_SIGMA_FACTOR = 1.5;
export const FINGER_WEIGHT = 0.8;
export const TIMING_WEIGHT = 0.2;
export const MIN_SCORE_FRAMES = 2;
export const HINT_MIN_DEVIATION_DEG = 4;
export const HINT_TIMING_MS = 120;
export const HINT_WRIST_MIN_DEG = 8;
export const HINT_WRIST_TOLERANCE_DEG = 15;
export const DEFAULT_TOLERANCE_ANGLE_DEG = 18;
export const DEFAULT_TOLERANCE_TIMING_MS = 250;
export const CALIBRATION_MIN_RANGE_RAD = 0.05;
/** A reference whose every finger moves less than this total flexion (peak to peak) is a held pose: timing is not scored. */
export const STATIC_REFERENCE_RANGE_DEG = 12;
/** Motion presets that are held poses by definition. */
export const STATIC_PRESETS = ['hold_pose', 'idle'];
/** Per-finger step weights: the worst finger and the hint only name a finger weighted at least this. */
export const FOCUS_MIN_WEIGHT = 0.3;
export const TAKE_CONSISTENT_DEG = 12;
export const TAKE_INCONSISTENT_DEG = 45;
export const TAKE_INCONSISTENT_FLOOR = 0.2;

const RELAXED_FLEXION = [
  [0.1, 0.18, 0.15],
  [0.28, 0.38, 0.24],
  [0.28, 0.38, 0.24],
  [0.28, 0.38, 0.24],
  [0.3, 0.4, 0.26],
];
const FULL_FLEXION = [
  [0.75, 0.75, 0.55],
  [1.15, 1.3, 0.85],
  [1.15, 1.3, 0.85],
  [1.15, 1.3, 0.85],
  [1.15, 1.3, 0.85],
];
const THUMB_FLEXION_SCALE = 0.8;

/** Raised for requests the scorer cannot satisfy; the router turns it into an HTTP 400. */
export class ScoringError extends Error {}

/** A resampled hand: `frames[i][finger][joint]` on a regular grid. */
export type Series = number[][][];

export interface Comparison {
  errorDeg: Record<Finger, number>;
  deviationDeg: Record<Finger, number>;
  timingAbsMs: number;
  timingSignedMs: number;
}

/** Linear interpolation of ys over strictly ascending xs, clamped at the ends (numpy.interp). */
function interp(grid: number[], xs: number[], ys: number[]): number[] {
  const out: number[] = new Array(grid.length);
  let k = 0;
  for (let g = 0; g < grid.length; g++) {
    const x = grid[g];
    if (x <= xs[0]) {
      out[g] = ys[0];
      continue;
    }
    if (x >= xs[xs.length - 1]) {
      out[g] = ys[ys.length - 1];
      continue;
    }
    while (k < xs.length - 2 && xs[k + 1] <= x) k++;
    const span = xs[k + 1] - xs[k];
    out[g] = span === 0 ? ys[k + 1] : ys[k] + ((ys[k + 1] - ys[k]) * (x - xs[k])) / span;
  }
  return out;
}

/** Returns one hand's flexion as (T, 5, 3) on a regular time grid. */
export function resample(frames: GloveFrame[], side: Side, fps = SCORE_FPS): Series {
  const pairs = frames
    .map((f) => ({ t: f.t, hand: f.hands.find((h) => h.side === side) }))
    .filter((p): p is { t: number; hand: NonNullable<typeof p.hand> } => p.hand !== undefined);
  if (pairs.length < MIN_SCORE_FRAMES) throw new ScoringError(`need at least ${MIN_SCORE_FRAMES} frames with a ${side} hand to score`);
  const times = pairs.map((p) => p.t);
  const first = times[0];
  const last = times[times.length - 1];
  const grid: number[] = [];
  for (let i = 0; first + i / fps <= last + 1e-9; i++) grid.push(first + i / fps);
  const cols: number[][] = [];
  FINGER_NAMES.forEach((name) => {
    for (let j = 0; j < 3; j++) cols.push(interp(grid, times, pairs.map((p) => p.hand.flexion[name][j])));
  });
  return grid.map((_, g) => FINGER_NAMES.map((_n, fi) => [cols[fi * 3][g], cols[fi * 3 + 1][g], cols[fi * 3 + 2][g]]));
}

/** Dynamic time warping path between two (T, 3) series, constrained by a Sakoe-Chiba band. */
export function dtwPath(a: number[][], b: number[][], windowFraction = DTW_WINDOW_FRACTION): [number, number][] {
  const n = a.length;
  const m = b.length;
  const window = Math.max(DTW_MIN_WINDOW, Math.floor(windowFraction * Math.max(n, m)), Math.abs(n - m));
  const w = m + 1;
  const acc = new Float64Array((n + 1) * w).fill(Infinity);
  acc[0] = 0;
  for (let i = 1; i <= n; i++) {
    const lo = Math.max(1, i - window);
    const hi = Math.min(m, i + window);
    const ai = a[i - 1];
    for (let j = lo; j <= hi; j++) {
      const bj = b[j - 1];
      const cost = (Math.abs(ai[0] - bj[0]) + Math.abs(ai[1] - bj[1]) + Math.abs(ai[2] - bj[2])) / 3 / MAX_FLEXION_RAD;
      acc[i * w + j] = cost + Math.min(acc[(i - 1) * w + j], acc[i * w + j - 1], acc[(i - 1) * w + j - 1]);
    }
  }
  const path: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const diag = acc[(i - 1) * w + j - 1];
    const up = acc[(i - 1) * w + j];
    const left = acc[i * w + j - 1];
    // numpy.argmin keeps the first minimum, so ties prefer the diagonal, then up, then left.
    if (diag <= up && diag <= left) {
      i--;
      j--;
    } else if (up <= left) i--;
    else j--;
  }
  return path.reverse();
}

const sum3 = (v: number[]): number => v[0] + v[1] + v[2];
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** True when no finger's total flexion moves more than the static range, i.e. the reference is a held pose. */
export function isStatic(reference: Series): boolean {
  let widest = 0;
  for (let fi = 0; fi < FINGER_NAMES.length; fi++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const frame of reference) {
      const total = sum3(frame[fi]);
      lo = Math.min(lo, total);
      hi = Math.max(hi, total);
    }
    widest = Math.max(widest, hi - lo);
  }
  return toDeg(widest) < STATIC_REFERENCE_RANGE_DEG;
}

/**
 * Aligns each finger separately and measures total-flexion error, signed deviation and timing offset. A held pose
 * (`isStaticRef` true, or unset and the reference barely moves) has no beat to be early or late for: the warp path on a
 * near-constant series is arbitrary, so the timing offset is reported as 0 instead of that noise.
 */
export function compare(reference: Series, attempt: Series, fps = SCORE_FPS, isStaticRef?: boolean, jointMask?: number[][] | null): Comparison {
  const errorDeg = {} as Record<Finger, number>;
  const deviationDeg = {} as Record<Finger, number>;
  const signedLags: number[] = [];
  const absLags: number[] = [];
  FINGER_NAMES.forEach((finger, fi) => {
    const ref = reference.map((f) => f[fi]);
    const att = attempt.map((f) => f[fi]);
    const path = dtwPath(ref, att);
    const m = jointMask?.[fi];
    const total = m ? (v: number[]) => v[0] * m[0] + v[1] * m[1] + v[2] * m[2] : sum3;
    let absSum = 0;
    let signedSum = 0;
    let lagSigned = 0;
    let lagAbs = 0;
    for (const [ri, ai] of path) {
      const diff = total(att[ai]) - total(ref[ri]);
      absSum += Math.abs(diff);
      signedSum += diff;
      lagSigned += ai - ri;
      lagAbs += Math.abs(ai - ri);
    }
    errorDeg[finger] = toDeg(absSum / path.length);
    deviationDeg[finger] = toDeg(signedSum / path.length);
    signedLags.push(lagSigned / path.length);
    absLags.push(lagAbs / path.length);
  });
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  if (isStaticRef ?? isStatic(reference)) return { errorDeg, deviationDeg, timingAbsMs: 0, timingSignedMs: 0 };
  return { errorDeg, deviationDeg, timingAbsMs: (mean(absLags) / fps) * 1000, timingSignedMs: (mean(signedLags) / fps) * 1000 };
}

export function gaussianScore(error: number, tolerance: number): number {
  return 100 * Math.exp(-0.5 * (error / (SCORE_SIGMA_FACTOR * tolerance)) ** 2);
}

/** The sizes from which a hint speaks up, and the tolerances severity is measured against, after the margin of error. */
export interface Thresholds {
  fingerDeg: number;
  timingMs: number;
  wristDeg: number;
  angleTolDeg: number;
  timingTolMs: number;
  wristTolDeg: number;
}

/**
 * Scales every hint threshold and tolerance by the margin's multiplier (hints.thresholds). The tolerances passed in are
 * the step's own. A quiet margin also raises each threshold to its widened tolerance, so nothing inside the band is
 * corrected. Standard returns the plain constants.
 */
export function thresholds(margin: Margin = DEFAULT_MARGIN, angleTolDeg = DEFAULT_TOLERANCE_ANGLE_DEG, timingTolMs = DEFAULT_TOLERANCE_TIMING_MS): Thresholds {
  const k = MARGIN_MULTIPLIERS[margin];
  const angle = angleTolDeg * k;
  const timing = timingTolMs * k;
  const wrist = HINT_WRIST_TOLERANCE_DEG * k;
  let fingerDeg = HINT_MIN_DEVIATION_DEG * k;
  let timingMs = HINT_TIMING_MS * k;
  let wristDeg = HINT_WRIST_MIN_DEG * k;
  if (MARGIN_QUIET.includes(margin)) {
    fingerDeg = Math.max(fingerDeg, angle);
    timingMs = Math.max(timingMs, timing);
    wristDeg = Math.max(wristDeg, wrist);
  }
  return { fingerDeg, timingMs, wristDeg, angleTolDeg: angle, timingTolMs: timing, wristTolDeg: wrist };
}

export const STANDARD_THRESHOLDS = thresholds();

/** The step's tolerance bands widened (or narrowed) by the margin of error (Tolerance.widened), per-finger bands included. */
export function widened(tolerance: Tolerance, margin: Margin = DEFAULT_MARGIN): Tolerance {
  const k = MARGIN_MULTIPLIERS[margin];
  const out: Tolerance = { angle_deg: tolerance.angle_deg * k, timing_ms: tolerance.timing_ms * k };
  if (tolerance.finger_angle_deg) {
    const fingers: Partial<Record<Finger, number>> = {};
    for (const f of FINGER_NAMES) {
      const v = tolerance.finger_angle_deg[f];
      if (v !== undefined) fingers[f] = v * k;
    }
    out.finger_angle_deg = fingers;
  }
  return out;
}

/** One finger's angle tolerance: its own when the step has per-finger bands, else angle_deg (Tolerance.angle_for). */
export function angleFor(tolerance: Tolerance, finger: Finger): number {
  return tolerance.finger_angle_deg?.[finger] ?? tolerance.angle_deg;
}

/**
 * The finger to correct, or null: among fingers past their own hint threshold, the one furthest outside its own tolerance
 * (hints.focus_finger). With the same thresholds for every finger this is the largest absolute deviation.
 */
export function focusFinger(deviations: Partial<Record<Finger, number>>, perFinger: Record<Finger, Thresholds>): Finger | null {
  let best: Finger | null = null;
  let bestRatio = -1;
  for (const f of FINGER_NAMES) {
    const size = Math.abs(deviations[f] ?? 0);
    if (size < perFinger[f].fingerDeg) continue;
    const ratio = size / perFinger[f].angleTolDeg;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = f;
    }
  }
  return best;
}

/** The same thresholds for every finger. */
const uniform = (limits: Thresholds): Record<Finger, Thresholds> =>
  Object.fromEntries(FINGER_NAMES.map((f) => [f, limits])) as Record<Finger, Thresholds>;

/** Thresholds per finger for a tolerance with per-finger bands, before the margin is applied (the margin is). */
export function fingerThresholds(tolerance: Tolerance, margin: Margin = DEFAULT_MARGIN): Record<Finger, Thresholds> {
  return Object.fromEntries(FINGER_NAMES.map((f) => [f, thresholds(margin, angleFor(tolerance, f), tolerance.timing_ms)])) as Record<Finger, Thresholds>;
}

/**
 * Plain-language tip. Deviation is signed total-flexion degrees (positive: curled too much); timing is positive when late.
 * perFinger gives each finger its own thresholds (a step with per-finger tolerance); without it every finger uses limits.
 */
export function buildHint(
  deviations: Partial<Record<Finger, number>>,
  timingMs: number,
  limits: Thresholds = STANDARD_THRESHOLDS,
  perFinger?: Record<Finger, Thresholds>,
): string {
  const finger = focusFinger(deviations, perFinger ?? uniform(limits));
  if (finger !== null) {
    const deviation = deviations[finger] ?? 0;
    if (deviation > 0) return `Relax your ${finger} finger, it is curled about ${Math.abs(deviation).toFixed(0)} degrees (in total) too much.`;
    return `Curl your ${finger} finger more, it is about ${Math.abs(deviation).toFixed(0)} degrees (in total) too straight.`;
  }
  if (Math.abs(timingMs) >= limits.timingMs) {
    const word = timingMs > 0 ? 'late' : 'early';
    return `Your finger shapes are right, but you are about ${Math.abs(timingMs).toFixed(0)} ms ${word}. Match the guide hand's beat.`;
  }
  return 'Great match. Keep the same shape and rhythm.';
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Per-finger weights clipped to 0..1; null (or a missing finger) counts fully (scoring.weight_map). */
export function weightMap(weights?: Partial<Record<Finger, number>> | null): Record<Finger, number> {
  const out = {} as Record<Finger, number>;
  for (const f of FINGER_NAMES) out[f] = Math.min(1, Math.max(0, weights?.[f] ?? 1));
  return out;
}

/** Fingers that may be named as the one to fix: weight at or above the minimum, else the heaviest non-zero ones. */
export function focusFingers(weights: Record<Finger, number>, minWeight = FOCUS_MIN_WEIGHT): Finger[] {
  const out = FINGER_NAMES.filter((f) => weights[f] >= minWeight && weights[f] > 0);
  if (out.length) return out;
  const top = Math.max(...FINGER_NAMES.map((f) => weights[f]));
  return FINGER_NAMES.filter((f) => top > 0 && weights[f] === top);
}

/**
 * Turns alignment statistics into the contract's ScoreResult, judged with the learner's margin of error. Per-finger bands
 * (tolerance.finger_angle_deg) give each finger its own Gaussian and limit (the worst finger is the one furthest outside
 * its own band). With step weights, the finger part of `overall` is their weighted mean, a zero-weight finger never breaks `within_tolerance`,
 * and the worst finger and the hint only name a finger weighted at least FOCUS_MIN_WEIGHT.
 */
export function toResult(cmp: Comparison, stepTolerance: Tolerance, margin: Margin = DEFAULT_MARGIN, weights?: Partial<Record<Finger, number>> | null): ScoreResult {
  const limits = thresholds(margin, stepTolerance.angle_deg, stepTolerance.timing_ms);
  const fingerLimits = fingerThresholds(stepTolerance, margin);
  const tolerance = widened(stepTolerance, margin);
  const band = (f: Finger) => angleFor(tolerance, f);
  const perFinger = FINGER_NAMES.map((f) => gaussianScore(cmp.errorDeg[f], band(f)));
  const timing = gaussianScore(cmp.timingAbsMs, tolerance.timing_ms);
  const w = weightMap(weights);
  let fingersPart: number;
  if (!weights) fingersPart = perFinger.reduce((s, v) => s + v, 0) / perFinger.length;
  else {
    const total = FINGER_NAMES.reduce((s, f) => s + w[f], 0);
    fingersPart = total > 0 ? FINGER_NAMES.reduce((s, f, i) => s + w[f] * perFinger[i], 0) / total : 100;
  }
  const overall = FINGER_WEIGHT * fingersPart + TIMING_WEIGHT * timing;
  const within = FINGER_NAMES.every((f) => w[f] <= 0 || cmp.errorDeg[f] <= band(f)) && cmp.timingAbsMs <= tolerance.timing_ms;
  const focusList = focusFingers(w);
  const focus = focusList.length ? focusList : FINGER_NAMES;
  let worst: Finger = focus[0];
  for (const f of focus) if (cmp.errorDeg[f] / band(f) > cmp.errorDeg[worst] / band(worst)) worst = f;
  const focusDeviation: Partial<Record<Finger, number>> = {};
  for (const f of focus) focusDeviation[f] = cmp.deviationDeg[f];
  const per = {} as Record<Finger, number>;
  FINGER_NAMES.forEach((f, i) => (per[f] = round1(perFinger[i])));
  return {
    overall: round1(overall),
    per_finger: per,
    timing: round1(timing),
    within_tolerance: within,
    worst_finger: worst,
    hint: buildHint(focusDeviation, cmp.timingSignedMs, limits, fingerLimits),
    warnings: [],
    margin,
  };
}

/** (joint mask (5, 3), finger weights) from a calibration's usable joints; null if a phase is missing (scoring.calibration_masks). */
export function calibrationMasks(cal: Calibration): { joints: number[][]; fingers: Record<Finger, number> } | null {
  const r = rangesOf(cal);
  if (!r) return null;
  const fingers = {} as Record<Finger, number>;
  FINGER_NAMES.forEach((f, i) => (fingers[f] = r.usable[i].some(Boolean) ? 1 : 0));
  return { joints: r.usable.map((row) => row.map((u) => (u ? 1 : 0))), fingers };
}

/** (weights, spread in degrees) per finger from several takes of one step (scoring.take_weights). */
export function takeWeights(takes: Series[]): { weights: Record<Finger, number>; spreadDeg: Record<Finger, number> } {
  const weights = {} as Record<Finger, number>;
  const spreadDeg = {} as Record<Finger, number>;
  FINGER_NAMES.forEach((f, fi) => {
    if (takes.length < 2) {
      weights[f] = 1;
      spreadDeg[f] = 0;
      return;
    }
    const means = takes.map((t) => toDeg(t.reduce((s, frame) => s + sum3(frame[fi]), 0) / t.length));
    const mu = means.reduce((s, v) => s + v, 0) / means.length;
    const sd = Math.sqrt(means.reduce((s, v) => s + (v - mu) ** 2, 0) / means.length);
    const frac = Math.min(1, Math.max(0, (sd - TAKE_CONSISTENT_DEG) / (TAKE_INCONSISTENT_DEG - TAKE_CONSISTENT_DEG)));
    weights[f] = Math.round((1 - frac * (1 - TAKE_INCONSISTENT_FLOOR)) * 100) / 100;
    spreadDeg[f] = round1(sd);
  });
  return { weights, spreadDeg };
}

interface Ranges {
  flat: number[][];
  fist: number[][];
  usable: boolean[][];
}

function rangesOf(cal: Calibration): Ranges | null {
  const flat = FINGER_NAMES.map((f) => [...cal.flat[f]]);
  const fist = FINGER_NAMES.map((f) => [...cal.fist[f]]);
  const anyNonZero = (m: number[][]) => m.some((row) => row.some((v) => v !== 0));
  if (!anyNonZero(flat) || !anyNonZero(fist)) return null;
  return { flat, fist, usable: fist.map((row, i) => row.map((v, j) => v - flat[i][j] > CALIBRATION_MIN_RANGE_RAD)) };
}

function standardRanges(): { flat: number[][]; fist: number[][] } {
  const scale = (i: number) => (i === 0 ? THUMB_FLEXION_SCALE : 1);
  return {
    flat: RELAXED_FLEXION.map((row, i) => row.map((v) => v * scale(i))),
    fist: RELAXED_FLEXION.map((row, i) => row.map((v, j) => (v + FULL_FLEXION[i][j]) * scale(i))),
  };
}

/** Normalises an attempt by its own flat/fist range, then maps it into the reference's angle space. */
export function calibrateAttempt(attempt: Series, own: Calibration, reference: Calibration | null, warnings: string[]): Series {
  const ownRange = rangesOf(own);
  if (!ownRange) {
    warnings.push('attempt calibration is incomplete (flat or fist not captured); scored without calibration');
    return attempt;
  }
  let { flat: refFlat, fist: refFist } = standardRanges();
  if (reference) {
    const r = rangesOf(reference);
    if (!r) warnings.push('reference calibration is incomplete; using nominal reference ranges');
    else {
      refFlat = r.flat;
      refFist = r.fist;
    }
  }
  if (!ownRange.usable.every((row) => row.every(Boolean))) warnings.push('some joints have too small a calibrated range and were left uncalibrated');
  return attempt.map((frame) =>
    frame.map((joints, fi) =>
      joints.map((x, j) => {
        if (!ownRange.usable[fi][j]) return x;
        const span = ownRange.fist[fi][j] - ownRange.flat[fi][j];
        const norm = Math.min(1, Math.max(0, (x - ownRange.flat[fi][j]) / span));
        return refFlat[fi][j] + norm * (refFist[fi][j] - refFlat[fi][j]);
      }),
    ),
  );
}

/** Convenience for tests and the router: score two frame lists on one side, with optional calibrations. */
export function scoreFrames(
  referenceFrames: GloveFrame[],
  attemptFrames: GloveFrame[],
  side: Side,
  tolerance: Tolerance,
  calibration?: { own: Calibration | null; reference: Calibration | null },
  margin: Margin = DEFAULT_MARGIN,
  weights?: Partial<Record<Finger, number>> | null,
): ScoreResult {
  const ref = resample(referenceFrames, side);
  let att = resample(attemptFrames, side);
  const warnings: string[] = [];
  let jointMask: number[][] | null = null;
  let w = weights ?? null;
  if (calibration?.own) {
    att = calibrateAttempt(att, calibration.own, calibration.reference, warnings);
    const masked = applyCalibrationMasks(calibration.own, w, warnings);
    jointMask = masked.jointMask;
    w = masked.weights;
  }
  return { ...toResult(compare(ref, att, SCORE_FPS, undefined, jointMask), tolerance, margin, w), warnings };
}

/** The score handler's calibration step: joints the attempt calibration cannot read leave the sum, fingers with none get weight 0. */
export function applyCalibrationMasks(
  own: Calibration,
  weights: Partial<Record<Finger, number>> | null,
  warnings: string[],
): { jointMask: number[][] | null; weights: Partial<Record<Finger, number>> | null } {
  const masks = calibrationMasks(own);
  if (!masks || masks.joints.every((row) => row.every((v) => v === 1))) return { jointMask: null, weights };
  const base = weightMap(weights);
  const out = {} as Record<Finger, number>;
  for (const f of FINGER_NAMES) out[f] = base[f] * masks.fingers[f];
  const dropped = FINGER_NAMES.filter((f) => masks.fingers[f] === 0);
  if (dropped.length) warnings.push(`this calibration cannot read the ${dropped.join(', ')}; not scored`);
  return { jointMask: masks.joints, weights: out };
}

export type { JointTriple };
