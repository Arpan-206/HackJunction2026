import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGloveStream, type GloveDeviceStatus, type GloveIssue, type GloveRigStatus } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, ButtonLink } from '../../../components/ui';
import { Hand, HandCanvas, type StageProps } from '../../../three';
import { useNoGloves } from '../noGloves';
import { useDemoMode } from '../settings';
import { CalibrationInUse } from './CalibrationInUse';
import { DemoCheck } from './DemoCheck';
import { FixText } from './FixText';
import { canStartGloves, gloveFacts, nextPath, splitIssues } from './logic';
import { useGloveRig } from './useGloveRig';
import './gloves.css';

function SensorList({ g }: { g: GloveDeviceStatus }) {
  // The compass (magnetometer) settles on its own once the hand moves, so it is never listed as a fault.
  const bad = g.sensors.map((s) => ({ ...s, saturated: s.saturated.filter((x) => x !== 'magnetometer') })).filter((s) => s.saturated.length);
  if (!g.connected) return null;
  if (!bad.length) return <p className="gl-line">All seven sensors read normally.</p>;
  return (
    <ul className="gl-sensors" aria-label={`Saturated sensors on the ${g.side} glove`}>
      {bad.map((s) => (
        <li key={s.name} className="gl-sensor gl-sensor--bad">
          {s.name === 'hub' ? 'Back of the hand' : s.name === 'arm' ? 'Forearm' : `${s.name[0].toUpperCase()}${s.name.slice(1)}`}: {s.saturated.join(', ')} saturated
        </li>
      ))}
    </ul>
  );
}

/** A live hand sits in a canvas of its own inside its box (so it scrolls with the page): plain stage, drag to turn it round. */
const LIVE_STAGE: StageProps = { decor: false, showGrid: false, controls: 'orbit', target: [0, 0, 0] };

function GloveColumn({ g, live }: { g: GloveDeviceStatus; live: ReturnType<typeof useGloveStream>['latest'] }) {
  const facts = gloveFacts(g);
  const name = g.side === 'left' ? 'Left glove' : 'Right glove';
  return (
    <section className={`gl-glove ${g.connected ? '' : 'gl-glove--off'}`} aria-labelledby={`gl-${g.side}`}>
      <h2 id={`gl-${g.side}`} className="gl-glove__title">
        {name}
      </h2>
      <div className="gl-glove__view">
        <HandCanvas preset="closeup" stage={LIVE_STAGE} label={g.connected ? `${name}, moving with your hand` : `${name}, not connected`}>
          {g.connected ? <Hand side={g.side} style="wood" live={live} /> : <Hand side={g.side} style="ghost" motion={{ preset: 'idle' }} />}
        </HandCanvas>
      </div>
      <dl className="gl-facts">
        <div>
          <dt>Link</dt>
          <dd>{facts.connection}</dd>
        </div>
        {g.connected && (
          <>
            <div>
              <dt>Rate</dt>
              <dd>{g.streaming === false ? 'Not streaming yet' : facts.rate}</dd>
            </div>
            <div>
              <dt>Frames</dt>
              <dd>{facts.age}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Battery</dt>
          <dd>{facts.battery.replace(/^Battery:? /, '')}</dd>
        </div>
      </dl>
      <SensorList g={g} />
    </section>
  );
}

function FixFirst({ issue }: { issue: GloveIssue }) {
  return (
    <section className="gl-fix" aria-labelledby="gl-fix-title" role="alert">
      <h2 id="gl-fix-title" className="gl-fix__title">
        {issue.title}
      </h2>
      <p className="gl-fix__text">
        <FixText text={issue.fix} />
      </p>
    </section>
  );
}

function Notes({ issues }: { issues: GloveIssue[] }) {
  if (!issues.length) return null;
  return (
    <section className="gl-notes" aria-labelledby="gl-notes-title">
      <h2 id="gl-notes-title" className="gl-notes__title">
        {issues.some((i) => i.blocking) ? 'Then' : 'To check'}
      </h2>
      <ol className="gl-notes__list">
        {issues.map((i) => (
          <li key={`${i.code}-${i.side ?? 'both'}`}>
            <strong>{i.title}.</strong> <FixText text={i.fix} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Summary({ status }: { status: GloveRigStatus }) {
  const on = status.gloves.filter((g) => g.connected).length;
  if (status.ready) return <p className="gl-ready">{on === 2 ? 'Both gloves are ready.' : `The ${status.gloves.find((g) => g.connected)?.side} glove is ready.`}</p>;
  return null;
}

/**
 * The gloves screen (/gloves): each glove's link, frame rate, last frame, battery and sensors next to a live hand, the
 * one thing to fix first, and the buttons to start the gloves, calibrate them or go on. In demo mode it also runs the
 * short drift check against the wearer's saved calibration.
 */
export default function GlovesScreen() {
  const rig = useGloveRig(1000);
  const gloves = useGloveStream(true);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [demo] = useDemoMode();
  const [noGloves] = useNoGloves();
  const next = nextPath(params);
  const status = rig.status;
  const { now, rest } = status ? splitIssues(status.issues) : { now: null, rest: [] };
  const [title, setTitle] = useState('Gloves');

  useEffect(() => {
    setTitle(status?.ready ? 'Gloves ready' : 'Gloves');
  }, [status?.ready]);

  // With "No gloves" on, the glove readings would describe the simulator as connected gloves: say what is true instead.
  if (noGloves) {
    return (
      <div className="gl-page">
        <PageHeader title="Simulated hands" context="No gloves is on, so every screen runs without the gloves." />
        <p className="gl-line">
          The hands you see are simulated. Once the gloves are here, press &ldquo;We have gloves now&rdquo; on the Geppetto home page, or switch off No gloves in Settings.
        </p>
        <div className="gl-actions">
          <ButtonLink large to={next}>
            Continue
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="gl-page">
      <PageHeader title={title} context="Check the gloves before you record or train. This page updates every second." />

      {rig.error && (
        <p className="gl-fix gl-fix--plain" role="alert">
          The app could not read the glove status: {rig.error}
        </p>
      )}
      {!status && !rig.error && <p className="gl-line">Looking for the gloves...</p>}

      {status && (
        <>
          {now ? <FixFirst issue={now} /> : <Summary status={status} />}
          <CalibrationInUse calibrateHref={`/gloves/calibrate?next=${encodeURIComponent(next)}`} />
          {demo && <DemoCheck ready={status.ready} onPass={() => navigate(next, { replace: true })} />}

          <div className="gl-pair">
            {status.gloves.map((g) => (
              <GloveColumn key={g.side} g={g} live={gloves.latest} />
            ))}
          </div>

          <Notes issues={rest} />

          <div className="gl-actions">
            {canStartGloves(status) && (
              <Button large onClick={() => void rig.start()} disabled={rig.starting}>
                {rig.starting ? 'Starting the gloves...' : 'Start the gloves'}
              </Button>
            )}
            <Button variant="secondary" large onClick={rig.refresh}>
              Check again
            </Button>
            <ButtonLink variant="secondary" large to={`/gloves/calibrate?next=${encodeURIComponent(next)}`}>
              Calibrate gloves
            </ButtonLink>
            <ButtonLink variant={status.ready ? 'primary' : 'ghost'} large to={next}>
              {status.ready ? 'Continue' : 'Continue without the gloves'}
            </ButtonLink>
          </div>
        </>
      )}
    </div>
  );
}
