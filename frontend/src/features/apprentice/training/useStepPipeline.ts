import { useCallback, useMemo, useState } from 'react';
import type { ScoreResult, Step } from '../../../api';
import { logAttempt, useLoggedAttempts } from '../../shared/practiceLog';
import { setLine, stageLine } from '../pipeline/coachLines';
import { dayKey, deriveStep, startingPoint } from '../pipeline/progress';
import { applyRep, configFor, finishWatch, initialState, replay, type PipelineConfig, type RepOutcome, type Stage, type StageEvent, type StageState } from '../pipeline/stages';
import { policyForStage, type AttemptPolicy } from './coach/fade';

export interface PipelineLines {
  /** Celebratory line at a stage change. */
  stage: string;
  /** Short line after a finished set. */
  set: string;
}

export interface StepPipeline {
  cfg: PipelineConfig;
  machine: StageState;
  stage: Stage;
  policy: AttemptPolicy;
  /** True when the next rep is a scheduled blind review. */
  review: boolean;
  /** Bumps each time the strings snap. */
  snapKey: number;
  lines: PipelineLines;
  /** What the last submitted rep did to the machine. */
  event: StageEvent;
  /** Reps taken in this visit. */
  reps: number;
  /** The last scored rep, or null. */
  last: ScoreResult | null;
  /** Logs a scored rep, moves the machine and returns what happened. */
  submit: (score: ScoreResult) => RepOutcome;
  endWatch: () => void;
  restart: () => void;
}

/**
 * Drives one step through Watch, Strings, Ghost and Blind. The starting stage is rebuilt from the attempt log, so a learner
 * returns to where they left off; every scored rep is logged with its stage so ranks and review dates can be derived later.
 */
export function useStepPipeline(lessonId: string, step: Step, demo: boolean): StepPipeline {
  const logged = useLoggedAttempts(lessonId);
  const cfg = useMemo(() => configFor(step, demo), [step, demo]);

  const [start] = useState(() => {
    const own = logged.filter((a) => a.step_id === step.id);
    const base = replay(own.map((a) => ({ stage: a.stage, score: a.score })), cfg);
    const mastery = deriveStep(step.id, own, cfg);
    const sp = startingPoint(base.stage, mastery, dayKey(new Date()));
    const machine = sp.stage === base.stage ? base : { ...initialState(sp.stage), mastered: base.mastered || sp.review };
    return { machine, review: sp.review };
  });

  const [machine, setMachine] = useState<StageState>(start.machine);
  const [review, setReview] = useState(start.review);
  const [snapKey, setSnapKey] = useState(0);
  const [lines, setLines] = useState<PipelineLines>({ stage: '', set: '' });
  const [event, setEvent] = useState<StageEvent>('none');
  const [reps, setReps] = useState(0);
  const [last, setLast] = useState<ScoreResult | null>(null);
  const [setScores, setSetScores] = useState<ScoreResult[]>([]);

  const submit = useCallback(
    (score: ScoreResult): RepOutcome => {
      let outcome = applyRep(machine, score, cfg);
      logAttempt(lessonId, step.id, score, { stage: machine.stage === 'watch' ? 'strings' : machine.stage, kind: review ? 'review' : 'practice' });
      if (review) {
        // A missed review sends the step back to the Ghost stage for a set; a clean one leaves it mastered.
        if (!outcome.clean) outcome = { ...outcome, state: { ...initialState('ghost'), mastered: true }, event: 'dropped' };
        setReview(false);
      }
      const scores = [...setScores, score];
      setSetScores(outcome.setEnded || outcome.event === 'advanced' || outcome.event === 'mastered' || outcome.event === 'dropped' ? [] : scores);
      if (outcome.event === 'advanced' && machine.stage === 'strings') setSnapKey((k) => k + 1);
      setMachine(outcome.state);
      setEvent(outcome.event);
      setReps((n) => n + 1);
      setLast(score);
      setLines({
        stage: stageLine(outcome, outcome.state.wrongFingers),
        set: outcome.setEnded || outcome.event === 'mastered' ? setLine(scores) : '',
      });
      return outcome;
    },
    [machine, cfg, lessonId, step.id, review, setScores],
  );

  const endWatch = useCallback(() => setMachine((m) => finishWatch(m)), []);
  const restart = useCallback(() => {
    setMachine({ ...initialState('strings'), mastered: machine.mastered });
    setSetScores([]);
    setEvent('none');
    setLines({ stage: '', set: '' });
  }, [machine.mastered]);

  const policy = useMemo(() => policyForStage(machine.stage, machine.wrongFingers, reps + 1), [machine.stage, machine.wrongFingers, reps]);
  return { cfg, machine, stage: machine.stage, policy, review, snapKey, lines, event, reps, last, submit, endWatch, restart };
}
