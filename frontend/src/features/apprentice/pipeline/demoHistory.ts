import type { LoggedAttempt, LoggedStage, LoggedTest } from '../../shared/practiceLog';
import { syntheticScore } from './progress';

interface LessonLike {
  id: string;
  steps: { id: string }[];
}

export interface DemoHistory {
  attempts: Record<string, LoggedAttempt[]>;
  tests: Record<string, LoggedTest[]>;
}

/** ISO time `daysAgo` days before `now`, at the given local hour. */
function when(now: Date, daysAgo: number, hour: number, minute = 0): string {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function rep(stepId: string, stage: LoggedStage, overall: number, at: string, kind: 'practice' | 'review' = 'practice'): LoggedAttempt {
  return { step_id: stepId, stage, kind, at, score: syntheticScore(overall) };
}

/** Three clean blind reps in a row: the step is mastered on that day. */
function mastered(stepId: string, daysAgo: number, hour: number, now: Date): LoggedAttempt[] {
  return [
    rep(stepId, 'strings', 71, when(now, daysAgo + 1, hour)),
    rep(stepId, 'strings', 86, when(now, daysAgo + 1, hour, 4)),
    rep(stepId, 'ghost', 84, when(now, daysAgo, hour)),
    rep(stepId, 'blind', 83, when(now, daysAgo, hour, 6)),
    rep(stepId, 'blind', 88, when(now, daysAgo, hour, 8)),
    rep(stepId, 'blind', 91, when(now, daysAgo, hour, 10)),
  ];
}

/**
 * Believable demo history, as if the learner had been practising for a fortnight: the first lesson is mid-way with two
 * reviews due today, the second (when there is one) is Sealed. Nothing is logged for today, so the day is open.
 */
export function buildDemoHistory(lessons: LessonLike[], now = new Date()): DemoHistory {
  const history: DemoHistory = { attempts: {}, tests: {} };
  const [first, second] = lessons;
  if (first) {
    const s = first.steps;
    const log: LoggedAttempt[] = [];
    if (s[0]) log.push(...mastered(s[0].id, 4, 10, now));
    if (s[1]) {
      log.push(...mastered(s[1].id, 8, 17, now));
      log.push(rep(s[1].id, 'blind', 87, when(now, 7, 9), 'review'));
    }
    if (s[2]) log.push(rep(s[2].id, 'strings', 66, when(now, 2, 18)), rep(s[2].id, 'strings', 79, when(now, 2, 18, 3)), rep(s[2].id, 'strings', 84, when(now, 2, 18, 6)));
    history.attempts[first.id] = log.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  }
  if (second) {
    const log: LoggedAttempt[] = [];
    second.steps.forEach((st, i) => {
      log.push(...mastered(st.id, 11 - i, 10 + i, now));
    });
    second.steps.forEach((st, i) => log.push(rep(st.id, 'blind', 86 + (i % 3), when(now, 2, 9, i * 2), 'review')));
    history.attempts[second.id] = log.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
    history.tests[second.id] = [{ passed: true, overall: 88, at: when(now, 1, 16) }];
  }
  return history;
}
