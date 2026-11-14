import { useSyncExternalStore } from 'react';
import type { Hands, Prop, Side } from '../../api/types';

/**
 * Per-session stage preferences shared by the expert studio and the learner: whether props are drawn with the hands, and the
 * last hands set-up the expert chose. Kept in sessionStorage (cleared when the tab closes) and safe without it.
 */

const PROPS_KEY = 'apprentice.showProps';
const HANDS_KEY = 'apprentice.hands';

function read(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(key, value);
  } catch {
    /* private mode or storage blocked: the preference lasts until reload */
  }
}

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

let propsOn: boolean | null = null;

/** Whether props (racket, keyboard) are drawn with the hands. Off by default: the hands still clip through them. */
export function getShowProps(): boolean {
  propsOn ??= read(PROPS_KEY) === '1';
  return propsOn;
}

export function setShowProps(on: boolean): void {
  propsOn = on;
  write(PROPS_KEY, on ? '1' : '0');
  listeners.forEach((l) => l());
}

/** The session's prop preference and its setter; every stage that uses it re-renders together. */
export function useShowProps(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, getShowProps, () => false), setShowProps];
}

/** The prop a stage should draw: the move's own prop when props are on, else none. */
export const shownProp = (prop: Prop | undefined, on: boolean): Prop => (on && prop ? prop : 'none');

/** One-line note shown beside every prop switch. */
export const PROP_NOTE = 'Props can clip through the hands for now.';

/* ---- hands ---- */

interface HandsMemory {
  last?: Hands;
  moves: Record<string, Hands>;
}

const isHands = (v: unknown): v is Hands => v === 'left' || v === 'right' || v === 'both';

function readHands(): HandsMemory {
  try {
    const raw = JSON.parse(read(HANDS_KEY) ?? '{}') as Partial<HandsMemory>;
    const moves: Record<string, Hands> = {};
    for (const [k, v] of Object.entries(raw.moves ?? {})) if (isHands(v)) moves[k] = v;
    return { last: isHands(raw.last) ? raw.last : undefined, moves };
  } catch {
    return { moves: {} };
  }
}

/**
 * The hands a move starts with: the choice made for this move earlier in the session, else the move's catalogue entry, else
 * the last choice this session, else one hand, right.
 */
export function defaultHands(moveId: string | null, catalogue?: Hands): Hands {
  const mem = readHands();
  return (moveId ? mem.moves[moveId] : undefined) ?? catalogue ?? mem.last ?? 'right';
}

/** Remembers a hands choice for this session, for the move and as the latest choice. */
export function rememberHands(moveId: string | null, hands: Hands): void {
  const mem = readHands();
  if (moveId) mem.moves[moveId] = hands;
  mem.last = hands;
  write(HANDS_KEY, JSON.stringify(mem));
}

/** The gloves a hands set-up uses. */
export const handsSides = (h: Hands): Side[] => (h === 'both' ? ['left', 'right'] : [h]);

/** Plain words for a hands set-up. */
export const handsLabel = (h: Hands): string => (h === 'both' ? 'Two hands' : h === 'left' ? 'One hand, left' : 'One hand, right');
