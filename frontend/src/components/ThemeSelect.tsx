import { THEMES, THEME_IDS, useTheme, type ThemeId } from '../theme';

/** Compact theme switcher (bottega, notte, affresco). */
export function ThemeSelect({ className = 'theme-select' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <select className={className} aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)}>
      {THEME_IDS.map((id) => (
        <option key={id} value={id}>
          {THEMES[id].label}
        </option>
      ))}
    </select>
  );
}
