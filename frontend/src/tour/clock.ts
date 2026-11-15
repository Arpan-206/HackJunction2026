import { useCallback, useEffect, useRef, useState } from 'react';

/** True when the visitor asked the system for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export interface LoopClock {
  /** Seconds into the current loop, read every render frame by the 3D hands. */
  now: () => number;
  playing: boolean;
  toggle: () => void;
  /** The loop time, updated about 8 times a second for the text beside the stage. */
  shown: number;
}

/**
 * One looping clock for a stop: the 3D hands read now() every frame, the page reads `shown`. It starts paused when the
 * visitor prefers reduced motion.
 */
export function useLoopClock(duration: number): LoopClock {
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const state = useRef({ start: performance.now(), pausedAt: 0 });
  const [shown, setShown] = useState(0);

  const now = useCallback(() => {
    const s = state.current;
    const d = Math.max(0.1, duration);
    const raw = playing ? (performance.now() - s.start) / 1000 : s.pausedAt;
    return ((raw % d) + d) % d;
  }, [duration, playing]);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      const s = state.current;
      if (p) s.pausedAt = (performance.now() - s.start) / 1000;
      else s.start = performance.now() - s.pausedAt * 1000;
      return !p;
    });
  }, []);

  useEffect(() => {
    if (!playing) {
      setShown(now());
      return;
    }
    const id = window.setInterval(() => setShown(now()), 125);
    return () => window.clearInterval(id);
  }, [playing, now]);

  return { now, playing, toggle, shown };
}
