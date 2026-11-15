import '../threeSetup';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FINGERS, type Finger, type GloveFrame } from '../../api/types';
import { trackFromFrames, type ReferenceTrack } from '../../features/apprentice/training/coach/reference';
import { PASS_SCORE, type Instruction, type SkillAxis } from '../../features/shared/robot/teach/robotSkill';
import { useTeachSession, type RoundSummary, type TeachSession } from '../../features/shared/robot/teach/useTeachSession';
import { Hand } from '../../three/Hand';
import { CODEX_STAGE } from '../../three/parchment';
import { HandCanvas } from '../../three/Stage';
import type { TourTake } from '../data';
import { StageFrame } from '../StageFrame';
import { useTake } from './shared';

const ROBOT_NAME = 'Pinocchio';
const FINGER_LABEL: Record<Finger, string> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', little: 'Little' };
const ACTIONS: { axis: SkillAxis; dir: 1 | -1; label: string }[] = [
  { axis: 'bend', dir: 1, label: 'Curl more' },
  { axis: 'bend', dir: -1, label: 'Straighten' },
];

export default function TeachStop() {
  const take = useTake('letter');
  const track = useMemo(() => (take ? trackFromFrames(take.frames, take.side) : null), [take]);
  const [attempt, setAttempt] = useState(0);
  return (
    <section className="tour-stop">
      <p className="tour-lead">
        Now you teach. {ROBOT_NAME}, a five-finger robot hand, performs the Finnish letter A from an expert's take, sometimes with one finger wrong. Judge it by eye, then
        tap the finger and the fix, or type it in words.
      </p>
      {take && track ? <TeachRun key={attempt} take={take} track={track} onRestart={() => setAttempt((a) => a + 1)} /> : <p className="tour-loading">Loading the take...</p>}
      <p className="tour-small">
        This stop is live in your browser: {ROBOT_NAME} follows fixed rules that read your words, with no AI model and nothing sent anywhere. The example is canned: every
        visitor gets the same expert take.
      </p>
    </section>
  );
}

function TeachRun({ take, track, onRestart }: { take: TourTake; track: ReferenceTrack; onRestart: () => void }) {
  const noGlove = useRef<GloveFrame | null>(null);
  const session = useTeachSession(track, 1, null, noGlove);
  const [finger, setFinger] = useState<Finger | null>(null);
  const [text, setText] = useState('');
  const { round } = session;
  useEffect(() => setFinger(null), [round]);

  const tint = session.hintFinger ? { [session.hintFinger]: CODEX_STAGE.vermilion } : undefined;
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

  return (
    <>
      <StageFrame text={`The expert's chalk hand makes the letter A beside ${ROBOT_NAME}, a steel robot hand that copies it.`}>
        <HandCanvas preset="pair" stage={{ decor: false }} label={`The expert's hand beside ${ROBOT_NAME}, the robot hand you teach`}>
          <Hand side={take.side} style="chalk" getFrame={session.expertFrame} position={[-1.3, 0.15, 0]} />
          <Hand side={take.side} style="robot" getFrame={session.robotFrame} fingerTint={tint} smoothing={0.09} position={[1.3, 0.15, 0]} />
        </HandCanvas>
        <div className="rb-twin__caps" aria-hidden="true">
          <span className="rb-twin__cap">The expert</span>
          <span className="rb-twin__cap rb-twin__cap--robot">{ROBOT_NAME}</span>
        </div>
      </StageFrame>
      <p className="tour-speech" aria-live="polite">
        {ROBOT_NAME}: {session.line}
      </p>
      {session.done ? <Summary summary={session.summary} onRestart={onRestart} /> : <Controls session={session} finger={finger} setFinger={setFinger} tell={tell} text={text} setText={setText} submit={submit} />}
    </>
  );
}

function Controls({
  session,
  finger,
  setFinger,
  tell,
  text,
  setText,
  submit,
}: {
  session: TeachSession;
  finger: Finger | null;
  setFinger: (f: Finger | null) => void;
  tell: (axis: SkillAxis, dir: 1 | -1) => void;
  text: string;
  setText: (t: string) => void;
  submit: (e: FormEvent) => void;
}) {
  const busy = session.over;
  return (
    <div className="tour-panel">
      <p className="tour-score">
        Round {session.round + 1} of {session.rounds}.{' '}
        {session.over || session.heard ? (
          <>
            {ROBOT_NAME}'s score <strong className="ap-num">{session.score}</strong> (passes at {PASS_SCORE})
          </>
        ) : (
          'Judge by eye first.'
        )}
      </p>
      {session.over ? (
        <div>
          <p>{roundLine(session.summary[session.summary.length - 1])}</p>
          <button type="button" className="btn btn--primary tour-btn" onClick={session.next}>
            {session.round + 1 >= session.rounds ? 'See how you taught' : 'Next round'}
          </button>
        </div>
      ) : (
        <>
          <fieldset className="tour-fieldset" disabled={busy}>
            <legend>Which finger is wrong?</legend>
            <div className="tour-chips">
              {FINGERS.map((f) => (
                <button key={f} type="button" className="btn btn--secondary tour-btn" aria-pressed={finger === f} onClick={() => setFinger(finger === f ? null : f)}>
                  {FINGER_LABEL[f]}
                </button>
              ))}
            </div>
            {finger && (
              <div className="tour-chips">
                {ACTIONS.map((a) => (
                  <button key={a.label} type="button" className="btn btn--primary tour-btn" onClick={() => tell(a.axis, a.dir)}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn btn--secondary tour-btn" onClick={() => session.looksRight()}>
              Nothing is wrong
            </button>
          </fieldset>
          <form className="tour-say" onSubmit={submit}>
            <label htmlFor="tour-say">Or tell it in words</label>
            <div className="tour-chips">
              <input id="tour-say" value={text} onChange={(e) => setText(e.target.value)} placeholder="Curl your index a bit more" autoComplete="off" disabled={busy} />
              <button type="submit" className="btn btn--secondary tour-btn" disabled={busy || !text.trim()}>
                Tell
              </button>
            </div>
          </form>
          <div className="tour-chips">
            <button type="button" className="btn btn--ghost tour-btn" onClick={session.hint} disabled={busy || session.hintFinger !== null}>
              Give me a hint
            </button>
            <button type="button" className="btn btn--ghost tour-btn" onClick={session.reveal} disabled={busy}>
              Show me what was wrong
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function roundLine(s: RoundSummary | undefined): string {
  if (!s) return '';
  switch (s.outcome) {
    case 'gave_up':
      return `You asked to see it. ${s.fault}`;
    case 'missed':
      return `You said nothing was wrong, but it was. ${s.fault}`;
    case 'left':
      return 'Nothing was wrong, and you left it alone. Well spotted.';
    default:
      if (s.kind === 'catch') return 'Nothing was wrong at the start. Your changes broke it, then you fixed it.';
      return `${s.fault} You fixed it in ${s.corrections} ${s.corrections === 1 ? 'change' : 'changes'}.`;
  }
}

function Summary({ summary, onRestart }: { summary: RoundSummary[]; onRestart: () => void }) {
  const right = summary.filter((s) => s.outcome === 'left' || (s.outcome === 'taught' && s.firstTry)).length;
  return (
    <div className="tour-panel">
      <p>
        You judged {right} of {summary.length} rounds right first time.
      </p>
      <ol>
        {summary.map((s, i) => (
          <li key={i}>{roundLine(s)}</li>
        ))}
      </ol>
      <button type="button" className="btn btn--primary tour-btn" onClick={onRestart}>
        Teach it again
      </button>
    </div>
  );
}
