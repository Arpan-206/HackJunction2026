import { useEffect, useRef } from 'react';
import type { Lesson } from '../../../api';
import { logTest } from '../../shared/practiceLog';
import { BOT_SKILL } from '../pipeline/progress';
import { useLessonProgress } from '../pipeline/useRank';
import { SealCard } from '../course/SealCard';

/** Pass mark for a duel: the learner's overall (0 to 100) at or above this passes. */
export const DUEL_PASS_SCORE = 80;

/** The bot skill for a lesson, scaled to the learner's current guild rank. */
export function useBotSkill(lesson: Lesson | undefined): number {
  const progress = useLessonProgress(lesson);
  return BOT_SKILL[progress?.rank ?? 'apprentice'];
}

/**
 * Logs a finished duel once (while `finished` is true) and returns the Master's Seal card when the result earns the seal.
 * `passed` and `overall` describe the learner's result.
 */
export function useDuelOutcome(lesson: Lesson | undefined, finished: boolean, passed: boolean, overall: number) {
  const logged = useRef(false);
  const progress = useLessonProgress(lesson);
  useEffect(() => {
    if (!finished) {
      logged.current = false;
      return;
    }
    if (logged.current || !lesson) return;
    logged.current = true;
    logTest(lesson.id, { passed, overall: Math.round(overall), at: new Date().toISOString() });
  }, [finished, lesson, passed, overall]);
  if (!finished || !lesson || progress?.rank !== 'sealed') return null;
  return <SealCard master={lesson.master_name} lesson={lesson.title} at={progress.sealedAt} score={progress.blindScore} />;
}
