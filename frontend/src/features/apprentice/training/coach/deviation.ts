import { DEFAULT_MARGIN, MARGIN_MULTIPLIERS } from '../../../../api/margin';
import { FINGERS, type Finger, type HandFrame, type Margin } from '../../../../api/types';

const RAD2DEG = 180 / Math.PI;

export type FingerValues = Record<Finger, number>;
export type FingerStatus = 'good' | 'off';

/** Tunables for comparing a learner hand with the reference. */
export interface CoachConfig {
  /** Allowed difference in total finger flexion, in degrees: the step's single band, for anything that reads one number. */
  toleranceDeg: number;
  /**
   * Each finger's own band in degrees, after the margin. From the step's `tolerance.finger_angle_deg` (the takes model:
   * a finger the expert holds steady is judged strictly, one that varies gets room); a finger left out uses `toleranceDeg`.
   */
  fingerToleranceDeg: FingerValues;
  /** Differences below this are treated as tremor and ignored, in degrees. */
  deadZoneDeg: number;
  /** Largest timing slip that is forgiven, in milliseconds. */
  timingMs: number;
}

/** Dead zone used when the step does not say otherwise: a few degrees of natural tremor. */
export const DEFAULT_DEAD_ZONE_DEG = 4;

/** A tolerance band in degrees: one number for every finger, or each finger's own. */
export type ToleranceBand = number | FingerValues;

/** One finger's band from a tolerance band. */
export function bandFor(band: ToleranceBand, finger: Finger): number {
  return typeof band === 'number' ? band : band[finger];
}

/** The step's tolerance as the coach reads it; `finger_angle_deg` is optional and may name only some fingers. */
export interface ToleranceInput {
  angle_deg?: number;
  timing_ms?: number;
  finger_angle_deg?: Partial<Record<Finger, number>> | null;
}

/**
 * Builds a coach configuration from a step's tolerance (defaults 18 degrees and 250 ms) widened by the learner's margin of
 * error, the same multiplier the scorer applies. Every live correction (strings, rings, finger tints, tips, the match
 * meter and the local score) reads its band from here, so a relaxed margin stops marking a slightly-off finger. A step
 * built from several takes carries a band per finger (`finger_angle_deg`); a finger it leaves out falls back to
 * `angle_deg`, and the margin multiplies every band, as on POST /score.
 */
export function configFromTolerance(tol: ToleranceInput | undefined, margin: Margin = DEFAULT_MARGIN): CoachConfig {
  const k = MARGIN_MULTIPLIERS[margin];
  const base = tol?.angle_deg ?? 18;
  const fingerToleranceDeg = zeroValues();
  for (const f of FINGERS) {
    const own = tol?.finger_angle_deg?.[f];
    fingerToleranceDeg[f] = (typeof own === 'number' && own > 0 ? own : base) * k;
  }
  return { toleranceDeg: base * k, fingerToleranceDeg, deadZoneDeg: DEFAULT_DEAD_ZONE_DEG, timingMs: (tol?.timing_ms ?? 250) * k };
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
 * The live match meter, 0 to 100: the weakest finger's match, each finger against its own band. A hand is only as in line
 * as its worst finger, so the meter can never read high while a finger is flagged.
 */
export function matchMeter(deviations: FingerValues, tolerance: ToleranceBand): number {
  let worst = 100;
  for (const f of FINGERS) worst = Math.min(worst, fingerMatch(deviations[f], bandFor(tolerance, f)));
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
