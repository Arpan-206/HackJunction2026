import { useSyncExternalStore } from 'react';

/** How the apprentice sees the master's reference: ghost overlay, dark shadow guidance, or two hands side by side. */
export type GuidanceMode = 'ghost' | 'shadow' | 'side_by_side';

export interface Settings {
  guidanceMode: GuidanceMode;
}

const KEY = 'apprentice.settings';
const DEFAULTS: Settings = { guidanceMode: 'ghost' };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

let current: Settings = load();
const listeners = new Set<() => void>();

/** Updates and persists local UI settings. */
export function setSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Local UI preferences (persisted in localStorage), e.g. the default apprentice guidance mode. */
export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
