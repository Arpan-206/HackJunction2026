import { useSyncExternalStore } from 'react';

/**
 * The AI Assistant switch: one flag for every language-model feature (drafting steps from words or a video, describing a
 * movement in words, the practice plan, written coaching hints, the feedback after a rep). On by default and kept in localStorage. The API client
 * checks it too (see ASSISTANT_PATHS), so no assistant request can leave the app while it is off, in mock mode as well.
 * The algorithmic scorer is not the AI Assistant and works either way.
 */

const KEY = 'apprentice.assistant';

/** API paths (under /api) that call the AI Assistant. */
export const ASSISTANT_PATHS = ['/lessons/generate', '/lessons/generate_from_video', '/coach/hint', '/coach/review', '/coach/plan', '/motion/from_text'] as const;

/** Whether a request path (without query string) goes to the AI Assistant. */
export function isAssistantPath(path: string): boolean {
  const bare = path.split('?')[0];
  return (ASSISTANT_PATHS as readonly string[]).includes(bare);
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let on: boolean | null = null;

export function isAssistantOn(): boolean {
  if (on === null) {
    try {
      on = storage()?.getItem(KEY) !== '0';
    } catch {
      on = true;
    }
  }
  return on;
}

export function setAssistantOn(next: boolean): void {
  on = next;
  try {
    storage()?.setItem(KEY, next ? '1' : '0');
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** The AI Assistant switch and its setter; every screen that uses it updates together. */
export function useAssistant(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, isAssistantOn, () => true), setAssistantOn];
}

/** The one-line notes shown where an assistant feature would be. */
export const ASSISTANT_OFF = {
  draft: 'The AI Assistant is off. Turn it on in Settings to draft steps from a sentence.',
  video: 'The AI Assistant is off. Turn it on in Settings to draft steps from a video.',
  describe: 'The AI Assistant is off. Turn it on in Settings to describe a movement in words.',
} as const;
