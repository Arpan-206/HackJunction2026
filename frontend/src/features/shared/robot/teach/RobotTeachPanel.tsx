import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FINGERS, type Finger, type GloveFrame, type Side } from '../../../../api/types';
import type { GloveStreamHandle } from '../../../../api/useGloveStream';
import { Disclosure } from '../../../../components/ui';
import { CODEX_STAGE } from '../../../../three';
import { useReferenceTrack } from '../../../apprentice/hooks/useReferenceTrack';
import type { ReferenceTrack } from '../../../apprentice/training/coach/reference';
import { Segmented } from '../../../apprentice/training/Segmented';
import { LessonStepFields, lessonPickerNote, useLessonStep } from '../LessonStepPicker';
import { LESSON_SPEEDS, type SpeedId } from '../RobotLessonPlayer';
import type { TwinLesson } from '../RobotTwin';
import { fingerProfile, MOVING_RANGE_DEG, PASS_SCORE, type Instruction, type SkillAxis } from './robotSkill';
import { speak, useSpeechInput } from './useSpeechInput';
import { useTeachSession, type RoundSummary, type TeachSession } from './useTeachSession';

/** The robot's name in teach mode: Geppetto's wooden boy. */
export const ROBOT_NAME = 'Pinocchio';

const FINGER_LABEL: Record<Finger, string> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', little: 'Little' };

const ACTIONS: { axis: SkillAxis; dir: 1 | -1; label: string }[] = [
  { axis: 'bend', dir: 1, label: 'Curl more' },
  { axis: 'bend', dir: -1, label: 'Straighten' },
  { axis: 'time', dir: -1, label: 'Earlier' },
  { axis: 'time', dir: 1, label: 'Later' },
];

interface RobotTeachPanelProps {
  gloves: GloveStreamHandle;
  /** Hands the stage what to draw: the expert, the robot's attempt and its line, or null when nothing is loaded. */
  onChange: (lesson: TwinLesson | null) => void;
}

/**
 * Teach the robot: the five-finger robot performs a lesson step, sometimes with one planted fault, and the learner
 * judges it and fixes it: by tapping a finger and a change, by voice or typed words, or by showing it with the glove.
 * The robot does what it is told, right or wrong, so its score is the teacher's score (learning by teaching,
 * research/13 and 14).
 */
export function RobotTeachPanel({ gloves, onChange }: RobotTeachPanelProps) {
  const choice = useLessonStep();
  const { lesson, step } = choice;
  const [speed, setSpeed] = useState<SpeedId>('1');
  const [attempt, setAttempt] = useState(0);
  const ref = useReferenceTrack(step);
  const note = lessonPickerNote(choice);

  useEffect(() => () => onChange(null), [onChange]);
  useEffect(() => {
    if (!ref.track) onChange(null);
  }, [ref.track, onChange]);

  if (note) return <p className="note">{note}</p>;
  const speedLabel = LESSON_SPEEDS.find((s) => s.id === speed)?.label.toLowerCase();
  return (
    <div className="rb-teach">
      <Disclosure summary={`${lesson?.title ?? 'Lesson'}: ${step?.title ?? ''}, ${speedLabel}`} className="rb-teach__setup">
        <div className="rb-teach__group">
          <LessonStepFields choice={choice} />
          <div className="ap-field">
            <span className="ap-field__label">Speed</span>
            <Segmented label="Playback speed" value={speed} options={[...LESSON_SPEEDS]} onChange={setSpeed} />
          </div>
        </div>
      </Disclosure>
      {ref.notice && <p className="note">{ref.notice}</p>}
      {ref.track && step && !ref.loading ? (
        <TeachRun
          key={`${step.id}-${ref.track.source}-${attempt}`}
          onRestart={() => setAttempt((a) => a + 1)}
          track={ref.track}
          speed={Number(speed)}
          weights={step.weights ?? null}
          gloves={gloves}
          label={step.title}
          onChange={onChange}
        />
      ) : (
        <p className="note">Loading the expert's take...</p>
      )}
    </div>
  );
}

interface TeachRunProps {
  track: ReferenceTrack;
  speed: number;
  weights: Partial<Record<Finger, number>> | null;
  gloves: GloveStreamHandle;
  label: string;
  onChange: (lesson: TwinLesson | null) => void;
  onRestart: () => void;
}

function hasHand(f: GloveFrame | null, side: Side): boolean {
  return !!f?.hands.some((h) => h.side === side);
}

function TeachRun({ track: given, speed, weights: givenWeights, gloves, label, onChange, onRestart }: TeachRunProps) {
  // The run keeps the track and weights it started with: the lesson library refetches, which hands down new objects for
  // the same step, and a new track would plan new rounds and wipe the teaching so far. A new step remounts the run.
  const [track] = useState(given);
  const [weights] = useState(givenWeights);
  const session = useTeachSession(track, speed, weights, gloves.latest);
  const [finger, setFinger] = useState<Finger | null>(null);
  const [text, setText] = useState('');
  const [hideExpert, setHideExpert] = useState(false);
  const [talk, setTalk] = useState(false);
  const [gloveOn, setGloveOn] = useState(false);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const moving = useMemo(() => Object.values(fingerProfile(track.handAt, track.period)).some((p) => p.range >= MOVING_RANGE_DEG), [track]);
  const voice = useSpeechInput(session.sayText);

  // Whether the glove for the step's hand is sending, checked once a second (frames arrive without re-rendering).
  useEffect(() => {
    const check = () => setGloveOn(gloves.status === 'open' && hasHand(gloves.latest.current, track.side));
    check();
    const id = window.setInterval(check, 1000);
    return () => window.clearInterval(id);
  }, [gloves, track.side]);

  useEffect(() => {
    if (talk) speak(session.line);
  }, [talk, session.line]);

  // A new round starts with no finger picked and no give-up pending.
  const { round } = session;
  useEffect(() => {
    setFinger(null);
    setConfirmGiveUp(false);
  }, [round]);

  const tint = session.hintFinger ? { [session.hintFinger]: CODEX_STAGE.vermilion } : undefined;
  const { expertFrame, robotFrame, line, demo, countdown } = session;
  const banner = demo === 'countdown' ? String(countdown) : demo === 'recording' ? 'Recording' : undefined;
  useEffect(() => {
    onChange({
      getFrame: expertFrame,
      robotFrame,
      side: track.side,
      label,
      showExpert: !hideExpert,
      robotTint: tint,
      speech: line,
      robotLabel: ROBOT_NAME,
      banner,
    });
    // The frame functions read the session clock and skill through refs, so a new identity each render changes nothing
    // the stage draws; re-sending on the values below is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, track.side, label, hideExpert, session.hintFinger, line, round, session.score, banner]);

  const tell = (axis: SkillAxis, dir: 1 | -1) => {
    if (!finger) return;
    const ins: Instruction = { finger, axis, dir, amount: 1 };
    session.tell([ins], `${FINGER_LABEL[finger]}: ${ACTIONS.find((a) => a.axis === axis && a.dir === dir)?.label.toLowerCase()}.`);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    session.sayText(text);
    setText('');
  };

  if (session.done) return <TeachSummary summary={session.summary} onRestart={onRestart} />;

  const busy = session.over || demo !== 'idle';
  return (
    <div className="rb-teach__run">
      {/* The score stays hidden until the teacher has judged by eye: shown at once, it would give away whether anything is wrong. */}
      <p className="rb-teach__round" aria-live="polite">
        <span>
          Round {round + 1} of {session.rounds}
        </span>
        {/* After a miss or a give-up the robot has fixed itself, so its 100 would not be the teacher's score. */}
        {session.over && !session.passed ? (
          <span className="rb-teach__of">Round over</span>
        ) : session.over || session.heard ? (
          <span>
            {ROBOT_NAME}'s score <strong className={`ap-num ${session.passed ? 'rb-teach__num--ok' : ''}`}>{session.score}</strong>
            <span className="rb-teach__of"> (passes at {PASS_SCORE})</span>
          </span>
        ) : (
          <span className="rb-teach__of">Judge by eye</span>
        )}
      </p>

      {session.over ? (
        <RoundResult session={session} />
      ) : (
        <>
          <fieldset className="rb-teach__group" disabled={busy}>
            <legend className="rb-teach__legend">Which finger is wrong?</legend>
            <div className="rb-teach__chips" role="group" aria-label="Finger">
              {FINGERS.map((f) => (
                <button key={f} type="button" className="btn btn--toggle" aria-pressed={finger === f} onClick={() => setFinger(finger === f ? null : f)}>
                  {FINGER_LABEL[f]}
                </button>
              ))}
            </div>
            {finger ? (
              <div className="rb-teach__chips" role="group" aria-label={`What the ${FINGER_LABEL[finger].toLowerCase()} should do`}>
                {ACTIONS.filter((a) => moving || a.axis === 'bend').map((a) => (
                  <button key={a.label} type="button" className="btn btn--secondary" onClick={() => tell(a.axis, a.dir)}>
                    {a.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="note rb-teach__hint">Tap the finger that looks wrong, then what it should do.</p>
            )}
            <button type="button" className="btn btn--secondary rb-teach__ok" onClick={() => session.looksRight()}>
              Nothing is wrong
            </button>
          </fieldset>

          <div className="rb-teach__group">
            <span className="rb-teach__legend">Or tell it another way</span>
            <div className="rb-teach__chips">
              {voice.supported && (
                <button type="button" className="btn btn--secondary" aria-pressed={voice.listening} disabled={busy} onClick={voice.listening ? voice.stop : voice.listen}>
                  {voice.listening ? 'Listening, press to stop' : 'Say it'}
                </button>
              )}
              <button type="button" className="btn btn--secondary" disabled={busy || !gloveOn} onClick={session.startDemo}>
                {demo === 'countdown' ? `Get ready: ${countdown}` : demo === 'recording' ? 'Recording your hand' : 'Show it with your glove'}
              </button>
            </div>
            <p className="note rb-teach__hint">
              {voice.supported ? 'Say it: speak a sentence such as "curl your index a bit more". Your browser listens, then the robot acts. ' : ''}
              {gloveOn
                ? `Show it: do the step once with the expert (${track.period.toFixed(1)} s); the robot copies most of your hand, mistakes included.`
                : `Show it: connect a ${track.side} glove first.`}
            </p>
            {voice.error && <p className="note">{voice.error}</p>}
            <Disclosure summary="Type it instead">
              <form className="rb-teach__say" onSubmit={submit}>
                <input
                  className="rb-select"
                  aria-label="Tell the robot in words"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Curl your index a bit more"
                  disabled={busy}
                  autoComplete="off"
                />
                <button type="submit" className="btn btn--secondary" disabled={busy || !text.trim()}>
                  Tell
                </button>
              </form>
            </Disclosure>
          </div>

          <div className="rb-teach__group">
            <span className="rb-teach__legend">Stuck?</span>
            <div className="rb-teach__chips">
              <button type="button" className="btn btn--secondary" onClick={session.hint} disabled={busy || session.hintFinger !== null}>
                Give me a hint
              </button>
              {confirmGiveUp ? (
                <>
                  <button type="button" className="btn btn--secondary" onClick={session.reveal} disabled={busy}>
                    Yes, show me
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirmGiveUp(false)}>
                    Keep trying
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn--ghost rb-teach__quiet" onClick={() => setConfirmGiveUp(true)} disabled={busy}>
                  Give up this round
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <Disclosure summary="Options">
        <div className="rb-teach__group">
          <label className="rb-teach__check">
            <input type="checkbox" checked={hideExpert} onChange={(e) => setHideExpert(e.target.checked)} />
            Hide the expert, and judge from memory (harder)
          </label>
          <label className="rb-teach__check">
            <input type="checkbox" checked={talk} onChange={(e) => setTalk(e.target.checked)} />
            {ROBOT_NAME} talks aloud
          </label>
        </div>
      </Disclosure>

      {session.log.length > 0 && (
        <Disclosure summary={`What you tried (${session.log.length})`}>
          <ol className="rb-teach__log" aria-label="Teaching log">
            {[...session.log].reverse().map((e) => (
              <li key={e.id}>
                <span className="rb-teach__said">{e.said}</span>
                <span>{e.reply}</span>
              </li>
            ))}
          </ol>
        </Disclosure>
      )}
    </div>
  );
}

/** One line for how a round ended. */
function roundLine(s: RoundSummary): string {
  switch (s.outcome) {
    case 'gave_up':
      return `You gave up. ${s.fault}`;
    case 'missed':
      return `You said nothing was wrong, but it was. ${s.fault}`;
    case 'left':
      return 'Nothing was wrong, and you left it alone. Well spotted.';
    default:
      if (s.kind === 'catch') return 'Nothing was wrong at the start. Your changes broke it, then you fixed it.';
      return `${s.fault} You fixed it in ${s.corrections} ${s.corrections === 1 ? 'change' : 'changes'}${s.firstTry ? ', right first time' : ''}${s.hinted ? ', with a hint' : ''}.`;
  }
}

function RoundResult({ session }: { session: TeachSession }) {
  const last = session.summary[session.summary.length - 1];
  const isLast = session.round + 1 >= session.rounds;
  return (
    <div className="rb-teach__result">
      <p className={session.passed ? 'rb-teach__result--ok' : ''}>{last ? roundLine(last) : ''}</p>
      <button type="button" className="btn btn--primary" onClick={session.next}>
        {isLast ? 'See how you taught' : 'Next round'}
      </button>
    </div>
  );
}

function TeachSummary({ summary, onRestart }: { summary: RoundSummary[]; onRestart: () => void }) {
  const right = summary.filter((s) => s.outcome === 'left' || (s.outcome === 'taught' && s.firstTry)).length;
  return (
    <div className="rb-teach__run">
      <p className="rb-teach__head">
        You judged {right} of {summary.length} rounds right first time.
      </p>
      <ol className="rb-teach__summary" aria-label="Rounds">
        {summary.map((s, i) => (
          <li key={i}>
            <span className="rb-teach__said">Round {i + 1}</span>
            <span>{roundLine(s)}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn--primary rb-teach__again" onClick={onRestart}>
        Teach it again
      </button>
    </div>
  );
}
