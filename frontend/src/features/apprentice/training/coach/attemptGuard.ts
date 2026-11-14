/** Share of the expected attempt length that must actually be recorded before a rep is scored. */
export const MIN_ATTEMPT_COVERAGE = 0.8;
/** Fewest recorded frames that can ever be scored (about a third of a second at the coach's rate). */
export const MIN_ATTEMPT_FRAMES = 10;

/** Seconds of reference time covered by the recorded frames (last minus first `t`). */
export function recordedSeconds(frames: readonly { t: number }[]): number {
  if (frames.length < 2) return 0;
  return Math.max(0, frames[frames.length - 1].t - frames[0].t);
}

export type AttemptCheck = { ok: true } | { ok: false; reason: 'no_frames' | 'too_short'; recordedS: number; expectedS: number };

/**
 * Whether an attempt holds enough movement to score fairly. A rep with almost no frames would otherwise be scored on a
 * fraction of a second and could even count as clean. `expectedS` is the planned length (0 when it has none, as in Follow
 * practice, where only the frame floor applies).
 */
export function checkAttempt(frames: readonly { t: number }[], expectedS: number, coverage = MIN_ATTEMPT_COVERAGE): AttemptCheck {
  const recordedS = recordedSeconds(frames);
  if (frames.length === 0) return { ok: false, reason: 'no_frames', recordedS, expectedS };
  if (frames.length < MIN_ATTEMPT_FRAMES) return { ok: false, reason: 'too_short', recordedS, expectedS };
  if (expectedS > 0 && recordedS < expectedS * coverage) return { ok: false, reason: 'too_short', recordedS, expectedS };
  return { ok: true };
}

/** A calm line for the learner when an attempt is not scored. */
export function attemptRetryLine(check: Exclude<AttemptCheck, { ok: true }>): string {
  if (check.reason === 'no_frames') return 'No glove movement was recorded, so this rep was not scored or counted. Check the glove, then begin the rep again.';
  if (check.expectedS <= 0) return 'This rep was too short to score. It was not counted. Begin the rep again when you are ready.';
  return `This rep was too short to score: ${check.recordedS.toFixed(1)} of ${check.expectedS.toFixed(1)} seconds were recorded. It was not counted. Begin the rep again when you are ready.`;
}
