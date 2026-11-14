import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Finger, type GloveFrame, type HandFrame, type Lesson, type ScoreResult, type Side } from '../../../api';
import { Button } from '../../../components/ui';
import { anglesFromHand, handFromTargets, Retargeter, ROBOT_CONFIG } from '../../../mock/robot';
import { synthesise } from '../../../mock/synth';
import { loadRobotModels, type RobotModels } from '../../../three/robot';
import { prefersReducedMotion } from '../settings';
import { FINGER_NAME, modelName, type Tone } from './logic';
import { RobotStage } from './RobotStage';
import './robot.css';

/**
 * "Teach the robot" (research/12 section 7.2): the expert's lesson is played through the robot twin and the robot's
 * copy is scored like a learner's attempt.
 *
 * The honest path, and why: the copy is worked out in the browser with mock/robot.ts, the port of core/robot.py pinned
 * to the core's own numbers, because the core's `lesson` source plays the core's own lesson files, not these backend
 * lessons. Each reference frame is retargeted, clamped to the Dex3-1 limits, and turned back into a hand (ring and
 * little stay straight: the robot has none). That copy goes to the same POST /score the learner's attempts use (the
 * backend scorer, or its browser port in mock mode), against the same reference. So the score measures exactly what the
 * robot loses: its missing fingers, its two-joint fingers and its joint limits.
 */

const FPS = 60;
const MIN_S = 3;
const MAX_S = 8;
const PASS = 80;
const MASTERY = 90;

type Phase = 'idle' | 'playing' | 'result' | 'error';

interface Copy {
  side: Side;
  ref: GloveFrame[];
  q: Record<string, number>[];
  attempt: GloveFrame[];
  duration: number;
  /** Fingers that hit a joint limit at some point of the lesson. */
  clipped: Set<Finger>;
}

/** The expert's frames for a step: the stored recording, or the step's motion through the synthesiser port. */
async function referenceFrames(lesson: Lesson, stepIndex: number, side: Side): Promise<{ frames: GloveFrame[]; recording: boolean }> {
  const step = lesson.steps[stepIndex];
  if (step.reference_recording_id) {
    try {
      const rec = await api.recording(step.reference_recording_id);
      const frames = rec.frames.filter((f) => f.hands.some((h) => h.side === side));
      if (frames.length > 1) return { frames, recording: true };
    } catch {
      /* fall through to the motion, as the training room does */
    }
  }
  if (!step.motion) throw new Error('This lesson has no expert motion for the robot to copy.');
  const dur = Math.min(MAX_S, Math.max(MIN_S, durationHint(step.motion)));
  return { frames: synthesise(step.motion, side, dur, FPS), recording: false };
}

function durationHint(m: NonNullable<Lesson['steps'][number]['motion']>): number {
  if (m.preset === 'finger_sequence') return (m.beat_ms / 1000) * m.sequence.length;
  if (m.preset === 'grip_and_swing' || m.preset === 'pinch') return (m.beat_ms / 1000) * 3;
  return 4;
}

function makeCopy(frames: GloveFrame[], side: Side, models: RobotModels): Copy {
  const rt = new Retargeter(models);
  const q: Record<string, number>[] = [];
  const attempt: GloveFrame[] = [];
  const clipped = new Set<Finger>();
  const human = ROBOT_CONFIG.humanDofs;
  for (const f of frames) {
    const hand = f.hands.find((h) => h.side === side) as HandFrame;
    const t = rt.targets(anglesFromHand(hand), side);
    for (const [finger, fid] of Object.entries(t.fidelity) as [Finger, number][]) {
      const n = ROBOT_CONFIG.retarget.filter((e) => e.finger === finger).length;
      if (fid < Math.min(1, n / human[finger]) - 0.02) clipped.add(finger);
    }
    q.push(t.q);
    attempt.push({ t: f.t, source: f.source, hands: [handFromTargets(t.q, side, rt, hand)] });
  }
  const t0 = frames[0]?.t ?? 0;
  return { side, ref: frames, q, attempt, duration: Math.max(0.5, (frames.at(-1)?.t ?? 1) - t0), clipped };
}

function frameAtTime<T>(list: T[], times: GloveFrame[], t: number): T {
  const t0 = times[0].t;
  let i = 0;
  while (i < times.length - 1 && times[i + 1].t - t0 <= t) i++;
  return list[i];
}

interface Line {
  finger: Finger;
  text: string;
  tone: Tone;
}

function resultLines(score: ScoreResult, copy: Copy): Line[] {
  return (['thumb', 'index', 'middle', 'ring', 'little'] as Finger[]).map((f) => {
    const v = Math.round(score.per_finger[f]);
    const name = FINGER_NAME[f];
    if (!ROBOT_CONFIG.retarget.some((e) => e.finger === f)) return { finger: f, text: `${name}: the robot has no ${f} finger, so it stays straight (${v}).`, tone: 'missing' };
    if (copy.clipped.has(f) && v < PASS) return { finger: f, text: `${name} ${v}. Its joint limit cut the expert's bend short.`, tone: 'fix' };
    if (v >= PASS) return { finger: f, text: `${name} ${v}. Copied well.`, tone: 'ok' };
    const n = ROBOT_CONFIG.retarget.filter((e) => e.finger === f).length;
    return { finger: f, text: `${name} ${v}. It bends in ${n} joints where the expert bends ${ROBOT_CONFIG.humanDofs[f]}.`, tone: 'plain' };
  });
}

export interface TeachRobotProps {
  lesson: Lesson;
  stepIndex?: number;
}

/** The "Teach the robot" section: a button, the lesson played through the robot twin, and the robot's per-finger score. */
export function TeachRobot({ lesson, stepIndex = 0 }: TeachRobotProps) {
  const step = lesson.steps[stepIndex];
  const side: Side = step?.hands === 'left' ? 'left' : 'right';
  const [phase, setPhase] = useState<Phase>('idle');
  const [models, setModels] = useState<RobotModels | null>(null);
  const [copy, setCopy] = useState<Copy | null>(null);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const taut = useRef(true);
  const start = useRef(0);
  const run = useRef(0);

  useEffect(() => () => void (run.current += 1), []);

  const teach = useCallback(async () => {
    const id = ++run.current;
    setProblem(null);
    setScore(null);
    setPhase('playing');
    try {
      const [m, ref] = await Promise.all([loadRobotModels(), referenceFrames(lesson, stepIndex, side)]);
      if (id !== run.current) return;
      const c = makeCopy(ref.frames, side, m);
      setModels(m);
      setCopy(c);
      start.current = performance.now();
      const scoring = api.score({
        ...(ref.recording && step.reference_recording_id ? { reference_recording_id: step.reference_recording_id } : { reference_motion: step.motion! }),
        attempt_frames: c.attempt,
        tolerance: step.tolerance,
        side,
      });
      // Play the lesson through the robot once (straight to the score with reduced motion), then show the score.
      const wait = prefersReducedMotion() ? 0 : c.duration * 1000;
      const [s] = await Promise.all([scoring, new Promise((r) => window.setTimeout(r, wait))]);
      if (id !== run.current) return;
      setScore(s);
      setPhase('result');
    } catch (e) {
      if (id !== run.current) return;
      setProblem(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [lesson, stepIndex, side, step]);

  const reduce = prefersReducedMotion();
  const loopT = useCallback((c: Copy) => (reduce ? c.duration / 2 : ((performance.now() - start.current) / 1000) % c.duration), [reduce]);
  const getFrame = useCallback(() => (copy ? (frameAtTime(copy.ref, copy.ref, loopT(copy)).hands.find((h) => h.side === copy.side) ?? null) : null), [copy, loopT]);
  const getQ = useCallback(() => (copy ? frameAtTime(copy.q, copy.ref, loopT(copy)) : null), [copy, loopT]);
  const lines = useMemo(() => (score && copy ? resultLines(score, copy) : []), [score, copy]);

  if (!step) return null;
  const overall = score ? Math.round(score.overall) : 0;
  return (
    <section className="rb-teach" aria-labelledby="rb-teach-h">
      <h2 id="rb-teach-h" className="rb-h">
        {phase === 'result' ? 'The robot is the apprentice' : 'Teach the robot'}
      </h2>
      {phase === 'idle' && <p className="rb-line">Play {lesson.master_name}&rsquo;s first lesson through the {modelName(ROBOT_CONFIG.model)} and score its copy the way your own attempts are scored.</p>}
      {(phase === 'playing' || phase === 'result') && models && copy && (
        <div className="rb-teach__stage">
          <RobotStage
            models={models}
            side={side}
            getFrame={getFrame}
            humanStyle="sketch"
            getQ={getQ}
            taut={taut}
            label={`${lesson.master_name}'s hand on the left plays the lesson; the robot on the right copies it through the strings.`}
          />
        </div>
      )}
      {phase === 'playing' && (
        <p className="rb-line" aria-live="polite">
          The robot is copying {lesson.master_name}&rsquo;s lesson...
        </p>
      )}
      {phase === 'result' && score && (
        <>
          <p className={`rb-teach__score${overall >= MASTERY && score.within_tolerance ? ' is-mastered' : ''}`}>The robot scored {overall}</p>
          <ul className="rb-fingers" aria-label="The robot's score per finger">
            {lines.map((l) => (
              <li key={l.finger} className={`rb-finger rb-line--${l.tone}`}>
                {l.text}
              </li>
            ))}
          </ul>
          <p className="rb-note">The robot&rsquo;s copy is worked out in this browser with the core&rsquo;s retarget table and scored by the same scorer as your attempts.</p>
        </>
      )}
      {problem && (
        <p className="rb-line rb-line--fix" role="alert">
          The robot could not be taught: {problem}
        </p>
      )}
      <div className="rb-teach__actions">
        <Button variant={phase === 'idle' ? 'primary' : 'secondary'} large onClick={() => void teach()} disabled={phase === 'playing'}>
          {phase === 'idle' ? 'Teach the robot' : 'Teach it again'}
        </Button>
      </div>
    </section>
  );
}
