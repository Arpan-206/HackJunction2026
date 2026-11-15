import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Finger, HandFrame, ModelProvider, ScoreResult, Side, Tolerance } from '../../../api/types';
import { Button } from '../../../components/ui';
import { isOfflineProvider } from '../../shared/providerLabel';
import { LEARNER_DEFAULT_MARGIN, marginSentence } from '../../shared/settings';
import { FINGER_LABEL } from './coach/tips';
import { isMastery, MASTERY, OK_FROM, weakestFinger } from './score/scoreRules';
import { ScoreView } from './score/ScoreView';

export { weakestFinger };

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
  /** The hand drawn in the 3D score, and its side. */
  pose?: HandFrame | null;
  side?: Side;
  /** Fingers the step weights too little to correct (lightFingers); never named as the one to fix. */
  light?: readonly Finger[];
  /** The step's own tolerance, so the margin line can say what the margin allowed. */
  tolerance?: Tolerance;
  /**
   * The rep in plain words (POST /coach/review): shown as the main sentence. `provider` null means the sentence was built
   * on this device and the AI Assistant's version may still arrive.
   */
  feedback?: { text: string; provider: ModelProvider | null } | null;
}

/** Whether a language model wrote the feedback (not the backend's own sentence, a template or the offline note). */
export function writtenByModel(provider: ModelProvider | null | undefined): boolean {
  return !!provider && provider !== 'algorithmic' && provider !== 'algorithm' && provider !== 'mock' && !isOfflineProvider(provider);
}

const NAMED_FINGER = /\b(thumb|(?:index|middle|ring|little) finger)\b/gi;

/** The scorer's hint, kept only when it does not name a finger other than the weakest one (so the card never contradicts itself). */
function consistentHint(hint: string, weakest: Finger): string | null {
  const want = FINGER_LABEL[weakest].toLowerCase();
  const named = hint.match(NAMED_FINGER) ?? [];
  return named.some((n) => n.toLowerCase() !== want) ? null : hint;
}

/**
 * The terminal result of an attempt, shown as the full-width state of the stage: the score as a 3D scene or a flat chart
 * (Settings, or click to flip), a large Cinzel numeral (gold only at mastery), the margin of error it was judged with, and
 * one line about the weakest finger, all derived from the displayed scores.
 */
export function ScoreCard({ result, attempt, source, onRetry, onRestart, nextLabel, onNext, planTo, lines, clean, combo, retryLabel, restartLabel, footer, pose, side = 'right', tolerance, light = [], feedback }: ScoreCardProps) {
  const overall = Math.round(result.overall);
  const mastery = isMastery(result);
  const margin = result.margin ?? 'standard';
  // A high rep while just trying it is good work, but gold needs a tighter margin (scoreRules.isMastery).
  const goldKept = !mastery && overall >= MASTERY && result.within_tolerance && margin === 'just_trying';
  const weakest = weakestFinger(result, light);
  const weakScore = Math.round(result.per_finger[weakest]);
  const allGood = weakScore >= OK_FROM;
  const hint = allGood ? null : consistentHint(result.hint, weakest);
  const timingWeak = result.timing < OK_FROM;
  const summary = allGood
    ? `Every finger held the shape.${timingWeak ? ` Timing was the weak point at ${Math.round(result.timing)}.` : ''}`
    : `${FINGER_LABEL[weakest]} was weakest at ${weakScore}.`;
  const verdict = result.within_tolerance ? 'A clean rep.' : 'Close. Not clean yet.';
  // The margin is named only when the learner chose one other than the one they start on (Settings).
  const showMargin = margin !== LEARNER_DEFAULT_MARGIN || goldKept;
  const main = feedback?.text ?? lines?.rep ?? `${summary} ${hint ?? ''}`;
  return (
    <section className="ap-score" aria-label={`Score for attempt ${attempt}`}>
      <ScoreView result={result} weakest={weakest} allGood={allGood} mastery={mastery} pose={pose} side={side} attempt={attempt} />

      <div className="ap-score__detail">
        <div className="ap-score__numeral">
          <p className={`ap-score__big ${mastery ? 'ap-score__big--gold' : ''}`} aria-label={`Overall score ${overall} out of 100`}>
            {overall}
          </p>
          <div className="ap-score__head">
            <p className="ap-score__of">out of 100, attempt {attempt}</p>
            <p className="ap-score__verdict">
              {verdict}
              {source === 'local' && ' Estimated on this device.'}
            </p>
          </div>
        </div>
        {showMargin && (
          <p className="ap-score__margin">
            {marginSentence(margin, tolerance)}
            {goldKept && ' Gold is kept for a tighter margin.'}
          </p>
        )}
        <p className="ap-score__hint" aria-live="polite">
          {main}
        </p>
        {writtenByModel(feedback?.provider) && <p className="ap-score__by">Written by the AI Assistant.</p>}
        {clean !== undefined && combo && (
          <p className={`ap-score__combo ${clean ? 'ap-score__combo--clean' : ''}`}>
            {clean ? `${combo.count} in a row${combo.count > 0 && combo.count < combo.need ? `, ${combo.need - combo.count} more to move on.` : '.'}` : 'The count starts again.'}
          </p>
        )}
        {lines?.stage && <p className="ap-score__stage">{lines.stage}</p>}
        {lines?.set && <p className="ap-score__set">{lines.set}</p>}
        {(result.warnings?.length ?? 0) > 0 && (
          <details className="ap-score__tech">
            <summary>Technical notes</summary>
            <ul className="ap-score__warnings" aria-label="Notes about this score">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
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
