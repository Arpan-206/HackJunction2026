import { THEMES, THEME_IDS, useTheme, type ThemeId } from '../theme';

/** Compact native theme select (bottega, notte, affresco), for tool pages such as the playground. */
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

/**
 * A quiet theme switch in running text: "Theme  Bottega  Notte  Affresco", the current one underlined. Each name is a real
 * button with aria-pressed, so it reads as a choice to screen readers without looking like a form control.
 */
export function ThemeSwitch({ className = 'theme-switch' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <span className={className} role="group" aria-label="Theme">
      <span className="theme-switch__label" aria-hidden="true">
        Theme
      </span>
      {THEME_IDS.map((id: ThemeId) => (
        <button key={id} type="button" className="theme-switch__opt" aria-pressed={theme === id} onClick={() => setTheme(id)}>
          {THEMES[id].label}
        </button>
      ))}
    </span>
  );
}
