import { useEffect } from 'react';

/**
 * Hand position from the phone's depth (the core's `wrist_pos`, hand-root lane) is used only where a skill asks for
 * it: table tennis moves through space, while piano, fingerspelling and the shadow puppets read better with the hand
 * in one place. A screen turns it on for its skill with `useHandPosition`; everywhere else the hand stays put.
 *
 * Override for a demo or a test, localStorage `apprentice.handPosition`: "on" (every screen), "off" (none), or
 * "auto" (the default: per skill).
 */
const KEY = 'apprentice.handPosition';

export type HandPositionMode = 'auto' | 'on' | 'off';

let wanted = false;

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

/** For the screen of one skill: `on` is the skill's own flag (catalogue `handPosition`). Off again when the screen closes. */
export function useHandPosition(on: boolean): void {
  useEffect(() => {
    wanted = on;
    return () => {
      wanted = false;
    };
  }, [on]);
}

/** Tests only. */
export function setHandPositionWanted(on: boolean): void {
  wanted = on;
}
