import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type DriftCheckResult, type WearerCalibration } from '../../../api';
import { Button, ButtonLink, Countdown } from '../../../components/ui';
import { formatWhen } from '../../master/lib';
import { useWearer, WEARER_MAX_CHARS } from '../settings';
import { DRIFT_SECONDS, demoDecision } from './logic';

type Phase = 'idle' | 'countdown' | 'holding' | 'done' | 'error';

interface DemoCheckProps {
  /** The gloves are streaming with nothing blocking. */
  ready: boolean;
  /** Called once the drift check passes: go straight in. */
  onPass: () => void;
}

/**
 * Demo mode on the gloves screen: no full calibration. It loads the wearer's last saved calibration, asks them to hold
 * still for two seconds and compares. Within the limits it goes straight in; past them it asks for a recalibration.
 */
export function DemoCheck({ ready, onPass }: DemoCheckProps) {
  const [wearer, setWearer] = useWearer();
  const [draft, setDraft] = useState(wearer);
  const [saved, setSaved] = useState<WearerCalibration | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<DriftCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    if (!wearer) {
      setSaved(null);
      return;
    }
    const ctl = new AbortController();
    setSaved(undefined);
    api
      .latestWearerCalibration(wearer, ctl.signal)
      .then(setSaved)
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setSaved(null);
        if (!(e instanceof ApiError && e.status === 404)) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctl.abort();
  }, [wearer]);

  const decision = demoDecision({ wearer, saved, ready, phase, result });

  const begin = useCallback(() => {
    setError(null);
    setResult(null);
    setPhase('countdown');
  }, []);

  // Demo mode runs the check by itself the first time everything is in place.
  useEffect(() => {
    if (decision === 'run' && !autoRan.current) {
      autoRan.current = true;
      begin();
    }
  }, [decision, begin]);

  const hold = useCallback(async () => {
    setPhase('holding');
    try {
      const r = await api.driftCheck({ wearer, duration_s: DRIFT_SECONDS });
      setResult(r);
      setPhase('done');
      if (r.ok) onPass();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [wearer, onPass]);

  return (
    <section className="gl-demo" aria-labelledby="gl-demo-title">
      <h2 id="gl-demo-title" className="gl-demo__title">
        Demo mode
      </h2>
      {!wearer || decision === 'name' ? (
        <form
          className="gl-demo__name"
          onSubmit={(e) => {
            e.preventDefault();
            setWearer(draft);
          }}
        >
          <label className="gl-label" htmlFor="gl-demo-wearer">
            Who is wearing the gloves?
          </label>
          <div className="gl-inline">
            <input id="gl-demo-wearer" className="field__control" value={draft} maxLength={WEARER_MAX_CHARS} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
            <Button type="submit" disabled={!draft.trim()}>
              Use this name
            </Button>
          </div>
        </form>
      ) : (
        <p className="gl-line">
          Wearer: <strong>{wearer}</strong>{' '}
          <Button variant="ghost" onClick={() => setWearer('')}>
            Change
          </Button>
        </p>
      )}

      {decision === 'loading' && <p className="gl-line">Loading the saved calibration...</p>}
      {decision === 'calibrate' && (
        <p className="gl-line">
          No saved calibration for {wearer} yet. Calibrate once, then demo mode only checks for drift.{' '}
          <ButtonLink variant="secondary" to="/gloves/calibrate">
            Calibrate gloves
          </ButtonLink>
        </p>
      )}
      {decision === 'wait' && <p className="gl-line">The drift check starts once the gloves are ready.</p>}
      {saved && decision !== 'calibrate' && <p className="gl-line">Using the calibration from {formatWhen(saved.created_at)}.</p>}

      {phase === 'countdown' && <Countdown caption="Rest your hands on the table and hold still" onDone={() => void hold()} />}
      {phase === 'holding' && (
        <div className="mst-capture" role="status" aria-live="polite">
          <p className="mst-capture__step">Demo mode drift check</p>
          <p className="mst-capture__text">Hold still</p>
          <div className="mst-progress" role="progressbar" aria-label="Checking for drift" aria-valuemin={0} aria-valuemax={100}>
            <div className="mst-progress__bar" style={{ animationDuration: `${DRIFT_SECONDS}s` }} />
          </div>
        </div>
      )}
      {phase === 'done' && result && (
        <div className={result.ok ? 'gl-result gl-result--ok' : 'gl-result gl-result--drift'} role="status">
          <p className="gl-result__text">{result.message}</p>
          <ul className="gl-result__hands">
            {result.hands.map((h) => (
              <li key={h.side}>
                {h.side === 'left' ? 'Left' : 'Right'} hand: fingers {Math.round(h.flex_drift_deg)} degrees off (limit {result.max_flex_deg}), heading {Math.round(h.yaw_drift_deg)} degrees off (limit {result.max_yaw_deg})
              </li>
            ))}
          </ul>
          {!result.ok && (
            <div className="gl-inline">
              <ButtonLink to="/gloves/calibrate">Recalibrate</ButtonLink>
              <Button variant="secondary" onClick={begin}>
                Check again
              </Button>
            </div>
          )}
        </div>
      )}
      {(phase === 'error' || error) && (
        <p className="gl-fix gl-fix--plain" role="alert">
          {error}{' '}
          <Button variant="secondary" onClick={begin}>
            Try again
          </Button>
        </p>
      )}
      {decision === 'run' && phase === 'idle' && (
        <Button large onClick={begin}>
          Hold still and check
        </Button>
      )}
    </section>
  );
}
