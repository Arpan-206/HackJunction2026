import type { LoggedAttempt, LoggedTest } from '../../shared/practiceLog';
import { addDays, dayKey, deriveStep } from './progress';
import { DEFAULT_CONFIG, type PipelineConfig } from './stages';

/** The run of practised days that ends today, or yesterday while today is still open. */
export interface Streak {
  length: number;
  /** The days in the run, oldest first. */
  days: string[];
  /** True when today is already part of the run. */
  includesToday: boolean;
}

/**
 * The current streak from the sorted practised day keys. Today counts once practised; until then a run that ended
 * yesterday is still alive (the day is not over). Any other gap ends it.
 */
export function currentStreak(practised: string[], today: string): Streak {
  const set = new Set(practised);
  const includesToday = set.has(today);
  let day = includesToday ? today : addDays(today, -1);
  const days: string[] = [];
  while (set.has(day)) {
    days.unshift(day);
    day = addDays(day, -1);
  }
  return { length: days.length, days, includesToday: includesToday && days.length > 0 };
}

/** The line beside the week: "3-day streak", or an invitation when there is none. */
export function streakLabel(s: Streak): string {
  return s.length > 0 ? `${s.length}-day streak` : 'Start a streak today';
}

/** A minute added for the last rep of a sitting, since each rep is logged when it ends. */
const REP_MIN = 1.5;
/** A gap longer than this between two reps starts a new sitting. */
const SITTING_GAP_MIN = 20;

/** Estimated minutes of practice from rep times: each sitting from its first rep to its last, plus one rep. */
export function practiceMinutes(times: string[]): number {
  const t = times.map((x) => new Date(x).getTime()).sort((a, b) => a - b);
  if (!t.length) return 0;
  let total = 0;
  let start = t[0];
  let prev = t[0];
  for (const x of t.slice(1)) {
    if (x - prev > SITTING_GAP_MIN * 60000) {
      total += (prev - start) / 60000 + REP_MIN;
      start = x;
    }
    prev = x;
  }
  total += (prev - start) / 60000 + REP_MIN;
  return Math.max(1, Math.round(total));
}

interface LessonLike {
  id: string;
  title: string;
  skill: string;
  steps: { id: string; title: string }[];
}

export interface DayLessonLine {
  lessonId: string;
  stepId: string;
  /** The skill's display name, e.g. "Table tennis". */
  skill: string;
  /** The lesson (step) title without its "Lesson 1:" prefix. */
  lesson: string;
  reps: number;
  best: number;
  /** Mastered blind on this day. */
  mastered: boolean;
  /** The day's reps were a scheduled review. */
  review: boolean;
}

export interface DayDetail {
  day: string;
  lessons: DayLessonLine[];
  tests: { lesson: string; passed: boolean; overall: number }[];
  minutes: number;
  /** Best overall score of the day, or null when nothing was scored. */
  best: number | null;
}

/** "Lesson 2: Forehand swing" -> "Forehand swing". */
export const shortLessonTitle = (title: string): string => title.replace(/^Lesson\s+\d+\s*:\s*/i, '');

/**
 * What the learner did on one day, from the practice log: each lesson (step) practised with its best score and whether it was
 * mastered or reviewed, any tests, the estimated minutes and the best score. Lessons no longer in the library are left out.
 */
export function dayDetail(
  day: string,
  lessons: LessonLike[],
  attempts: Record<string, LoggedAttempt[]>,
  tests: Record<string, LoggedTest[]>,
  skillName: (id: string) => string,
  cfg: PipelineConfig = DEFAULT_CONFIG,
): DayDetail {
  const lines: DayLessonLine[] = [];
  const times: string[] = [];
  const testLines: DayDetail['tests'] = [];
  for (const l of lessons) {
    const log = attempts[l.id] ?? [];
    const today = log.filter((a) => a.at && dayKey(a.at) === day);
    for (const s of l.steps) {
      const mine = today.filter((a) => a.step_id === s.id);
      if (!mine.length) continue;
      times.push(...mine.map((a) => a.at as string));
      const m = deriveStep(s.id, log, cfg);
      lines.push({
        lessonId: l.id,
        stepId: s.id,
        skill: skillName(l.skill),
        lesson: shortLessonTitle(s.title),
        reps: mine.length,
        best: mine.reduce((b, a) => Math.max(b, Math.round(a.score.overall)), 0),
        mastered: Boolean(m.mastered_at && dayKey(m.mastered_at) === day),
        review: mine.some((a) => a.kind === 'review'),
      });
    }
    for (const t of tests[l.id] ?? []) {
      if (dayKey(t.at) !== day) continue;
      times.push(t.at);
      testLines.push({ lesson: l.title, passed: t.passed, overall: Math.round(t.overall) });
    }
  }
  const scores = [...lines.map((x) => x.best), ...testLines.map((x) => x.overall)];
  return { day, lessons: lines, tests: testLines, minutes: practiceMinutes(times), best: scores.length ? Math.max(...scores) : null };
}

/** "Thursday 12 November". */
export function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** The accessible name of a day in the week row, e.g. "Thursday 12 November, practised 2 lessons". */
export function dayButtonLabel(day: string, lessonsPractised: number, isToday: boolean): string {
  const when = `${longDay(day)}${isToday ? ', today' : ''}`;
  if (lessonsPractised <= 0) return `${when}, no practice`;
  return `${when}, practised ${lessonsPractised} ${lessonsPractised === 1 ? 'lesson' : 'lessons'}`;
}
