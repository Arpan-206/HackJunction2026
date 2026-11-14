/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_PANEL?: string;
  /** `1` turns the in-browser mock backend on (see src/mock). */
  readonly VITE_MOCK?: string;
  /** `1` builds a kiosk: only /demo is reachable (see features/shared/kiosk.ts). */
  readonly VITE_KIOSK?: string;
}
