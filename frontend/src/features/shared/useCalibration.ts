import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Calibration, type Side } from '../../api';
import { calibrateCoreHeading } from '../../api/coreCommand';
import { CALIBRATION_SECONDS } from '../master/lib';

export type CalibrationPhase = 'idle' | 'countdown-flat' | 'capture-flat' | 'countdown-fist' | 'capture-fist' | 'aim';

/** Milliseconds the last step gives the hand to open flat again before the core starts averaging the heading. */
export const AIM_LEAD_MS = 1200;
/** Milliseconds the core averages the wrist heading over (core/rgmp.py `calibrate`), plus a little slack. */
export const AIM_HOLD_MS = 1300;

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
 * Glove calibration in three steps: a flat hand, then a loose fist, each preceded by a 3-2-1 countdown and sampled by
 * POST /api/calibrations, then the hand flat again for the core's `calibrate`. That last command does two things: the
 * wrist heading over the next second becomes zero, and the core reloads the flat and fist just saved, so the new
 * calibration reaches the live score at once (sent before the captures, the core would keep the previous one).
 */
export function useCalibration(side: Side): CalibrationHandle {
  const [latest, setLatest] = useState<Calibration | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<CalibrationPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

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
    clearTimers();
    setError(null);
    setPhase('countdown-flat');
  }, [clearTimers]);

  // Step 3: give the hand a moment to open flat, then the core averages the heading and reloads the calibration.
  const aim = useCallback(() => {
    const mine = run.current;
    setPhase('aim');
    timers.current.push(
      setTimeout(() => {
        if (mine === run.current) void calibrateCoreHeading();
      }, AIM_LEAD_MS),
      setTimeout(() => {
        if (mine === run.current) setPhase('idle');
      }, AIM_LEAD_MS + AIM_HOLD_MS),
    );
  }, []);

  const capture = useCallback(
    async (which: 'flat' | 'fist') => {
      const mine = run.current;
      try {
        const c = await api.calibrate({ side, phase: which, duration_s: CALIBRATION_SECONDS });
        if (mine !== run.current) return;
        if (which === 'flat') {
          setPhase('countdown-fist');
          return;
        }
        setLatest(c);
        aim();
      } catch (e) {
        if (mine !== run.current) return;
        setError(e instanceof ApiError ? e.message : String(e));
        setPhase('idle');
      }
    },
    [side, aim],
  );

  const countdownDone = useCallback(() => {
    if (phase === 'countdown-flat') {
      setPhase('capture-flat');
      void capture('flat');
    } else if (phase === 'countdown-fist') {
      setPhase('capture-fist');
      void capture('fist');
    }
  }, [phase, capture]);

  const cancel = useCallback(() => {
    run.current += 1;
    clearTimers();
    setPhase('idle');
  }, [clearTimers]);

  return { latest, loading, phase, error, start, countdownDone, cancel };
}
