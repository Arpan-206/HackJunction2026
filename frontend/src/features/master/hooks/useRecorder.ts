import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Hands, type Recording } from '../../../api';
import { cacheRecording } from './useRecording';

export type RecorderPhase = 'idle' | 'countdown' | 'recording' | 'saving';

export interface RecordContext {
  lessonId?: string;
  /** Label stored with the recording: a step id, or move id plus repetition for scratch takes. */
  stepId?: string;
  /** Which gloves the take keeps: one hand or both (the default). */
  hands?: Hands;
}

export interface RecorderHandle {
  phase: RecorderPhase;
  /** Seconds since recording began; updated about four times a second. */
  elapsedS: number;
  error: string | null;
  /** Starts the 3-2-1 countdown. */
  begin: (ctx: RecordContext) => void;
  /** Wire this to the Countdown component's onDone. */
  countdownDone: () => void;
  stop: () => void;
  cancel: () => void;
}

/**
 * Drives one recording at a time: countdown, POST /recordings/start, a live timer, then POST /recordings/{id}/stop.
 * The finished recording (with frames) is handed to `onTake`.
 */
export function useRecorder(onTake: (rec: Recording, ctx: RecordContext) => void): RecorderHandle {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsedS, setElapsedS] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef<RecordContext>({});
  const idRef = useRef<string | null>(null);
  const startedAt = useRef(0);
  const onTakeRef = useRef(onTake);
  onTakeRef.current = onTake;

  useEffect(() => {
    if (phase !== 'recording') return;
    const id = window.setInterval(() => setElapsedS((performance.now() - startedAt.current) / 1000), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(
    () => () => {
      const id = idRef.current;
      if (id) void api.stopRecording(id).catch(() => undefined);
    },
    [],
  );

  const begin = useCallback((ctx: RecordContext) => {
    ctxRef.current = ctx;
    setError(null);
    setElapsedS(0);
    setPhase('countdown');
  }, []);

  const countdownDone = useCallback(() => {
    const ctx = ctxRef.current;
    api
      .startRecording({ lesson_id: ctx.lessonId, step_id: ctx.stepId, ...(ctx.hands ? { hands: ctx.hands } : {}) })
      .then((r) => {
        idRef.current = r.recording_id;
        startedAt.current = performance.now();
        setPhase('recording');
      })
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : String(e));
        setPhase('idle');
      });
  }, []);

  const stop = useCallback(() => {
    const id = idRef.current;
    if (!id) return;
    setPhase('saving');
    api
      .stopRecording(id)
      .then((rec) => {
        cacheRecording(rec);
        onTakeRef.current(rec, ctxRef.current);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => {
        idRef.current = null;
        setPhase('idle');
      });
  }, []);

  const cancel = useCallback(() => {
    const id = idRef.current;
    idRef.current = null;
    if (id) void api.stopRecording(id).catch(() => undefined);
    setPhase('idle');
  }, []);

  return { phase, elapsedS, error, begin, countdownDone, stop, cancel };
}
