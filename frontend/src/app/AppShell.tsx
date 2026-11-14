import { NavLink, Outlet } from "react-router-dom";
import { useAssistant } from "../features/shared/assistant";
import { SettingsButton } from "../features/shared/SettingsDialog";
import { GloveStatusLine } from "../features/shared/gloves/GloveStatusLine";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconHome() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...stroke}
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17M3.5 12h17" />
    </svg>
  );
}
function IconMaster() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...stroke}
    >
      <path d="M12 3 4 20M12 3l8 17M7 14h10" />
      <circle cx="12" cy="3" r="1.2" />
    </svg>
  );
}
function IconApprentice() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...stroke}
    >
      <path d="M5 20c0-4 3-6 7-6s7 2 7 6M12 4v10" />
      <path d="M8 8l4-4 4 4" />
    </svg>
  );
}

function IconRobot() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...stroke}
    >
      <path d="M6 20V9h12v11M6 13h12M9 9V5M15 9V5M9 20v-3M12 20v-3M15 20v-3" />
      <circle cx="9" cy="4" r="1.2" />
      <circle cx="15" cy="4" r="1.2" />
    </svg>
  );
}

const links = [
  { to: "/", label: "Home", icon: <IconHome />, end: true },
  { to: "/expert", label: "Expert", icon: <IconMaster />, end: false },
  {
    to: "/apprentice",
    label: "Apprentice",
    icon: <IconApprentice />,
    end: false,
  },
  { to: "/robot", label: "Robot", icon: <IconRobot />, end: false },
];

/** Lapis rail navigation with Settings, the AI Assistant state and glove status, wrapping every routed screen except the role select. */
export function AppShell() {
  const [assistant] = useAssistant();
  // Mock mode switches itself on when /api/health does not answer; say so, so fake data is never mistaken for a live session.
  const mock = typeof window !== "undefined" && window.__apprenticeMock === true;
  return (
    <div className="shell">
      <div className="rail-col">
        <nav className="rail" aria-label="Main">
          <NavLink to="/" className="rail__brand" aria-label="Apprentice home">
            <svg
              width="40"
              height="40"
              viewBox="0 0 32 32"
              aria-hidden="true"
              fill="none"
              strokeWidth="1.5"
            >
              <circle cx="16" cy="16" r="11" />
              <path
                d="M16 5v22M5 16h22"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
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
            {mock && <span className="rail__mock">Sample data, offline</span>}
            <SettingsButton className="rail__link rail__settings" />
            <span className="rail__state">
              AI Assistant {assistant ? "on" : "off"}
            </span>
            <GloveStatusLine mock={mock} />
          </div>
        </nav>
      </div>
      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
