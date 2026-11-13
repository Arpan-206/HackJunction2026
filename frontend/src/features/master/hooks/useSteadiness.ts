import { useCallback, useEffect, useRef, useState } from 'react';
import { useDevState, type GloveSource } from '../../../api';

/** Cut-off range of the One Euro filter: steadier means a lower cut-off (more smoothing). */
const CUTOFF_MAX = 4;
const CUTOFF_MIN = 0.4;
const BETA_MAX = 1.2;
const BETA_MIN = 0.06;
const DEBOUNCE_MS = 180;

/** Maps the 0..1 "Steadiness" slider to One Euro parameters, geometrically so each notch feels even. */
export function steadinessToFilter(s: number): { min_cutoff: number; beta: number } {
  return {
    min_cutoff: CUTOFF_MAX * Math.pow(CUTOFF_MIN / CUTOFF_MAX, s),
    beta: BETA_MAX * Math.pow(BETA_MIN / BETA_MAX, s),
  };
}

function cutoffToSteadiness(c: number): number {
  const s = Math.log(c / CUTOFF_MAX) / Math.log(CUTOFF_MIN / CUTOFF_MAX);
  return Math.min(1, Math.max(0, s));
}

export interface SteadinessHandle {
  online: boolean;
  /** 0 (responsive, shows every tremor) to 1 (very steady, slight lag). */
  steadiness: number;
  setSteadiness: (v: number) => void;
  /** True when smoothing is bypassed and the raw glove signal is streamed. */
  raw: boolean;
  setRaw: (raw: boolean) => void;
  gloveSource: GloveSource | null;
  error: string | null;
}

/** Reads and tunes the backend smoothing stage through /api/dev/state. Slider moves are debounced. */
export function useSteadiness(): SteadinessHandle {
  const { state, online, update } = useDevState(0);
  const [steadiness, setLocal] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (state && !seeded.current) {
      seeded.current = true;
      setLocal(cutoffToSteadiness(state.smoothing.min_cutoff));
    }
  }, [state]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const send = useCallback(
    (patch: Parameters<typeof update>[0]) => {
      update(patch).then(() => setError(null)).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [update],
  );

  const setSteadiness = useCallback(
    (v: number) => {
      setLocal(v);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => send({ smoothing: steadinessToFilter(v) }), DEBOUNCE_MS);
    },
    [send],
  );

  const setRaw = useCallback((raw: boolean) => send({ smoothing: { enabled: !raw } }), [send]);

  return {
    online,
    steadiness,
    setSteadiness,
    raw: state ? !state.smoothing.enabled : false,
    setRaw,
    gloveSource: state?.glove_source ?? null,
    error,
  };
}
