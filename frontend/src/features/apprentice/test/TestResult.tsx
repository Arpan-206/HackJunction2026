import type { ReactNode } from 'react';
import { Badge, Button, ButtonLink, Card } from '../../../components/ui';

interface TestResultProps {
  title: string;
  /** The headline score for the player. */
  score: number | string;
  scoreLabel: string;
  verdict: 'win' | 'lose' | 'draw';
  verdictText: string;
  bestMoment: string;
  details?: ReactNode;
  onAgain: () => void;
}

/** The finale screen for both tests: the score, who won, the best moment, and the way back to the lessons. */
export function TestResult({ title, score, scoreLabel, verdict, verdictText, bestMoment, details, onAgain }: TestResultProps) {
  return (
    <Card as="section" className="ap-result" aria-label="Test result">
      <p className="ap-kicker">{title}</p>
      <p className="ap-result__score" aria-label={`${scoreLabel}: ${score}`}>
        {score}
      </p>
      <p className="ap-result__label">{scoreLabel}</p>
      <Badge tone={verdict === 'win' ? 'gold' : verdict === 'draw' ? 'neutral' : 'danger'}>{verdictText}</Badge>
      {details}
      <div className="ap-result__best">
        <p className="ap-kicker">Best moment</p>
        <p className="note">{bestMoment || 'Play a little more to earn a best moment.'}</p>
      </div>
      <div className="ap-result__actions">
        <Button large onClick={onAgain}>
          Play again
        </Button>
        <ButtonLink to="/apprentice" variant="secondary" large>
          Back to lessons
        </ButtonLink>
      </div>
    </Card>
  );
}
