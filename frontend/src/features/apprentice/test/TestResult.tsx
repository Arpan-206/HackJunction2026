import type { ReactNode } from 'react';
import { Button, ButtonLink, Card } from '../../../components/ui';

interface TestResultProps {
  title: string;
  /** The headline score for the player. */
  score: number | string;
  scoreLabel: string;
  verdict: 'win' | 'lose' | 'draw';
  verdictText: string;
  bestMoment: string;
  details?: ReactNode;
  /** Shown under the best moment, such as the Master's Seal. */
  footer?: ReactNode;
  onAgain: () => void;
}

/** Splits a verdict such as "You beat the bot pianist" so the word "beat" can be set in gold italic. */
function headline(text: string) {
  const at = text.search(/\bbeat\b/);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <em className="ap-gold-word">beat</em>
      {text.slice(at + 4)}
    </>
  );
}

/** The finale screen for both tests: the score, who won, the best moment, and the way back to the lessons. */
export function TestResult({ title, score, scoreLabel, verdict, verdictText, bestMoment, details, footer, onAgain }: TestResultProps) {
  return (
    <Card as="section" className="ap-result" aria-label="Test result">
      <h2 className={`ap-result__headline ap-result__headline--${verdict}`}>{headline(verdictText)}</h2>
      <p className="ap-result__context">{title}</p>
      <p className="ap-result__score" aria-label={`${scoreLabel}: ${score}`}>
        {score}
      </p>
      <p className="ap-result__label">{scoreLabel}</p>
      {details}
      <div className="ap-result__best">
        <p className="ap-result__best-title">Best moment</p>
        <p className="note">{bestMoment || 'Play a little more to earn a best moment.'}</p>
      </div>
      {footer}
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
