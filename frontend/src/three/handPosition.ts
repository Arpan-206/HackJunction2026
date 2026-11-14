import { useEffect, useSyncExternalStore } from 'react';
import type { Side } from '../api/types';

/**
 * Hand position from the phone's depth (the core's `wrist_pos`, hand-root lane) is used only where a skill asks for
 * it: table tennis moves through space, while piano, fingerspelling and the shadow puppets read better with the hand
 * in one place. A screen turns it on for its skill with `useHandPosition`; everywhere else the hand stays put.
 *
 * Override for a demo or a test, localStorage `apprentice.handPosition`: "on" (every screen), "off" (none), or
 * "auto" (the default: per skill).
 *
 * Recentre: the depth position can drift until the hand sits at the edge of the stage. `recentreHandPosition` makes
 * wherever each live hand is right now its new centre, with no calibration and nothing sent to the core; the hand then
 * moves from there. It lasts until the page reloads or the learner recentres again.
 */
const KEY = 'apprentice.handPosition';
/** How long a recentre waits for a live hand to report its position, milliseconds; a side not seen by then keeps its centre. */
const RECENTRE_WINDOW_MS = 1000;

export type HandPositionMode = 'auto' | 'on' | 'off';
type Triple = [number, number, number];

let wanted = false;
const listeners = new Set<() => void>();
const centres: Record<Side, Triple | null> = { left: null, right: null };
let recentreUntil = 0;
const recentred = new Set<Side>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function handPositionMode(): HandPositionMode {
  try {
    const v = typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** True while the live hand should follow `wrist_pos`. Read once a frame by three/Hand.tsx. */
export function followsHandPosition(): boolean {
  const mode = handPositionMode();
  return mode === 'on' || (mode === 'auto' && wanted);
}

/** The same flag for a component that shows or hides with it (the Recentre hand button). */
export function useFollowsHandPosition(): boolean {
  return useSyncExternalStore(subscribe, followsHandPosition, () => false);
}

/** For the screen of one skill: `on` is the skill's own flag (catalogue `handPosition`). Off again when the screen closes. */
export function useHandPosition(on: boolean): void {
  useEffect(() => {
    wanted = on;
    notify();
    return () => {
      wanted = false;
      notify();
    };
  }, [on]);
}

/** Make each live hand's current position its centre, on the next frame it draws. */
export function recentreHandPosition(now: number = performance.now()): void {
  recentreUntil = now + RECENTRE_WINDOW_MS;
  recentred.clear();
}

/**
 * The wrist position (metres, core world) a live hand of `side` is measured from: its centre after a recentre, or
 * `rest` (the core's rest pose) before any. `pos` is where the hand is now; while a recentre is waiting for this side,
 * that becomes the centre.
 */
export function handCentre(side: Side, pos: readonly number[], rest: Triple, now: number = performance.now()): Triple {
  if (now <= recentreUntil && !recentred.has(side)) {
    centres[side] = [pos[0], pos[1], pos[2]];
    recentred.add(side);
  }
  return centres[side] ?? rest;
}

/** Tests only. */
export function setHandPositionWanted(on: boolean): void {
  wanted = on;
  notify();
}

/** Tests only: forget every centre and any waiting recentre. */
export function resetHandCentres(): void {
  centres.left = null;
  centres.right = null;
  recentreUntil = 0;
  recentred.clear();
}
