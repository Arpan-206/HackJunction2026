import type { MotionSpec, Side } from '../../../api';
import { Button } from '../../../components/ui';
import { MOTION_TEXT_MAX, motionProviderLine, useMotionFromText } from '../../shared/useMotionFromText';

interface DescribeMotionProps {
  side: Side;
  stepNumber: number;
  /** Receives the motion the AI chose, to replace the step's mock guide. */
  onMotion: (motion: MotionSpec) => void;
}

/** A small "Describe the movement" line for one step: say it in words, the mock guide hand changes to match. */
export function DescribeMotion({ side, stepNumber, onMotion }: DescribeMotionProps) {
  const m = useMotionFromText(side);
  const id = `describe-${stepNumber}`;

  const apply = async () => {
    const r = await m.run();
    if (r) onMotion(r.motion);
  };

  return (
    <div className="mst-describe">
      <label className="field__label" htmlFor={id}>
        Describe the movement
      </label>
      <div className="mst-describe__row">
        <input
          id={id}
          className="field__control"
          value={m.text}
          maxLength={MOTION_TEXT_MAX}
          placeholder="a slow pinch, or each finger in turn"
          onChange={(e) => m.setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void apply();
            }
          }}
        />
        <Button variant="secondary" onClick={() => void apply()} disabled={m.busy || !m.text.trim()}>
          {m.busy ? 'Reading...' : 'Show me'}
        </Button>
      </div>
      {m.error && (
        <p className="mst-alert mst-alert--error" role="alert">
          {m.error}
        </p>
      )}
      {m.result && !m.error && (
        <p className="mst-describe__note" role="status">
          {m.result.explanation} {motionProviderLine(m.result.provider)}
        </p>
      )}
    </div>
  );
}
