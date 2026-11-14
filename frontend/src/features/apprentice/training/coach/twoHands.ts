import { FINGERS, type Finger, type ScoreResult, type Side } from '../../../../api/types';

const SIDE_WORD: Record<Side, string> = { left: 'Left hand', right: 'Right hand' };

/**
 * One score for a two-handed rep from the scorer's per-hand results (POST /score scores one side per call). A two-handed
 * move is only as good as its weaker hand: overall, timing and each finger take the lower of the two, the rep is within
 * tolerance only when both hands are, and the worst finger and hint come from the weaker hand, named (or "Both hands" when
 * both are in line). With one result
 * (the other hand could not be scored) that result is returned with a warning.
 */
export function combineHandScores(scores: Partial<Record<Side, ScoreResult>>): ScoreResult | null {
  const sides = (['left', 'right'] as const).filter((s) => scores[s]);
  if (!sides.length) return null;
  if (sides.length === 1) {
    const only = sides[0];
    const other: Side = only === 'left' ? 'right' : 'left';
    const r = scores[only] as ScoreResult;
    return { ...r, hint: `${SIDE_WORD[only]}: ${r.hint}`, warnings: [...r.warnings, `Only the ${only} hand was scored; the ${other} hand was missing from the recording.`] };
  }
  const left = scores.left as ScoreResult;
  const right = scores.right as ScoreResult;
  const weak: Side = left.overall <= right.overall ? 'left' : 'right';
  const w = weak === 'left' ? left : right;
  const per_finger = {} as Record<Finger, number>;
  for (const f of FINGERS) per_finger[f] = Math.min(left.per_finger[f], right.per_finger[f]);
  return {
    overall: Math.min(left.overall, right.overall),
    per_finger,
    timing: Math.min(left.timing, right.timing),
    within_tolerance: left.within_tolerance && right.within_tolerance,
    worst_finger: w.worst_finger,
    hint: `${left.within_tolerance && right.within_tolerance ? 'Both hands' : SIDE_WORD[weak]}: ${w.hint}`,
    warnings: [...new Set([...left.warnings, ...right.warnings])],
  };
}
