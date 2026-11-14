import type { Finger, ScoreResult } from '../../../api/types';
import { FINGER_LABEL } from '../training/coach/tips';
import type { RepOutcome, Stage } from './stages';

const NAMED_FINGER = /\b(thumb|(?:index|middle|ring|little) finger)\b/gi;

/** Plain list of finger names, lower case. */
function names(fingers: Finger[]): string {
  const n = fingers.map((f) => FINGER_LABEL[f].toLowerCase());
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** The finger with the lowest score, for the one-line summaries. */
function weakest(score: ScoreResult): Finger {
  let w = score.worst_finger;
  for (const f of Object.keys(score.per_finger) as Finger[]) if (score.per_finger[f] < score.per_finger[w]) w = f;
  return w;
}

/** One goal before a set: the worst finger from last time, or a plain goal for the stage the first time. */
export function goalLine(last: ScoreResult | null, stage: Stage): string {
  if (stage === 'watch') return 'Watch the expert first. Notice which fingers move and when.';
  if (!last) return stage === 'strings' ? 'Follow the strings and keep every finger in line.' : stage === 'ghost' ? 'The strings are cut. Keep the shape without them.' : 'No help this set. Trust your hand.';
  const w = weakest(last);
  if (last.per_finger[w] >= 80) return stage === 'blind' ? 'No help this set. Trust your hand.' : 'Keep every finger inside the shape this set.';
  return `Focus on the ${FINGER_LABEL[w].toLowerCase()} this set.`;
}

/** The algorithmic one-liner after a rep: the scorer's hint when it names the weakest finger, otherwise a plain summary. */
export function repLine(score: ScoreResult): string {
  const w = weakest(score);
  const named = score.hint.match(NAMED_FINGER) ?? [];
  const wantName = FINGER_LABEL[w].toLowerCase();
  if (score.hint && named.every((n) => n.toLowerCase() === wantName)) return score.hint;
  if (score.per_finger[w] >= 80) return score.timing < 70 ? `Good shape. Timing was ${Math.round(score.timing)}.` : 'Every finger held the shape.';
  return `${FINGER_LABEL[w]} was weakest at ${Math.round(score.per_finger[w])}.`;
}

/** After a set: one thing that improved or held, one to fix, one action. At most 25 words. */
export function setLine(scores: ScoreResult[]): string {
  if (scores.length === 0) return '';
  const first = scores[0];
  const last = scores[scores.length - 1];
  const w = weakest(last);
  const gain = Math.round(last.overall - first.overall);
  const lead = gain >= 5 ? `Up ${gain} points over the set.` : scores.every((s) => s.within_tolerance) ? 'Steady all set.' : 'Uneven set.';
  if (last.per_finger[w] >= 80) return `${lead} Every finger is in line. Next set, keep the same rhythm.`;
  return `${lead} The ${FINGER_LABEL[w].toLowerCase()} still lags: next set, move it first.`;
}

/** One factual line at a stage change, with no model involved. */
export function stageLine(outcome: Pick<RepOutcome, 'event' | 'state'>, wrong: Finger[] = []): string {
  switch (outcome.event) {
    case 'advanced':
      return outcome.state.stage === 'ghost'
        ? `The strings are cut. Now only the ghost${wrong.length ? `, and it will mark the ${names(wrong)}` : ''}.`
        : 'The ghost fades. Now without any help.';
    case 'mastered':
      return 'Mastered. Clean reps with no help. Come back tomorrow for the review.';
    case 'dropped':
      return outcome.state.stage === 'strings' ? 'Back to the strings for a steadier hand.' : 'Back one stage. The help returns for a while.';
    default:
      return '';
  }
}

/** Review day line: how many steps wait, one blind try each. */
export function reviewLine(due: number): string {
  if (due <= 0) return 'Nothing is due today.';
  return `${due === 1 ? 'One step is' : `${due} steps are`} due. One blind try each.`;
}
