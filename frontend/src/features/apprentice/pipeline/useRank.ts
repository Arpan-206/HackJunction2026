import { useMemo } from 'react';
import type { Lesson } from '../../../api';
import { useLoggedAttempts, useLoggedTests } from '../../shared/practiceLog';
import { deriveLesson, type LessonProgress } from './progress';
import { DEFAULT_CONFIG, DEMO_CONFIG } from './stages';
import { isDemo } from './flags';

/** The derived progress and guild rank of a lesson, recalculated whenever the attempt log changes. */
export function useLessonProgress(lesson: Pick<Lesson, 'id' | 'steps'> | null | undefined): LessonProgress | null {
  const attempts = useLoggedAttempts(lesson?.id ?? '');
  const tests = useLoggedTests(lesson?.id ?? '');
  const demo = isDemo();
  return useMemo(
    () => (lesson ? deriveLesson(lesson.steps.map((s) => s.id), attempts, tests, demo ? DEMO_CONFIG : DEFAULT_CONFIG) : null),
    [lesson, attempts, tests, demo],
  );
}
