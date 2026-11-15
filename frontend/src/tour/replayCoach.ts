import { FINGERS, type Finger, type GloveFrame, type ScoreResult, type Side, type Tolerance } from '../api/types';
import { alignedDeviation, meanLagMs } from '../features/apprentice/training/coach/alignment';
import {
  applyDeadZone,
  configFromTolerance,
  flaggedFinger,
  flexionDegrees,
  liveScore,
  MovingAverage,
  statusOf,
  tension,
  zeroValues,
  type CoachConfig,
  type FingerStatus,
  type FingerValues,
} from '../features/apprentice/training/coach/deviation';
import { trackFromFrames } from '../features/apprentice/training/coach/reference';
import { algorithmicTip } from '../features/apprentice/training/coach/tips';
import { handAt } from '../features/shared/playback';
import { scoreFrames } from '../mock/scoring';

/** What the learner saw at one moment of the attempt. */
export interface CoachMoment {
  t: number;
  status: Record<Finger, FingerStatus>;
  deviation: FingerValues;
  tension: FingerValues;
  /** The finger the stage names, or null when every finger is in line. */
  flagged: Finger | null;
  tip: string | null;
  /** The live score, 0 to 100. */
  score: number;
}

export interface CoachReplay {
  moments: CoachMoment[];
  /** The score the attempt ends on, from the same scorer as POST /score (mock/scoring.ts, the backend port). */
  result: ScoreResult;
  config: CoachConfig;
}

/** The app's default step tolerance (18 degrees, 250 ms), at the standard margin. */
export const TOUR_TOLERANCE: Tolerance = { angle_deg: 18, timing_ms: 250 };

/** Samples per second of the replayed corrections (the live coach ticks faster; the view updates about 8 times a second). */
export const REPLAY_HZ = 30;

/**
 * Replays a recorded attempt against the expert's take through the live coach's own steps, in Flow mode: the same moving
 * average, timing window, dead zone, per-finger bands, flag rule, tip and live score (features/apprentice/training/coach).
 * It reproduces what the learner saw from the same frames; it is not a log of the session.
 */
export function replayCoach(reference: GloveFrame[], attempt: GloveFrame[], side: Side, tolerance: Tolerance = TOUR_TOLERANCE): CoachReplay {
  const config = configFromTolerance(tolerance);
  const track = trackFromFrames(reference, side);
  const avg = new MovingAverage(6);
  const window = config.timingMs / 1000;
  const duration = attempt.length ? attempt[attempt.length - 1].t - attempt[0].t : 0;
  const moments: CoachMoment[] = [];
  for (let i = 0; i * (1 / REPLAY_HZ) <= duration + 1e-9; i++) {
    const t = i / REPLAY_HZ;
    const hand = handAt(attempt, t, side);
    if (!hand) continue;
    const smooth = avg.push(flexionDegrees(hand));
    const aligned = alignedDeviation(smooth, (x) => track.flexionAt(x), t, window);
    if (!aligned) continue;
    const dev = zeroValues();
    const ten = zeroValues();
    const status = {} as Record<Finger, FingerStatus>;
    for (const f of FINGERS) {
      dev[f] = applyDeadZone(aligned.deviation[f], config.deadZoneDeg);
      status[f] = statusOf(dev[f], config.fingerToleranceDeg[f]);
      ten[f] = tension(dev[f], config.fingerToleranceDeg[f]);
    }
    const lag = meanLagMs(aligned.lagMs);
    moments.push({
      t,
      status,
      deviation: dev,
      tension: ten,
      flagged: flaggedFinger({ status, deviation: dev }),
      tip: algorithmicTip(dev, config.fingerToleranceDeg, lag, config.timingMs, config.light),
      score: Math.round(liveScore(dev, config.fingerToleranceDeg, config.weights)),
    });
  }
  const result = scoreFrames(reference, attempt, side, tolerance);
  return { moments, result, config };
}

/** The moment at a time (the last one at or before it). */
export function momentAt(replay: CoachReplay, t: number): CoachMoment | null {
  const m = replay.moments;
  if (!m.length) return null;
  const i = Math.min(m.length - 1, Math.max(0, Math.floor(t * REPLAY_HZ)));
  return m[i];
}
