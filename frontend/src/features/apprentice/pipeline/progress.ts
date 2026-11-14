import type { ScoreResult } from '../../../api/types';
import type { LoggedAttempt, LoggedTest } from '../../shared/practiceLog';
import { DEFAULT_CONFIG, isClean, type PipelineConfig, type Stage } from './stages';

/** Leitner review gaps in days, by box: after mastery, then after each passed review. */
export const LEITNER_DAYS = [1, 3, 7, 14, 30] as const;
export const MAX_BOX = LEITNER_DAYS.length - 1;

export type Rank = 'apprentice' | 'journeyman' | 'sealed';

export const RANK_LABEL: Record<Rank, string> = { apprentice: 'Apprentice', journeyman: 'Journeyman', sealed: 'Sealed' };

/** How hard the duel bot plays for each rank, from 0 (clumsy) to 1 (expert). The default 0.5 is the original difficulty. */
export const BOT_SKILL: Record<Rank, number> = { apprentice: 0.25, journeyman: 0.5, sealed: 0.85 };

/** Local calendar day, 'YYYY-MM-DD'. */
export function dayKey(d: Date | string | number): string {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${dd}`;
}

/** Adds whole calendar days to a day key. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12));
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const t = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** A review day as people say it: "today", "tomorrow", or "15 Nov" (day and short month, like the other dates). */
export function formatDueDay(day: string, today: string): string {
  const gap = daysBetween(today, day);
  if (gap <= 0) return 'today';
  if (gap === 1) return 'tomorrow';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export interface StepMastery {
  step_id: string;
  /** ISO time of the rep that cleared the blind stage, or null. */
  mastered_at: string | null;
  /** Review box, 0 to 4. */
  box: number;
  /** Day the next review falls due, or null before mastery. */
  next_due: string | null;
  /** Clean blind reviews passed on a later day than mastery. */
  reviewsPassed: number;
  /** True when the last scheduled review was failed, so the step goes back to the Ghost stage. */
  relearn: boolean;
  /** Best blind score so far. */
  bestBlind: number;
}

export interface LessonProgress {
  steps: StepMastery[];
  rank: Rank;
  /** Mean of the latest clean blind rep per step, when every step has one. */
  blindScore: number | null;
  /** The latest day on which the lesson was sealed (the day of the last requirement met). */
  sealedAt: string | null;
  testBest: number | null;
  testPassed: boolean;
}

interface Timed extends LoggedAttempt {
  at: string;
}

const timed = (a: LoggedAttempt): a is Timed => Boolean(a.at);

/**
 * Derives the mastery and review schedule of one step from its attempts (oldest first). Only blind reps count. Mastery is
 * `cfg.cleanReps` clean blind reps in a row. After that the first blind rep on or after the due day is the review: clean
 * moves the box up and pushes the due day out, a miss moves it down and asks again the next day.
 */
export function deriveStep(stepId: string, all: LoggedAttempt[], cfg: PipelineConfig = DEFAULT_CONFIG): StepMastery {
  const out: StepMastery = { step_id: stepId, mastered_at: null, box: 0, next_due: null, reviewsPassed: 0, relearn: false, bestBlind: 0 };
  let streak = 0;
  let lastScheduled: string | null = null;
  for (const a of all.filter((x) => x.step_id === stepId && x.stage === 'blind').filter(timed)) {
    out.bestBlind = Math.max(out.bestBlind, Math.round(a.score.overall));
    const day = dayKey(a.at);
    const clean = isClean(a.score, cfg.passScore);
    if (!out.mastered_at) {
      streak = clean ? streak + 1 : 0;
      if (streak >= cfg.cleanReps) {
        out.mastered_at = a.at;
        out.next_due = addDays(day, LEITNER_DAYS[0]);
        lastScheduled = day;
      }
      continue;
    }
    if (out.next_due && day >= out.next_due && day !== lastScheduled) {
      lastScheduled = day;
      if (clean) {
        out.box = Math.min(MAX_BOX, out.box + 1);
        out.reviewsPassed += 1;
        out.relearn = false;
        out.next_due = addDays(day, LEITNER_DAYS[out.box]);
      } else {
        out.box = Math.max(0, out.box - 1);
        out.relearn = true;
        out.next_due = addDays(day, 1);
      }
    } else if (out.relearn && clean && day !== lastScheduled) {
      out.relearn = false;
    }
  }
  return out;
}

/** True when the step's review is due on or before `today`. */
export function isDue(m: StepMastery, today: string): boolean {
  return m.next_due !== null && m.next_due <= today;
}

/** Whole days a review is overdue (0 on the due day). */
export function overdueDays(m: StepMastery, today: string): number {
  return m.next_due ? Math.max(0, daysBetween(m.next_due, today)) : 0;
}

/** Mean score of a whole-lesson blind run (a clean blind rep per step, each at or after the one before), or null. */
function fullBlindRun(stepIds: string[], attempts: LoggedAttempt[], cfg: PipelineConfig): number | null {
  const blind = attempts.filter(timed).filter((a) => a.stage === 'blind' && isClean(a.score, cfg.passScore));
  let prev = '';
  const scores: number[] = [];
  for (const id of stepIds) {
    const next = blind.find((a) => a.step_id === id && a.at >= prev);
    if (!next) return null;
    prev = next.at;
    scores.push(next.score.overall);
  }
  return scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
}

/**
 * The guild rank of a lesson, derived from its attempts and tests. Apprentice by default; Journeyman when every step is
 * mastered blind and the steps were passed blind in order; Sealed when every step was also reviewed clean on a later day and
 * a duel was passed.
 */
export function deriveLesson(stepIds: string[], attempts: LoggedAttempt[], tests: LoggedTest[] = [], cfg: PipelineConfig = DEFAULT_CONFIG): LessonProgress {
  const steps = stepIds.map((id) => deriveStep(id, attempts, cfg));
  const allMastered = steps.length > 0 && steps.every((s) => s.mastered_at);
  const blindScore = allMastered ? fullBlindRun(stepIds, attempts, cfg) : null;
  const testPassed = tests.some((t) => t.passed);
  const reviewed = allMastered && steps.every((s) => s.reviewsPassed >= 1);
  let rank: Rank = 'apprentice';
  if (allMastered && blindScore !== null) rank = 'journeyman';
  if (rank === 'journeyman' && reviewed && testPassed) rank = 'sealed';
  const passedTest = tests.filter((t) => t.passed).map((t) => t.at);
  const sealedAt = rank === 'sealed' ? passedTest.concat(attempts.filter(timed).map((a) => a.at)).sort().slice(-1)[0] ?? null : null;
  return { steps, rank, blindScore, sealedAt, testBest: tests.length ? Math.max(...tests.map((t) => t.overall)) : null, testPassed };
}

/** The stage a step opens at, and whether the rep is a scheduled review. */
export function startingPoint(stage: Stage, mastery: StepMastery, today: string): { stage: Stage; review: boolean } {
  if (mastery.mastered_at && isDue(mastery, today)) return { stage: 'blind', review: true };
  if (mastery.relearn) return { stage: 'ghost', review: false };
  return { stage, review: false };
}

/** Days on which the learner practised, from attempts and tests, as sorted unique day keys. */
export function daysPractised(attempts: LoggedAttempt[], tests: LoggedTest[] = []): string[] {
  const set = new Set<string>();
  for (const a of attempts) if (a.at) set.add(dayKey(a.at));
  for (const t of tests) set.add(dayKey(t.at));
  return [...set].sort();
}

export interface WeekMark {
  day: string;
  /** Short weekday letter. */
  label: string;
  practised: boolean;
  today: boolean;
  future: boolean;
}

const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** The seven days of the week containing `today` (Monday first), with which were practised. */
export function weekMarks(practised: string[], today: string): WeekMark[] {
  const [y, m, d] = today.split('-').map(Number);
  const dow = (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
  const monday = addDays(today, -dow);
  const set = new Set(practised);
  return WEEKDAY.map((label, i) => {
    const day = addDays(monday, i);
    return { day, label, practised: set.has(day), today: day === today, future: day > today };
  });
}

/** Builds a synthetic score for seeded history. */
export function syntheticScore(overall: number, tolerant = true): ScoreResult {
  const v = Math.round(overall);
  return {
    overall: v,
    per_finger: { thumb: Math.min(100, v + 3), index: Math.min(100, v + 2), middle: v, ring: Math.max(0, v - 4), little: Math.min(100, v + 1) },
    timing: Math.min(100, v + 2),
    within_tolerance: tolerant && v >= 80,
    worst_finger: 'ring',
    hint: v >= 80 ? 'Clean. Hold the shape.' : 'Ring finger: curl a little more.',
    warnings: [],
  };
}
