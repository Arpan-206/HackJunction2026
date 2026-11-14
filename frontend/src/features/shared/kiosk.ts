import { readFlag } from '../apprentice/pipeline/flags';

/** The one screen a kiosk shows. */
export const KIOSK_HOME = '/demo';

/**
 * Kiosk mode for the demo table: only /demo is reachable, so a visitor never lands on the rail, Settings, the expert
 * screens or the dev panel. `?kiosk=1` turns it on for the tab (sessionStorage) and `?kiosk=0` turns it off again;
 * a build with VITE_KIOSK=1 is always a kiosk.
 */
export function isKiosk(): boolean {
  if (import.meta.env.VITE_KIOSK === '1') return true;
  return readFlag('kiosk');
}
