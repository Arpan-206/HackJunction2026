import type { Finger, Side } from '../../../api/types';

/**
 * The standard QWERTY touch typing assignment: which finger of which hand owns each key. Left little: ` 1 Q A Z; left ring:
 * 2 W S X; left middle: 3 E D C; left index: 4 5 R T F G V B; right index: 6 7 Y U H J N M; right middle: 8 I K ,; right
 * ring: 9 O L .; right little: 0 - = P [ ] \ ; ' /. The space bar belongs to the thumbs (either one counts).
 */
export interface KeyFinger {
  side: Side;
  finger: Finger;
}

const COLUMNS: [Side, Finger, string][] = [
  ['left', 'little', '`1qaz~!'],
  ['left', 'ring', '2wsx@'],
  ['left', 'middle', '3edc#'],
  ['left', 'index', '45rtfgvb$%'],
  ['right', 'index', '67yuhjnm^&'],
  ['right', 'middle', '8ik,*<'],
  ['right', 'ring', '9ol.(>'],
  ['right', 'little', "0-=p[]\\;'/)_+{}|:\"?"],
];

/** Named keys a learner might press, by KeyboardEvent.key. */
const NAMED: Record<string, KeyFinger> = {
  Tab: { side: 'left', finger: 'little' },
  CapsLock: { side: 'left', finger: 'little' },
  Enter: { side: 'right', finger: 'little' },
  Backspace: { side: 'right', finger: 'little' },
};

const MAP = new Map<string, KeyFinger>();
for (const [side, finger, keys] of COLUMNS) for (const k of keys) MAP.set(k, { side, finger });

export const SPACE: KeyFinger = { side: 'right', finger: 'thumb' };

/** The finger that should strike a key (a KeyboardEvent.key or a character), or null for a key outside the map. */
export function fingerForKey(key: string): KeyFinger | null {
  if (key === ' ' || key === 'Space' || key === 'Spacebar') return SPACE;
  if (NAMED[key]) return NAMED[key];
  if (key.length !== 1) return null;
  return MAP.get(key.toLowerCase()) ?? null;
}

/** Whether `used` is an acceptable finger for a key owned by `expected`: same hand and finger, or any thumb for the space bar. */
export function sameFinger(expected: KeyFinger, used: KeyFinger): boolean {
  if (expected.finger === 'thumb') return used.finger === 'thumb';
  return expected.side === used.side && expected.finger === used.finger;
}

/** The home row: where each finger rests, and the key it strikes in the drills. */
export const HOME_KEYS: Record<Side, Record<Finger, string>> = {
  left: { thumb: ' ', index: 'f', middle: 'd', ring: 's', little: 'a' },
  right: { thumb: ' ', index: 'j', middle: 'k', ring: 'l', little: ';' },
};

/** The letters of the home row, for the "home row only" level. */
export const HOME_ROW = 'asdfghjkl;';

/** "e" -> "E", " " -> "Space": a key as the screen names it. */
export function keyLabel(key: string): string {
  if (key === ' ' || key === 'Space') return 'Space';
  return key.length === 1 ? key.toUpperCase() : key;
}

const FINGER_WORD: Record<Finger, string> = { thumb: 'thumb', index: 'index finger', middle: 'middle finger', ring: 'ring finger', little: 'little finger' };

/** "left middle finger"; a thumb is just "thumb", since either thumb may take the space bar. */
export function fingerPhrase(kf: KeyFinger, withSide = true): string {
  if (kf.finger === 'thumb') return 'thumb';
  return withSide ? `${kf.side} ${FINGER_WORD[kf.finger]}` : FINGER_WORD[kf.finger];
}
