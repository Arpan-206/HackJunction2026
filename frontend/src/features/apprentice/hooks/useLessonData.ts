import { useMemo } from 'react';
import { useLesson, useLessons, type ApiError, type Lesson } from '../../../api';
import { LOCAL_LESSONS } from './localLessons';

export interface LessonData<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  /** True when the backend could not be reached and the built-in demo lessons are shown instead. */
  offline: boolean;
  reload: () => void;
}

/** All lessons, falling back to the built-in demo lessons when the backend is unreachable. */
export function useLessonLibrary(): LessonData<Lesson[]> {
  const { data, loading, error, reload } = useLessons();
  const offline = Boolean(error?.isNetwork);
  return { data: offline ? LOCAL_LESSONS : data, loading, error: offline ? null : error, offline, reload };
}

/** One lesson by id, falling back to the built-in demo lessons when the backend is unreachable. */
export function useLessonById(id: string | undefined): LessonData<Lesson> {
  const { data, loading, error, reload } = useLesson(id);
  const offline = Boolean(error?.isNetwork);
  const local = useMemo(() => LOCAL_LESSONS.find((l) => l.id === id) ?? null, [id]);
  return { data: offline ? local : data, loading, error: offline && local ? null : error, offline, reload };
}
