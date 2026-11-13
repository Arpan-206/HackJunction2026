import { NavLink, Outlet } from 'react-router-dom';
import { useGloveStream } from '../api';
import { ThemeSelect } from '../components/ThemeSelect';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function IconHome() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17M3.5 12h17" />
    </svg>
  );
}
function IconMaster() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M12 3 4 20M12 3l8 17M7 14h10" />
      <circle cx="12" cy="3" r="1.2" />
    </svg>
  );
}
function IconApprentice() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M5 20c0-4 3-6 7-6s7 2 7 6M12 4v10" />
      <path d="M8 8l4-4 4 4" />
    </svg>
  );
}

const links = [
  { to: '/', label: 'Home', icon: <IconHome />, end: true },
  { to: '/master', label: 'Master', icon: <IconMaster />, end: false },
  { to: '/apprentice', label: 'Apprentice', icon: <IconApprentice />, end: false },
];

/** Lapis rail navigation with glove status and theme switch, wrapping every routed screen except the role select. */
export function AppShell() {
  const { status } = useGloveStream(true);
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <NavLink to="/" className="rail__brand" aria-label="Apprentice home">
          <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="var(--gold)" strokeWidth="1.5">
            <circle cx="16" cy="16" r="11" />
            <path d="M16 5v22M5 16h22" stroke="currentColor" strokeWidth="1" />
          </svg>
          Apprentice
        </NavLink>
        <div className="rail__nav">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="rail__link">
              {l.icon}
              {l.label}
            </NavLink>
          ))}
        </div>
        <div className="rail__foot">
          <span role="status">
            <span className={`glove-dot glove-dot--${status}`} aria-hidden="true" />
            Gloves {status === 'open' ? 'live' : status === 'connecting' ? 'linking' : 'off'}
          </span>
          <ThemeSelect />
        </div>
      </nav>
      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
