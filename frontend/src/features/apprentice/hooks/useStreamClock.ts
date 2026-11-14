import { useEffect, useRef } from 'react';
import type { GloveStreamHandle } from '../../../api';

/** Reads "now" on the glove stream's own clock, so game events line up with frame timestamps. */
export interface StreamClock {
  /** Stream seconds now, extrapolated between frames. 0 before the first frame. */
  now: () => number;
  /** Stream time of the latest frame that has been processed; use it to expire notes so queued frames are never overtaken. */
  lastFrame: () => number;
  /** Whether the most recent frame came from the simulator, which can be phase-locked. */
  simulated: () => boolean;
  /** Whether any frame has arrived in the last half second. */
  live: () => boolean;
}

/** Tracks the stream clock without re-rendering: stores the last frame time against the wall clock. */
export function useStreamClock(gloves: GloveStreamHandle): StreamClock {
  const last = useRef({ t: 0, wall: 0, source: '' });
  useEffect(
    () =>
      gloves.onFrame((f) => {
        last.current = { t: f.t, wall: performance.now(), source: f.source };
      }),
    [gloves],
  );
  const clock = useRef<StreamClock>({
    now: () => (last.current.wall ? last.current.t + (performance.now() - last.current.wall) / 1000 : 0),
    lastFrame: () => last.current.t,
    simulated: () => last.current.source === 'simulator',
    live: () => last.current.wall > 0 && performance.now() - last.current.wall < 500,
  });
  return clock.current;
}
