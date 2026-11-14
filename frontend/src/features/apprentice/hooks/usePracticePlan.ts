import { useCallback, useState } from 'react';
import { api, ApiError, type Lesson } from '../../../api';
import { isAssistantOn } from '../../shared/assistant';
import { storePlan, trimAttempts, useLoggedAttempts, useStoredPlan, type StoredPlan } from '../../shared/practiceLog';

/** The backend accepts at most this many steps per plan request. */
const MAX_PLAN_STEPS = 20;

export interface PracticePlanHandle {
  /** Number of attempts kept on this device for the lesson. */
  attempts: number;
  stored: StoredPlan | null;
  busy: boolean;
  /** Plain-words reason the last request failed, or null. */
  error: string | null;
  /** POST /api/coach/plan with the attempts kept on this device, then remember the answer. */
  request: () => Promise<void>;
}

/** Asks the assistant for a practice plan from the attempts this device remembers for a lesson. */
export function usePracticePlan(lesson: Lesson): PracticePlanHandle {
  const logged = useLoggedAttempts(lesson.id);
  const stored = useStoredPlan(lesson.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async () => {
    const steps = lesson.steps.slice(0, MAX_PLAN_STEPS).map((s) => ({ step_id: s.id, title: s.title }));
    const known = new Set(steps.map((s) => s.step_id));
    const attempts = trimAttempts(logged.filter((a) => known.has(a.step_id))).map((a) => ({ step_id: a.step_id, score: a.score }));
    if (attempts.length === 0 || !isAssistantOn()) return;
    setBusy(true);
    setError(null);
    try {
      storePlan(lesson.id, await api.coachPlan({ lesson_title: lesson.title, steps, attempts }));
    } catch (e) {
      setError(e instanceof ApiError && e.isNetwork ? 'The assistant could not be reached. Check that the backend is running.' : e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [lesson, logged]);

  return { attempts: logged.length, stored, busy, error, request };
}
