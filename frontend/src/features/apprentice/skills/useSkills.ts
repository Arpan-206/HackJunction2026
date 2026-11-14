import { useCallback, useMemo } from 'react';
import type { Lesson } from '../../../api';
import { useAllAttempts } from '../../shared/practiceLog';
import { useLessonLibrary } from '../hooks/useLessonData';
import { isDemo } from '../pipeline/flags';
import { dayKey } from '../pipeline/progress';
import { DEFAULT_CONFIG, DEMO_CONFIG } from '../pipeline/stages';
import { buildSkills, newestPerTitle, skillProgress, type SkillProgress, type SkillView } from './catalogue';

export interface SkillsState {
  skills: SkillView[];
  /** Every course, newest per title, for the Today panel. */
  courses: Lesson[];
  lessons: Lesson[] | null;
  loading: boolean;
  error: ReturnType<typeof useLessonLibrary>['error'];
  offline: boolean;
  reload: () => void;
  /** Practice-log progress of one skill, recalculated whenever the log changes. */
  progressOf: (skill: SkillView) => SkillProgress;
}

/** The catalogue merged with the lessons the API serves (or the built-in ones offline), plus progress from the practice log. */
export function useSkills(): SkillsState {
  const { data: lessons, loading, error, offline, reload } = useLessonLibrary();
  const attempts = useAllAttempts();
  const demo = isDemo();
  const today = dayKey(new Date());
  const skills = useMemo(() => buildSkills(lessons ?? []), [lessons]);
  const courses = useMemo(() => (lessons ? newestPerTitle(lessons) : []), [lessons]);
  const progress = useMemo(() => {
    const cfg = demo ? DEMO_CONFIG : DEFAULT_CONFIG;
    return new Map(skills.map((s) => [s.id, skillProgress(s.courses, attempts, today, cfg)]));
  }, [skills, attempts, demo, today]);
  const progressOf = useCallback((skill: SkillView) => progress.get(skill.id) ?? skillProgress(skill.courses, attempts, today), [progress, attempts, today]);
  return { skills, courses, lessons, loading, error, offline, reload, progressOf };
}
