import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useGloveStream, useLessons, type Finger, type HandFrame, type Lesson, type MotionSpec, type Side } from '../../../api';
import { useRobotStream } from '../../../api/useRobotStream';
import { PageHeader } from '../../../components/PageHeader';
import { synthFrame } from '../../../three';
import { useRobotModels } from '../../../three/robot';
import { connectionLine, fingerLines, lagLine, modelName, sourceFor, type DriveChoice } from './logic';
import { RobotStage } from './RobotStage';
import './robot.css';

const CHOICES: { id: DriveChoice; label: string }[] = [
  { id: 'you', label: 'You' },
  { id: 'lesson', label: 'Expert lesson' },
  { id: 'off', label: 'Off' },
];
/** The robot is "still" once no message has come for this long. */
const QUIET_MS = 400;
const READOUT_MS = 250;
/** What the mock glove plays on this screen, so the strings move without gloves. */
const MOCK_GLOVE_MOTION: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3, 2, 1, 5], beat_ms: 750 };

/** The first one-handed step with a motion: what "Expert lesson" plays in the browser. */
function lessonGuide(lessons: Lesson[] | null): { lesson: Lesson; motion: MotionSpec } | null {
  for (const l of lessons ?? []) {
    for (const s of l.steps) if (s.motion && s.hands !== 'left') return { lesson: l, motion: s.motion };
  }
  return null;
}

function SourceSwitch({ value, onChange }: { value: DriveChoice; onChange: (c: DriveChoice) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: ReactKeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + CHOICES.length) % CHOICES.length;
    onChange(CHOICES[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div className="rb-seg" role="radiogroup" aria-label="The robot follows">
      {CHOICES.map((c, i) => (
        <button
          key={c.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          tabIndex={value === c.id ? 0 : -1}
          className="rb-seg__opt"
          onClick={() => onChange(c.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Dead-man control: the robot gets targets only while this is held (pointer) or toggled on with Space. Releasing,
 * leaving the page or losing the core all let go, because real hardware will follow this.
 */
function EngageControl({ engaged, disabled, onHold }: { engaged: boolean; disabled: boolean; onHold: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className={`rb-engage${engaged ? ' is-on' : ''}`}
      aria-pressed={engaged}
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {engaged ? 'Engaged' : 'Hold to engage'}
    </button>
  );
}

/**
 * The teleop screen (/robot): the human hand drives a robot twin (Unitree Dex3-1) through marionette strings. It reads
 * the core's /ws/robot, or works the robot out in the browser when the core is down or in mock mode.
 */
export default function RobotScreen() {
  const gloves = useGloveStream(true);
  const robot = useRobotStream(true);
  const { models, error: modelError } = useRobotModels();
  const lessons = useLessons();
  const guide = useMemo(() => lessonGuide(lessons.data), [lessons.data]);
  const [choice, setChoice] = useState<DriveChoice>('you');
  const [engaged, setEngaged] = useState(false);
  const taut = useRef(false);
  const [readout, setReadout] = useState<{ fidelity: Partial<Record<Finger, number>> | null; side: Side; moving: boolean }>({ fidelity: null, side: 'right', moving: false });
  const [problem, setProblem] = useState<string | null>(null);
  const { link, roles, setSource, setMockInput, noteGloveFrame, onMessage, lastAt } = robot;
  const mock = typeof window !== 'undefined' && window.__apprenticeMock === true;
  const browserLesson = link !== 'core';

  // In mock mode the simulated glove plays a finger sequence, so the robot has something to follow.
  const { setMotion } = gloves;
  useEffect(() => {
    if (mock) setMotion(MOCK_GLOVE_MOTION);
  }, [mock, setMotion]);

  const lessonHand = useCallback((side: Side): HandFrame | null => (guide ? synthFrame(guide.motion, performance.now() / 1000, side) : null), [guide]);

  // What the browser retarget follows: the glove hand, or the lesson hand at the same clock the stage draws it with.
  useEffect(() => {
    setMockInput((src) => {
      if (src === 'lesson') {
        const hand = lessonHand('right');
        return hand ? { hand, from: 'lesson' } : null;
      }
      const f = gloves.latest.current;
      const hand = f?.hands.find((h) => h.side === 'right') ?? f?.hands[0];
      return hand ? { hand, from: 'hand' } : null;
    });
    return () => setMockInput(null);
  }, [setMockInput, gloves.latest, lessonHand]);

  useEffect(() => gloves.onFrame(noteGloveFrame), [gloves, noteGloveFrame]);

  // Engage sends the chosen source; release sends off. Any failure lets go.
  const want = engaged ? sourceFor(choice, roles) : 'off';
  useEffect(() => {
    taut.current = want !== 'off';
    let cancelled = false;
    (async () => {
      try {
        if (want === 'lesson' && link === 'core' && (!robot.lessonId || !['learn', 'duel', 'playback'].includes(robot.mode ?? ''))) {
          // The core's lesson source plays its own loaded lesson, and only in learn, duel or playback mode.
          const id = robot.lessonId ?? robot.lessons[0]?.id;
          if (!id) throw new Error('The core has no lesson to play. Record one with the core first.');
          if (!robot.lessonId) await robot.send('lesson_load', { lesson_id: id });
          await robot.send('set_mode', { mode: 'playback' });
        }
        await setSource(want);
        if (!cancelled) setProblem(null);
      } catch (e) {
        if (cancelled) return;
        setProblem(e instanceof Error ? e.message : String(e));
        setEngaged(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // robot.lessonId, mode and lessons are read at engage time only; re-sending on their change would fight the core.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, link, setSource]);

  // Let go whenever the connection changes, the page is hidden or the window loses focus.
  useEffect(() => setEngaged(false), [link]);
  useEffect(() => {
    const off = () => setEngaged(false);
    const vis = () => document.visibilityState === 'hidden' && off();
    window.addEventListener('blur', off);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', off);
    return () => {
      window.removeEventListener('blur', off);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pagehide', off);
      void setSource('off').catch(() => undefined);
    };
  }, [setSource]);

  // Space toggles the dead-man (and never also clicks a focused button).
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target) || (e.target instanceof HTMLElement && e.target.closest('dialog'))) return;
      e.preventDefault();
      if (!e.repeat && choice !== 'off') setEngaged((v) => !v);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target)) e.preventDefault();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [choice]);

  useEffect(() => {
    if (choice === 'off') setEngaged(false);
  }, [choice]);

  // A few readings a second for the words under the stage; the stage itself reads refs every frame.
  useEffect(() => {
    let last: { fidelity: Partial<Record<Finger, number>>; side: Side } | null = null;
    const un = onMessage((m) => {
      last = { fidelity: m.fidelity, side: m.hand };
    });
    const id = window.setInterval(() => {
      const moving = performance.now() - lastAt() < QUIET_MS;
      setReadout((r) => {
        const next = { fidelity: moving && last ? last.fidelity : null, side: last?.side ?? r.side, moving };
        return JSON.stringify(next) === JSON.stringify(r) ? r : next;
      });
    }, READOUT_MS);
    return () => {
      un();
      window.clearInterval(id);
    };
  }, [onMessage, lastAt]);

  const conn = connectionLine(robot);
  const lines = fingerLines(robot.robot, readout.side, readout.fidelity);
  const lessonInStage = choice === 'lesson' && browserLesson && guide !== null;
  const who = choice === 'lesson' ? (browserLesson ? `the expert lesson${guide ? ` "${guide.lesson.title}"` : ''}` : `the lesson loaded in the core${robot.lessonId ? ` (${robot.lessonId})` : ''}`) : 'your hand';
  const state = choice === 'off' ? 'Pick You or Expert lesson to drive the robot.' : engaged ? (readout.moving ? `Engaged: the robot follows ${who}.` : `Engaged, waiting for ${who}.`) : 'Released: the robot holds still.';
  const name = modelName(robot.robot?.model);

  return (
    <div className="rb-page">
      <PageHeader title="Robot" context={`Your hand works the ${name} like a marionette. Hold Engage and the robot copies you; let go and it stops.`} />

      <p className={`rb-line rb-line--${conn.tone}`}>{conn.text}</p>

      <div className="rb-stage">
        {models ? (
          <RobotStage
            models={models}
            side={readout.side}
            live={lessonInStage ? undefined : gloves.latest}
            getFrame={lessonInStage ? () => lessonHand(readout.side) : undefined}
            humanStyle={lessonInStage ? 'sketch' : 'chalk'}
            q={robot.latest}
            taut={taut}
            stringsHidden={choice === 'lesson' && !browserLesson}
            label={`Your hand on the left and the ${name} on the right, joined by strings from the thumb, index and middle fingertips.`}
          />
        ) : (
          <p className="rb-line">{modelError ? `The robot model could not be read: ${modelError}` : 'Setting up the robot...'}</p>
        )}
      </div>

      <div className="rb-panel">
        <section className="rb-controls" aria-labelledby="rb-drive">
          <h2 id="rb-drive" className="rb-h">The robot follows</h2>
          <SourceSwitch value={choice} onChange={setChoice} />
          <EngageControl engaged={engaged} disabled={choice === 'off'} onHold={setEngaged} />
          <p className="rb-line rb-state" aria-live="polite">
            {state}
          </p>
          <p className="rb-note">Hold the button, or press Space to engage and Space again to let go.</p>
          {problem && (
            <p className="rb-line rb-line--fix" role="alert">
              {problem}
            </p>
          )}
          {choice === 'lesson' && !browserLesson && <p className="rb-note">The core plays its own lesson files, so your hand stays on the left for reference and the strings are put away.</p>}
        </section>

        <section className="rb-read" aria-labelledby="rb-fid">
          <h2 id="rb-fid" className="rb-h">How well it copies</h2>
          <ul className="rb-fingers">
            {lines.map((l) => (
              <li key={l.finger} className={`rb-finger rb-line--${l.tone}`}>
                {l.text}
              </li>
            ))}
          </ul>
          <p className="rb-line">{lagLine(robot.lagMs, link)}</p>
        </section>
      </div>
    </div>
  );
}
