import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FINGERS, type Finger, type ScoreResult } from '../../../api/types';
import { Button } from '../../../components/ui';
import { FINGER_LABEL } from './coach/tips';

interface ScoreCardProps {
  result: ScoreResult;
  attempt: number;
  /** Where the numbers came from; the local summary stands in when the backend is unreachable. */
  source: 'backend' | 'local';
  onRetry: () => void;
  onRestart: () => void;
  nextLabel?: string;
  onNext?: () => void;
  /** Where to find the practice plan; offered quietly from the third attempt onwards. */
  planTo?: string;
  /** Coach lines from the pipeline: the one-liner for this rep, the stage change and the set summary. */
  lines?: { rep?: string; stage?: string; set?: string };
  /** Whether the rep was clean, and the combo it leaves behind. */
  clean?: boolean;
  combo?: { count: number; need: number };
  retryLabel?: string;
  restartLabel?: string;
  /** Extra content under the buttons, such as the plan for tomorrow. */
  footer?: ReactNode;
}

/** Overall score from which the numeral turns gold, provided every finger was also inside the tolerance. */
const MASTERY = 90;
const OK_FROM = 70;
const NAMED_FINGER = /\b(thumb|(?:index|middle|ring|little) finger)\b/gi;

/** The finger with the lowest displayed score; the backend's own pick only breaks a tie. */
export function weakestFinger(result: ScoreResult): Finger {
  let worst = result.worst_finger;
  for (const f of FINGERS) {
    if (Math.round(result.per_finger[f]) < Math.round(result.per_finger[worst])) worst = f;
  }
  return worst;
}

/** The scorer's hint, kept only when it does not name a finger other than the weakest one (so the card never contradicts itself). */
function consistentHint(hint: string, weakest: Finger): string | null {
  const want = FINGER_LABEL[weakest].toLowerCase();
  const named = hint.match(NAMED_FINGER) ?? [];
  return named.some((n) => n.toLowerCase() !== want) ? null : hint;
}

/**
 * The terminal result of an attempt, shown as the full-width state of the stage: a large Cinzel numeral (gold only at
 * mastery), per-finger bars, timing and one line about the weakest finger, all derived from the displayed scores.
 */
export function ScoreCard({ result, attempt, source, onRetry, onRestart, nextLabel, onNext, planTo, lines, clean, combo, retryLabel, restartLabel, footer }: ScoreCardProps) {
  const overall = Math.round(result.overall);
  const mastery = overall >= MASTERY && result.within_tolerance;
  const weakest = weakestFinger(result);
  const weakScore = Math.round(result.per_finger[weakest]);
  const allGood = weakScore >= OK_FROM;
  const hint = allGood ? null : consistentHint(result.hint, weakest);
  const timingWeak = result.timing < OK_FROM;
  const summary = allGood
    ? `Every finger held the shape.${timingWeak ? ` Timing was the weak point at ${Math.round(result.timing)}.` : ''}`
    : `${FINGER_LABEL[weakest]} was weakest at ${weakScore}.`;
  const verdict = result.within_tolerance ? 'Within the tolerance.' : allGood && timingWeak ? 'Timing was outside the tolerance.' : 'Outside the tolerance.';
  return (
    <section className="ap-score" aria-label={`Score for attempt ${attempt}`}>
      <div className="ap-score__numeral">
        <p className={`ap-score__big ${mastery ? 'ap-score__big--gold' : ''}`} aria-label={`Overall score ${overall} out of 100`}>
          {overall}
        </p>
        <p className="ap-score__of">out of 100, attempt {attempt}</p>
        <p className="ap-score__verdict">
          {verdict}
          {source === 'local' && ' Estimated on this device.'}
        </p>
      </div>

      <div className="ap-score__detail">
        <ul className="ap-bars" aria-label="Score per finger">
          {FINGERS.map((f) => {
            const v = Math.round(result.per_finger[f]);
            return (
              <li key={f} className="ap-bar">
                <span className="ap-bar__name">{FINGER_LABEL[f]}</span>
                <span className="ap-bar__track" role="presentation">
                  <span className={`ap-bar__fill ${v >= OK_FROM ? 'ap-bar__fill--ok' : 'ap-bar__fill--off'}`} style={{ width: `${v}%` }} />
                </span>
                <span className={`ap-bar__val ${f === weakest && !allGood ? 'ap-bar__val--off' : ''}`}>{v}</span>
              </li>
            );
          })}
          <li className="ap-bar ap-bar--timing">
            <span className="ap-bar__name">Timing</span>
            <span className="ap-bar__track" role="presentation">
              <span className={`ap-bar__fill ${result.timing >= OK_FROM ? 'ap-bar__fill--ok' : 'ap-bar__fill--off'}`} style={{ width: `${Math.round(result.timing)}%` }} />
            </span>
            <span className="ap-bar__val">{Math.round(result.timing)}</span>
          </li>
        </ul>
        <p className="ap-score__hint">{lines?.rep ?? `${summary} ${hint ?? ''}`}</p>
        {clean !== undefined && combo && (
          <p className={`ap-score__combo ${clean ? 'ap-score__combo--clean' : ''}`}>
            {clean ? `Clean rep. ${combo.count} in a row${combo.count > 0 && combo.count < combo.need ? `, ${combo.need - combo.count} more to move on.` : '.'}` : 'Not clean this time. The count starts again.'}
          </p>
        )}
        {lines?.stage && <p className="ap-score__stage">{lines.stage}</p>}
        {lines?.set && <p className="ap-score__set">{lines.set}</p>}
        {(result.warnings?.length ?? 0) > 0 && (
          <ul className="ap-score__warnings" aria-label="Notes about this score">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {planTo && attempt >= 3 && (
          <p className="ap-score__plan">
            Three attempts in. <Link to={planTo}>Ask for a plan for tomorrow</Link>.
          </p>
        )}
        <div className="ap-score__actions">
          <Button large onClick={onRetry}>
            {retryLabel ?? 'Try again'}
          </Button>
          <Button variant="secondary" onClick={onRestart}>
            {restartLabel ?? 'Restart with full guidance'}
          </Button>
          {onNext && (
            <Button variant="secondary" onClick={onNext}>
              {nextLabel ?? 'Next'}
            </Button>
          )}
        </div>
        {footer}
      </div>
    </section>
  );
}
