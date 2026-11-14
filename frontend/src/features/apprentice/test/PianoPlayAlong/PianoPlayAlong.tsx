import { useCallback, useEffect, useRef, useState } from 'react';
import { useGloveStream, type Lesson, type Side, type TestSpec } from '../../../../api';
import { Button, Card } from '../../../../components/ui';
import { PropSwitch } from '../../../shared/PropSwitch';
import { useShowProps } from '../../../shared/sessionPrefs';
import { useStreamClock } from '../../hooks/useStreamClock';
import { flexionDegrees } from '../../training/coach/deviation';
import { TestResult } from '../TestResult';
import { DUEL_PASS_SCORE, useBotSkill, useDuelOutcome } from '../useDuelOutcome';
import { NoteLane } from './NoteLane';
import { PianoScene } from './PianoScene';
import {
  alignToPhrase,
  botPerformance,
  DEFAULT_BEAT_S,
  DEFAULT_PHRASE,
  NoteJudge,
  PressDetector,
  schedulePhrase,
  type PhraseNote,
  type PianoScore,
} from './piano';

const COUNT_IN_S = 3;

interface Live {
  scores: Record<Side, PianoScore>;
  callout: Record<Side, string>;
  next: PhraseNote | null;
}

const ZERO: PianoScore = { overall: 0, notes: 0, timing: 0, fingering: 0, streak: 0 };

/**
 * The piano test: a five-finger phrase arrives as falling notes with finger numbers. Presses are detected from how fast a
 * finger curls, then scored on note, timing and fingering ("right note, wrong finger" is called out), against a bot pianist
 * or a second glove in a duel.
 */
export function PianoPlayAlong({ spec, lesson }: { spec: TestSpec; lesson?: Lesson }) {
  const twoPlayer = spec.opponent === 'two_player';
  const botSkill = useBotSkill(lesson);
  const gloves = useGloveStream(true);
  const clock = useStreamClock(gloves);
  const [showProps] = useShowProps();
  const [stage, setStage] = useState<'intro' | 'playing' | 'result'>('intro');
  const [live, setLive] = useState<Live>({ scores: { left: ZERO, right: ZERO }, callout: { left: '', right: '' }, next: null });
  const [round, setRound] = useState(1);
  const [run, setRun] = useState<{ notes: PhraseNote[]; judges: Record<Side, NoteJudge>; end: number; bot: PianoScore } | null>(null);
  const detectors = useRef<Record<Side, PressDetector>>({ left: new PressDetector(), right: new PressDetector() });
  const active = useRef<Record<Side, NoteJudge> | null>(null);

  useEffect(() => {
    gloves.setMotion({ preset: 'finger_sequence', sequence: DEFAULT_PHRASE, beat_ms: DEFAULT_BEAT_S * 1000 });
  }, [gloves, gloves.status]);

  useEffect(
    () =>
      gloves.onFrame((f) => {
        const judges = active.current;
        if (!judges) return;
        for (const h of f.hands) {
          if (!twoPlayer && h.side === 'left') continue;
          for (const press of detectors.current[h.side].push(f.t, flexionDegrees(h))) judges[h.side].press(press);
        }
      }),
    [gloves, twoPlayer],
  );

  const start = useCallback(() => {
    const now = clock.now();
    const after = now + COUNT_IN_S;
    const t0 = clock.simulated() ? alignToPhrase(after, DEFAULT_BEAT_S, DEFAULT_PHRASE.length) : after;
    const notes = schedulePhrase(DEFAULT_PHRASE, t0, DEFAULT_BEAT_S, spec.rounds);
    const judges = { left: new NoteJudge(notes), right: new NoteJudge(notes) };
    detectors.current = { left: new PressDetector(), right: new PressDetector() };
    active.current = judges;
    setRun({ notes, judges, end: notes[notes.length - 1].time + 0.9, bot: botPerformance(notes, 7, botSkill) });
    setRound(1);
    setStage('playing');
  }, [clock, spec.rounds, botSkill]);

  useEffect(() => {
    if (stage !== 'playing' || !run) return;
    const id = window.setInterval(() => {
      const now = clock.now();
      const next = run.notes.find((n) => n.time + 0.3 >= now) ?? null;
      const perRound = DEFAULT_PHRASE.length;
      setRound(Math.min(spec.rounds, 1 + Math.floor((next?.index ?? run.notes.length - 1) / perRound)));
      setLive({
        scores: { left: run.judges.left.score(), right: run.judges.right.score() },
        callout: { left: run.judges.left.callout, right: run.judges.right.callout },
        next,
      });
      if (now > run.end) {
        active.current = null;
        setStage('result');
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [stage, run, clock, spec.rounds]);

  const mine: Side = 'right';
  const myScore = run && stage === 'result' ? run.judges[mine].score().overall : 0;
  const seal = useDuelOutcome(lesson, stage === 'result' && !twoPlayer, myScore >= DUEL_PASS_SCORE, myScore);
  const rivals = run && stage === 'result' ? { me: run.judges[mine].score(), left: run.judges.left.score(), bot: run.bot } : null;

  if (stage === 'result' && run && rivals) {
    const you = rivals.me;
    const other = twoPlayer ? rivals.left : rivals.bot;
    const verdict = you.overall > other.overall ? 'win' : you.overall < other.overall ? 'lose' : 'draw';
    const hits = run.judges[mine].judged.filter((j) => j.result === 'hit').length;
    const wrongs = run.judges[mine].judged.filter((j) => j.result === 'wrong_finger').length;
    return (
      <TestResult
        title={twoPlayer ? 'Piano duel' : 'Piano play-along'}
        score={you.overall}
        scoreLabel={twoPlayer ? `You (right glove) against ${other.overall} for the left glove` : `Your score against ${other.overall} for the bot pianist`}
        verdict={verdict}
        verdictText={verdict === 'win' ? (twoPlayer ? 'Right glove wins' : 'You beat the bot pianist') : verdict === 'draw' ? 'A draw' : twoPlayer ? 'Left glove wins' : 'The bot pianist wins'}
        bestMoment={you.streak > 1 ? `${you.streak} notes in a row, right finger and right time` : ''}
        footer={seal}
        details={
          <ul className="ap-result__split" aria-label="Score breakdown">
            <li>
              <strong>{you.notes}</strong> notes played
            </li>
            <li>
              <strong>{you.timing}</strong> timing
            </li>
            <li>
              <strong>{you.fingering}</strong> fingering
            </li>
            <li>
              {hits} clean, {wrongs} wrong finger
            </li>
          </ul>
        }
        onAgain={() => setStage('intro')}
      />
    );
  }

  const sides: Side[] = twoPlayer ? ['left', 'right'] : ['right'];
  return (
    <div className={`ap-arena ap-arena--piano ${stage === 'playing' ? 'ap-arena--live' : ''}`}>
      <div className="ap-arena__scene">
        <PianoScene gloves={gloves} twoPlayer={twoPlayer} showProp={showProps} resetKey={run} />
        {stage === 'playing' && live.next && (
          <div className="ap-next" role="status" aria-live="polite">
            <span className="ap-next__round">
              Round {round} of {spec.rounds}
            </span>
            <span className="ap-next__num">{live.next.finger}</span>
            <span className="ap-next__name">{['', 'Thumb', 'Index', 'Middle', 'Ring', 'Little'][live.next.finger]}</span>
          </div>
        )}
        {stage === 'intro' && (
          <Card as="section" className="ap-intro" aria-label="How to play">
            <h2>{twoPlayer ? 'Piano duel' : 'Play along with the phrase'}</h2>
            <ul className="ap-intro__rules">
              <li>Notes fall in five lanes, one for each finger. Press with the finger the note shows: 1 is the thumb, 5 the little finger.</li>
              <li>You earn points for the note, for the timing and for the fingering. &ldquo;Right note, wrong finger&rdquo; is called out.</li>
              <li>{twoPlayer ? 'Left glove against right glove, same phrase, same time.' : 'Beat the bot pianist’s score.'}</li>
              <li>
                {spec.rounds} rounds of the five-finger scale, up and back down.
              </li>
            </ul>
            <div className="ap-intro__foot">
              <PropSwitch prop="keyboard" className="ap-intro__prop" />
              <Button large onClick={start}>
                Start playing
              </Button>
            </div>
          </Card>
        )}
      </div>

      {stage === 'playing' && run && (
        <div className="ap-arena__lanes">
          <div className={`ap-lanes ${twoPlayer ? 'ap-lanes--two' : ''}`}>
            {sides.map((s) => (
              <div key={s} className="ap-lanes__col">
                <NoteLane label={twoPlayer ? (s === 'left' ? 'Player 1 (left glove)' : 'Player 2 (right glove)') : 'Your phrase'} notes={run.notes} judge={run.judges[s]} clock={clock} />
                <div className="ap-lanes__score">
                  <span className="ap-lanes__num">{live.scores[s].overall}</span>
                  <span className="ap-lanes__label">points</span>
                  <p className="ap-lanes__callout note" aria-live="polite">
                    {live.callout[s] || 'Waiting for your first note'}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {!twoPlayer && (
            <p className="ap-lanes__bot">
              Bot pianist <strong>{run.bot.overall}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
