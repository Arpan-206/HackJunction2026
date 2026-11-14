import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type GloveRigStatus } from '../../../api';

export interface GloveRigHandle {
  status: GloveRigStatus | null;
  error: string | null;
  /** True while Start the gloves is waiting for the solver. */
  starting: boolean;
  refresh: () => void;
  start: () => Promise<void>;
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

/** Polls GET /gloves/status every `everyMs` while mounted (0: once). Start the gloves posts /gloves/driver. */
export function useGloveRig(everyMs = 1000): GloveRigHandle {
  const [status, setStatus] = useState<GloveRigStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    let timer = 0;
    const load = () => {
      api
        .gloveStatus(ctl.signal)
        .then((s) => {
          setStatus(s);
          setError(null);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setError(message(e));
        })
        .finally(() => {
          if (everyMs > 0 && !ctl.signal.aborted) timer = window.setTimeout(load, everyMs);
        });
    };
    load();
    return () => {
      ctl.abort();
      window.clearTimeout(timer);
    };
  }, [everyMs, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const s = await api.gloveDriver({ action: 'start' });
      if (alive.current) setStatus(s);
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setStarting(false);
    }
  }, []);

  return { status, error, starting, refresh, start };
}
