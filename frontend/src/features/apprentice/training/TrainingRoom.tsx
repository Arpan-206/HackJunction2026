import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useGloveStream, type Lesson, type ScoreResult, type Step } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { ApHeader } from '../ApHeader';
import { Button, ButtonLink, Countdown, Disclosure } from '../../../components/ui';
import { useLessonById } from '../hooks/useLessonData';
import { recordAttempt } from '../hooks/useProgress';
import { CalibrationPanel } from '../../shared/CalibrationPanel';
import { useCalibration } from '../../shared/useCalibration';
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
import { SideBySide } from './modes/SideBySide';
import { Segmented } from './Segmented';
import { ScoreCard } from './ScoreCard';

type Phase = 'ready' | 'countdown' | 'running' | 'scoring' | 'result';

const PRACTICE_OPTIONS: { id: PracticeMode; label: string; hint: string }[] = [
  { id: 'follow', label: 'Follow', hint: 'The ghost waits at each checkpoint until you match it for half a second.' },
  { id: 'flow', label: 'Flow', hint: 'The ghost plays continuously, like the real thing.' },
];

const MAX_ATTEMPT_S = 14;
/** Longest a Follow attempt may run once recording has started. */
const FOLLOW_CAP_MS = 60000;
/** Slack on top of one motion period before an attempt that never recorded a frame is ended. */
const START_GRACE_MS = 2000;

function attemptLength(period: number): number {
  return Math.min(MAX_ATTEMPT_S, Math.max(period, Math.round(6 / period) * period));
}

/**
 * The training room, the heart of the apprentice side: the master reference plays while the live glove hand follows it, in one
 * of four guidance modes. Guidance fades attempt by attempt, every attempt ends with a score, and an optional AI coach adds
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
          Back to lessons
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
  const side = stepSide(step);
  const config = useMemo(() => configFromTolerance(step.tolerance), [step.tolerance]);
  const { track, loading: refLoading, notice } = useReferenceTrack(step);
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
    onFollowDone: () => finishRef.current(),
    onRecordStart: () => recordStartRef.current(),
  });

  useEffect(() => {
    if (step.motion) gloves.setMotion(step.motion);
  }, [step.motion, gloves, gloves.status]);

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
    const local = localScore(stats, config);
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
      const req =
        attempt && step.reference_recording_id
          ? { reference_recording_id: step.reference_recording_id, ...attempt, tolerance: step.tolerance, ...sideField, ...(calibrated ? { use_latest_calibration: true } : {}) }
          : attempt && step.motion
            ? { reference_motion: step.motion, ...attempt, tolerance: step.tolerance, ...sideField, ...(calibrated ? { use_latest_calibration: true } : {}) }
            : null;
      if (req) {
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
  }, [coach, config, lessonId, step, calibrated, pipe, mode, track]);
  finishRef.current = () => {
    if (phase === 'running') void finish();
  };

  const startAttempt = useCallback(async () => {
    setProblem(null);
    setResult(null);
    recordingId.current = null;
    try {
      const rec = await api.startRecording({ lesson_id: lessonId, step_id: step.id });
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
  }, [coach, lessonId, mode, step.id, track]);

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
    prop: step.prop,
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
          <div className="ap-stage__canvas">
            {refLoading || !track ? (
              <p className="note ap-state">Loading the expert's recording...</p>
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
            <p className="ap-tolerance">
              Room for error: <span className="ap-num">{config.toleranceDeg}&deg;</span> per finger, <span className="ap-num">{config.timingMs}</span> ms of timing.
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

          {/* Calibration is prominent only while the glove has never been calibrated; after that it lives in the settings. */}
          {!calibration.loading && !calibrated && calPanel}

          <Disclosure summary="Room settings" className="ap-settings">
            {(calibration.loading || calibrated) && calPanel}
            <GuidanceModeSwitch />
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
