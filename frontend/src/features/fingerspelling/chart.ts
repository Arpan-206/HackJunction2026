/**
 * The fingerspelling chart: the 26 letters of the American manual alphabet as the gloves see them. Each letter's shape is
 * the `fs_<letter>` move in `mock/data/moves.json`, a verbatim copy of `backend/app/data/moves.json`, so the chart, the drill,
 * the seeded lessons, the scorer and `tools/make_pose_lessons.py` all read one table. Nothing here is a second copy of a
 * curl. Every curl is an estimate of a written handshape (SOURCES) until an expert records the letters with the gloves.
 *
 * The solver gives finger curl and the wrist, not finger spread or which finger the thumb touches (STATUS.md), so some
 * letters look the same to the scorer. `gloveTwins` finds them from the curls, and `TWIN_REASON` says in words what really
 * separates them, from the sources.
 */
import type { Finger, MotionSpec } from '../../api/types';
import { FINGERS } from '../../api/types';
import movesJson from '../../mock/data/moves.json';

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export type Letter = (typeof LETTERS)[number];

/** Where the written handshapes come from. Checked on 14 Nov 2026. */
export const SOURCES = [
  { label: 'Stokoe notation, handshape (dez) table, Wikipedia', url: 'https://en.wikipedia.org/wiki/Stokoe_notation' },
  { label: 'American manual alphabet, Wikipedia', url: 'https://en.wikipedia.org/wiki/American_manual_alphabet' },
  { label: 'American Sign Language alphabet, Start ASL', url: 'https://www.startasl.com/american-sign-language-alphabet/' },
] as const;

interface MoveRow {
  id: string;
  skill: string;
  description: string;
  default_motion: MotionSpec;
}

const MOVES = movesJson as unknown as MoveRow[];
const BY_ID = new Map(MOVES.map((m) => [m.id, m]));

export type Curls = Record<Finger, number>;

export interface LetterShape {
  letter: Letter;
  /** The written handshape, without the "estimates" note. */
  shape: string;
  motion: MotionSpec;
  /** The held curls (the first key for a letter with a motion). */
  curls: Curls;
  /** How the letter moves or turns, in words, or null for a still letter. */
  movement: string | null;
}

const ESTIMATE_NOTE = /\s*Curls are estimates until an expert records it with the gloves\.\s*$/;

function curlsOf(m: MotionSpec): Curls {
  if (m.preset === 'hold_pose') return { ...m.pose };
  if (m.preset === 'keyframes') return { ...m.keys[0].pose };
  throw new Error(`a letter is a hold or keyframes, not ${m.preset}`);
}

const MOVEMENT: Partial<Record<Letter, string>> = {
  J: 'Twist the wrist so the little finger draws a J.',
  Z: 'Draw a Z in the air with the index finger.',
  P: 'Turned down: the middle finger points to the floor.',
  Q: 'Turned down: thumb and index point to the floor.',
};

/** Every letter's shape, A to Z. Throws at import if a letter is missing from the moves, so a broken copy fails loudly. */
export const CHART: LetterShape[] = LETTERS.map((letter) => {
  const m = BY_ID.get(`fs_${letter.toLowerCase()}`);
  if (!m) throw new Error(`moves.json has no fs_${letter.toLowerCase()}`);
  return { letter, shape: m.description.replace(ESTIMATE_NOTE, ''), motion: m.default_motion, curls: curlsOf(m.default_motion), movement: MOVEMENT[letter] ?? null };
});

const BY_LETTER = new Map(CHART.map((c) => [c.letter, c]));

export function letterShape(letter: string): LetterShape | null {
  return BY_LETTER.get(letter.toUpperCase() as Letter) ?? null;
}

/** Largest per-finger curl difference between two shapes, 0 to 1. */
export function curlDistance(a: Curls, b: Curls): number {
  return Math.max(...FINGERS.map((f) => Math.abs(a[f] - b[f])));
}

/**
 * Two letters closer than this on every finger are one shape to the gloves. 0.2 of a full curl is about 18 degrees per
 * joint, inside a lesson's tolerance (22 degrees), so the scorer cannot keep them apart.
 */
export const TWIN_CURL = 0.2;

/** The letters the gloves read the same as `letter`, in alphabet order. */
export function gloveTwins(letter: string): Letter[] {
  const me = letterShape(letter);
  if (!me) return [];
  return CHART.filter((c) => c.letter !== me.letter && curlDistance(c.curls, me.curls) < TWIN_CURL).map((c) => c.letter);
}

/** Groups of letters the gloves cannot separate by curl alone: letters joined by any chain of glove twins. */
export function twinGroups(): Letter[][] {
  const seen = new Set<Letter>();
  const out: Letter[][] = [];
  for (const c of CHART) {
    if (seen.has(c.letter)) continue;
    const group: Letter[] = [];
    const todo: Letter[] = [c.letter];
    while (todo.length) {
      const l = todo.pop() as Letter;
      if (seen.has(l)) continue;
      seen.add(l);
      group.push(l);
      todo.push(...gloveTwins(l));
    }
    if (group.length > 1) out.push(group.sort());
  }
  return out;
}

/**
 * What really separates letters the gloves confuse, in the sources' words. Keys are letter pairs in alphabet order.
 * Spread and thumb contact are not sensed; orientation and motion are shown by the expert's hand but not scored.
 */
export const TWIN_REASON: Record<string, string> = {
  CO: 'O closes the fingertips onto the thumb, C leaves a gap. The gloves do not sense the touch.',
  GL: 'L opens the thumb and index finger to a right angle, G points both forward. The gloves see two straight fingers either way.',
  GQ: 'Q is G turned so the thumb and index finger point to the floor. Only the wrist differs.',
  LQ: 'Q points the thumb and index finger to the floor, L holds them up at a right angle.',
  HR: 'H points sideways with the fingers side by side; R points up with them crossed.',
  HU: 'H points sideways, U points up. Only the wrist differs.',
  HV: 'H points sideways with the fingers together; V points up with them spread.',
  RU: 'R crosses the two fingers. The gloves do not sense crossing.',
  RV: 'R crosses the two fingers, V spreads them. The gloves sense neither.',
  UV: 'U keeps the two fingers together, V spreads them. The gloves do not sense spread.',
  IJ: 'J is I with a twist of the wrist. The motion tells them apart.',
  KP: 'P is K turned so the middle finger points to the floor. Only the wrist differs.',
  MN: 'M folds three fingers over the thumb, N folds two.',
  MT: 'M folds three fingers over the thumb, T only the index finger.',
  NT: 'N folds two fingers over the thumb, T only the index finger.',
  NS: 'N folds two fingers over the thumb, S lays the thumb across the front of the fist.',
  ST: 'T tucks the thumb under the index finger, S lays it across the front of the fist.',
};

/** The words for why two letters look alike to the gloves, or a plain fallback. */
export function twinReason(a: string, b: string): string {
  const key = [a.toUpperCase(), b.toUpperCase()].sort().join('');
  return TWIN_REASON[key] ?? `${key[0]} and ${key[1]} differ in ways the gloves do not sense.`;
}

/* ---------- words ---------- */

/** Letters of a word the chart can spell, upper case; anything else (spaces, digits, accents) is dropped. */
export function spellable(word: string): Letter[] {
  return [...word.toUpperCase()].filter((ch): ch is Letter => BY_LETTER.has(ch as Letter));
}

/** Milliseconds each letter of a spelled word lasts: about one letter a second, as the seeded word lessons. */
export const LETTER_MS = 1200;

/**
 * A spelled word as one keyframes motion, one slot of `ms` per letter: a still letter is one key, J and Z keep their keys
 * squeezed into the slot. The same rule built the seeded word moves (fs_word_*), tested against them.
 */
export function wordMotion(word: string, ms = LETTER_MS): MotionSpec {
  const keys = spellable(word).flatMap((l) => {
    const m = (BY_LETTER.get(l) as LetterShape).motion;
    if (m.preset === 'hold_pose') return [{ pose: { ...m.pose }, ms }];
    if (m.preset !== 'keyframes') return [];
    const total = m.keys.reduce((n, k) => n + k.ms, 0);
    return m.keys.map((k) => ({ ...k, pose: { ...k.pose }, ms: Math.round((k.ms * ms) / total) }));
  });
  return { preset: 'keyframes', keys };
}

/** Words the drill offers first: the seeded ones, then short ones. */
export const DRILL_WORDS = ['JUNCTION', 'GEPPETTO', 'HELLO', 'HAND', 'ROBOT'];
