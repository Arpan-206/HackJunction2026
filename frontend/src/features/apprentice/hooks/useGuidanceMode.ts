import { useSyncExternalStore } from 'react';
import { setSettings } from '../../../state/settings';

/** The four ways the master can be shown to the apprentice. 'marionette' is the apprentice default. */
export type ApprenticeGuidance = 'marionette' | 'shadow' | 'ghost' | 'side_by_side';

export const GUIDANCE_OPTIONS: { id: ApprenticeGuidance; label: string; hint: string }[] = [
  { id: 'marionette', label: 'Strings', hint: 'The expert hovers above you, strings join each fingertip.' },
  { id: 'shadow', label: 'Shadow', hint: 'A dark shadow of the expert lies under your hand.' },
  { id: 'ghost', label: 'Ghost', hint: 'A chalk ghost overlays your hand.' },
  { id: 'side_by_side', label: 'Side by side', hint: 'Expert on the left, you on the right.' },
];

const KEY = 'apprentice.guidance.v2';

function load(): ApprenticeGuidance {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && GUIDANCE_OPTIONS.some((o) => o.id === raw)) return raw as ApprenticeGuidance;
  } catch {
    /* storage unavailable */
  }
  return 'marionette';
}

let current: ApprenticeGuidance = load();
const listeners = new Set<() => void>();

/** Persists the chosen guidance mode, and mirrors it into the shared settings when the shared type knows it. */
export function setGuidance(mode: ApprenticeGuidance): void {
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable */
  }
  if (mode !== 'marionette') setSettings({ guidanceMode: mode });
  listeners.forEach((l) => l());
}

/** The apprentice's chosen guidance mode (persisted locally, default marionette strings). */
export function useGuidance(): ApprenticeGuidance {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
