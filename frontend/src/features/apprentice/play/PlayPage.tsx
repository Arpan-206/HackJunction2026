import { useHandPosition } from '../../../three/handPosition';
import { skillUsesHandPosition } from '../skills/catalogue';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api, useGloveStream, type Lesson, type ScoreRequest, type ScoreResult } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Button, ButtonLink } from '../../../components/ui';
import { HandCanvas, Keyboard, PropCue, RecentreHandButton, type HandHandle } from '../../../three';
import { ApHeader } from '../ApHeader';
import { KeyPoseStill } from '../course/VideoSlot';
import { stepSide, useReferenceTrack } from '../hooks/useReferenceTrack';
import { useLessonById } from '../hooks/useLessonData';
import { playRecord, recordPlayRound, type PlayRecord } from '../pipeline/journey';
import { isClean } from '../pipeline/stages';
import { checkAttempt } from '../training/coach/attemptGuard';
import { configFromTolerance } from '../training/coach/deviation';
import { policyForStage } from '../training/coach/fade';
import { localScore } from '../training/coach/localScore';
import { useCoach, useCoachView, type Coach } from '../training/coach/useCoach';
import { LearnerHand } from '../training/modes/LearnerHand';
import { presetFor } from '../training/modes/Shadow';
import { shapeName, ShadowPuppets } from '../training/modes/ShadowPuppets';
import { shownProp, useShowProps } from '../../shared/sessionPrefs';
import { useMargin } from '../../shared/settings';

/** Calls in one round of Play. */
export const PLAY_CALLS = 5;
/** Seconds the call shows before the move is timed. */
const READY_MS = 2200;
/** Seconds a scored call stays up before the next one. */
const CALLED_MS = 2200;
/** Shortest and longest time a call is performed for, in seconds. */
const PERFORM_MIN_S = 3;
const PERFORM_MAX_S = 8;
/** Slack after the planned length when no glove frame ever arrives. */
const START_GRACE_MS = 2000;

type Phase = 'intro' | 'ready' | 'perform' | 'scoring' | 'called' | 'done';

interface CallResult {
  stepIndex: number;
  /** Null when no hand was seen during the call. */
  score: ScoreResult | null;
  clean: boolean;
}

/** The order of a round: every step once in a random order, repeated until the round is full, no step twice in a row. */
export function buildCalls(steps: number, calls = PLAY_CALLS, random: () => number = Math.random): number[] {
  if (steps <= 0) return [];
  const out: number[] = [];
  while (out.length < calls) {
    const order = Array.from({ length: steps }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (steps > 1 && out.length && order[0] === out[out.length - 1]) [order[0], order[1]] = [order[1], order[0]];
    out.push(...order);
  }
  return out.slice(0, calls);
}

/** The longest run of clean calls. */
export function longestStreak(clean: boolean[]): number {
  let best = 0;
  let run = 0;
  for (const c of clean) {
    run = c ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Route `/apprentice/lessons/:lessonId/play`: the last part of a course. A course with a premade game plays that game. */
export function PlayPage() {
  const { lessonId } = useParams();
  const { data: lesson, loading, error, offline } = useLessonById(lessonId);
  if (loading) return <p className="note ap-state">Setting up the round...</p>;
  if (error || !lesson) {
    return (
      <div className="ap-state">
        <PageHeader title="Lesson not found" />
        <p className="note">{error?.message ?? 'That lesson does not exist.'}</p>
        <ButtonLink to="/apprentice" variant="secondary">
          Back to skills
        </ButtonLink>
      </div>
    );
  }
  if (lesson.test) return <Navigate replace to={`/apprentice/lessons/${lesson.id}/test`} />;
  return (
    <>
      <ApHeader title="Play" context={lesson.title} back={{ to: `/apprentice/lessons/${lesson.id}`, label: 'Back to syllabus' }} />
      {offline && <p className="note ap-banner">Backend offline: playing with the built-in demo lesson. Scores are estimated on this device.</p>}
      {lesson.steps.length ? <PlayRound lesson={lesson} /> : <p className="note ap-state">This course has no moves to play yet.</p>}
    </>
  );
}

function PlayRound({ lesson }: { lesson: Lesson }) {
  const [calls, setCalls] = useState(() => buildCalls(lesson.steps.length));
  const [phase, setPhase] = useState<Phase>('intro');
  const [at, setAt] = useState(0);
  const [results, setResults] = useState<CallResult[]>([]);
  const [record, setRecord] = useState<PlayRecord | null>(() => playRecord(lesson.id));
  const [newBest, setNewBest] = useState(false);

  const stepIndex = calls[Math.min(at, calls.length - 1)];
  const step = lesson.steps[stepIndex];
  const side = stepSide(step);
  const gloves = useGloveStream(true);
  const { track } = useReferenceTrack(step, side);
  const [margin] = useMargin();
  const [showProps] = useShowProps();
  const config = useMemo(() => configFromTolerance(step.tolerance, margin, step.weights), [step.tolerance, margin, step.weights]);
  const recordStart = useRef<() => void>(() => {});
  const coach = useCoach({ track, gloves, side, config, mode: 'flow', clumsy: false, onRecordStart: () => recordStart.current() });
  const performS = track ? Math.min(PERFORM_MAX_S, Math.max(PERFORM_MIN_S, track.period)) : PERFORM_MIN_S;

  // The simulator glove performs the called move, so the round plays end to end without hardware.
  useEffect(() => {
    if (step.motion) gloves.setMotion(step.motion);
  }, [step.motion, gloves, gloves.status]);

  const endTimer = useRef<number | null>(null);
  const clearEnd = () => {
    if (endTimer.current !== null) window.clearTimeout(endTimer.current);
    endTimer.current = null;
  };
  useEffect(() => clearEnd, []);

  const finishCall = useCallback(async () => {
    clearEnd();
    recordStart.current = () => {};
    setPhase('scoring');
    const stats = coach.end();
    const frames = coach.frames().slice();
    let score: ScoreResult | null = null;
    if (checkAttempt(frames, performS * 0.6).ok) {
      score = { ...localScore(stats, config), margin };
      const sideField = step.hands === 'left' || step.hands === 'right' ? { side: step.hands } : {};
      const req: ScoreRequest | null = step.reference_recording_id
        ? { reference_recording_id: step.reference_recording_id, attempt_frames: frames, tolerance: step.tolerance, margin, ...sideField }
        : step.motion
          ? { reference_motion: step.motion, attempt_frames: frames, tolerance: step.tolerance, margin, ...sideField }
          : null;
      if (req) score = await api.score(req).catch(() => score);
    }
    setResults((r) => [...r, { stepIndex, score, clean: score ? isClean(score) : false }]);
    setPhase('called');
  }, [coach, config, margin, performS, step, stepIndex]);

  // Ready: show the call, then time the move from its first recorded frame (a simulator waits for its beat).
  useEffect(() => {
    if (phase !== 'ready' || !track) return;
    const id = window.setTimeout(() => {
      const arm = (ms: number) => {
        clearEnd();
        endTimer.current = window.setTimeout(() => void finishCall(), ms);
      };
      recordStart.current = () => {
        recordStart.current = () => {};
        arm(performS * 1000);
      };
      arm(performS * 1000 + track.period * 1000 + START_GRACE_MS);
      coach.begin();
      setPhase('perform');
    }, READY_MS);
    return () => window.clearTimeout(id);
  }, [phase, track, coach, performS, finishCall]);

  // Called: the result stays up, then the next call, or the end of the round.
  useEffect(() => {
    if (phase !== 'called') return;
    const id = window.setTimeout(() => {
      if (at + 1 < calls.length) {
        setAt(at + 1);
        setPhase('ready');
      } else {
        setPhase('done');
      }
    }, CALLED_MS);
    return () => window.clearTimeout(id);
  }, [phase, at, calls.length]);

  // Done: store the round once.
  const stored = useRef(false);
  useEffect(() => {
    if (phase !== 'done' || stored.current) return;
    stored.current = true;
    const avg = results.reduce((n, r) => n + (r.score?.overall ?? 0), 0) / Math.max(1, results.length);
    const out = recordPlayRound(lesson.id, avg, longestStreak(results.map((r) => r.clean)));
    setRecord(out.record);
    setNewBest(out.newBest);
  }, [phase, results, lesson.id]);

  const startRound = () => {
    if (phase === 'done') setCalls(buildCalls(lesson.steps.length));
    stored.current = false;
    setResults([]);
    setAt(0);
    setNewBest(false);
    setPhase('ready');
  };

  const prop = shownProp(step.prop, showProps);
  const cue = showProps ? 'none' : (step.prop ?? 'none');
  const policy = useMemo(() => policyForStage('blind'), []);
  const theatre = lesson.skill === 'shadow_puppets';
  useHandPosition(skillUsesHandPosition(lesson.skill));
  const learner = useRef<HandHandle>(null);
  const running = phase === 'ready' || phase === 'perform' || phase === 'scoring' || phase === 'called';

  return (
    <div className="ap-play">
      <section className="card ap-play__call" aria-label="The call">
        {phase === 'intro' ? (
          <Intro lesson={lesson} record={record} onStart={startRound} />
        ) : phase === 'done' ? (
          <RoundOver lesson={lesson} results={results} record={record} newBest={newBest} onAgain={startRound} />
        ) : (
          <CallPanel lesson={lesson} at={at} calls={calls} results={results} phase={phase} coach={coach} performS={performS} />
        )}
      </section>
      <section className="ap-play__stage" aria-label="Your hand">
        {theatre ? (
          <ShadowPuppets coach={coach} gloves={gloves} side={side} prop="none" cue="none" policy={policy} toleranceDeg={config.fingerToleranceDeg} step={step} />
        ) : (
          <HandCanvas preset={presetFor(prop === 'none' ? cue : prop)} label="Your wooden hand, live from the glove">
            {prop === 'keyboard' && <Keyboard handRef={learner} />}
            <PropCue prop={cue} hand={learner} />
            <LearnerHand ref={learner} coach={coach} gloves={gloves} side={side} prop={prop} cue={cue} />
          </HandCanvas>
        )}
        <RecentreHandButton corner="top-left" />
        {!running && phase !== 'done' && <p className="ap-play__idle">Your hand, live from the glove. Move it to warm up.</p>}
      </section>
    </div>
  );
}

function Intro({ lesson, record, onStart }: { lesson: Lesson; record: PlayRecord | null; onStart: () => void }) {
  return (
    <div className="ap-play__intro">
      <h2>Try your skill in real time</h2>
      <p className="ap-play__lede">
        {PLAY_CALLS} moves from this course are called one after another, without the expert&rsquo;s hand. Make each one when it is called; your score fills
        as you hold it.
      </p>
      <p className="ap-play__moves">{lesson.steps.map((s) => shapeName(s)).join(', ')}</p>
      {record && (
        <p className="ap-play__best">
          Your best round: <span className="ap-num">{record.best}</span>. Longest clean streak: <span className="ap-num">{record.bestStreak}</span>.
        </p>
      )}
      <Button large onClick={onStart}>
        Start the round
      </Button>
    </div>
  );
}

function CallMarks({ calls, at, results }: { calls: number[]; at: number; results: CallResult[] }) {
  return (
    <span className="ap-play__marks" aria-hidden="true">
      {calls.map((_, i) => (
        <i key={i} className={i < results.length ? (results[i].clean ? 'is-clean' : 'is-done') : i === at ? 'is-now' : ''} />
      ))}
    </span>
  );
}

interface CallPanelProps {
  lesson: Lesson;
  at: number;
  calls: number[];
  results: CallResult[];
  phase: Phase;
  coach: Coach;
  performS: number;
}

function CallPanel({ lesson, at, calls, results, phase, coach, performS }: CallPanelProps) {
  const step = lesson.steps[calls[at]];
  const result = phase === 'called' ? results[results.length - 1] : null;
  const streak = (() => {
    let n = 0;
    for (let i = results.length - 1; i >= 0 && results[i].clean; i--) n++;
    return n;
  })();
  return (
    <div className="ap-play__now" aria-live="polite">
      <p className="ap-play__count">
        <span>
          Call <span className="ap-num">{at + 1}</span> of <span className="ap-num">{calls.length}</span>
        </span>
        <CallMarks calls={calls} at={at} results={results} />
      </p>
      <h2 className="ap-play__name">{shapeName(step)}</h2>
      <div className="ap-play__still">
        <KeyPoseStill motion={step.motion} prop={step.prop} side={stepSide(step)} title={step.title} />
      </div>
      <LiveScore coach={coach} phase={phase} result={result} performS={performS} />
      <p className="ap-play__streak">{streak >= 2 ? <>Streak: <span className="ap-num">{streak}</span> clean in a row</> : ' '}</p>
    </div>
  );
}

/** The score filling while the move is held: the mean of the live match, then the scorer's number for the call. */
function LiveScore({ coach, phase, result, performS }: { coach: Coach; phase: Phase; result: CallResult | null; performS: number }) {
  const view = useCoachView(coach);
  const sum = useRef({ total: 0, n: 0 });
  const [live, setLive] = useState(0);
  useEffect(() => {
    if (phase === 'ready') {
      sum.current = { total: 0, n: 0 };
      setLive(0);
      return;
    }
    if (phase !== 'perform' || !view.hasLearner) return;
    sum.current.total += view.score;
    sum.current.n += 1;
    setLive(sum.current.total / sum.current.n);
  }, [view, phase]);

  const shown = result ? Math.round(result.score?.overall ?? 0) : Math.round(live);
  const line =
    phase === 'ready'
      ? 'Get ready.'
      : phase === 'perform'
        ? `Now. Hold it for ${Math.round(performS)} seconds.`
        : phase === 'scoring'
          ? 'Scoring...'
          : !result?.score
            ? 'No hand was seen. Check the glove for the next call.'
            : result.clean
              ? 'Clean.'
              : result.score.hint;
  return (
    <div className={`ap-play__meter ${result?.clean ? 'is-clean' : ''}`}>
      <div className="ap-play__meterhead">
        <span>Live score</span>
        <span className="ap-play__val ap-num">{phase === 'ready' ? '0' : shown}</span>
      </div>
      <span className="ap-bar__track" role="meter" aria-label="Live score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase === 'ready' ? 0 : shown}>
        <span className="ap-bar__fill ap-play__fill" style={{ width: `${phase === 'ready' ? 0 : shown}%` }} />
      </span>
      <p className="ap-play__line">{line}</p>
    </div>
  );
}

function RoundOver({ lesson, results, record, newBest, onAgain }: { lesson: Lesson; results: CallResult[]; record: PlayRecord | null; newBest: boolean; onAgain: () => void }) {
  const clean = results.filter((r) => r.clean).length;
  const avg = Math.round(results.reduce((n, r) => n + (r.score?.overall ?? 0), 0) / Math.max(1, results.length));
  const streak = longestStreak(results.map((r) => r.clean));
  return (
    <div className="ap-play__over">
      <h2>Round over</h2>
      <p className="ap-play__result">
        <span className="ap-num">{clean}</span> of <span className="ap-num">{results.length}</span> calls clean, average <span className="ap-num">{avg}</span>.
        {streak >= 2 && (
          <>
            {' '}
            Longest streak <span className="ap-num">{streak}</span>.
          </>
        )}
      </p>
      {record && <p className="ap-play__best">{newBest ? 'A new best round.' : <>Your best round: <span className="ap-num">{record.best}</span>.</>}</p>}
      <ol className="ap-play__list">
        {results.map((r, i) => (
          <li key={i} className={r.clean ? 'is-clean' : ''}>
            <span>{shapeName(lesson.steps[r.stepIndex])}</span>
            <span className="ap-num">{r.score ? Math.round(r.score.overall) : 'no hand'}</span>
          </li>
        ))}
      </ol>
      <div className="ap-play__actions">
        <Button large onClick={onAgain}>
          Play another round
        </Button>
        <ButtonLink variant="secondary" to={`/apprentice/lessons/${lesson.id}`}>
          Back to the course
        </ButtonLink>
      </div>
    </div>
  );
}
