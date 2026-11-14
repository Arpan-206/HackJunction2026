/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_PANEL?: string;
  /** `1` turns the in-browser mock backend on (see src/mock). */
  readonly VITE_MOCK?: string;
}
