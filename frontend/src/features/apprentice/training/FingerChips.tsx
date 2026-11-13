import { FINGERS } from '../../../api/types';
import type { AttemptPolicy } from './coach/fade';
import { FINGER_LABEL } from './coach/tips';
import { useCoachView, type Coach } from './coach/useCoach';

interface FingerChipsProps {
  coach: Coach;
  policy: AttemptPolicy;
  compact?: boolean;
}

/** One chip per finger: malachite when inside the tolerance, vermilion with a plain instruction when it is not. */
export function FingerChips({ coach, policy, compact }: FingerChipsProps) {
  const view = useCoachView(coach);
  const guiding = policy.liveCoach && view.hasLearner;
  return (
    <ul className={`ap-chips ${compact ? 'ap-chips--compact' : ''}`} aria-label="Finger status">
      {FINGERS.map((f) => {
        const off = guiding && view.status[f] === 'off';
        const d = Math.round(view.deviation[f]);
        const word = !guiding ? 'No data' : off ? (d > 0 ? `Uncurl ${Math.abs(d)}°` : `Curl ${Math.abs(d)}°`) : 'In line';
        return (
          <li key={f} className={`ap-chip ${!guiding ? 'ap-chip--idle' : off ? 'ap-chip--off' : 'ap-chip--ok'}`}>
            <span className="ap-chip__name">{compact ? FINGER_LABEL[f].replace(' finger', '') : FINGER_LABEL[f]}</span>
            <span className="ap-chip__state">{word}</span>
          </li>
        );
      })}
    </ul>
  );
}
