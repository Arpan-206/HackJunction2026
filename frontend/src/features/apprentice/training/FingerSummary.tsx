import { FINGERS } from '../../../api/types';
import type { AttemptPolicy } from './coach/fade';
import { FINGER_LABEL } from './coach/tips';
import { useCoachView, type Coach } from './coach/useCoach';

interface FingerSummaryProps {
  coach: Coach;
  policy: AttemptPolicy;
}

/**
 * A screen-reader summary of which fingers are off, announced politely when the set changes. The sighted learner sees the
 * vermilion rings in the scene instead, so this stays visually hidden. Messages carry no magnitudes so they stay stable.
 */
export function FingerSummary({ coach, policy }: FingerSummaryProps) {
  const view = useCoachView(coach);
  const guiding = policy.liveCoach && view.hasLearner;
  const off = FINGERS.filter((f) => view.status[f] === 'off');
  const text = !guiding
    ? ''
    : off.length === 0
      ? 'All fingers are in line.'
      : off.map((f) => `${FINGER_LABEL[f]}: ${view.deviation[f] > 0 ? 'uncurl a little' : 'curl a little more'}`).join('. ') + '.';
  return (
    <p className="ap-sr" aria-live="polite" aria-atomic="true">
      {text}
    </p>
  );
}
