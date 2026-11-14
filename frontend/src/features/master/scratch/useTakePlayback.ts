import { useEffect, useMemo, useRef } from 'react';
import type { HandFrame, Side } from '../../../api';
import { usePlayback, type PlaybackControls } from '../../shared/playback';
import { useRecording } from '../hooks/useRecording';

export interface TakePlayback {
  /** The take is fetched and ready to draw. */
  ready: boolean;
  loading: boolean;
  error: string | null;
  pb: PlaybackControls;
  /** What the Record stage draws in place of the live hand, or null while nothing plays. */
  stage: { getFrame: (side: Side) => HandFrame | null; ghost?: (side: Side) => HandFrame | null } | null;
}

/**
 * One take played back on the Record stage, looping until stopped, with play, pause and scrub. With `compareId` (the
 * reference take) a second clock plays that take as a ghost, stretched to the same length so both start and end together
 * and follow the same pause and scrub.
 */
export function useTakePlayback(takeId: string | null, compareId: string | null): TakePlayback {
  const take = useRecording(takeId);
  const ref = useRecording(compareId);
  const pb = usePlayback(takeId ? (take.recording?.frames ?? null) : null, { loop: true });
  const refPb = usePlayback(compareId ? (ref.recording?.frames ?? null) : null, { loop: true, autoPlay: false });
  const { duration, position, playing, rate } = pb;
  const refDuration = refPb.duration;

  // The ghost follows the take's clock: same phase, same pause, a rate that makes both lengths match.
  const stretch = duration > 0 && refDuration > 0 ? refDuration / duration : 1;
  // The ghost's controls change identity every render; read them through a ref so syncing never loops.
  const refControls = useRef(refPb);
  refControls.current = refPb;
  useEffect(() => {
    const r = refControls.current;
    if (!compareId || !refDuration) return;
    r.setRate(rate * stretch);
    r.seek(Math.min(position * stretch, refDuration));
    if (playing) r.play();
    else r.pause();
    // Re-sync on play state, scrub and the coarse position tick; the clocks drift too little between ticks to matter.
  }, [compareId, refDuration, stretch, rate, playing, position]);

  const ready = Boolean(takeId && take.recording);
  const getFrame = pb.getFrame;
  const ghostFrame = refPb.getFrame;
  const showGhost = Boolean(compareId && ref.recording);
  const stage = useMemo(() => (ready ? { getFrame, ghost: showGhost ? ghostFrame : undefined } : null), [ready, getFrame, ghostFrame, showGhost]);
  return { ready, loading: take.loading, error: take.error ? take.error.message : null, pb, stage };
}
