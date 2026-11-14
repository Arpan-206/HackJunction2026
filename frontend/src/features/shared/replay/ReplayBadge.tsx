import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { replayWatch } from './replayWatch';
import './replay.css';

/**
 * The REPLAY corner mark. Mounted once beside the routes in main.tsx, outside the shell, the kiosk switch and the dev
 * panel, so every screen gets it (the /demo kiosk included) and nothing can hide it: it reads only whether the core
 * is playing a recording (replayWatch). No prop, setting or flag turns it off.
 */
export function ReplayBadge() {
  const replay = useSyncExternalStore(replayWatch.subscribe, replayWatch.getSnapshot, () => false);
  const { pathname } = useLocation();
  useEffect(() => {
    replayWatch.reconsider();
  }, [pathname]);
  if (!replay) return null;
  return (
    <div className="replay-mark" role="status" aria-live="polite" data-testid="replay-badge">
      <span className="replay-mark__word">Replay</span>
      <span className="replay-mark__note">Recorded gloves, not live hands</span>
    </div>
  );
}
