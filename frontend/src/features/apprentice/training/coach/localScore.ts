import { FINGERS, type ScoreResult } from '../../../../api/types';
import type { AttemptStats } from './useCoach';
import type { CoachConfig } from './deviation';

/**
 * A score computed from the live comparison alone, used when the backend cannot be reached. It is a fair summary, not the
 * canonical DTW score: each finger blends how long it stayed inside its own band with how far it strayed on average.
 */
export function localScore(stats: AttemptStats, config: CoachConfig): ScoreResult {
  const per_finger = {} as ScoreResult['per_finger'];
  let sum = 0;
  for (const f of FINGERS) {
    const closeness = Math.max(0, 1 - stats.meanAbs[f] / (2 * config.fingerToleranceDeg[f]));
    per_finger[f] = Math.round(100 * (0.6 * stats.inTolerance[f] + 0.4 * closeness));
    sum += per_finger[f];
  }
  const over = Math.max(0, Math.abs(stats.meanLagMs) - config.timingMs);
  const timing = Math.round(Math.max(0, 100 - (over / config.timingMs) * 50));
  const overall = Math.round((sum / FINGERS.length) * 0.8 + timing * 0.2);
  return {
    overall,
    per_finger,
    timing,
    within_tolerance: FINGERS.every((f) => stats.inTolerance[f] >= 0.7),
    worst_finger: stats.worst,
    hint: stats.tip ?? 'A clean attempt. Keep the shape steady and repeat it.',
    warnings: [],
  };
}
