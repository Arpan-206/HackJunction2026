import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useGloveStream, type Lesson, type ScoreRequest, type ScoreResult, type Side, type Step } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { ApHeader } from '../ApHeader';
import { Button, ButtonLink, Countdown, Disclosure } from '../../../components/ui';
import { useLessonById } from '../hooks/useLessonData';
import { recordAttempt } from '../hooks/useProgress';
import { CalibrationPanel } from '../../shared/CalibrationPanel';
import { useCalibration } from '../../shared/useCalibration';
import { PropSwitch } from '../../shared/PropSwitch';
import { shownProp, useShowProps } from '../../shared/sessionPrefs';
import { MARGIN_INFO, roomFor, useMargin } from '../../shared/settings';
import { combineHandScores } from './coach/twoHands';
import { stepSide, useReferenceTrack } from '../hooks/useReferenceTrack';
import { useGuidance } from '../hooks/useGuidanceMode';
import { configFromTolerance } from './coach/deviation';
import { localScore } from './coach/localScore';
import { attemptRetryLine, checkAttempt } from './coach/attemptGuard';
import { useCoach, type PracticeMode } from './coach/useCoach';
import { goalLine, repLine } from '../pipeline/coachLines';
import { isDemo, isDev } from '../pipeline/flags';
import type { RepOutcome } from '../pipeline/stages';
import { PlanCard } from '../course/PlanCard';
import { usePracticePlan } from '../hooks/usePracticePlan';
import { StageLadder } from './StageLadder';
import { useStepPipeline } from './useStepPipeline';
import { CoachPanel } from './CoachPanel';
import { FingerSummary } from './FingerSummary';
import { GuidanceModeSwitch } from './GuidanceModeSwitch';
import { GhostOverlay } from './modes/GhostOverlay';
import { Marionette } from './modes/Marionette';
import { Shadow } from './modes/Shadow';
import { ShadowPuppets } from './modes/ShadowPuppets';
import { SideBySide } from './modes/SideBySide';
import { Segmented } from './Segmented';
import { ScoreCard } from './ScoreCard';
import { preloadScoreScene } from './score/preload';
import { useRobotStream } from '../../../api/useRobotStream';
import type { HandStyle } from '../../../three';
import { RobotPanel } from '../../shared/robot/RobotPanel';
import { RobotTwin } from '../../shared/robot/RobotTwin';
import { useRobotPane } from '../../shared/robot/robotPrefs';
import '../../shared/robot/robot.css';

type Phase = 'ready' | 'countdown' | 'running' | 'scoring' | 'result';

const HAND_OPTIONS: { id: Side; label: string }[] = [
  { id: 'left', label: 'Left hand' },
  { id: 'right', label: 'Right hand' },
];

const PRACTICE_OPTIONS: { id: PracticeMode; label: string; hint: string }[] = [
  { id: 'follow', label: 'Follow', hint: 'The ghost waits at each checkpoint until you match it for half a second.' },
  { id: 'flow', label: 'Flow', hint: 'The ghost plays continuously, like the real thing.' },
];

const MAX_ATTEMPT_S = 14;
/** Where in the motion cycle the 3D score takes the hand's pose: past the middle, near a swing's contact. */
const SCORE_POSE_AT = 0.55;
/** Longest a Follow attempt may run once recording has started. */
const FOLLOW_CAP_MS = 60000;
/** Slack on top of one motion period before an attempt that never recorded a frame is ended. */
const START_GRACE_MS = 2000;

function attemptLength(period: number): number {
  return Math.min(MAX_ATTEMPT_S, Math.max(period, Math.round(6 / period) * period));
}

/**
 * The training room, the heart of the apprentice side: the master reference plays while the live glove hand follows it, in one
 * of four guidance modes. Guidance fades attempt by attempt, every attempt ends with a score, and the AI Assistant (when on) adds
 * a handwritten hint when one finger keeps missing.
 */
export function TrainingRoom() {
  const { lessonId, stepIndex } = useParams();
  const dev = useMemo(() => isDev(), []);
  const { data: lesson, loading, error, offline } = useLessonById(lessonId);
  const index = Number(stepIndex ?? 0);
  const step = lesson?.steps[index] ?? null;

  if (loading) return <p className="note ap-state">Setting up the studio...</p>;
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
  if (!step) {
    return (
      <div className="ap-state">
        <PageHeader title="Step not found" />
        <ButtonLink to={`/apprentice/lessons/${lesson.id}`} variant="secondary">
          Back to the lesson
        </ButtonLink>
      </div>
    );
  }
  return <Room key={`${lesson.id}:${step.id}`} lesson={lesson} lessonId={lesson.id} lessonTitle={lesson.title} step={step} index={index} total={lesson.steps.length} hasTest={Boolean(lesson.test)} dev={dev} offline={offline} />;
}

interface RoomProps {
  lesson: Lesson;
  lessonId: string;
  lessonTitle: string;
  step: Step;
  index: number;
  total: number;
  hasTest: boolean;
  dev: boolean;
  offline: boolean;
}

function Room({ lesson, lessonId, lessonTitle, step, index, total, hasTest, dev, offline }: RoomProps) {
  const navigate = useNavigate();
  const resultRef = useRef<HTMLDivElement>(null);
  const gloves = useGloveStream(true);
  const guidance = useGuidance();
  // A two-handed step coaches one hand at a time on the stage (the learner picks which); every rep scores both hands.
  const twoHanded = step.hands === 'both';
  // Shadow puppets are learnt on the wall: the lamp's shadow theatre replaces the guidance modes.
  const theatre = lesson.skill === 'shadow_puppets';
  const [coached, setCoached] = useState<Side>(stepSide(step));
  const side = twoHanded ? coached : stepSide(step);
  const [showProps] = useShowProps();
  const [margin] = useMargin();
  const config = useMemo(() => configFromTolerance(step.tolerance, margin), [step.tolerance, margin]);
  const room = roomFor(step.tolerance, margin);
  const { track, loading: refLoading, notice } = useReferenceTrack(step, side);
  const calibration = useCalibration(side);
  const calibrated = calibration.latest !== null;

  const [mode, setMode] = useState<PracticeMode>('flow');
  // The clumsy simulation starts on only when this very URL asks for ?dev=1; the remembered dev flag just offers the switch.
  const [clumsy, setClumsy] = useState(() => dev && new URLSearchParams(window.location.search).get('dev') === '1');
  const demo = useMemo(() => isDemo(), []);
  const pipe = useStepPipeline(lessonId, step, demo);
  const plan = usePracticePlan(lesson);
  const planRequest = useRef(plan.request);
  planRequest.current = plan.request;
  const [phase, setPhase] = useState<Phase>('ready');
  const [watchRate, setWatchRate] = useState(0.5);
  const playedSnap = useRef(0);
  const [result, setResult] = useState<{ score: ScoreResult; source: 'backend' | 'local'; outcome: RepOutcome } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const recordingId = useRef<string | null>(null);
  const endTimer = useRef<number | null>(null);

  const watching = pipe.stage === 'watch';
  // Before a rep starts (and during its countdown) the room is a rehearsal: hands and strings move, nothing is judged.
  const rehearsing = !watching && (phase === 'ready' || phase === 'countdown');
  const policy = useMemo(() => (rehearsing ? { ...pipe.policy, rehearsal: true } : pipe.policy), [pipe.policy, rehearsing]);

  const finishRef = useRef<() => void>(() => {});
  const recordStartRef = useRef<() => void>(() => {});
  const coach = useCoach({
    track,
    gloves,
    side,
    config,
    mode: watching ? 'flow' : mode,
    rate: watching ? watchRate : 1,
    clumsy,
    alsoRecord: twoHanded ? ['left', 'right'] : undefined,
    onFollowDone: () => finishRef.current(),
    onRecordStart: () => recordStartRef.current(),
  });

  // The robot twin beside the stage: a Dex3-1 that follows whoever the engine's source names, with strings from the
  // human hand it copies (the lesson's expert, or the live glove the coach sees).
  const [robotPane, setRobotPane] = useRobotPane();
  const robot = useRobotStream(robotPane);
  const robotSource = robot.source ?? 'off';
  const robotHuman = {
    side,
    style: (robotSource === 'learner' ? 'wood' : 'chalk') as HandStyle,
    live: gloves.latest,
    getFrame: () => (robotSource === 'lesson' ? coach.live.current.master : coach.live.current.learner),
    label: robotSource === 'lesson' ? 'The lesson' : robotSource === 'master' ? 'The expert' : 'You',
  };
  const robotDecoupled = typeof window !== 'undefined' && window.__apprenticeMock === true && !robot.mock;

  useEffect(() => {
    if (step.motion) gloves.setMotion(step.motion);
  }, [step.motion, gloves, gloves.status]);

  useEffect(preloadScoreScene, []);

  // Watch: two loops at half speed, then full speed. Nothing is scored.
  const period = Math.max(1, track?.period ?? 1);
  useEffect(() => {
    if (!watching || !track) return;
    setWatchRate(0.5);
    const id = window.setTimeout(() => setWatchRate(1), Math.min(24, (2 * period) / 0.5) * 1000);
    return () => window.clearTimeout(id);
  }, [watching, track, period]);

  const finish = useCallback(async () => {
    if (endTimer.current !== null) window.clearTimeout(endTimer.current);
    endTimer.current = null;
    setPhase('scoring');
    const stats = coach.end();
    const local: ScoreResult = { ...localScore(stats, config), margin };
    let score = local;
    let source: 'backend' | 'local' = 'local';
    const id = recordingId.current;
    recordingId.current = null;
    const frames = coach.frames().slice();
    // Never score a near-empty rep: it would be judged on a fraction of a second and could even count as clean.
    const check = checkAttempt(frames, mode === 'flow' && track ? attemptLength(track.period) : 0);
    if (!check.ok) {
      if (id) void api.stopRecording(id).catch(() => undefined);
      setProblem(attemptRetryLine(check));
      setPhase('ready');
      return;
    }
    try {
      if (id) await api.stopRecording(id).catch(() => undefined);
      const attempt = frames.length > 2 ? { attempt_frames: frames, ...(id ? { attempt_recording_id: id } : {}) } : id ? { attempt_recording_id: id } : null;
      const sideField = step.hands === 'left' || step.hands === 'right' ? { side: step.hands } : {};
      const req: ScoreRequest | null =
        attempt && step.reference_recording_id
          ? { reference_recording_id: step.reference_recording_id, ...attempt, tolerance: step.tolerance, margin, ...sideField, ...(calibrated ? { use_latest_calibration: true } : {}) }
          : attempt && step.motion
            ? { reference_motion: step.motion, ...attempt, tolerance: step.tolerance, margin, ...sideField, ...(calibrated ? { use_latest_calibration: true } : {}) }
            : null;
      if (req && twoHanded) {
        // The scorer judges one hand per call: score each hand, then keep the weaker hand's result (see combineHandScores).
        const [l, r] = await Promise.allSettled([api.score({ ...req, side: 'left' }), api.score({ ...req, side: 'right' })]);
        const both = combineHandScores({ left: l.status === 'fulfilled' ? l.value : undefined, right: r.status === 'fulfilled' ? r.value : undefined });
        if (!both) throw l.status === 'rejected' ? l.reason : new Error('no hand could be scored');
        score = both;
        source = 'backend';
      } else if (req) {
        score = await api.score(req);
        source = 'backend';
      }
    } catch (e) {
      setProblem(`The scoring service did not answer (${e instanceof Error ? e.message : 'unknown error'}). Showing an estimate from this device.`);
    }
    recordAttempt(lessonId, step.id, score.overall);
    const outcome = pipe.submit(score);
    if (outcome.event === 'mastered') void planRequest.current();
    setResult({ score, source, outcome });
    setPhase('result');
  }, [coach, config, lessonId, step, calibrated, pipe, mode, track, twoHanded, margin]);
  finishRef.current = () => {
    if (phase === 'running') void finish();
  };

  const startAttempt = useCallback(async () => {
    setProblem(null);
    setResult(null);
    recordingId.current = null;
    try {
      const rec = await api.startRecording({ lesson_id: lessonId, step_id: step.id, hands: step.hands });
      recordingId.current = rec.recording_id;
    } catch {
      setProblem('Recording is unavailable (the backend is not answering). The attempt is still coached and scored on this device.');
    }
    // The attempt is timed from its first recorded frame, not from here: a phase-locked simulator waits for the next beat
    // of the reference (up to one motion period) before anything is recorded.
    const lengthMs = mode === 'flow' && track ? attemptLength(track.period) * 1000 : FOLLOW_CAP_MS;
    const arm = (ms: number) => {
      if (endTimer.current !== null) window.clearTimeout(endTimer.current);
      endTimer.current = window.setTimeout(() => void finishRef.current(), ms);
    };
    recordStartRef.current = () => {
      recordStartRef.current = () => {};
      arm(lengthMs);
    };
    // Fallback when no frame ever arrives (no glove): end after the longest possible wait plus the attempt itself.
    arm(lengthMs + (track ? track.period * 1000 : 0) + START_GRACE_MS);
    coach.begin();
    setPhase('running');
  }, [coach, lessonId, mode, step.id, step.hands, track]);

  useEffect(
    () => () => {
      if (endTimer.current !== null) window.clearTimeout(endTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (phase === 'result') resultRef.current?.scrollIntoView({ block: 'start' });
  }, [phase]);

  const onCountdownDone = useCallback(() => void startAttempt(), [startAttempt]);

  const stageProps = {
    coach,
    gloves,
    side,
    prop: shownProp(step.prop, showProps),
    cue: showProps ? 'none' : (step.prop ?? 'none'),
    policy,
    toleranceDeg: config.toleranceDeg,
    combo: { count: pipe.machine.combo, need: pipe.cfg.cleanReps, snapKey: pipe.snapKey, played: playedSnap },
  };
  const goal = pipe.review ? 'Review: one blind try, no help.' : goalLine(pipe.last, pipe.stage);
  const nextTo = index + 1 < total ? `/apprentice/lessons/${lessonId}/steps/${index + 1}` : hasTest ? `/apprentice/lessons/${lessonId}/test` : `/apprentice/lessons/${lessonId}`;
  const nextLabel = index + 1 < total ? 'Next lesson' : hasTest ? 'Test your skills' : 'Finish';
  const busy = phase === 'countdown' || phase === 'running' || phase === 'scoring';
  const calPanel = (
    <CalibrationPanel
      side={side}
      onSide={() => undefined}
      cal={calibration}
      compact
      hideSide
      title="Calibrate your glove"
      missingNote="Not calibrated yet. Scores assume an average hand until you do."
    />
  );

  return (
    <div className="ap-room">
      <ApHeader title={step.title} context={lessonTitle} back={{ to: `/apprentice/lessons/${lessonId}`, label: 'Back to syllabus' }} />
      {offline && <p className="note ap-banner">Backend offline: practising with the built-in demo lesson. Scores are estimated on this device.</p>}
      {notice && <p className="note ap-banner">{notice}</p>}

      {phase === 'result' && result ? (
        <div ref={resultRef}>
          <ScoreCard
            result={result.score}
            source={result.source}
            pose={track ? track.handAt(track.period * SCORE_POSE_AT) : null}
            side={side}
            tolerance={step.tolerance}
            attempt={pipe.reps}
            lines={{ rep: repLine(result.score), stage: pipe.lines.stage, set: pipe.lines.set }}
            clean={result.outcome.clean}
            combo={{ count: result.outcome.event === 'none' || result.outcome.event === 'set_done' ? result.outcome.state.combo : pipe.cfg.cleanReps, need: pipe.cfg.cleanReps }}
            retryLabel="Next rep"
            restartLabel="Restart from the strings"
            footer={result.outcome.event === 'mastered' ? <PlanCard lesson={lesson} /> : undefined}
            onRetry={() => setPhase('ready')}
            onRestart={() => {
              pipe.restart();
              setPhase('ready');
            }}
            nextLabel={nextLabel}
            onNext={() => navigate(nextTo)}
            planTo={`/apprentice/lessons/${lessonId}#plan`}
          />
        </div>
      ) : (
      <div className="ap-room__grid">
        <section className="ap-stage" aria-label="Training stage">
          <div className={`ap-stage__row ${robotPane ? 'ap-stage__row--twin' : ''}`}>
            <div className="ap-stage__canvas">
              {refLoading || !track ? (
                <p className="note ap-state">Loading the expert's recording...</p>
              ) : theatre ? (
                <ShadowPuppets {...stageProps} step={step} />
              ) : guidance === 'marionette' ? (
                <Marionette {...stageProps} />
              ) : guidance === 'shadow' ? (
                <Shadow {...stageProps} />
              ) : guidance === 'ghost' ? (
                <GhostOverlay {...stageProps} />
              ) : (
                <SideBySide {...stageProps} />
              )}
            </div>
            {robotPane && (
              <div className="ap-stage__canvas ap-stage__canvas--robot">
                <RobotTwin robot={robot} human={robotHuman} decoupled={robotDecoupled} label="The Dex3-1 robot hand beside the hand that drives it, with a string to each fingertip" />
              </div>
            )}
          </div>
          <FingerSummary coach={coach} policy={policy} />
          <p className="ap-stage__cap">
            {phase === 'running' && <span className="ap-stage__dot" aria-hidden="true" />}
            {phase === 'running' ? `Recording rep ${pipe.reps + 1}. ` : watching ? `Watch, ${watchRate < 1 ? 'half speed' : 'full speed'}. ` : ''}
            {policy.blurb}
            {watching && track && track.source !== 'recording' && ' A sample guide plays the expert here.'}
          </p>
        </section>

        <aside className="ap-side" aria-label="Controls and coaching">
          <div className="card ap-panel">
            <StageLadder machine={pipe.machine} cfg={pipe.cfg} review={pipe.review} goal={goal} />
            <p className="ap-instruction">{step.instruction}</p>
            {twoHanded && (
              <div className="ap-field">
                <span className="ap-field__label">Two hands</span>
                {busy ? (
                  <p className="ap-field__hint">Coaching your {coached} hand this rep.</p>
                ) : (
                  <Segmented label="Coached hand" value={coached} options={HAND_OPTIONS} onChange={setCoached} />
                )}
                <p className="note ap-field__hint">The stage coaches one hand at a time. Every rep scores both, and the weaker hand sets the score.</p>
              </div>
            )}
            <p className="ap-tolerance">
              Room for error: <span className="ap-num">{room.angle}&deg;</span> per finger, <span className="ap-num">{room.timing}</span> ms of timing
              {MARGIN_INFO[margin].room}
            </p>
            <div className="ap-actions">
              {phase === 'running' ? (
                <Button large variant="secondary" onClick={() => void finish()}>
                  Finish attempt
                </Button>
              ) : watching ? (
                <Button large disabled={!track} onClick={pipe.endWatch}>
                  Start with the strings
                </Button>
              ) : (
                phase !== 'result' && (
                  <Button large disabled={busy || !track} onClick={() => setPhase('countdown')}>
                    {`Begin rep ${pipe.reps + 1}`}
                  </Button>
                )
              )}
              {phase === 'scoring' && <p className="note">Scoring your attempt...</p>}
              {problem && <p className="note ap-banner">{problem}</p>}
            </div>
          </div>

          <div className="card ap-panel">
            <CoachPanel coach={coach} policy={policy} mode={mode} running={phase === 'running' || phase === 'scoring'} />
          </div>

          {robotPane && (
            <div className="card ap-panel" aria-label="Robot hand">
              <RobotPanel robot={robot} compact />
            </div>
          )}

          {/* Calibration is prominent only while the glove has never been calibrated; after that it lives in the settings. */}
          {!calibration.loading && !calibrated && calPanel}

          <Disclosure summary="Room settings" className="ap-settings">
            {(calibration.loading || calibrated) && calPanel}
            {theatre ? <p className="note ap-field__hint">Shadow puppets are always shown on the wall: the expert's shadow on the left, yours on the right.</p> : <GuidanceModeSwitch />}
            <PropSwitch prop={step.prop} />
            <label className="ap-toggle">
              <input type="checkbox" checked={robotPane} onChange={(e) => setRobotPane(e.target.checked)} />
              <span>Show the robot hand</span>
              <span className="note">a Dex3-1 twin follows the glove beside the stage</span>
            </label>
            <div className="ap-field">
              <span className="ap-field__label">Practice</span>
              <Segmented label="Practice mode" value={mode} options={PRACTICE_OPTIONS} onChange={setMode} />
              <p className="note ap-field__hint">{PRACTICE_OPTIONS.find((o) => o.id === mode)?.hint}</p>
            </div>
            {dev && (
              <label className="ap-toggle ap-toggle--dev">
                <input type="checkbox" checked={clumsy} onChange={(e) => setClumsy(e.target.checked)} />
                <span>Simulate a clumsy apprentice</span>
                <span className="note">ring finger lags 300 ms, under-curls 25&deg;</span>
              </label>
            )}
          </Disclosure>
        </aside>
      </div>
      )}

      {phase === 'countdown' && <Countdown from={3} onDone={onCountdownDone} caption={mode === 'follow' ? 'Match the ghost, then hold.' : 'Move with the expert.'} />}

    </div>
  );
}
