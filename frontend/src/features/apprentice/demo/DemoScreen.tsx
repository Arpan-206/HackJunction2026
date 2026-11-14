import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGloveStream, useLessons, type HandFrame, type Lesson, type Side } from '../../../api';
import { useCoreSession, type CoreScore, type CoreSessionHandle } from '../../../api/useCoreSession';
import { useRobotStream } from '../../../api/useRobotStream';
import { Button } from '../../../components/ui';
import { Hand, HandPreview } from '../../../three';
import { PreviewHost } from '../../../three/Preview';
import { RobotTwin } from '../../shared/robot/RobotTwin';
import { trackFromMotion } from '../training/coach/reference';
import { GUEST_POSES, GUEST_TOTAL_S, guestName, handFromKeyAngles, hintLine, localScore, MATCH_AT, shownScore, sidesFrom } from './demoLogic';
import { useGuestCalibration } from './useGuestCalibration';
import { readFlag } from '../pipeline/flags';
import '../../shared/robot/robot.css';
import './demo.css';

type Stage = 'welcome' | 'calibrate' | 'pick' | 'live';

/** A lesson the visitor chose: one of the core's (scored live by the core) or a seeded one (scored here, offline). */
type Chosen = { kind: 'core'; id: string; title: string } | { kind: 'local'; lesson: Lesson };

const SCORE_HZ = 6;
/** In offline mode a step counts as passed after this long at or above MATCH_AT. */
const LOCAL_HOLD_MS = 1000;

/**
 * /demo: the visitor flow for the demo table. Guest calibration (about 20 s), pick a lesson, the live score beside the
 * robot twin, then one click for the next visitor. With `kiosk` (?kiosk=1 or VITE_KIOSK=1) this is the only screen.
 */
export default function DemoScreen({ kiosk = false }: { kiosk?: boolean }) {
  const [stage, setStage] = useState<Stage>('welcome');
  const [wearer, setWearer] = useState(() => guestName(new Date()));
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [visitor, setVisitor] = useState(1);
  // ?nocore=1 keeps the screen off the glove engine (the offline walk, or a table with no engine): browser score only.
  const [noCore] = useState(() => readFlag('nocore'));
  const core = useCoreSession(!noCore);
  const robot = useRobotStream(true);
  const gloves = useGloveStream(true);
  const cal = useGuestCalibration();
  const coreUp = core.status === 'open';

  useEffect(() => {
    if (stage === 'calibrate' && cal.phase === 'done') setStage('pick');
  }, [stage, cal.phase]);

  const begin = () => {
    setStage('calibrate');
    void cal.start({
      wearer,
      sides: sidesFrom(gloves.latest.current?.hands),
      coreCalibrate: coreUp ? () => core.command('calibrate') : undefined,
    });
  };

  const nextVisitor = useCallback(() => {
    // The engine goes back to rest: no lesson running, the robot still. The guest's calibration files stay on disk until
    // the next guest's newer ones replace them (the core always loads the newest).
    if (core.status === 'open') void core.command('set_mode', { mode: 'idle' }).catch(() => undefined);
    void robot.setSource('off').catch(() => undefined);
    cal.reset();
    setChosen(null);
    setWearer(guestName(new Date()));
    setVisitor((n) => n + 1);
    setStage('welcome');
  }, [core, robot, cal]);

  return (
    <PreviewHost className="demo">
      <header className="demo__head">
        <h1 className="demo__brand">Geppetto</h1>
        <ol className="demo__steps" aria-label="Your steps">
          {(['Calibrate', 'Pick a lesson', 'Play'] as const).map((label, i) => {
            const at = stage === 'welcome' || stage === 'calibrate' ? 0 : stage === 'pick' ? 1 : 2;
            return (
              <li key={label} className={i === at ? 'demo__step demo__step--now' : 'demo__step'} aria-current={i === at ? 'step' : undefined}>
                {i + 1}. {label}
              </li>
            );
          })}
        </ol>
        {(stage === 'calibrate' || stage === 'pick') && (
          <Button variant="secondary" large className="demo__next" onClick={nextVisitor}>
            Next visitor
          </Button>
        )}
      </header>
      <main className="demo__body" key={visitor}>
        {stage === 'welcome' && <Welcome onStart={begin} kiosk={kiosk} />}
        {stage === 'calibrate' && <Calibrating cal={cal} live={gloves.latest} side={sidesFrom(gloves.latest.current?.hands)[0]} />}
        {stage === 'pick' && (
          <PickLesson
            core={core}
            notes={cal.notes}
            onPick={(c) => {
              setChosen(c);
              setStage('live');
            }}
          />
        )}
        {stage === 'live' && chosen && <Live core={core} chosen={chosen} onAnother={() => setStage('pick')} onDone={nextVisitor} />}
      </main>
    </PreviewHost>
  );
}

function Welcome({ onStart, kiosk }: { onStart: () => void; kiosk: boolean }) {
  return (
    <section className="demo__panel demo__welcome" aria-labelledby="demo-welcome">
      <h2 id="demo-welcome" className="demo__title">
        Your hand drives a robot hand
      </h2>
      <p className="demo__lead">Put on the glove. First we learn your hand in 20 seconds: flat, a fist, then the thumb folded.</p>
      <Button large className="demo__go" onClick={onStart}>
        Start
      </Button>
      {!kiosk && (
        <p className="note">
          <Link to="/">Leave the demo</Link>. Add ?kiosk=1 to lock the screen to this flow.
        </p>
      )}
    </section>
  );
}

function Calibrating({ cal, live, side }: { cal: ReturnType<typeof useGuestCalibration>; live: ReturnType<typeof useGloveStream>['latest']; side: Side }) {
  const pose = GUEST_POSES[cal.pose];
  const pct = Math.min(100, Math.round((cal.elapsed / GUEST_TOTAL_S) * 100));
  return (
    <section className="demo__panel demo__cal" aria-labelledby="demo-cal">
      <div className="demo__cal-text">
        <p className="demo__count" aria-hidden="true">
          {cal.phase === 'saving' ? '' : cal.left}
        </p>
        <h2 id="demo-cal" className="demo__title" aria-live="polite">
          {cal.phase === 'saving' ? 'Saving your hand' : `${cal.pose + 1} of ${GUEST_POSES.length}: ${pose.title}`}
        </h2>
        <p className="demo__lead">{cal.phase === 'ready' ? pose.say : cal.phase === 'hold' ? 'Hold still.' : 'One moment.'}</p>
        <div className="demo__bar" role="progressbar" aria-label="Calibration" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span className="demo__bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <HandPreview className="demo__cal-hand" label="Your hand, live">
        <Hand side={side} style="wood" live={live} />
      </HandPreview>
    </section>
  );
}

function PickLesson({ core, notes, onPick }: { core: CoreSessionHandle; notes: string[]; onPick: (c: Chosen) => void }) {
  const seeded = useLessons();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fromCore = core.status === 'open' && core.lessons.length > 0;

  const pickCore = async (id: string, title: string) => {
    setBusy(id);
    setError(null);
    try {
      for (const [name, args] of [
        ['lesson_load', { lesson_id: id }],
        ['set_mode', { mode: 'learn' }],
        ['step_goto', { index: 0 }],
      ] as const) {
        const ack = await core.command(name, args);
        if (!ack.ok) throw new Error(ack.error?.message ?? `${name} was refused`);
      }
      onPick({ kind: 'core', id, title });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const lessons = fromCore
    ? core.lessons.map((l) => ({ id: l.id, title: l.title, steps: l.steps_total, pick: () => void pickCore(l.id, l.title) }))
    : (seeded.data ?? []).map((l) => ({ id: l.id, title: l.title, steps: l.steps.length, pick: () => onPick({ kind: 'local', lesson: l }) }));

  return (
    <section className="demo__panel" aria-labelledby="demo-pick">
      <h2 id="demo-pick" className="demo__title">
        Pick a lesson
      </h2>
      {error && (
        <p className="demo__correction" role="alert">
          {error}
        </p>
      )}
      {!fromCore && seeded.loading && <p className="demo__lead">Loading the lessons...</p>}
      <ul className="demo__lessons">
        {lessons.slice(0, 6).map((l) => (
          <li key={l.id}>
            <button type="button" className="demo__lesson" onClick={l.pick} disabled={busy !== null}>
              <span className="demo__lesson-title">{l.title}</span>
              <span className="demo__lesson-meta">{busy === l.id ? 'Loading...' : `${l.steps} ${l.steps === 1 ? 'step' : 'steps'}`}</span>
            </button>
          </li>
        ))}
      </ul>
      {!fromCore && <p className="note demo__op">The glove engine is not connected, so this score is worked out in the browser.</p>}
      {notes.length > 0 && (
        <details className="demo__op">
          <summary>Calibration notes for the operator ({notes.length})</summary>
          <ul>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

interface LiveView {
  score: number | null;
  hint: string | null;
  match: boolean;
  step: number;
  steps: number;
  stepName: string;
  complete: boolean;
}

function Live({ core, chosen, onAnother, onDone }: { core: CoreSessionHandle; chosen: Chosen; onAnother: () => void; onDone: () => void }) {
  const robot = useRobotStream(true);
  const gloves = useGloveStream(true);
  const side: Side = robot.hand ?? (chosen.kind === 'local' && chosen.lesson.steps[0]?.hands === 'left' ? 'left' : 'right');
  const [view, setView] = useState<LiveView>({ score: null, hint: null, match: false, step: 0, steps: 1, stepName: '', complete: false });
  const [complete, setComplete] = useState(false);
  const [localStep, setLocalStep] = useState(0);
  const t0 = useRef(performance.now());
  const goodSince = useRef<number | null>(null);
  const setSource = robot.setSource;

  useEffect(() => {
    void setSource('learner').catch(() => undefined);
  }, [setSource]);

  useEffect(() => {
    if (chosen.kind !== 'core') return;
    return core.onEvent((e) => {
      if (e.name === 'lesson_complete') setComplete(true);
    });
  }, [core, chosen.kind]);

  const localStepData = chosen.kind === 'local' ? chosen.lesson.steps[Math.min(localStep, chosen.lesson.steps.length - 1)] ?? null : null;
  const track = useMemo(() => (localStepData ? trackFromMotion(localStepData.motion, side) : null), [localStepData, side]);

  const coreStep = core.session?.step ?? 0;
  const coreLesson = chosen.kind === 'core' && core.lesson?.id === chosen.id ? core.lesson : null;
  const target: HandFrame | null = useMemo(() => (coreLesson ? handFromKeyAngles(coreLesson.steps[coreStep]?.key_angles, side) : null), [coreLesson, coreStep, side]);

  useEffect(() => {
    const tick = () => {
      let s: CoreScore | null = null;
      let step = 0;
      let steps = 1;
      let stepName = '';
      if (chosen.kind === 'core') {
        s = core.score.current;
        step = coreStep;
        steps = Math.max(1, core.session?.steps_total ?? coreLesson?.steps.length ?? 1);
        stepName = coreLesson?.steps[coreStep]?.name ?? '';
      } else {
        const hand = gloves.latest.current?.hands.find((h) => h.side === side) ?? gloves.latest.current?.hands[0] ?? null;
        const t = (performance.now() - t0.current) / 1000;
        s = hand && track ? localScore(hand, track.handAt(t)) : null;
        step = localStep;
        steps = Math.max(1, chosen.lesson.steps.length);
        stepName = localStepData?.title ?? '';
        if (s && s.overall >= MATCH_AT) {
          goodSince.current ??= performance.now();
          if (performance.now() - goodSince.current >= LOCAL_HOLD_MS) {
            goodSince.current = null;
            if (localStep + 1 >= steps) setComplete(true);
            else setLocalStep((n) => n + 1);
          }
        } else goodSince.current = null;
      }
      const score = shownScore(s?.overall);
      const next: LiveView = { score, hint: hintLine(s?.worst ?? null, s?.hint ?? null), match: (s?.overall ?? 0) >= MATCH_AT, step, steps, stepName, complete };
      setView((p) => (p.score === next.score && p.hint === next.hint && p.step === next.step && p.stepName === next.stepName && p.complete === next.complete && p.steps === next.steps ? p : next));
    };
    tick();
    const id = window.setInterval(tick, 1000 / SCORE_HZ);
    return () => window.clearInterval(id);
  }, [chosen, core.score, core.session?.steps_total, coreLesson, coreStep, gloves.latest, side, track, localStep, localStepData, complete]);

  const title = chosen.kind === 'core' ? chosen.title : chosen.lesson.title;
  return (
    <section className="demo__live" aria-labelledby="demo-live">
      <div className="demo__stage">
        <RobotTwin robot={robot} human={{ side, style: 'wood', live: gloves.latest, label: 'You' }} className="demo__twin" />
      </div>
      <aside className="demo__panel demo__side">
        <h2 id="demo-live" className="demo__lesson-name">
          {title}
        </h2>
        <p className="demo__lead" aria-live="polite">
          Step {Math.min(view.step + 1, view.steps)} of {view.steps}
          {view.stepName ? `: ${view.stepName}` : ''}
        </p>
        {view.complete ? (
          <p className="demo__mastered" role="status">
            Lesson mastered
          </p>
        ) : (
          <p className={view.match ? 'demo__score demo__score--match' : 'demo__score'} aria-label={view.score === null ? 'No score yet' : `Score ${view.score} of 100`}>
            {view.score ?? '–'}
          </p>
        )}
        <p className="demo__hint" aria-live="polite">
          {view.complete ? 'Well done.' : view.score === null ? 'Waiting for your hand...' : view.hint ? <span className="demo__correction">{view.hint}</span> : view.match ? 'Hold it there.' : 'Copy the hand below.'}
        </p>
        {(target || track) && (
          <HandPreview className="demo__target" label="The hand to copy">
            {target ? <Hand side={side} style="chalk" frame={target} /> : <Hand side={side} style="chalk" getFrame={(t) => track!.handAt(t)} />}
          </HandPreview>
        )}
        <div className="demo__actions">
          <Button large onClick={onDone}>
            Next visitor
          </Button>
          <Button large variant="secondary" onClick={onAnother}>
            Another lesson
          </Button>
        </div>
      </aside>
    </section>
  );
}
