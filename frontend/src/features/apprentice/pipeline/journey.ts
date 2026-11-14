/**
 * The three parts of a lesson course, as the learner meets them: the Tutorial of each step, Practice (the strings, ghost and
 * blind ladder) and Play at the end. Practice progress is the practice log (progress.ts); this keeps the other two in
 * localStorage, wrapped in try/catch so a blocked storage only costs the memory.
 */

const SEEN_KEY = 'apprentice.tutorialSeen';
const PLAY_KEY = 'apprentice.play';

export type JourneyPart = 'tutorial' | 'practice' | 'play';
export const JOURNEY: JourneyPart[] = ['tutorial', 'practice', 'play'];
export const JOURNEY_LABEL: Record<JourneyPart, string> = { tutorial: 'Tutorial', practice: 'Practice', play: 'Play' };

/** The best Play round on a course. */
export interface PlayRecord {
  rounds: number;
  /** Best round average, 0 to 100. */
  best: number;
  /** Longest run of clean calls in any round. */
  bestStreak: number;
  /** ISO time of the last round. */
  last_at: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: progress lasts this page only */
  }
}

/** The steps of a course whose tutorial the learner has watched. */
export function tutorialsSeen(lessonId: string): Set<string> {
  return new Set(read<Record<string, string[]>>(SEEN_KEY, {})[lessonId] ?? []);
}

export function markTutorialSeen(lessonId: string, stepId: string): void {
  const all = read<Record<string, string[]>>(SEEN_KEY, {});
  const mine = new Set(all[lessonId] ?? []);
  if (mine.has(stepId)) return;
  mine.add(stepId);
  write(SEEN_KEY, { ...all, [lessonId]: [...mine] });
}

export function playRecord(lessonId: string): PlayRecord | null {
  return read<Record<string, PlayRecord>>(PLAY_KEY, {})[lessonId] ?? null;
}

/** Stores a finished round and returns the record, with whether this round beat the best. */
export function recordPlayRound(lessonId: string, average: number, streak: number, at = new Date()): { record: PlayRecord; newBest: boolean } {
  const all = read<Record<string, PlayRecord>>(PLAY_KEY, {});
  const before = all[lessonId] ?? null;
  const record: PlayRecord = {
    rounds: (before?.rounds ?? 0) + 1,
    best: Math.max(before?.best ?? 0, Math.round(average)),
    bestStreak: Math.max(before?.bestStreak ?? 0, streak),
    last_at: at.toISOString(),
  };
  write(PLAY_KEY, { ...all, [lessonId]: record });
  return { record, newBest: before !== null && Math.round(average) > before.best };
}
