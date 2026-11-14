import { MARGIN_QUIET } from '../../../../api/margin';
import { FINGERS, type Finger, type ScoreResult } from '../../../../api/types';

/** Overall score from which the numeral turns gold, provided every finger was also inside the tolerance. */
export const MASTERY = 90;
/** A finger or the timing at or above this held the expert's shape; below it is the one correction. */
export const OK_FROM = 70;

/**
 * The finger with the lowest displayed score; the backend's own pick only breaks a tie. Fingers the step weights too
 * little (`light`, see lightFingers) are never the one to fix.
 */
export function weakestFinger(result: ScoreResult, light: readonly Finger[] = []): Finger {
  const named = FINGERS.filter((f) => !light.includes(f));
  if (!named.length) return result.worst_finger;
  let worst = named.includes(result.worst_finger) ? result.worst_finger : named[0];
  for (const f of named) {
    if (Math.round(result.per_finger[f]) < Math.round(result.per_finger[worst])) worst = f;
  }
  return worst;
}

/**
 * Gold is only for mastery: a high score inside the tolerance, judged with the standard or a strict margin. A rep that
 * only passed because the learner widened the margin (relaxed, just trying it) is good, not mastered.
 */
export function isMastery(result: ScoreResult): boolean {
  return Math.round(result.overall) >= MASTERY && result.within_tolerance && !MARGIN_QUIET.includes(result.margin ?? 'standard');
}
