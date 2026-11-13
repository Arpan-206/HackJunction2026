import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './client';
import { useAsync, type AsyncState } from './useAsync';
import type { DevState, DevStatePatch, Lesson, MoveKind, Skill } from './types';

/** GET /api/lessons. */
export function useLessons(): AsyncState<Lesson[]> {
  return useAsync((s) => api.lessons(s), 'lessons');
}

/** GET /api/lessons/{id}. Pass undefined to skip. */
export function useLesson(id: string | undefined): AsyncState<Lesson> {
  return useAsync((s) => api.lesson(id as string, s), `lesson:${id}`, Boolean(id));
}

/** GET /api/moves, optionally filtered by skill. */
export function useMoves(skill?: Skill): AsyncState<MoveKind[]> {
  return useAsync((s) => api.moves(skill, s), `moves:${skill ?? 'all'}`);
}

export interface DevStateHandle {
  state: DevState | null;
  loading: boolean;
  error: ApiError | null;
  /** True once a request succeeded and the last one did not fail. */
  online: boolean;
  /** POST a partial update; resolves to the new state or rejects with ApiError. */
  update: (patch: DevStatePatch) => Promise<DevState>;
  reload: () => void;
}

/** GET and POST /api/dev/state, polled lightly so the panel notices the backend coming and going. */
export function useDevState(pollMs = 5000): DevStateHandle {
  const { data, loading, error, reload } = useAsync((s) => api.devState(s), 'dev-state');
  const [state, setState] = useState<DevState | null>(null);

  useEffect(() => {
    if (data) setState(data);
  }, [data]);

  useEffect(() => {
    if (!pollMs) return;
    const id = window.setInterval(reload, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, reload]);

  const update = useCallback(async (patch: DevStatePatch) => {
    const next = await api.setDevState(patch);
    setState(next);
    return next;
  }, []);

  return { state, loading, error, online: state !== null && error === null, update, reload };
}
