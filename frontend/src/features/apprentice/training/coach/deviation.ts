import { DEFAULT_MARGIN, MARGIN_MULTIPLIERS } from '../../../../api/margin';
import { FINGERS, type Finger, type HandFrame, type Margin } from '../../../../api/types';

const RAD2DEG = 180 / Math.PI;

export type FingerValues = Record<Finger, number>;
export type FingerStatus = 'good' | 'off';

/** Tunables for comparing a learner hand with the reference. */
export interface CoachConfig {
  /** Allowed difference in total finger flexion, in degrees. */
  toleranceDeg: number;
  /** Differences below this are treated as tremor and ignored, in degrees. */
  deadZoneDeg: number;
  /** Largest timing slip that is forgiven, in milliseconds. */
  timingMs: number;
  /**
   * Fingers the step weights too little to correct (Step.weights below FOCUS_MIN_WEIGHT). They are drawn dimmed, never
   * marked off, never named in a tip and left out of the match meter. Empty without step weights.
   */
  light?: readonly Finger[];
  /** The step's weights, 0 to 1, every finger 1 without step weights. */
  weights?: Record<Finger, number>;
}

/** Below this weight a finger is never the one to fix (backend FOCUS_MIN_WEIGHT, mock/scoring.ts). */
export const FOCUS_MIN_WEIGHT = 0.3;

/**
 * Fingers too light to correct: weight under FOCUS_MIN_WEIGHT. When every finger is that light, the heaviest non-zero
 * ones still count (the scorer's focus rule), so a lesson of only light fingers keeps its corrections.
 */
export function lightFingers(weights?: Partial<Record<Finger, number>> | null): Finger[] {
  if (!weights) return [];
  const w = (f: Finger) => Math.min(1, Math.max(0, weights[f] ?? 1));
  const focus = FINGERS.filter((f) => w(f) >= FOCUS_MIN_WEIGHT && w(f) > 0);
  if (focus.length) return FINGERS.filter((f) => !focus.includes(f));
  const top = Math.max(...FINGERS.map(w));
  return FINGERS.filter((f) => !(top > 0 && w(f) === top));
}

/** Dead zone used when the step does not say otherwise: a few degrees of natural tremor. */
export const DEFAULT_DEAD_ZONE_DEG = 4;

/**
 * Builds a coach configuration from a step's tolerance (defaults 18 degrees and 250 ms) widened by the learner's margin of
 * error, the same multiplier the scorer applies. Every live correction (strings, rings, finger tints, tips, the match
 * meter and the local score) reads its band from here, so a relaxed margin stops marking a slightly-off finger.
 */
export function configFromTolerance(
  tol: { angle_deg?: number; timing_ms?: number } | undefined,
  margin: Margin = DEFAULT_MARGIN,
  weights?: Partial<Record<Finger, number>> | null,
): CoachConfig {
  const k = MARGIN_MULTIPLIERS[margin];
  const base = { toleranceDeg: (tol?.angle_deg ?? 18) * k, deadZoneDeg: DEFAULT_DEAD_ZONE_DEG, timingMs: (tol?.timing_ms ?? 250) * k };
  if (!weights) return base;
  const w = {} as Record<Finger, number>;
  for (const f of FINGERS) w[f] = Math.min(1, Math.max(0, weights[f] ?? 1));
  return { ...base, weights: w, light: lightFingers(weights) };
}

/** Total flexion of one finger (sum of its three joints) in degrees. */
export function totalFlexionDeg(hand: HandFrame, finger: Finger): number {
  const [a, b, c] = hand.flexion[finger];
  return (a + b + c) * RAD2DEG;
}

/** Total flexion of every finger in degrees. */
export function flexionDegrees(hand: HandFrame): FingerValues {
  const out = {} as FingerValues;
  for (const f of FINGERS) out[f] = totalFlexionDeg(hand, f);
  return out;
}

/** An all-zero finger record, for initial state. */
export function zeroValues(): FingerValues {
  return { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 };
}

/** Shrinks a signed difference towards zero by the dead zone, so tremor never counts as an error. */
export function applyDeadZone(value: number, deadZoneDeg: number): number {
  const mag = Math.abs(value);
  return mag <= deadZoneDeg ? 0 : Math.sign(value) * (mag - deadZoneDeg);
}

/** Running mean of the last N flexion vectors; comparing this instead of raw frames hides sensor jitter. */
export class MovingAverage {
  private readonly buf: FingerValues[] = [];

  constructor(private readonly size = 6) {}

  /** Adds a sample and returns the current mean. */
  push(sample: FingerValues): FingerValues {
    this.buf.push(sample);
    if (this.buf.length > this.size) this.buf.shift();
    const out = zeroValues();
    for (const s of this.buf) for (const f of FINGERS) out[f] += s[f] / this.buf.length;
    return out;
  }

  /** Forgets all samples. */
  reset(): void {
    this.buf.length = 0;
  }
}

/** Whether a finger is within the allowed angle. */
export function statusOf(deviationDeg: number, toleranceDeg: number): FingerStatus {
  return Math.abs(deviationDeg) <= toleranceDeg ? 'good' : 'off';
}

/** 0 (relaxed string) to 1 (taut and vermilion): grows once a finger passes half its tolerance, full at twice the tolerance. */
export function tension(deviationDeg: number, toleranceDeg: number): number {
  const over = Math.abs(deviationDeg) - toleranceDeg * 0.5;
  return Math.max(0, Math.min(1, over / (toleranceDeg * 1.5)));
}

/** Match at the tolerance edge. A finger inside the tolerance scores at least this, a finger outside it always less. */
export const MATCH_IN_LINE = 75;

/**
 * One finger's match, 0 to 100: 100 when it mirrors the master exactly, MATCH_IN_LINE at the tolerance edge, then falling to
 * 0 at three times the tolerance. A finger flagged as off therefore always reads below MATCH_IN_LINE.
 */
export function fingerMatch(deviationDeg: number, toleranceDeg: number): number {
  const mag = Math.abs(deviationDeg);
  if (mag <= toleranceDeg) return 100 - (100 - MATCH_IN_LINE) * (mag / toleranceDeg);
  return Math.max(0, MATCH_IN_LINE - MATCH_IN_LINE * ((mag - toleranceDeg) / (2 * toleranceDeg)));
}

/**
 * The live match meter, 0 to 100: the weakest finger's match. A hand is only as in line as its worst finger, so the meter
 * can never read high while a finger is flagged.
 */
export function matchMeter(deviations: FingerValues, toleranceDeg: number, light: readonly Finger[] = []): number {
  let worst = 100;
  for (const f of FINGERS) if (!light.includes(f)) worst = Math.min(worst, fingerMatch(deviations[f], toleranceDeg));
  return worst;
}

/** What the stage and the meter both show: one coach snapshot, published together about eight times a second. */
export interface FlagSnapshot {
  status: Record<Finger, FingerStatus>;
  deviation: FingerValues;
}

/**
 * The single rule that turns a snapshot into a correction: the finger the stage label names is the one with the largest
 * deviation among fingers whose status is 'off' (and inside the focus, when the attempt has one). Null when every finger
 * in view is in line. The meter uses the same snapshot (see meterOff), so a label can never sit beside a green meter.
 */
export function flaggedFinger(snap: FlagSnapshot, focus?: readonly Finger[] | null): Finger | null {
  let best: Finger | null = null;
  for (const f of FINGERS) {
    if (snap.status[f] !== 'off' || (focus && !focus.includes(f))) continue;
    if (!best || Math.abs(snap.deviation[f]) > Math.abs(snap.deviation[best])) best = f;
  }
  return best;
}

/** Whether the match meter fill is vermilion: any finger in the snapshot is off. True whenever flaggedFinger names one. */
export function meterOff(snap: FlagSnapshot): boolean {
  return FINGERS.some((f) => snap.status[f] === 'off');
}
