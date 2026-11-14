import { useSyncExternalStore } from 'react';
import { DEFAULT_MARGIN, isMargin, MARGIN_MULTIPLIERS } from '../../api/margin';
import type { Margin, Tolerance } from '../../api/types';

/**
 * The learner's settings from the Settings panel (rail footer): margin of error, how the score is shown and reduced
 * motion. Kept in localStorage so they survive a reload, and safe without it (private mode, blocked storage): every read
 * and write is wrapped, and a blocked write keeps the choice until reload. The AI Assistant switch lives in assistant.ts
 * and the "Add a prop" default in sessionPrefs.ts; the panel shows all of them together.
 */

export type ScoreView = '3d' | '2d';

const MARGIN_KEY = 'apprentice.margin';
const VIEW_KEY = 'apprentice.scoreView';
const MOTION_KEY = 'apprentice.reduceMotion';

function read(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
}

interface Pref<T> {
  get: () => T;
  set: (value: T) => void;
  use: () => [T, (value: T) => void];
  /** Forgets the cached value so the next read goes back to storage (tests). */
  reset: () => void;
}

/** One persisted preference with a cached value and subscribers, read through useSyncExternalStore. */
function pref<T>(key: string, parse: (raw: string | null) => T, serialise: (value: T) => string | null, onChange?: (value: T) => void): Pref<T> {
  const listeners = new Set<() => void>();
  let cached: { value: T } | null = null;
  const get = () => (cached ??= { value: parse(read(key)) }).value;
  const set = (value: T) => {
    cached = { value };
    const raw = serialise(value);
    if (raw === null) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* storage blocked */
      }
    } else write(key, raw);
    onChange?.(value);
    listeners.forEach((l) => l());
  };
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };
  const fallback = parse(null);
  return {
    get,
    set,
    use: () => [useSyncExternalStore(subscribe, get, () => fallback), set],
    reset: () => {
      cached = null;
    },
  };
}

/* ---- margin of error ---- */

export const marginPref = pref<Margin>(MARGIN_KEY, (raw) => (isMargin(raw) ? raw : DEFAULT_MARGIN), (v) => v);

/** The learner's margin of error and its setter. Standard unless the learner chose otherwise. */
export const useMargin = marginPref.use;
export const getMargin = marginPref.get;

/** Plain words for each margin, for the Settings panel and the score screen. */
export const MARGIN_INFO: Record<Margin, { label: string; blurb: string; phrase: string; room: string }> = {
  strict: { label: 'Strict', blurb: 'Tight. Small slips are marked, for polishing a skill you already know.', phrase: 'a strict margin of error', room: ', narrowed by your strict margin of error.' },
  standard: { label: 'Standard', blurb: "The expert's own margin. The default.", phrase: "the expert's standard margin of error", room: '.' },
  relaxed: { label: 'Relaxed', blurb: 'Wider. A slightly wrong swing still passes, with no correction.', phrase: 'a relaxed margin of error', room: ', widened by your relaxed margin of error.' },
  just_trying: { label: 'Just trying it', blurb: 'Very wide. Only big mistakes are marked, for a first go.', phrase: 'a very wide margin of error, just trying it', room: ', widened a lot because you are just trying it.' },
};

/** The room for error a step gives once the learner's margin is applied, rounded for display. */
export function roomFor(tolerance: Tolerance, margin: Margin): { angle: number; timing: number } {
  const k = MARGIN_MULTIPLIERS[margin];
  return { angle: Math.round(tolerance.angle_deg * k), timing: Math.round(tolerance.timing_ms * k) };
}

/** One sentence for the score screen: which margin judged the rep, and what it allowed. */
export function marginSentence(margin: Margin, tolerance?: Tolerance): string {
  const room = tolerance ? roomFor(tolerance, margin) : null;
  const what = room ? `: ${room.angle} degrees per finger and ${room.timing} ms of timing` : '';
  return `Judged with ${MARGIN_INFO[margin].phrase}${what}.`;
}

/* ---- score view ---- */

export const scoreViewPref = pref<ScoreView>(VIEW_KEY, (raw) => (raw === '2d' ? '2d' : '3d'), (v) => v);

/** How the score is shown first: the 3D scene (default) or the flat chart. */
export const useScoreView = scoreViewPref.use;

/* ---- gloves: demo mode and the wearer ---- */

const DEMO_KEY = 'apprentice.demoMode';
const WEARER_KEY = 'apprentice.wearer';
export const WEARER_MAX_CHARS = 40;

/**
 * Demo mode skips the full glove calibration: the app loads the wearer's last saved calibration and only runs a short
 * drift check ("hold still") before going in, asking for a recalibration when the gloves have drifted. Off by default.
 */
export const demoModePref = pref<boolean>(DEMO_KEY, (raw) => raw === '1', (v) => (v ? '1' : null));
export const useDemoMode = demoModePref.use;

/** Who wears the gloves: calibrations are saved per wearer. Empty until someone types a name. */
export const wearerPref = pref<string>(
  WEARER_KEY,
  (raw) => (raw ?? '').slice(0, WEARER_MAX_CHARS),
  (v) => (v.trim() ? v.trim().slice(0, WEARER_MAX_CHARS) : null),
);
export const useWearer = wearerPref.use;

/* ---- reduced motion ---- */

/** Whether the device itself asks for less motion. */
export function systemReducesMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function markRoot(on: boolean | null): void {
  if (typeof document === 'undefined') return;
  // The attribute switches the same CSS that the system preference does (see styles/global.css).
  if (on) document.documentElement.setAttribute('data-reduce-motion', '');
  else document.documentElement.removeAttribute('data-reduce-motion');
}

/** The learner's own choice: true or false, or null to follow the device. */
export const reduceMotionPref = pref<boolean | null>(
  MOTION_KEY,
  (raw) => (raw === '1' ? true : raw === '0' ? false : null),
  (v) => (v === null ? null : v ? '1' : '0'),
  markRoot,
);

/** True when motion should be reduced: the learner asked for it, or the device does and the learner has not said otherwise. */
export function prefersReducedMotion(): boolean {
  return reduceMotionPref.get() ?? systemReducesMotion();
}

/** The effective reduced-motion flag and a setter that records the learner's explicit choice. */
export function useReducedMotion(): [boolean, (on: boolean) => void] {
  const [choice, set] = reduceMotionPref.use();
  return [choice ?? systemReducesMotion(), set];
}

markRoot(reduceMotionPref.get());
