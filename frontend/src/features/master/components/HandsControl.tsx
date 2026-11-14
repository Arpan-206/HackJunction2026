import type { Hands } from '../../../api';
import { Button } from '../../../components/ui';
import { handsLabel } from '../../shared/sessionPrefs';

interface HandsControlProps {
  value: Hands;
  onChange: (h: Hands) => void;
  /** When set, capture has started: the choice shows as a summary with this reason instead of the buttons. */
  locked?: string | null;
  /** Names the group for screen readers when several sit on one page, e.g. "for step 2". */
  context?: string;
}

/**
 * Which hands a move is captured with: one hand (left or right) or two. It decides which gloves the stage shows, what the
 * take stores and how the learner trains. Once capture starts it collapses into a one-line summary.
 */
export function HandsControl({ value, onChange, locked, context }: HandsControlProps) {
  if (locked) {
    return (
      <p className="mst-hands mst-hands--summary">
        <span className="mst-hands__label">Hands</span>
        <strong>{handsLabel(value)}</strong>
        <span className="note">{locked}</span>
      </p>
    );
  }
  const one = value !== 'both';
  return (
    <fieldset className="mst-hands">
      <legend className="mst-hands__label">Hands</legend>
      <div className="mst-hands__row">
        <div className="mst-seg" role="group" aria-label={`How many hands${context ? ` ${context}` : ''}`}>
          <Button variant="toggle" aria-pressed={one} onClick={() => !one && onChange('right')}>
            One hand
          </Button>
          <Button variant="toggle" aria-pressed={!one} onClick={() => one && onChange('both')}>
            Two hands
          </Button>
        </div>
        {one && (
          <div className="mst-seg" role="group" aria-label={`Which hand${context ? ` ${context}` : ''}`}>
            <Button variant="toggle" aria-pressed={value === 'left'} onClick={() => onChange('left')}>
              Left
            </Button>
            <Button variant="toggle" aria-pressed={value === 'right'} onClick={() => onChange('right')}>
              Right
            </Button>
          </div>
        )}
      </div>
      <span className="note">{one ? `Only the ${value} glove is captured and shown.` : 'Both gloves are captured and shown.'}</span>
    </fieldset>
  );
}
