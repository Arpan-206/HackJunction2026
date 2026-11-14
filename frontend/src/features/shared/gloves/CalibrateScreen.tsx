import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, FINGERS, useGloveStream, type Side, type WearerCalibration } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, ButtonLink, Countdown, Stepper } from '../../../components/ui';
import { Hand, HandPreview } from '../../../three';
import { CalibrationPanel } from '../CalibrationPanel';
import { useWearer, WEARER_MAX_CHARS } from '../settings';
import { useCalibration } from '../useCalibration';
import { FixText } from './FixText';
import { GRADE_WORDS, NEUTRAL_SECONDS, nextPath, qualityLines, splitIssues, TravelTracker, VERIFY_MIN_TRAVEL_DEG } from './logic';
import { useGloveRig } from './useGloveRig';
import '../../master/master.css';
import './gloves.css';

const STEPS = [{ label: 'Connection' }, { label: 'Start pose' }, { label: 'Range' }, { label: 'Check' }];

const message = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

/** Step 1: the gloves are found and streaming, the compass has settled, and we know who wears them. */
function ConnectionStep({ onNext }: { onNext: () => void }) {
  const rig = useGloveRig(1000);
  const [wearer, setWearer] = useWearer();
  const [draft, setDraft] = useState(wearer);
  const status = rig.status;
  const connected = status?.gloves.filter((g) => g.connected) ?? [];
  const unsettled = connected.filter((g) => g.heading_reliable === false);
  const { now } = status ? splitIssues(status.issues) : { now: null };
  const name = draft.trim();
  return (
    <section className="gl-step" aria-labelledby="gl-step-1">
      <h2 id="gl-step-1" className="gl-step__title">
        Connect the gloves
      </h2>
      {!status && <p className="gl-line">Looking for the gloves...</p>}
      {status && now && (
        <div className="gl-fix">
          <p className="gl-fix__title">{now.title}</p>
          <p className="gl-fix__text">
            <FixText text={now.fix} />
          </p>
        </div>
      )}
      {status && !now && (
        <p className="gl-ready">
          {connected.length === 2 ? 'Both gloves are streaming.' : connected.length === 1 ? `Only the ${connected[0].side} glove is connected. You can calibrate it on its own.` : 'No gloves yet.'}
        </p>
      )}
      {unsettled.length > 0 && (
        <p className="gl-line">Move your hands to settle the compass: turn both wrists slowly a few times, away from metal. It settles with movement after a still moment.</p>
      )}
      <div className="gl-field">
        <label className="gl-label" htmlFor="gl-wearer">
          Who is wearing the gloves?
        </label>
        <span className="note" id="gl-wearer-hint">
          The calibration is saved under this name, so demo mode can reuse it.
        </span>
        <input id="gl-wearer" className="field__control" value={draft} maxLength={WEARER_MAX_CHARS} aria-describedby="gl-wearer-hint" autoComplete="off" onChange={(e) => setDraft(e.target.value)} />
      </div>
      <div className="gl-actions">
        <Button
          large
          disabled={!name || !status || !!now || !connected.length}
          onClick={() => {
            setWearer(name);
            onNext();
          }}
        >
          Next: the start pose
        </Button>
        <Button variant="secondary" large onClick={rig.refresh}>
          Check again
        </Button>
      </div>
    </section>
  );
}

/** Step 2: hands flat on the table, thumbs together, still for 3 s; the backend stores offsets and the yaw zero. */
function NeutralStep({ onDone, saved }: { onDone: (c: WearerCalibration) => void; saved: WearerCalibration | null }) {
  const [wearer] = useWearer();
  const [reinit, setReinit] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'holding'>('idle');
  const [error, setError] = useState<string | null>(null);
  const capture = async () => {
    setPhase('holding');
    try {
      onDone(await api.captureNeutral({ wearer, duration_s: NEUTRAL_SECONDS, reinit }));
    } catch (e) {
      setError(message(e));
    } finally {
      setPhase('idle');
    }
  };
  return (
    <section className="gl-step" aria-labelledby="gl-step-2">
      <h2 id="gl-step-2" className="gl-step__title">
        Hold the start pose
      </h2>
      <p className="gl-line">Lay both hands flat on the table, palms down, thumbs together. Hold still for {NEUTRAL_SECONDS} seconds, the same start pose every lesson begins with.</p>
      <label className="gl-check">
        <input type="checkbox" checked={reinit} onChange={(e) => setReinit(e.target.checked)} />
        Reset the glove sensors first. Use this when a glove drifts; it adds a few seconds.
      </label>
      {error && (
        <p className="gl-fix gl-fix--plain" role="alert">
          {error}
        </p>
      )}
      {saved && <Quality cal={saved} />}
      <div className="gl-actions">
        <Button large variant={saved ? 'secondary' : 'primary'} onClick={() => setPhase('countdown')} disabled={phase !== 'idle'}>
          {saved ? 'Capture again' : 'Capture the start pose'}
        </Button>
      </div>
      {phase === 'countdown' && <Countdown caption="Hands flat, palms down, thumbs together" onDone={() => void capture()} />}
      {phase === 'holding' && (
        <div className="mst-capture" role="status" aria-live="polite">
          <p className="mst-capture__step">Start pose</p>
          <p className="mst-capture__text">Hold still</p>
          <div className="mst-progress" role="progressbar" aria-label="Capturing the start pose" aria-valuemin={0} aria-valuemax={100}>
            <div className="mst-progress__bar" style={{ animationDuration: `${NEUTRAL_SECONDS + (reinit ? 2 : 0)}s` }} />
          </div>
        </div>
      )}
    </section>
  );
}

function Quality({ cal }: { cal: WearerCalibration }) {
  const q = cal.quality;
  return (
    <div className={`gl-quality gl-quality--${q.grade}`}>
      <p className="gl-quality__grade">{GRADE_WORDS[q.grade]}</p>
      <dl className="gl-facts">
        {qualityLines(q).map((l) => (
          <div key={l.label}>
            <dt>{l.label}</dt>
            <dd>{l.value}</dd>
          </div>
        ))}
        <div>
          <dt>Hands</dt>
          <dd>{cal.neutral.map((n) => (n.side === 'left' ? 'left' : 'right')).join(' and ')}</dd>
        </div>
      </dl>
      {q.notes.map((n) => (
        <p key={n} className="gl-correction">
          {n}
        </p>
      ))}
    </div>
  );
}

/** Step 3: the flat and fist range per hand, with the existing calibration (POST /calibrations). */
function RangeStep({ sides, onDone }: { sides: Side[]; onDone: (ids: Partial<Record<Side, string>>) => void }) {
  const left = useCalibration('left');
  const right = useCalibration('right');
  const cals = { left, right };
  const done = sides.every((s) => cals[s].latest);
  return (
    <section className="gl-step" aria-labelledby="gl-step-3">
      <h2 id="gl-step-3" className="gl-step__title">
        Range: flat, then a fist
      </h2>
      <p className="gl-line">For each hand: hold it flat and open, then curl a loose fist when asked. This sets how far each finger bends.</p>
      <div className="gl-pair">
        {sides.map((s) => (
          <CalibrationPanel key={s} side={s} onSide={() => undefined} cal={cals[s]} hideSide compact title={s === 'left' ? 'Left hand' : 'Right hand'} />
        ))}
      </div>
      <div className="gl-actions">
        <Button large disabled={!done} onClick={() => onDone(Object.fromEntries(sides.map((s) => [s, cals[s].latest!.id])))}>
          Next: check the hands follow
        </Button>
      </div>
    </section>
  );
}

/** Step 4: open and close the hands; every finger must travel far enough on screen. */
function VerifyStep({ sides, onDone }: { sides: Side[]; onDone: (verified: boolean) => void }) {
  const gloves = useGloveStream(true);
  const tracker = useMemo(() => new TravelTracker(VERIFY_MIN_TRAVEL_DEG), []);
  const [, setTick] = useState(0);
  const last = useRef(0);
  useEffect(
    () =>
      gloves.onFrame((f) => {
        for (const h of f.hands) tracker.push(h);
        const t = performance.now();
        if (t - last.current > 200) {
          last.current = t;
          setTick((n) => n + 1);
        }
      }),
    [gloves, tracker],
  );
  const done = tracker.done(sides);
  return (
    <section className="gl-step" aria-labelledby="gl-step-4">
      <h2 id="gl-step-4" className="gl-step__title">
        Check the hands follow
      </h2>
      <p className="gl-line">Open and close {sides.length === 2 ? 'both hands' : `your ${sides[0]} hand`} fully, two or three times, and watch the hand on screen move with you.</p>
      <div className="gl-pair">
        {sides.map((s) => {
          const followed = tracker.followed(s);
          return (
            <div key={s} className="gl-glove">
              <h3 className="gl-glove__title">{s === 'left' ? 'Left hand' : 'Right hand'}</h3>
              <HandPreview className="gl-glove__view" label={`${s} hand, moving with yours`}>
                <Hand side={s} style="wood" live={gloves.latest} />
              </HandPreview>
              <ul className="gl-fingers" aria-label={`${s} hand fingers`}>
                {FINGERS.map((f) => (
                  <li key={f} className={followed.includes(f) ? 'gl-finger gl-finger--ok' : 'gl-finger'}>
                    {f[0].toUpperCase() + f.slice(1)}: {followed.includes(f) ? 'follows' : `${Math.round(tracker.travel(s, f))} of ${VERIFY_MIN_TRAVEL_DEG} degrees`}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="gl-actions">
        <Button large disabled={!done} onClick={() => onDone(true)}>
          {done ? 'Save the calibration' : 'Keep opening and closing'}
        </Button>
        <Button variant="ghost" large onClick={() => onDone(false)}>
          Save without the check
        </Button>
      </div>
    </section>
  );
}

/**
 * Calibrate gloves (/gloves/calibrate): connection check, the start pose (neutral offsets and heading zero), the range
 * (flat and fist through the existing calibration), then a check that the hands follow. Saved per wearer.
 */
export default function CalibrateScreen() {
  const [params] = useSearchParams();
  const next = nextPath(params);
  const [wearer] = useWearer();
  const [step, setStep] = useState(0);
  const [cal, setCal] = useState<WearerCalibration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<WearerCalibration | null>(null);
  const sides: Side[] = cal?.neutral.map((n) => n.side) ?? ['left', 'right'];

  const finish = async (body: Parameters<typeof api.finishWearerCalibration>[1], then: number) => {
    if (!cal) return;
    setError(null);
    try {
      const c = await api.finishWearerCalibration(cal.id, body);
      setCal(c);
      if (then > 3) setSaved(c);
      else setStep(then);
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <div className="gl-page">
      <PageHeader title="Calibrate gloves" context={wearer ? `For ${wearer}. Four short steps; the start pose matches the one every lesson begins with.` : 'Four short steps; the start pose matches the one every lesson begins with.'} />
      <Stepper steps={STEPS} current={saved ? STEPS.length : step} label="Calibration steps" />
      {error && (
        <p className="gl-fix gl-fix--plain" role="alert">
          {error}
        </p>
      )}
      {saved ? (
        <section className="gl-step" aria-labelledby="gl-saved">
          <h2 id="gl-saved" className="gl-step__title">
            Saved for {saved.wearer}
          </h2>
          <Quality cal={saved} />
          <p className="gl-line">{saved.verified ? 'The hands followed through the full range.' : 'Saved without the follow check.'} Demo mode will reuse this calibration and only check for drift.</p>
          <div className="gl-actions">
            <ButtonLink large to={next}>
              Continue
            </ButtonLink>
            <ButtonLink variant="secondary" large to={`/gloves?next=${encodeURIComponent(next)}`}>
              Back to the gloves
            </ButtonLink>
          </div>
        </section>
      ) : step === 0 ? (
        <ConnectionStep onNext={() => setStep(1)} />
      ) : step === 1 ? (
        <>
          <NeutralStep saved={cal} onDone={setCal} />
          {cal && (
            <div className="gl-actions">
              <Button large onClick={() => setStep(2)}>
                Next: the range
              </Button>
            </div>
          )}
        </>
      ) : step === 2 ? (
        <RangeStep sides={sides} onDone={(ids) => void finish({ range_calibration_ids: ids }, 3)} />
      ) : (
        <VerifyStep sides={sides} onDone={(verified) => void finish({ verified }, 4)} />
      )}
    </div>
  );
}
