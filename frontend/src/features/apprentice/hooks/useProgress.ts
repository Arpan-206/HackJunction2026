import { useCallback, useSyncExternalStore } from 'react';

export interface StepProgress {
  attempts: number;
  best: number;
}

type Store = Record<string, StepProgress>;

const KEY = 'apprentice.progress.v1';

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* storage unavailable */
  }
  return {};
}

let current: Store = load();
const listeners = new Set<() => void>();

/** Records a finished attempt for a step, keeping the best score. */
export function recordAttempt(lessonId: string, stepId: string, score: number): void {
  const key = `${lessonId}:${stepId}`;
  const prev = current[key] ?? { attempts: 0, best: 0 };
  current = { ...current, [key]: { attempts: prev.attempts + 1, best: Math.max(prev.best, Math.round(score)) } };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

/** Locally stored practice progress, keyed by lesson and step. */
export function useProgress(lessonId: string): { get: (stepId: string) => StepProgress } {
  const store = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  const get = useCallback((stepId: string) => store[`${lessonId}:${stepId}`] ?? { attempts: 0, best: 0 }, [store, lessonId]);
  return { get };
}
