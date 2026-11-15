import type { Finger } from '../../../../api/types';
import type { Instruction, SkillAxis } from './robotSkill';

/**
 * Understands plain teaching words for the robot, such as "curl your index more", "thumb a bit earlier", "little finger
 * too bent", "straighten the ring and little" or "that's right". It runs in the browser with no language model, so it is
 * instant, works offline and always says back exactly what it took from the sentence (research/14: echo every command).
 */

/** What the robot took from a sentence. */
export type Understanding =
  | { kind: 'instructions'; instructions: Instruction[] }
  | { kind: 'ok' }
  /** A finger was named but not what to do with it, or the other way round: the robot asks. */
  | { kind: 'ask'; fingers: Finger[]; axis: SkillAxis | null; dir: 1 | -1 | null; amount: number }
  | { kind: 'unknown' };

const FINGER_WORDS: Record<string, Finger> = {
  thumb: 'thumb',
  thumbs: 'thumb',
  index: 'index',
  pointer: 'index',
  pointing: 'index',
  forefinger: 'index',
  first: 'index',
  middle: 'middle',
  second: 'middle',
  ring: 'ring',
  third: 'ring',
  little: 'little',
  pinky: 'little',
  pinkie: 'little',
  small: 'little',
  fourth: 'little',
  baby: 'little',
};

/** Words that ask for more curl. "more" alone also means this, as does a finger that is "too straight". */
const BEND_MORE = new Set(['bend', 'curl', 'close', 'flex', 'fold', 'tuck', 'tighter', 'tighten', 'squeeze', 'grip', 'clench', 'more', 'deeper', 'further', 'down']);
/** Words that ask for less curl. "less" alone also means this, as does a finger that is "too bent". */
const BEND_LESS = new Set(['straighten', 'straight', 'open', 'extend', 'uncurl', 'unbend', 'relax', 'loosen', 'looser', 'less', 'flatter', 'flat', 'lift', 'up', 'raise', 'release']);
/** Describes a finger as too curled: the fix is less. Used after "too" or "is". */
const TOO_CURLED = new Set(['bent', 'curled', 'closed', 'tight', 'much', 'deep']);
/** Describes a finger as too open: the fix is more. */
const TOO_OPEN = new Set(['straight', 'open', 'flat', 'stiff', 'loose', 'little', 'weak']);
/** Asks to move sooner. "late" describes the fault, so it also asks for sooner. */
const SOONER = new Set(['earlier', 'sooner', 'faster', 'quicker', 'late', 'slow', 'lagging', 'lags', 'behind', 'hurry']);
/** Asks to move later. "early" describes the fault, so it also asks for later. */
const LATER = new Set(['later', 'slower', 'wait', 'delay', 'early', 'rushing', 'rush', 'rushed', 'ahead', 'fast', 'quick']);
const SMALL = new Set(['bit', 'slightly', 'touch', 'tad', 'tiny', 'smidge', 'gently']);
const LARGE = new Set(['lot', 'much', 'way', 'really', 'very', 'far', 'loads', 'heaps', 'fully', 'completely', 'all']);
const OK_WORDS = ['right', 'good', 'correct', 'perfect', 'great', 'fine', 'yes', 'nothing', 'nailed', 'spot', 'well done', 'looks good', 'leave it', "that's it", 'thats it'];
const FORBID = new Set(["don't", 'dont', 'never', 'stop']);

/** Amount for "a little" and for "a lot". */
/** Ready-made sentences the teach panel offers to tap, so a visitor sees plain words understood without typing. */
export const EXAMPLE_PHRASES = ['Curl your index more', 'Straighten the little finger a bit', 'Curl the middle and straighten the thumb'] as const;

export const SMALL_AMOUNT = 0.5;
export const LARGE_AMOUNT = 1.8;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

interface Clause {
  fingers: Finger[];
  axis: SkillAxis | null;
  dir: 1 | -1 | null;
  amount: number;
}

function readClause(ws: string[]): Clause {
  const fingers: Finger[] = [];
  let axis: SkillAxis | null = null;
  let dir: 1 | -1 | null = null;
  let amount = 1;
  /** "don't curl": an order not to, so the request flips. "doesn't curl" or "not curled enough" describe a shortfall, so it stands. */
  let forbid = false;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const prev = ws[i - 1];
    const next = ws[i + 1];
    // "a little" and "little bit" are amounts; "little" before "finger", or alone, is the finger.
    if (w === 'little' && (prev === 'a' || next === 'bit' || next === 'more' || next === 'less' || next === 'earlier' || next === 'later')) {
      amount = SMALL_AMOUNT;
      continue;
    }
    if (w === 'little' && prev === 'too') {
      axis = 'bend';
      dir = 1;
      continue;
    }
    if (FORBID.has(w)) {
      forbid = true;
      continue;
    }
    if (w === 'not' || w === "isn't" || w === 'isnt' || w === "doesn't" || w === 'doesnt') continue;
    if (w in FINGER_WORDS) {
      if (w === 'first' || w === 'second' || w === 'third' || w === 'fourth') {
        if (next !== 'finger' && next !== 'fingers') continue;
      }
      const f = FINGER_WORDS[w];
      if (!fingers.includes(f)) fingers.push(f);
      continue;
    }
    if (w === 'all' && (next === 'fingers' || next === 'of')) {
      for (const f of ['thumb', 'index', 'middle', 'ring', 'little'] as Finger[]) if (!fingers.includes(f)) fingers.push(f);
      continue;
    }
    if (SMALL.has(w)) {
      amount = SMALL_AMOUNT;
      continue;
    }
    if (prev === 'too' || prev === 'is' || prev === 'was' || prev === 'are' || prev === 'so') {
      if (SOONER.has(w)) {
        axis = 'time';
        dir = -1;
        continue;
      }
      if (LATER.has(w)) {
        axis = 'time';
        dir = 1;
        continue;
      }
      if (TOO_CURLED.has(w)) {
        axis = 'bend';
        dir = -1;
        continue;
      }
      if (TOO_OPEN.has(w)) {
        axis = 'bend';
        dir = 1;
        continue;
      }
    }
    if (LARGE.has(w) && w !== 'all') {
      if (w === 'much' && prev === 'too') {
        axis ??= 'bend';
        if (axis === 'bend') dir = -1;
        continue;
      }
      amount = LARGE_AMOUNT;
      continue;
    }
    if (SOONER.has(w)) {
      axis = 'time';
      dir = -1;
      continue;
    }
    if (LATER.has(w)) {
      axis = 'time';
      dir = 1;
      continue;
    }
    if (BEND_MORE.has(w) || w === 'curled' || w === 'bent' || w === 'closed') {
      // "more" after a timing word ("a bit more earlier") changes nothing; after a bend word it already agrees.
      if (axis === 'time' || (w === 'more' && dir !== null)) continue;
      axis = 'bend';
      dir = 1;
      continue;
    }
    if (BEND_LESS.has(w)) {
      if (axis === 'time' || (w === 'less' && dir !== null)) continue;
      axis = 'bend';
      dir = -1;
      continue;
    }
  }
  if (forbid && dir !== null) dir = dir === 1 ? -1 : 1;
  return { fingers, axis, dir, amount };
}

/** Splits a sentence into clauses: on commas and "then" or "but", and on "and" when both sides say what to do. */
function clauses(text: string): string[][] {
  const parts = text.split(/[,;.!?]|\bthen\b|\bbut\b|\balso\b/i).map(words).filter((p) => p.length);
  const out: string[][] = [];
  for (const p of parts) {
    const at = p.indexOf('and');
    if (at > 0) {
      const a = readClause(p.slice(0, at));
      const b = readClause(p.slice(at + 1));
      if (a.dir !== null && b.dir !== null) {
        out.push(p.slice(0, at), p.slice(at + 1));
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/**
 * Reads a sentence. `lastFinger` fills in a clause that says what to do but names no finger ("more", "a bit earlier"),
 * so a short follow-up to a question works.
 */
export function understand(text: string, lastFinger: Finger | null = null): Understanding {
  const all = words(text);
  if (!all.length) return { kind: 'unknown' };
  const joined = ` ${all.join(' ')} `;
  const instructions: Instruction[] = [];
  let ask: Understanding | null = null;
  let carried: Finger[] = lastFinger ? [lastFinger] : [];
  for (const ws of clauses(text)) {
    const c = readClause(ws);
    const fingers = c.fingers.length ? c.fingers : c.dir !== null ? carried : [];
    if (c.fingers.length) carried = c.fingers;
    if (fingers.length && c.axis && c.dir !== null) {
      for (const finger of fingers) instructions.push({ finger, axis: c.axis, dir: c.dir, amount: c.amount });
    } else if (fingers.length || c.dir !== null) {
      ask ??= { kind: 'ask', fingers, axis: c.axis, dir: c.dir, amount: c.amount };
    }
  }
  if (instructions.length) return { kind: 'instructions', instructions };
  const ok = OK_WORDS.some((w) => joined.includes(` ${w} `));
  // "the index is right" names a finger but asks for nothing: it is praise, not half an instruction.
  if (ok && (!ask || (ask.kind === 'ask' && ask.dir === null))) return { kind: 'ok' };
  if (ask) return ask;
  return { kind: 'unknown' };
}

const FINGER_NAME: Record<Finger, string> = { thumb: 'thumb', index: 'index finger', middle: 'middle finger', ring: 'ring finger', little: 'little finger' };

/** The robot saying back one instruction in its own words: "Curl my index finger a little more." */
export function echo(ins: Instruction): string {
  const size = ins.amount <= SMALL_AMOUNT ? ' a little' : ins.amount >= LARGE_AMOUNT ? ' a lot' : '';
  const f = FINGER_NAME[ins.finger];
  if (ins.axis === 'bend') return ins.dir === 1 ? `Curl my ${f}${size} more.` : `Straighten my ${f}${size}.`;
  return ins.dir === -1 ? `Move my ${f}${size} earlier.` : `Move my ${f}${size} later.`;
}

/** The question the robot asks when a sentence was half understood. */
export function question(u: Extract<Understanding, { kind: 'ask' }>): string {
  if (!u.fingers.length) return 'Which finger?';
  const f = u.fingers.map((x) => FINGER_NAME[x]).join(' and ');
  return `What should my ${f} do: curl more, straighten, move earlier or move later?`;
}

export { FINGER_NAME };
