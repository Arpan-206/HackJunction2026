import type { Prop } from '../../api';
import { Button } from '../../components/ui';
import { PROP_NOTE, useShowProps } from './sessionPrefs';

const NAMES: Record<Prop, string> = { none: 'prop', racket: 'racket', keyboard: 'keyboard', ball: 'ball' };

/**
 * The quiet "Add a prop" switch: draws the move's prop (racket, keyboard) with the hands. Off by default and remembered on this
 * device; the same default is in Settings. Renders nothing for a move without a prop.
 */
export function PropSwitch({ prop, className }: { prop: Prop | undefined; className?: string }) {
  const [on, setOn] = useShowProps();
  if (!prop || prop === 'none') return null;
  return (
    <div className={`prop-switch ${className ?? ''}`}>
      <Button variant="toggle" aria-pressed={on} onClick={() => setOn(!on)}>
        Add a prop
      </Button>
      <span className="note">{on ? `The ${NAMES[prop]} is shown. ${PROP_NOTE}` : PROP_NOTE}</span>
    </div>
  );
}
