import { FINGERS, type Finger, type HandFrame } from '../../../../api/types';

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
}

/** Dead zone used when the step does not say otherwise: a few degrees of natural tremor. */
export const DEFAULT_DEAD_ZONE_DEG = 4;

/** Builds a coach configuration from a step's tolerance, with defaults of 18 degrees and 250 ms. */
export function configFromTolerance(tol: { angle_deg?: number; timing_ms?: number } | undefined): CoachConfig {
  return { toleranceDeg: tol?.angle_deg ?? 18, deadZoneDeg: DEFAULT_DEAD_ZONE_DEG, timingMs: tol?.timing_ms ?? 250 };
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

/** 100 inside the tolerance, falling to 0 at three times the tolerance. */
export function fingerMatch(deviationDeg: number, toleranceDeg: number): number {
  const over = Math.abs(deviationDeg) - toleranceDeg;
  if (over <= 0) return 100;
  return Math.max(0, 100 - (over / (2 * toleranceDeg)) * 100);
}

/** Mean per-finger match across the hand, 0 to 100. */
export function matchMeter(deviations: FingerValues, toleranceDeg: number): number {
  let sum = 0;
  for (const f of FINGERS) sum += fingerMatch(deviations[f], toleranceDeg);
  return sum / FINGERS.length;
}
