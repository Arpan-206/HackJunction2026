import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, FINGERS, useGloveStream, type ScoreResult, type Step } from '../../../api';
import { PageHeader } from '../../../components/PageHeader';
import { Badge, Button, ButtonLink, Countdown } from '../../../components/ui';
import { useLessonById } from '../hooks/useLessonData';
import { recordAttempt } from '../hooks/useProgress';
import { stepSide, useReferenceTrack } from '../hooks/useReferenceTrack';
import { useGuidance } from '../hooks/useGuidanceMode';
import { configFromTolerance } from './coach/deviation';
import { policyFor } from './coach/fade';
import { localScore } from './coach/localScore';
import { FINGER_LABEL } from './coach/tips';
import { useAiHint } from './coach/useAiHint';
import { useCoach, type PracticeMode } from './coach/useCoach';
import { CoachPanel } from './CoachPanel';
import { FingerChips } from './FingerChips';
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
  const [params] = useSearchParams();
  const dev = params.get('dev') === '1';
  const { data: lesson, loading, error, offline } = useLessonById(lessonId);
  const index = Number(stepIndex ?? 0);
  const step = lesson?.steps[index] ?? null;

  if (loading) return <p className="note ap-state">Setting up the studio...</p>;
  if (error || !lesson) {
    return (
      <div className="ap-state">
        <PageHeader kicker="L'apprendista" title="Lesson not found" />
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
        <PageHeader kicker="L'apprendista" title="Step not found" />
        <ButtonLink to={`/apprentice/lessons/${lesson.id}`} variant="secondary">
          Back to the lesson
        </ButtonLink>
      </div>
    );
  }
  return <Room key={`${lesson.id}:${step.id}`} lessonId={lesson.id} lessonTitle={lesson.title} step={step} index={index} total={lesson.steps.length} hasTest={Boolean(lesson.test)} dev={dev} offline={offline} />;
}

interface RoomProps {
  lessonId: string;
  lessonTitle: string;
  step: Step;
  index: number;
  total: number;
  hasTest: boolean;
  dev: boolean;
  offline: boolean;
}

function Room({ lessonId, lessonTitle, step, index, total, hasTest, dev, offline }: RoomProps) {
  const navigate = useNavigate();
  const resultRef = useRef<HTMLDivElement>(null);
  const gloves = useGloveStream(true);
  const guidance = useGuidance();
  const side = stepSide(step);
  const config = useMemo(() => configFromTolerance(step.tolerance), [step.tolerance]);
  const { track, loading: refLoading, notice } = useReferenceTrack(step);

  const [mode, setMode] = useState<PracticeMode>('flow');
  const [clumsy, setClumsy] = useState(dev);
  const [aiOn, setAiOn] = useState(true);
  const [phase, setPhase] = useState<Phase>('ready');
  const [attempt, setAttempt] = useState(1);
  const [result, setResult] = useState<{ score: ScoreResult; source: 'backend' | 'local'; liveNote: string | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const recordingId = useRef<string | null>(null);
  const endTimer = useRef<number | null>(null);

  const ai = useAiHint({ enabled: aiOn, stepId: step.id, instruction: step.instruction, toleranceDeg: config.toleranceDeg, timingMs: config.timingMs });
  const policy = policyFor(attempt);

  const finishRef = useRef<() => void>(() => {});
  const coach = useCoach({
    track,
    gloves,
    side,
    config,
    mode,
    clumsy,
    onSustainedOff: (info) => {
      if (phase === 'running' && policy.liveCoach) void ai.request(info);
    },
    onFollowDone: () => finishRef.current(),
  });

  useEffect(() => {
    if (step.motion) gloves.setMotion(step.motion);
  }, [step.motion, gloves, gloves.status]);

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
    if (id) {
      try {
        await api.stopRecording(id);
        const req = step.reference_recording_id
          ? { reference_recording_id: step.reference_recording_id, attempt_recording_id: id, tolerance: step.tolerance }
          : step.motion
            ? { reference_motion: step.motion, attempt_recording_id: id, tolerance: step.tolerance }
            : null;
        if (req) {
          score = await api.score(req);
          source = 'backend';
        }
      } catch (e) {
        setProblem(`The scoring service did not answer (${e instanceof Error ? e.message : 'unknown error'}). Showing an estimate from this device.`);
      }
    }
    recordAttempt(lessonId, step.id, score.overall);
    const missed = FINGERS.filter((f) => stats.inTolerance[f] < 0.7);
    const liveNote = missed.length ? `The live coach saw ${missed.map((f) => FINGER_LABEL[f].toLowerCase()).join(' and ')} outside the tolerance for most of the attempt.` : null;
    setResult({ score, source, liveNote });
    setPhase('result');
  }, [coach, config, lessonId, step]);
  finishRef.current = () => {
    if (phase === 'running') void finish();
  };

  const startAttempt = useCallback(async () => {
    setProblem(null);
    setResult(null);
    ai.clear();
    recordingId.current = null;
    try {
      const rec = await api.startRecording({ lesson_id: lessonId, step_id: step.id });
      recordingId.current = rec.recording_id;
    } catch {
      setProblem('Recording is unavailable (the backend is not answering). The attempt is still coached and scored on this device.');
    }
    coach.begin();
    setPhase('running');
    if (mode === 'flow' && track) endTimer.current = window.setTimeout(() => void finishRef.current(), attemptLength(track.period) * 1000);
    else endTimer.current = window.setTimeout(() => void finishRef.current(), 60000);
  }, [ai, coach, lessonId, mode, step.id, track]);

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

  const stageProps = { coach, gloves, side, prop: step.prop, policy };
  const nextTo = index + 1 < total ? `/apprentice/lessons/${lessonId}/steps/${index + 1}` : hasTest ? `/apprentice/lessons/${lessonId}/test` : `/apprentice/lessons/${lessonId}`;
  const nextLabel = index + 1 < total ? 'Next lesson' : hasTest ? 'Test your skills' : 'Finish';
  const busy = phase === 'countdown' || phase === 'running' || phase === 'scoring';

  return (
    <div className="ap-room">
      <PageHeader
        kicker={lessonTitle}
        title={step.title}
        actions={
          <Link className="ap-back" to={`/apprentice/lessons/${lessonId}`}>
            Back to syllabus
          </Link>
        }
      />
      {offline && <p className="note ap-banner">Backend offline: practising with the built-in demo lesson. Scores are estimated on this device.</p>}
      {notice && <p className="note ap-banner">{notice}</p>}

      <div className="ap-room__grid">
        <section className="ap-stage" aria-label="Training stage">
          <div className="ap-stage__canvas">
            {refLoading || !track ? (
              <p className="note ap-state">Loading the master's recording...</p>
            ) : guidance === 'marionette' ? (
              <Marionette {...stageProps} />
            ) : guidance === 'shadow' ? (
              <Shadow {...stageProps} />
            ) : guidance === 'ghost' ? (
              <GhostOverlay {...stageProps} />
            ) : (
              <SideBySide {...stageProps} />
            )}
            <div className="ap-stage__tags">
              <Badge tone={policy.attempt >= 3 ? 'neutral' : 'lapis'}>{policy.label}</Badge>
              <Badge tone={gloves.status === 'open' ? 'ok' : 'neutral'}>{gloves.status === 'open' ? 'Gloves live' : 'Gloves not linked'}</Badge>
              {track && <Badge>{track.source === 'recording' ? "Master's recording" : 'Mock guide'}</Badge>}
            </div>
            {phase === 'running' && (
              <p className="ap-stage__live" role="status">
                <span className="ap-stage__dot" aria-hidden="true" /> Recording attempt {attempt}
              </p>
            )}
          </div>
          {policy.liveCoach && guidance !== 'side_by_side' && <FingerChips coach={coach} policy={policy} />}
          <p className="note ap-stage__blurb">{policy.blurb}</p>
        </section>

        <aside className="ap-side" aria-label="Controls and coaching">
          <div className="card ap-panel">
            <p className="ap-kicker">Hand instruction</p>
            <p className="ap-instruction">{step.instruction}</p>
            <p className="ap-tolerance">
              Room for error: {config.toleranceDeg}&deg; per finger, {config.timingMs} ms of timing.
            </p>
            <div className="ap-actions">
              {phase === 'running' ? (
                <Button large variant="secondary" onClick={() => void finish()}>
                  Finish attempt
                </Button>
              ) : (
                phase !== 'result' && (
                  <Button large disabled={busy || !track} onClick={() => setPhase('countdown')}>
                    {`Begin attempt ${attempt}`}
                  </Button>
                )
              )}
              {phase === 'scoring' && <p className="note">Scoring your attempt...</p>}
              {problem && <p className="note ap-banner">{problem}</p>}
            </div>
          </div>

          <div className="card ap-panel">
            <CoachPanel coach={coach} policy={policy} mode={mode} running={phase === 'running'} />
            {aiOn && policy.liveCoach && (ai.hint || ai.pending) && (
              <blockquote className="ap-annot">
                <p className="note">{ai.pending && !ai.hint ? 'The coach is thinking...' : ai.hint?.text}</p>
                {ai.hint && <footer>Coach note, {ai.hint.provider}</footer>}
              </blockquote>
            )}
          </div>

          <div className="card ap-panel">
            <GuidanceModeSwitch />
            <div className="ap-field">
              <span className="ap-field__label">Practice</span>
              <Segmented label="Practice mode" value={mode} options={PRACTICE_OPTIONS} onChange={setMode} />
              <p className="note ap-field__hint">{PRACTICE_OPTIONS.find((o) => o.id === mode)?.hint}</p>
            </div>
            <label className="ap-toggle">
              <input type="checkbox" checked={aiOn} onChange={(e) => setAiOn(e.target.checked)} />
              <span>AI coach</span>
              <span className="note">adds a hint after 1.5 s of one finger missing</span>
            </label>
            {dev && (
              <label className="ap-toggle ap-toggle--dev">
                <input type="checkbox" checked={clumsy} onChange={(e) => setClumsy(e.target.checked)} />
                <span>Simulate a clumsy apprentice</span>
                <span className="note">ring finger lags 300 ms, under-curls 25&deg;</span>
              </label>
            )}
          </div>
        </aside>
      </div>

      {phase === 'countdown' && <Countdown from={3} onDone={onCountdownDone} caption={mode === 'follow' ? 'Match the ghost, then hold.' : 'Move with the master.'} />}

      {phase === 'result' && result && (
        <div ref={resultRef}>
        <ScoreCard
          result={result.score}
          source={result.source}
          liveNote={result.liveNote}
          attempt={attempt}
          onRetry={() => {
            setAttempt((a) => a + 1);
            setPhase('ready');
          }}
          onRestart={() => {
            setAttempt(1);
            setPhase('ready');
          }}
          nextLabel={nextLabel}
          onNext={() => navigate(nextTo)}
        />
        </div>
      )}
    </div>
  );
}
