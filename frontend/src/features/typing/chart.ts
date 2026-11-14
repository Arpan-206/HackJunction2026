/**
 * Standard QWERTY touch-typing chart, the same one the core judges with (`core/tasks/typing.py`, CHART_ROWS).
 * `tests/test_typing.py::test_frontend_chart_matches_the_core` reads this file and fails if the two disagree,
 * so keep one row per finger in the `FINGER_KEYS` literal below.
 */

export type TypingSide = 'left' | 'right';
export type TypingFinger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
/** Tally row: one per chart finger, with both thumbs as one row for the space bar. */
export type FingerRow = `${TypingSide}.${Exclude<TypingFinger, 'thumb'>}` | 'both.thumb';

export const FINGER_KEYS: Record<Exclude<FingerRow, 'both.thumb'>, string> = {
  'left.little': '`1qaz',
  'left.ring': '2wsx',
  'left.middle': '3edc',
  'left.index': '45rtfgvb',
  'right.index': '67yuhjnm',
  'right.middle': '8ik,',
  'right.ring': '9ol.',
  'right.little': '0-=p[]\\;\'/',
};

export const FINGER_ROWS: FingerRow[] = [
  'left.little',
  'left.ring',
  'left.middle',
  'left.index',
  'both.thumb',
  'right.index',
  'right.middle',
  'right.ring',
  'right.little',
];

export const SPACE = ' ';

const KEY_ROW = new Map<string, FingerRow>();
for (const [row, keys] of Object.entries(FINGER_KEYS)) for (const k of keys) KEY_ROW.set(k, row as FingerRow);
KEY_ROW.set(SPACE, 'both.thumb');

const SHIFTED: Record<string, string> = {
  '~': '`', '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
};

/** Base chart key for a KeyboardEvent.key, or null when the chart has no such key (Enter, Shift, arrows). */
export function normalizeKey(key: string): string | null {
  if (key === ' ' || key === 'Spacebar') return SPACE;
  if ([...key].length !== 1) return null;
  const k = SHIFTED[key] ?? key.toLowerCase();
  return KEY_ROW.has(k) ? k : null;
}

/** The chart finger row for a key, or null. */
export function rowOfKey(key: string): FingerRow | null {
  const k = normalizeKey(key);
  return k === null ? null : (KEY_ROW.get(k) ?? null);
}

/** Plain words for a finger row, for screen text. */
export function fingerName(row: FingerRow): string {
  if (row === 'both.thumb') return 'either thumb';
  const [side, finger] = row.split('.');
  return `${side} ${finger} finger`;
}

/** Plain words for one detected finger. */
export function handFingerName(hand: TypingSide, finger: TypingFinger): string {
  return finger === 'thumb' ? `${hand} thumb` : `${hand} ${finger} finger`;
}

/** Hue per finger, mirrored left and right so each finger pair shares a colour. Muted tempera tones. */
export const FINGER_TINT: Record<FingerRow, string> = {
  'left.little': '#b9a2c9',
  'left.ring': '#9fb7d6',
  'left.middle': '#a9cdb3',
  'left.index': '#e6cf98',
  'both.thumb': '#d8c8b0',
  'right.index': '#e6cf98',
  'right.middle': '#a9cdb3',
  'right.ring': '#9fb7d6',
  'right.little': '#b9a2c9',
};

/** The keyboard as drawn: four rows plus the space bar. */
export const KEYBOARD_ROWS: string[][] = [
  [...'`1234567890-='],
  [...'qwertyuiop[]\\'],
  [...'asdfghjkl;\''],
  [...'zxcvbnm,./'],
];

export const HOME_KEYS = new Set([...'asdfjkl;']);
