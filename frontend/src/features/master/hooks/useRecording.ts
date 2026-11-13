import { useEffect, useState } from 'react';
import { api, ApiError, type Recording } from '../../../api';

const cache = new Map<string, Recording>();

/** Remembers a recording the master just captured so replay never needs a second fetch. */
export function cacheRecording(rec: Recording): void {
  cache.set(rec.id, rec);
}

export interface RecordingState {
  recording: Recording | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Loads a recording by id (from the local cache first, then GET /api/recordings/{id}).
 * Pass null to skip.
 */
export function useRecording(id: string | null | undefined): RecordingState {
  const [fetched, setFetched] = useState<{ id: string; recording: Recording | null; error: ApiError | null } | null>(null);
  const cached = id ? (cache.get(id) ?? null) : null;

  useEffect(() => {
    if (!id || cache.has(id)) return;
    const ctl = new AbortController();
    api
      .recording(id, ctl.signal)
      .then((r) => {
        cache.set(id, r);
        setFetched({ id, recording: r, error: null });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setFetched({ id, recording: null, error: e instanceof ApiError ? e : new ApiError(String(e), 0, id, e) });
      });
    return () => ctl.abort();
  }, [id]);

  if (!id) return { recording: null, loading: false, error: null };
  if (cached) return { recording: cached, loading: false, error: null };
  if (fetched && fetched.id === id) return { recording: fetched.recording, loading: false, error: fetched.error };
  return { recording: null, loading: true, error: null };
}
