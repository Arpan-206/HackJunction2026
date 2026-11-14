import { mulberry32 } from '../test/PianoPlayAlong/piano';
import { HOME_ROW } from './fingerMap';

export type TypingLevel = 'home' | 'all';

/** Short real words made only of home row letters. */
export const HOME_WORDS = ['ask', 'add', 'all', 'dad', 'sad', 'lad', 'gas', 'has', 'had', 'ash', 'dash', 'flash', 'flask', 'glass', 'salad', 'shall', 'half', 'flag', 'hall', 'fall', 'alas', 'gala', 'lag', 'sag', 'jags', 'lass'];

/** Short everyday words across the whole keyboard. */
export const ALL_WORDS = ['the', 'and', 'you', 'hand', 'glove', 'skill', 'learn', 'touch', 'craft', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'word', 'type', 'keys', 'home', 'play', 'light', 'write', 'paper', 'every', 'right', 'wrist', 'gentle', 'steady', 'music', 'river', 'stone'];

export const LEVEL_LABEL: Record<TypingLevel, string> = { home: 'Home row only', all: 'All letters' };

/** True when a word needs only home row keys. */
export const isHomeRowWord = (w: string): boolean => [...w].every((c) => HOME_ROW.includes(c));

/** `count` words for a level, shuffled by a seed so a run can be replayed exactly; no word twice in a row. */
export function pickWords(level: TypingLevel, count: number, seed = 1): string[] {
  const pool = level === 'home' ? HOME_WORDS : ALL_WORDS;
  const rng = mulberry32(seed);
  const out: string[] = [];
  while (out.length < count) {
    const w = pool[Math.floor(rng() * pool.length)];
    if (w !== out[out.length - 1]) out.push(w);
  }
  return out;
}
