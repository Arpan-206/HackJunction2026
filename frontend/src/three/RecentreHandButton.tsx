import { useEffect, useState } from 'react';
import { recentreHandPosition, useFollowsHandPosition } from './handPosition';
import './stageOrbit.css';

/** How long the button says the hand was recentred, milliseconds. */
const DONE_MS = 1600;

/**
 * "Recentre hand", over a corner of the learner's stage on a skill whose hand follows the phone's depth (table tennis).
 * When the depth position drifts and the hand ends up at the edge, one press makes where the hand is now its centre
 * again: no calibration, nothing sent to the core. Hidden on every other skill.
 */
export function RecentreHandButton({ corner = 'bottom-left' }: { corner?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' }) {
  const on = useFollowsHandPosition();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), DONE_MS);
    return () => window.clearTimeout(id);
  }, [done]);
  if (!on) return null;
  return (
    <button
      type="button"
      className={`stage-recentre stage-reset--${corner}`}
      title="The hand drifted? Make where it is now the middle of the stage again. No calibration needed."
      onClick={() => {
        recentreHandPosition();
        setDone(true);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r="6.5" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
      </svg>
      <span aria-live="polite">{done ? 'Hand recentred' : 'Recentre hand'}</span>
    </button>
  );
}
