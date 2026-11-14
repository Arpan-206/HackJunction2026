import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './client';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  /** Re-run the request. */
  reload: () => void;
}

/** Runs an abortable request on mount and whenever `key` changes. Keep `fn` free of per-render identity by passing `key`. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, key: string, enabled = true): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fnRef
      .current(ctl.signal)
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof ApiError ? e : new ApiError(String(e), 0, key, e));
        setLoading(false);
      });
    return () => ctl.abort();
  }, [key, enabled, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, loading, error, reload };
}
