/**
 * The word drill's rules, kept pure so they are unit tested: spell a word letter by letter, each letter passing once every
 * finger has stayed inside the tolerance for `holdMs`. The live match per letter uses the same closeness rule as the room's
 * local score (`training/coach/localScore.ts`); the word's final score comes from the scorer (POST /score), not from here.
 */
import { FINGERS, type Finger } from '../../api/types';
import type { FingerValues } from '../apprentice/training/coach/deviation';
import type { Letter } from './chart';

export interface DrillConfig {
  /** Allowed difference in total finger flexion, degrees (a step's angle_deg widened by the margin). */
  toleranceDeg: number;
  /** How long every finger must stay inside the tolerance for the letter to pass. */
  holdMs: number;
  /** A letter not reached in this long is skipped, marked missed, so the drill never stalls. */
  giveUpMs: number;
}

export const DEFAULT_DRILL: DrillConfig = { toleranceDeg: 22, holdMs: 600, giveUpMs: 12000 };

export interface LetterResult {
  letter: Letter;
  /** Milliseconds from the letter's start until it passed (or was given up). */
  ms: number;
  /** Mean live match over the letter, 0 to 100. */
  match: number;
  passed: boolean;
}

export interface DrillState {
  word: Letter[];
  index: number;
  letterStartMs: number;
  /** When every finger came inside the tolerance this time, or null while one is out. */
  inSinceMs: number | null;
  matchSum: number;
  matchN: number;
  /** Live match of the last frame, 0 to 100. */
  match: number;
  /** Fingers outside the tolerance on the last frame. */
  off: Finger[];
  results: LetterResult[];
  done: boolean;
}

export function startDrill(word: Letter[], nowMs: number): DrillState {
  return { word, index: 0, letterStartMs: nowMs, inSinceMs: null, matchSum: 0, matchN: 0, match: 0, off: [], results: [], done: word.length === 0 };
}

/** Live match of one frame, 0 to 100: the mean over fingers of 1 - error / (2 x tolerance), floored at 0. */
export function frameMatch(learner: FingerValues, target: FingerValues, toleranceDeg: number): { match: number; off: Finger[] } {
  let sum = 0;
  const off: Finger[] = [];
  for (const f of FINGERS) {
    const err = Math.abs(learner[f] - target[f]);
    sum += Math.max(0, 1 - err / (2 * toleranceDeg));
    if (err > toleranceDeg) off.push(f);
  }
  return { match: Math.round((100 * sum) / FINGERS.length), off };
}

function close(s: DrillState, nowMs: number, passed: boolean): DrillState {
  const letter = s.word[s.index];
  const result: LetterResult = { letter, ms: Math.round(nowMs - s.letterStartMs), match: s.matchN ? Math.round(s.matchSum / s.matchN) : 0, passed };
  const index = s.index + 1;
  return { ...s, index, letterStartMs: nowMs, inSinceMs: null, matchSum: 0, matchN: 0, off: [], results: [...s.results, result], done: index >= s.word.length };
}

/** One glove frame: update the live match, pass the letter after a clean hold, or give it up after too long. */
export function drillFrame(s: DrillState, learner: FingerValues, target: FingerValues, nowMs: number, cfg: DrillConfig = DEFAULT_DRILL): DrillState {
  if (s.done) return s;
  const { match, off } = frameMatch(learner, target, cfg.toleranceDeg);
  const inSinceMs = off.length ? null : (s.inSinceMs ?? nowMs);
  const next = { ...s, match, off, inSinceMs, matchSum: s.matchSum + match, matchN: s.matchN + 1 };
  if (inSinceMs !== null && nowMs - inSinceMs >= cfg.holdMs) return close(next, nowMs, true);
  if (nowMs - s.letterStartMs >= cfg.giveUpMs) return close(next, nowMs, false);
  return next;
}

/** Skip the current letter (the learner asked to), marked as missed. */
export function skipLetter(s: DrillState, nowMs: number): DrillState {
  return s.done ? s : close(s, nowMs, false);
}

/** Progress through the hold of the current letter, 0 to 1, for the ring round the big letter. */
export function holdProgress(s: DrillState, nowMs: number, cfg: DrillConfig = DEFAULT_DRILL): number {
  return s.inSinceMs === null ? 0 : Math.min(1, (nowMs - s.inSinceMs) / cfg.holdMs);
}

export interface DrillSummary {
  passed: number;
  total: number;
  /** Mean of the letters' live match, 0 to 100. */
  match: number;
  /** Letters per minute over the passed letters, or 0. */
  lettersPerMinute: number;
  /** The letter with the lowest match, or null. */
  hardest: Letter | null;
}

export function summarise(results: LetterResult[]): DrillSummary {
  const passed = results.filter((r) => r.passed);
  const ms = passed.reduce((n, r) => n + r.ms, 0);
  const hardest = results.length ? results.reduce((a, b) => (b.match < a.match ? b : a)).letter : null;
  return {
    passed: passed.length,
    total: results.length,
    match: results.length ? Math.round(results.reduce((n, r) => n + r.match, 0) / results.length) : 0,
    lettersPerMinute: ms > 0 ? Math.round((passed.length * 60000) / ms) : 0,
    hardest,
  };
}
