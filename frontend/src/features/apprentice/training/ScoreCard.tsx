import { FINGERS, type ScoreResult } from '../../../api/types';
import { Badge, Button, Card } from '../../../components/ui';
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
  /** What the live coach saw during the attempt, in one sentence. */
  liveNote?: string | null;
}

const MASTERY = 85;

/** The terminal score after an attempt: big overall number, per-finger bars, timing, worst finger and a hint. */
export function ScoreCard({ result, attempt, source, onRetry, onRestart, nextLabel, onNext, liveNote }: ScoreCardProps) {
  const mastery = result.overall >= MASTERY && result.within_tolerance;
  return (
    <Card as="section" className="ap-score" aria-label={`Score for attempt ${attempt}`}>
      <div className="ap-score__top">
        <div>
          <p className="ap-kicker">Attempt {attempt}</p>
          <p className="ap-score__big" aria-label={`Overall score ${result.overall} out of 100`}>
            {Math.round(result.overall)}
            <span className="ap-score__of">/100</span>
          </p>
        </div>
        <div className="ap-score__badges">
          {mastery ? <Badge tone="gold">Mastery</Badge> : result.within_tolerance ? <Badge tone="ok">Within tolerance</Badge> : <Badge tone="danger">Keep practising</Badge>}
          {source === 'local' && <Badge>Estimated on this device</Badge>}
        </div>
      </div>

      <ul className="ap-bars" aria-label="Score per finger">
        {FINGERS.map((f) => {
          const v = Math.round(result.per_finger[f]);
          const worst = f === result.worst_finger;
          return (
            <li key={f} className="ap-bar">
              <span className="ap-bar__name">{FINGER_LABEL[f]}</span>
              <span className="ap-bar__track" role="presentation">
                <span className={`ap-bar__fill ${v >= 70 ? 'ap-bar__fill--ok' : 'ap-bar__fill--off'}`} style={{ width: `${v}%` }} />
              </span>
              <span className="ap-bar__val">{v}</span>
              {worst && v < 100 && <span className="ap-bar__flag">weakest</span>}
            </li>
          );
        })}
        <li className="ap-bar">
          <span className="ap-bar__name">Timing</span>
          <span className="ap-bar__track" role="presentation">
            <span className={`ap-bar__fill ${result.timing >= 70 ? 'ap-bar__fill--ok' : 'ap-bar__fill--off'}`} style={{ width: `${result.timing}%` }} />
          </span>
          <span className="ap-bar__val">{Math.round(result.timing)}</span>
        </li>
      </ul>

      {liveNote && <p className="note ap-score__hint">{liveNote}</p>}
      <p className="note ap-score__hint">
        Weakest: {FINGER_LABEL[result.worst_finger]}. {result.hint}
      </p>

      <div className="ap-score__actions">
        <Button large onClick={onRetry}>
          Try again
        </Button>
        <Button variant="secondary" onClick={onRestart}>
          Restart with full guidance
        </Button>
        {onNext && (
          <Button variant="secondary" onClick={onNext}>
            {nextLabel ?? 'Next'}
          </Button>
        )}
      </div>
    </Card>
  );
}
