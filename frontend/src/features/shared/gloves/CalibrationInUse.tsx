import { useEffect, useState } from 'react';
import { api, type ActiveCalibration } from '../../../api';
import { ButtonLink } from '../../../components/ui';

/** "14 Nov, 15:20" in the viewer's time zone. */
export function calibrationWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${time}`;
}

/** The sentence for the saved calibrations: which hands, and when the newest was made; null when none is saved. */
export function calibrationLine(active: ActiveCalibration): string | null {
  const sides = (['left', 'right'] as const).filter((s) => active[s]);
  const times = [...sides.map((s) => active[s]!.created_at), ...(active.wearer ? [active.wearer.created_at] : [])];
  if (!times.length) return null;
  const newest = times.reduce((a, b) => (b > a ? b : a));
  const hands = sides.length === 2 ? 'both hands' : sides.length === 1 ? `the ${sides[0]} hand` : null;
  return `Using your calibration from ${calibrationWhen(newest)}${hands ? `, for ${hands}` : ''}. It is saved, so it carries over after a restart.`;
}

/**
 * On the gloves screen: the saved calibration in use (GET /api/calibrations/active), so the expert knows there is no
 * need to calibrate again each session, with "Calibrate again" beside it.
 */
export function CalibrationInUse({ calibrateHref }: { calibrateHref: string }) {
  const [active, setActive] = useState<ActiveCalibration | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    api
      .activeCalibration(ctl.signal)
      .then(setActive)
      .catch(() => !ctl.signal.aborted && setFailed(true));
    return () => ctl.abort();
  }, []);

  if (failed || !active) return null;
  const line = calibrationLine(active);
  return (
    <div className="gl-calnow">
      <p className="gl-line">{line ?? 'No calibration saved yet. Calibrate once: it is saved and used every session after.'}</p>
      <ButtonLink variant="secondary" to={calibrateHref}>
        {line ? 'Calibrate again' : 'Calibrate gloves'}
      </ButtonLink>
    </div>
  );
}
