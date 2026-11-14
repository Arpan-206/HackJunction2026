import { useEffect, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useGloveStream } from '../../../api';
import { demoModePref } from '../settings';
import { gloveLine, shouldOpenGlovesOnStart } from './logic';
import { useGloveRig } from './useGloveRig';
import './gloves.css';

const CHECKED_KEY = 'apprentice.glovesChecked';

function checkedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(CHECKED_KEY) === '1';
  } catch {
    return true;
  }
}

function markChecked(): void {
  try {
    window.sessionStorage.setItem(CHECKED_KEY, '1');
  } catch {
    /* storage blocked: the check simply runs again */
  }
}

/**
 * The rail's glove line: one short state with a dot, as a link to the gloves screen. On the first screen of a session it
 * also decides whether to open the gloves screen first (real gloves, or demo mode); mock mode and the simulator never do.
 */
export function GloveStatusLine({ mock }: { mock: boolean }) {
  const { status: stream } = useGloveStream(true);
  const rig = useGloveRig(5000);
  const line = gloveLine(rig.status, mock, stream);
  const navigate = useNavigate();
  const location = useLocation();
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current || checkedThisSession()) return;
    if (!rig.status && !rig.error) return;
    decided.current = true;
    markChecked();
    if (location.pathname.startsWith('/gloves')) return;
    if (shouldOpenGlovesOnStart(rig.status, demoModePref.get(), mock)) navigate(`/gloves?next=${encodeURIComponent(location.pathname + location.search)}`);
  }, [rig.status, rig.error, mock, navigate, location]);

  return (
    <span role="status">
      <NavLink to={`/gloves?next=${encodeURIComponent(location.pathname)}`} className="rail__gloves">
        <span className={`glove-dot glove-dot--${line.tone}`} aria-hidden="true" />
        {line.text}
      </NavLink>
    </span>
  );
}
