import type { Lesson } from '../../../api';
import type { LoggedAttempt, LoggedTest } from '../../shared/practiceLog';
import type { PlayRecord } from '../pipeline/journey';
import { DEFAULT_CONFIG, replay, STAGE_LABEL, type OpenStage, type PipelineConfig } from '../pipeline/stages';
import type { SkillProgress } from './catalogue';

/**
 * The skill page's timeline: every course of a skill, every lesson in it, and the parts each lesson is learnt in (the
 * Tutorial, then the practice stages Watch, Ghost on and Ghost off), each with where it stands and the route that opens it.
 * Built from the practice log, the tutorials seen and the Play rounds, so it agrees with the course page and the rank.
 */

export type PartKey = 'tutorial' | OpenStage;
/** done: behind the learner; now: where they are; next: still ahead (it opens all the same, see `partTo`). */
export type PartState = 'done' | 'now' | 'next';

export interface PathPart {
  key: PartKey;
  label: string;
  to: string;
  state: PartState;
}

export interface PathLesson {
  courseId: string;
  index: number;
  /** Opens the lesson where the learner left off (the practice screen resumes from the log). */
  to: string;
  attempts: number;
  best: number;
  mastered: boolean;
  /** Mastered, with its review due today or earlier. */
  due: boolean;
  /** The lesson the primary "Continue" action opens. */
  here: boolean;
  parts: PathPart[];
}

export interface PathFinale {
  /** The game at the end of the course, or the generic Play round. */
  to: string;
  /** Rounds or games played. */
  played: number;
  /** Best round or game score, 0 to 100, or null before the first. */
  best: number | null;
}

export interface PathCourse {
  id: string;
  /** The course page (syllabus, videos, rank and seal). */
  to: string;
  lessons: PathLesson[];
  mastered: number;
  finale: PathFinale;
}

const PART_LABEL: Record<PartKey, string> = { tutorial: 'Tutorial', watch: STAGE_LABEL.watch, ghost: STAGE_LABEL.ghost, blind: STAGE_LABEL.blind };
export const PARTS: PartKey[] = ['tutorial', 'watch', 'ghost', 'blind'];

/**
 * The route of one part. Every part opens, upcoming ones too: the pipeline lets a learner flip the ghost switch at any
 * time after watching, so a link to Ghost off simply opens the practice screen with the ghost off.
 */
export function partTo(courseId: string, index: number, key: PartKey): string {
  const step = `/apprentice/lessons/${courseId}/steps/${index}`;
  return key === 'tutorial' ? `${step}/tutorial` : `${step}?stage=${key}`;
}

/** Which parts of one lesson are behind the learner. Ghost off is done only once the lesson is mastered blind. */
export function partsDone(args: { seenTutorial: boolean; staged: Pick<LoggedAttempt, 'stage' | 'score'>[]; mastered: boolean; cfg?: PipelineConfig }): Record<PartKey, boolean> {
  const { seenTutorial, staged, mastered, cfg = DEFAULT_CONFIG } = args;
  const stage = replay(staged.map((a) => ({ stage: a.stage, score: a.score })), cfg).stage;
  const practised = staged.some((a) => a.stage && a.stage !== 'watch');
  return {
    tutorial: seenTutorial || practised,
    watch: practised,
    ghost: mastered || stage === 'blind',
    blind: mastered,
  };
}

/** Marks the first part not done as now (on a due review, Ghost off again), the rest as done or next. */
export function partStates(done: Record<PartKey, boolean>, due: boolean): Record<PartKey, PartState> {
  const now: PartKey | undefined = due ? 'blind' : PARTS.find((p) => !done[p]);
  return Object.fromEntries(PARTS.map((p) => [p, p === now ? 'now' : done[p] ? 'done' : 'next'])) as Record<PartKey, PartState>;
}

export interface JourneyInput {
  courses: Lesson[];
  progress: SkillProgress;
  attempts: Record<string, LoggedAttempt[]>;
  tests: Record<string, LoggedTest[]>;
  /** Step ids whose tutorial was watched, per course. */
  seen: (courseId: string) => Set<string>;
  played: (courseId: string) => PlayRecord | null;
  cfg?: PipelineConfig;
}

/** The whole timeline of a skill, course by course. */
export function skillJourney({ courses, progress, attempts, tests, seen, played, cfg = DEFAULT_CONFIG }: JourneyInput): PathCourse[] {
  const next = progress.next;
  return courses.map((course, ci) => {
    const log = attempts[course.id] ?? [];
    const seenHere = seen(course.id);
    const lessons = course.steps.map((step, index): PathLesson => {
      const st = progress.lessons[ci]?.[index];
      const mastered = st?.mastered ?? false;
      const due = st?.due ?? false;
      const done = partsDone({ seenTutorial: seenHere.has(step.id), staged: log.filter((a) => a.step_id === step.id), mastered, cfg });
      const states = partStates(done, due);
      return {
        courseId: course.id,
        index,
        to: `/apprentice/lessons/${course.id}/steps/${index}`,
        attempts: st?.attempts ?? 0,
        best: st?.best ?? 0,
        mastered,
        due,
        here: next !== null && next.courseId === course.id && next.index === index,
        parts: PARTS.map((key) => ({ key, label: PART_LABEL[key], to: partTo(course.id, index, key), state: states[key] })),
      };
    });
    const games = tests[course.id] ?? [];
    const round = played(course.id);
    const finale: PathFinale = course.test
      ? { to: `/apprentice/lessons/${course.id}/test`, played: games.length, best: games.length ? Math.round(Math.max(...games.map((g) => g.overall))) : null }
      : { to: `/apprentice/lessons/${course.id}/play`, played: round?.rounds ?? 0, best: round ? round.best : null };
    return { id: course.id, to: `/apprentice/lessons/${course.id}`, lessons, mastered: lessons.filter((l) => l.mastered).length, finale };
  });
}

/**
 * An expert's name as the learner reads it. Older lessons were saved with the word "master" in the name ("Demo master");
 * the product says expert (CLAUDE.md rule 6), so the word is shown as "expert". The stored name is left alone.
 */
export function expertName(name: string): string {
  return name.replace(/\bmaster\b/gi, (w) => (w[0] === 'M' ? 'Expert' : 'expert'));
}
