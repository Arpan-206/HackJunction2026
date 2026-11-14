import { useSyncExternalStore } from 'react';
import type { CoachPlanResponse, ScoreResult } from '../../api';

export type LoggedStage = 'watch' | 'strings' | 'ghost' | 'blind';
export type LoggedKind = 'practice' | 'review';

/** One finished attempt at a step, as kept on this device for the coach plan and for the learner pipeline. */
export interface LoggedAttempt {
  step_id: string;
  score: ScoreResult;
  /** What help was on during the rep. Older entries have none. */
  stage?: LoggedStage;
  kind?: LoggedKind;
  /** ISO 8601 time of the rep. */
  at?: string;
  /** True for seeded demo history, so it can be refreshed or cleared without touching real practice. */
  demo?: boolean;
}

/** One finished duel or test, kept per lesson. */
export interface LoggedTest {
  passed: boolean;
  /** 0 to 100. */
  overall: number;
  /** ISO 8601. */
  at: string;
  /** True for seeded demo history. */
  demo?: boolean;
}

/** A practice plan together with when it was asked for. */
export interface StoredPlan {
  plan: CoachPlanResponse;
  /** ISO 8601. */
  at: string;
}

/** The backend accepts at most this many attempts per plan request. */
export const MAX_PLAN_ATTEMPTS = 60;

const ATTEMPTS_KEY = 'apprentice.attempts.v1';
const PLANS_KEY = 'apprentice.plans.v1';
const TESTS_KEY = 'apprentice.tests.v1';
/** How many attempts per lesson are kept on this device; the plan request only ever sends the newest 60. */
export const MAX_LOGGED_ATTEMPTS = 500;

type Attempts = Record<string, LoggedAttempt[]>;
type Tests = Record<string, LoggedTest[]>;
type Plans = Record<string, StoredPlan>;

function read<T>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* storage unavailable or corrupt */
  }
  return {} as T;
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

let attempts: Attempts = read<Attempts>(ATTEMPTS_KEY);
let plans: Plans = read<Plans>(PLANS_KEY);
let tests: Tests = read<Tests>(TESTS_KEY);
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Keeps the newest `max` attempts, so a long session never outgrows what the plan endpoint accepts. */
export function trimAttempts(list: LoggedAttempt[], max = MAX_PLAN_ATTEMPTS): LoggedAttempt[] {
  return list.length > max ? list.slice(list.length - max) : list;
}

/** Remembers the full ScoreResult of a finished attempt on this device. */
export function logAttempt(lessonId: string, stepId: string, score: ScoreResult, meta: { stage?: LoggedStage; kind?: LoggedKind; at?: string } = {}): void {
  const entry: LoggedAttempt = { step_id: stepId, score, ...meta, at: meta.at ?? new Date().toISOString() };
  attempts = { ...attempts, [lessonId]: trimAttempts([...(attempts[lessonId] ?? []), entry], MAX_LOGGED_ATTEMPTS) };
  write(ATTEMPTS_KEY, attempts);
  emit();
}

/** Remembers the latest practice plan for a lesson on this device. */
export function storePlan(lessonId: string, plan: CoachPlanResponse, at = new Date().toISOString()): void {
  plans = { ...plans, [lessonId]: { plan, at } };
  write(PLANS_KEY, plans);
  emit();
}

/** Replaces everything logged for the given lessons (used to seed demo history). */
export function replaceLog(next: { attempts: Record<string, LoggedAttempt[]>; tests: Record<string, LoggedTest[]> }): void {
  attempts = { ...attempts, ...next.attempts };
  tests = { ...tests, ...next.tests };
  write(ATTEMPTS_KEY, attempts);
  write(TESTS_KEY, tests);
  emit();
}

/** Replaces the whole attempt and test log on this device (empty objects clear it). Plans are kept. */
export function setLog(next: { attempts: Record<string, LoggedAttempt[]>; tests: Record<string, LoggedTest[]> }): void {
  attempts = { ...next.attempts };
  tests = { ...next.tests };
  write(ATTEMPTS_KEY, attempts);
  write(TESTS_KEY, tests);
  emit();
}

/** The whole attempt and test log, outside React (for seeding and resets). */
export function readLog(): { attempts: Record<string, LoggedAttempt[]>; tests: Record<string, LoggedTest[]> } {
  return { attempts, tests };
}

/** Remembers a finished duel or test for a lesson. */
export function logTest(lessonId: string, test: LoggedTest): void {
  tests = { ...tests, [lessonId]: [...(tests[lessonId] ?? []), test].slice(-50) };
  write(TESTS_KEY, tests);
  emit();
}

const NONE: LoggedAttempt[] = [];
const NO_TESTS: LoggedTest[] = [];

/** Every attempt logged on this device, keyed by lesson. */
export function useAllAttempts(): Attempts {
  return useSyncExternalStore(subscribe, () => attempts);
}

/** Every test logged on this device, keyed by lesson. */
export function useAllTests(): Tests {
  return useSyncExternalStore(subscribe, () => tests);
}

/** Tests logged for a lesson, oldest first. */
export function useLoggedTests(lessonId: string): LoggedTest[] {
  return useSyncExternalStore(subscribe, () => tests[lessonId] ?? NO_TESTS);
}

/** Attempts logged on this device for a lesson, oldest first. */
export function useLoggedAttempts(lessonId: string): LoggedAttempt[] {
  return useSyncExternalStore(subscribe, () => attempts[lessonId] ?? NONE);
}

/** The practice plan stored on this device for a lesson, or null. */
export function useStoredPlan(lessonId: string | undefined): StoredPlan | null {
  return useSyncExternalStore(subscribe, () => (lessonId ? plans[lessonId] ?? null : null));
}
