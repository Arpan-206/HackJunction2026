import { useEffect, useRef } from 'react';
import type { GloveSource, GloveStreamHandle, Side } from '../../../api';
import { CalibrationPanel } from '../../shared/CalibrationPanel';
import type { CalibrationHandle } from '../../shared/useCalibration';

interface GlovesControlProps {
  glove: GloveStreamHandle;
  source: GloveSource | null;
  side: Side;
  cal: CalibrationHandle;
}

/** The glove's state in a few words: what feeds the stream and whether it is calibrated. */
export function glovesLine(status: GloveStreamHandle['status'], source: GloveSource | null, calibrated: boolean): string {
  if (status !== 'open') return 'Gloves: not connected';
  if (source === 'simulator') return 'Gloves: simulated';
  return calibrated ? 'Gloves: live, calibrated' : 'Gloves: live, not calibrated';
}

/**
 * A small "Gloves" control for the Record screen: one line saying what feeds the stream, which opens a panel with the
 * connection note and calibration. Calibration is there when it is needed, never in the way of recording.
 */
export function GlovesControl({ glove, source, side, cal }: GlovesControlProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const line = glovesLine(glove.status, source, Boolean(cal.latest));

  // Close on Escape or on a click outside, like any popover; a running calibration keeps it open.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = (e: Event) => {
      if (!el.open || cal.phase !== 'idle') return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [cal.phase]);

  return (
    <details ref={ref} className="scr-gloves">
      <summary className="scr-gloves__summary">
        <span className={`scr-gloves__dot scr-gloves__dot--${glove.status === 'open' ? 'on' : 'off'}`} aria-hidden="true" />
        {line}
      </summary>
      <div className="scr-gloves__panel">
        {glove.status !== 'open' && (
          <p className="note">The glove stream is not connected. Is the backend running on port 8000? The hand rests until it is.</p>
        )}
        {source === 'simulator' && glove.status === 'open' && <p className="note">No gloves are worn: the simulator plays the move so takes still record.</p>}
        <CalibrationPanel side={side} onSide={() => undefined} cal={cal} compact hideSide title="Calibrate" missingNote="Not calibrated yet. Calibrate once per glove before your first take." />
      </div>
    </details>
  );
}
