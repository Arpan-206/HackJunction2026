import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Calibration, type Side } from '../../api';
import { CALIBRATION_SECONDS } from '../master/lib';

export type CalibrationPhase = 'idle' | 'countdown-flat' | 'capture-flat' | 'countdown-fist' | 'capture-fist';

export interface CalibrationHandle {
  /** Latest stored calibration for the side; null when none exists yet. */
  latest: Calibration | null;
  loading: boolean;
  phase: CalibrationPhase;
  error: string | null;
  start: () => void;
  /** Wire this to the Countdown component's onDone. */
  countdownDone: () => void;
  cancel: () => void;
}

/**
 * Two-phase glove calibration: flat hand, then loose fist, each preceded by a 3-2-1 countdown.
 * Each phase is a POST /api/calibrations that samples the live stream for a couple of seconds.
 */
export function useCalibration(side: Side): CalibrationHandle {
  const [latest, setLatest] = useState<Calibration | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<CalibrationPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    api
      .latestCalibration(side, ctl.signal)
      .then((c) => setLatest(c))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setLatest(null);
        if (!(e instanceof ApiError && e.status === 404)) setError(e instanceof ApiError ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [side]);

  const start = useCallback(() => {
    run.current += 1;
    setError(null);
    setPhase('countdown-flat');
  }, []);

  const capture = useCallback(
    async (which: 'flat' | 'fist', next: CalibrationPhase) => {
      const mine = run.current;
      try {
        const c = await api.calibrate({ side, phase: which, duration_s: CALIBRATION_SECONDS });
        if (mine !== run.current) return;
        if (which === 'fist') setLatest(c);
        setPhase(next);
      } catch (e) {
        if (mine !== run.current) return;
        setError(e instanceof ApiError ? e.message : String(e));
        setPhase('idle');
      }
    },
    [side],
  );

  const countdownDone = useCallback(() => {
    if (phase === 'countdown-flat') {
      setPhase('capture-flat');
      void capture('flat', 'countdown-fist');
    } else if (phase === 'countdown-fist') {
      setPhase('capture-fist');
      void capture('fist', 'idle');
    }
  }, [phase, capture]);

  const cancel = useCallback(() => {
    run.current += 1;
    setPhase('idle');
  }, []);

  return { latest, loading, phase, error, start, countdownDone, cancel };
}
