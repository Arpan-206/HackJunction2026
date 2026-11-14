import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_THEME, THEME_IDS, THEME_STORAGE_KEY, THEMES, type StageColors, type ThemeDef, type ThemeId } from './themes';

interface ThemeContextValue {
  theme: ThemeId;
  def: ThemeDef;
  stage: StageColors;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v && (THEME_IDS as string[]).includes(v)) return v as ThemeId;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_THEME;
}

/** Applies the active theme to the html element (data-theme), persists it, and exposes the 3D stage colours. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readStored);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, def: THEMES[theme], stage: THEMES[theme].stage, setTheme }),
    [theme, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Access the current theme, its 3D stage colours and the setter. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
