import { api } from '../../api/client';
import type { GloveSource } from '../../api/types';
import { demoModePref, pref } from './settings';

/**
 * "No gloves" mode, for a demo where the gloves are not to hand. Switched on the landing page or in Settings, it shows
 * the whole app with simulated hands:
 * - the backend's glove source goes to the simulator (POST /api/dev/state), so every room has moving hands;
 * - demo mode (the hold-still drift check) is turned off, since it waits for real gloves;
 * - opening the app never stops on the gloves screen first.
 * Switching it off puts back the glove source and the demo mode that were set before. Kept in localStorage, so a reload
 * or a backend restart keeps it (`ensureNoGloves` re-applies the simulator on load). In mock mode the hands are already
 * simulated and only the flag changes.
 */

const KEY = 'apprentice.noGloves';
const BEFORE_KEY = 'apprentice.noGloves.before';

interface Before {
  source: GloveSource | null;
  demo: boolean;
}

export const noGlovesPref = pref<boolean>(KEY, (raw) => raw === '1', (v) => (v ? '1' : null));
export const useNoGloves = noGlovesPref.use;

function readBefore(): Before | null {
  try {
    const raw = window.localStorage.getItem(BEFORE_KEY);
    return raw ? (JSON.parse(raw) as Before) : null;
  } catch {
    return null;
  }
}

function writeBefore(before: Before | null): void {
  try {
    if (before) window.localStorage.setItem(BEFORE_KEY, JSON.stringify(before));
    else window.localStorage.removeItem(BEFORE_KEY);
  } catch {
    /* storage blocked: switching back leaves the simulator on */
  }
}

/** The backend's glove source, or null when it cannot be read. */
async function currentSource(): Promise<GloveSource | null> {
  try {
    return (await api.devState()).glove_source;
  } catch {
    return null;
  }
}

/**
 * Puts the backend on the simulator unless it already is. Returns the source it found, and whether the hands are now
 * simulated (false when the backend could not be read or refused the switch; the flag still applies either way).
 */
async function switchToSimulator(): Promise<{ source: GloveSource | null; ok: boolean }> {
  const source = await currentSource();
  if (source === null) return { source, ok: false };
  if (source === 'simulator') return { source, ok: true };
  try {
    await api.setDevState({ glove_source: 'simulator' });
    return { source, ok: true };
  } catch {
    return { source, ok: false };
  }
}

/**
 * Turns "No gloves" on or off, saving and restoring what it changes. Resolves true when it worked, false when turning it
 * on could not move the backend to the simulator (the flag is on all the same, so the app stops asking for gloves).
 */
export async function setNoGloves(on: boolean): Promise<boolean> {
  if (on === noGlovesPref.get()) return true;
  if (on) {
    const demo = demoModePref.get();
    noGlovesPref.set(true);
    demoModePref.set(false);
    const { source, ok } = await switchToSimulator();
    writeBefore({ source: source === 'simulator' ? null : source, demo });
    return ok;
  }
  const before = readBefore();
  noGlovesPref.set(false);
  writeBefore(null);
  if (before?.demo) demoModePref.set(true);
  if (before?.source && before.source !== 'simulator' && (await currentSource()) === 'simulator') {
    try {
      await api.setDevState({ glove_source: before.source });
    } catch {
      /* the backend could not switch back: the gloves screen says what is wrong */
    }
  }
  return true;
}

/** On app load: when "No gloves" is on, make sure the backend is still on the simulator (it may have restarted). */
export function ensureNoGloves(): void {
  if (noGlovesPref.get()) void switchToSimulator();
}
