import { readLog, setLog, type LoggedAttempt, type LoggedStage, type LoggedTest } from '../../shared/practiceLog';
import { dayKey, syntheticScore } from './progress';

interface LessonLike {
  id: string;
  steps: { id: string }[];
}

export interface DemoHistory {
  attempts: Record<string, LoggedAttempt[]>;
  tests: Record<string, LoggedTest[]>;
}

/** What one demo session item does with a lesson (a step): master it, review it once, or practise it without mastering. */
type Doing = 'master' | 'review' | 'practise';

interface ScriptItem {
  lesson: string;
  step: string;
  doing: Doing;
  /** Scores in order: strings, ghost, then blind reps. */
  strings?: number[];
  ghost?: number[];
  blind?: number[];
}

interface ScriptDay {
  daysAgo: number;
  /** Local start hour of the session (ignored for today, which ends a few minutes before now). */
  hour: number;
  items: ScriptItem[];
}

/**
 * The demo learner's week, against the four seed courses (the same ids in the mock and on the backend). Practice on the
 * last three days, today included, makes a 3-day streak; one isolated day five days back shows that a gap breaks it. The
 * reviews are scheduled so nothing is due today. Mastered: Table tennis 2 of 3, Piano 1 of 2, Finnish fingerspelling 3 of 7.
 * Shadow puppets is left untouched on purpose, so it can be demoed live as a brand-new first session.
 */
const SCRIPT: ScriptDay[] = [
  {
    daysAgo: 5,
    hour: 19,
    items: [{ lesson: 'seed-piano', step: 'seed-piano-position', doing: 'master', strings: [64, 78], ghost: [81, 85], blind: [83, 87, 90] }],
  },
  {
    daysAgo: 2,
    hour: 18,
    items: [
      { lesson: 'seed-piano', step: 'seed-piano-position', doing: 'review', blind: [88] },
      { lesson: 'seed-table-tennis', step: 'seed-tt-grip', doing: 'master', strings: [70, 79], ghost: [84], blind: [82, 86, 89] },
      { lesson: 'seed-finnish-fingerspelling', step: 'seed-fs-a', doing: 'master', strings: [73, 85], ghost: [86], blind: [84, 88, 92] },
    ],
  },
  {
    daysAgo: 1,
    hour: 18,
    items: [
      { lesson: 'seed-table-tennis', step: 'seed-tt-grip', doing: 'review', blind: [90] },
      { lesson: 'seed-finnish-fingerspelling', step: 'seed-fs-a', doing: 'review', blind: [91] },
      { lesson: 'seed-finnish-fingerspelling', step: 'seed-fs-i', doing: 'master', strings: [69, 80], ghost: [83], blind: [81, 85, 87] },
      { lesson: 'seed-table-tennis', step: 'seed-tt-forehand', doing: 'practise', strings: [58, 66, 72], ghost: [75], blind: [74, 82, 77] },
    ],
  },
  {
    daysAgo: 0,
    hour: 9,
    items: [
      { lesson: 'seed-finnish-fingerspelling', step: 'seed-fs-i', doing: 'review', blind: [89] },
      { lesson: 'seed-table-tennis', step: 'seed-tt-forehand', doing: 'master', ghost: [83], blind: [84, 88, 91] },
      { lesson: 'seed-finnish-fingerspelling', step: 'seed-fs-l', doing: 'master', strings: [77, 84], blind: [86, 83, 90] },
      { lesson: 'seed-piano', step: 'seed-piano-scale', doing: 'practise', strings: [68, 76, 81], ghost: [79] },
    ],
  },
];

/** Minutes between two reps in a demo session. */
const REP_GAP_MIN = 1.5;

/** Minutes the whole of a script day takes, so today's session can end just before now. */
function sessionLength(day: ScriptDay): number {
  const reps = day.items.reduce((n, it) => n + (it.strings?.length ?? 0) + (it.ghost?.length ?? 0) + (it.blind?.length ?? 0), 0);
  return reps * REP_GAP_MIN;
}

/**
 * The local start of a script day's session and the minutes between its reps. Today's session ends five minutes before
 * `now`; just after midnight the reps are packed closer so they all still fall today and before now.
 */
function sessionTiming(day: ScriptDay, now: Date): { start: number; gap: number } {
  if (day.daysAgo === 0) {
    const reps = sessionLength(day) / REP_GAP_MIN;
    const end = now.getTime() - 5 * 60000;
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const room = Math.max(0, now.getTime() - midnight.getTime() - 1000) / 60000;
    if (end - sessionLength(day) * 60000 >= midnight.getTime()) return { start: end - sessionLength(day) * 60000, gap: REP_GAP_MIN };
    const gap = room / (reps + 1);
    return { start: midnight.getTime() + gap * 60000, gap };
  }
  const d = new Date(now);
  d.setDate(d.getDate() - day.daysAgo);
  d.setHours(day.hour, 0, 0, 0);
  return { start: d.getTime(), gap: REP_GAP_MIN };
}

/**
 * Believable demo history relative to `now`: a 3-day streak ending today, consistent with the seed courses. Only lessons
 * and steps present in `lessons` are written, and every entry is tagged `demo` so it can be refreshed or cleared later.
 */
export function buildDemoHistory(lessons: LessonLike[], now = new Date()): DemoHistory {
  const known = new Map(lessons.map((l) => [l.id, new Set(l.steps.map((s) => s.id))]));
  const history: DemoHistory = { attempts: {}, tests: {} };
  for (const day of SCRIPT) {
    const { start, gap } = sessionTiming(day, now);
    let t = start;
    for (const it of day.items) {
      if (!known.get(it.lesson)?.has(it.step)) continue;
      const reps: [LoggedStage, number][] = [
        ...(it.strings ?? []).map((v): [LoggedStage, number] => ['strings', v]),
        ...(it.ghost ?? []).map((v): [LoggedStage, number] => ['ghost', v]),
        ...(it.blind ?? []).map((v): [LoggedStage, number] => ['blind', v]),
      ];
      const log = (history.attempts[it.lesson] ??= []);
      for (const [stage, v] of reps) {
        log.push({ step_id: it.step, stage, kind: it.doing === 'review' ? 'review' : 'practice', at: new Date(t).toISOString(), score: syntheticScore(v), demo: true });
        t += gap * 60000;
      }
    }
  }
  for (const log of Object.values(history.attempts)) log.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  return history;
}

/* ---------- seeding policy ---------- */

/**
 * Where the seeding state lives: the day key the demo history was last written for, or 'off' after a deliberate clear. The
 * version is bumped whenever the script changes (v3 dropped shadow puppets), so demo-only logs from an older script are
 * rewritten; real practice still blocks seeding.
 */
export const DEMO_MARK_KEY = 'apprentice.demoHistory.v3';
/** Turns seeding off for good on this device (until a reset), so an emptied history stays empty. */
export const DEMO_OFF = 'off';

/** Real (not demo) practice exists in the log. */
export function hasRealPractice(log: DemoHistory): boolean {
  return Object.values(log.attempts).some((l) => l.some((a) => !a.demo)) || Object.values(log.tests).some((l) => l.some((t) => !t.demo));
}

function isEmpty(log: DemoHistory): boolean {
  return Object.values(log.attempts).every((l) => l.length === 0) && Object.values(log.tests).every((l) => l.length === 0);
}

/**
 * Whether demo history should be written now. Never when seeding was switched off or when the learner has any real practice;
 * yes when the log is empty; and yes when the log holds only demo history written on an earlier day, so the streak always
 * ends today.
 */
export function shouldSeed(log: DemoHistory, mark: string | null, today: string): boolean {
  if (mark === DEMO_OFF) return false;
  if (hasRealPractice(log)) return false;
  if (isEmpty(log)) return true;
  return mark !== today;
}

function readMark(): string | null {
  try {
    return localStorage.getItem(DEMO_MARK_KEY);
  } catch {
    return null;
  }
}

function writeMark(v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(DEMO_MARK_KEY);
    else localStorage.setItem(DEMO_MARK_KEY, v);
  } catch {
    /* storage unavailable */
  }
}

/** Seeds the demo history when `shouldSeed` allows it (the learner dashboard calls this). Returns true when it wrote. */
export function seedDemoHistoryIfEmpty(lessons: LessonLike[], now = new Date()): boolean {
  const today = dayKey(now);
  if (!lessons.length || !shouldSeed(readLog(), readMark(), today)) return false;
  setLog(buildDemoHistory(lessons, now));
  writeMark(today);
  return true;
}

/**
 * Developer reset: clears every attempt and test on this device and lets the dashboard seed fresh demo history on its next
 * render. Real practice is lost too; it is a demo tool (the dev panel's "Fresh demo history").
 */
export function resetDemoHistory(): void {
  writeMark(null);
  setLog({ attempts: {}, tests: {} });
}

/** Developer reset: clears every attempt and test and keeps the history empty (no demo seeding) until the next reset. */
export function clearPracticeHistory(): void {
  writeMark(DEMO_OFF);
  setLog({ attempts: {}, tests: {} });
}
