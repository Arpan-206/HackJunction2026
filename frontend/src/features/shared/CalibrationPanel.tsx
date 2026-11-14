import type { Side } from '../../api';
import { Button, Card, Countdown } from '../../components/ui';
import type { CalibrationHandle } from './useCalibration';
import { CALIBRATION_SECONDS, formatWhen } from '../master/lib';

interface CalibrationPanelProps {
  side: Side;
  onSide: (s: Side) => void;
  cal: CalibrationHandle;
  /** Smaller layout for use inside a dialog. */
  compact?: boolean;
  /** Hides the left or right choice when the glove is already decided, as in the training room. */
  hideSide?: boolean;
  /** Replaces the line shown while no calibration exists. */
  missingNote?: string;
  /** Replaces the card title. */
  title?: string;
}

const PROMPTS = {
  flat: { caption: 'Hold your hand flat and open, palm down, fingers pointing at the screen', capture: 'Keep your hand flat and still, fingers at the screen' },
  fist: { caption: 'Now curl into a loose, relaxed fist', capture: 'Hold the loose fist' },
} as const;

/**
 * Guided glove calibration: a flat hand, then a loose fist, each with a 3-2-1 countdown and a progress bar
 * while the backend samples the glove. Shows when the glove was last calibrated.
 */
export function CalibrationPanel({ side, onSide, cal, compact, hideSide, missingNote, title = 'Calibrate the glove' }: CalibrationPanelProps) {
  const { phase, latest, loading, error } = cal;
  const running = phase !== 'idle';
  const which = phase.endsWith('flat') ? 'flat' : 'fist';
  const step = which === 'flat' ? 1 : 2;

  return (
    <Card title={title} className={compact ? 'mst-cal mst-cal--compact' : 'mst-cal mst-cal--secondary'}>
      <div className="mst-cal__status">
        {loading ? (
          <span className="mst-line">Checking the glove...</span>
        ) : latest ? (
          <>
            <span className="mst-ok">Calibrated</span>
            <span className="note">last calibrated {formatWhen(latest.created_at)}</span>
          </>
        ) : (
          <span className="mst-line">{missingNote ?? 'Not calibrated yet. Do this once per glove before recording.'}</span>
        )}
      </div>
      <div className="mst-cal__row">
        {!hideSide && (
          <div className="mst-seg" role="group" aria-label="Which glove">
            {(['right', 'left'] as const).map((s) => (
              <Button key={s} variant="toggle" aria-pressed={side === s} onClick={() => onSide(s)} disabled={running}>
                {s === 'right' ? 'Right hand' : 'Left hand'}
              </Button>
            ))}
          </div>
        )}
        <Button variant="secondary" onClick={cal.start} disabled={running}>
          {latest ? 'Calibrate again' : 'Calibrate'}
        </Button>
      </div>
      {error && (
        <p className="mst-alert mst-alert--error" role="alert">
          {error}
        </p>
      )}

      {(phase === 'countdown-flat' || phase === 'countdown-fist') && (
        <Countdown key={phase} caption={`Step ${step} of 2: ${PROMPTS[which].caption}`} onDone={cal.countdownDone} />
      )}
      {(phase === 'capture-flat' || phase === 'capture-fist') && (
        <div className="mst-capture" role="status" aria-live="polite">
          <p className="mst-capture__step">Step {step} of 2</p>
          <p className="mst-capture__text">{PROMPTS[which].capture}</p>
          <div className="mst-progress" role="progressbar" aria-label="Capturing" aria-valuemin={0} aria-valuemax={100}>
            <div key={phase} className="mst-progress__bar" style={{ animationDuration: `${CALIBRATION_SECONDS}s` }} />
          </div>
        </div>
      )}
    </Card>
  );
}
