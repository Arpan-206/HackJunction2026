import { NavLink, Outlet } from "react-router-dom";
import { useAssistant } from "../features/shared/assistant";
import { SettingsButton } from "../features/shared/SettingsDialog";
import { GloveStatusLine } from "../features/shared/gloves/GloveStatusLine";
import { BrandMark, IconApprentice, IconExpert, IconHome, IconRobot } from "../features/shared/RailIcons";

const links = [
  { to: "/", label: "Home", icon: <IconHome />, end: true },
  { to: "/expert", label: "Expert", icon: <IconExpert />, end: false },
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
          <NavLink to="/" className="rail__brand" aria-label="Geppetto home">
            <BrandMark />
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
