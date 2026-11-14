import { FINGERS, type Finger, type ScoreResult, type Step } from '../../../api/types';

/** The four stages of one step: watch the master, then strings, ghost and blind as the help is taken away. */
export type Stage = 'watch' | 'strings' | 'ghost' | 'blind';

export const STAGES: Stage[] = ['watch', 'strings', 'ghost', 'blind'];

export const STAGE_LABEL: Record<Stage, string> = { watch: 'Watch', strings: 'Strings', ghost: 'Ghost', blind: 'Blind' };

export interface PipelineConfig {
  /** Overall score from which a rep can be clean. */
  passScore: number;
  /** Clean reps in a row needed to leave a stage. */
  cleanReps: number;
  /** Reps in one set. */
  setSize: number;
  /** Consecutive failed sets that drop the learner one stage. */
  failedSetsToDrop: number;
}

export const DEFAULT_CONFIG: PipelineConfig = { passScore: 80, cleanReps: 3, setSize: 5, failedSetsToDrop: 2 };
/** The hackathon demo setting: two clean reps, so the whole ladder fits in a few minutes. */
export const DEMO_CONFIG: PipelineConfig = { ...DEFAULT_CONFIG, cleanReps: 2 };

/** The configuration for a step: the demo or default count, with the step's own overrides. */
export function configFor(step: Pick<Step, 'tolerance'> & { pass_score?: number; clean_reps?: number }, demo: boolean): PipelineConfig {
  const base = demo ? DEMO_CONFIG : DEFAULT_CONFIG;
  return { ...base, passScore: step.pass_score ?? base.passScore, cleanReps: step.clean_reps ?? base.cleanReps };
}

/** A clean rep is inside the master's tolerance and at or above the pass score. */
export function isClean(score: Pick<ScoreResult, 'within_tolerance' | 'overall'>, passScore = DEFAULT_CONFIG.passScore): boolean {
  return score.within_tolerance && score.overall >= passScore;
}

export interface StageState {
  stage: Stage;
  /** Clean reps in a row at this stage (the combo). */
  combo: number;
  /** Reps taken in the current set. */
  repsInSet: number;
  /** Clean reps in the current set. */
  cleanInSet: number;
  /** Consecutive failed sets at this stage. */
  failedSets: number;
  /** Fingers that were wrong in the last rep, for the Ghost stage. */
  wrongFingers: Finger[];
  /** True once the blind stage has been cleared. */
  mastered: boolean;
}

export type StageEvent = 'none' | 'advanced' | 'dropped' | 'mastered' | 'set_done';

export interface RepOutcome {
  state: StageState;
  event: StageEvent;
  clean: boolean;
  /** True when the rep ended a set. */
  setEnded: boolean;
  /** Whether the set that just ended was a failed one. */
  setFailed: boolean;
}

export function initialState(stage: Stage = 'watch'): StageState {
  return { stage, combo: 0, repsInSet: 0, cleanInSet: 0, failedSets: 0, wrongFingers: [], mastered: false };
}

/** Moves on from watching to the strings. */
export function finishWatch(state: StageState): StageState {
  return state.stage === 'watch' ? { ...state, stage: 'strings', combo: 0, repsInSet: 0, cleanInSet: 0 } : state;
}

/** The fingers whose per-finger score fell short of the pass score. */
export function wrongFingersOf(score: Pick<ScoreResult, 'per_finger'>, passScore: number): Finger[] {
  return FINGERS.filter((f) => score.per_finger[f] < passScore);
}

function stageBelow(stage: Stage): Stage {
  return stage === 'blind' ? 'ghost' : 'strings';
}

function stageAbove(stage: Stage): Stage {
  return stage === 'strings' ? 'ghost' : 'blind';
}

/**
 * Applies one scored rep. Clean reps build the combo; enough in a row advance one stage (clearing blind means mastered).
 * A set of reps that ends without enough clean ones is failed, and enough failed sets in a row drop one stage. Watch reps
 * are not scored, so they leave the state alone.
 */
export function applyRep(state: StageState, score: ScoreResult, cfg: PipelineConfig = DEFAULT_CONFIG): RepOutcome {
  if (state.stage === 'watch') return { state, event: 'none', clean: false, setEnded: false, setFailed: false };
  const clean = isClean(score, cfg.passScore);
  let s: StageState = {
    ...state,
    combo: clean ? state.combo + 1 : 0,
    repsInSet: state.repsInSet + 1,
    cleanInSet: state.cleanInSet + (clean ? 1 : 0),
    wrongFingers: wrongFingersOf(score, cfg.passScore),
  };
  let event: StageEvent = 'none';

  if (s.combo >= cfg.cleanReps) {
    if (s.stage === 'blind') {
      event = s.mastered ? 'none' : 'mastered';
      s = { ...s, mastered: true, combo: 0, repsInSet: 0, cleanInSet: 0, failedSets: 0 };
    } else {
      event = 'advanced';
      s = { ...s, stage: stageAbove(s.stage), combo: 0, repsInSet: 0, cleanInSet: 0, failedSets: 0 };
    }
    return { state: s, event, clean, setEnded: false, setFailed: false };
  }

  if (s.repsInSet >= cfg.setSize) {
    const failed = s.cleanInSet < cfg.cleanReps;
    const failedSets = failed ? s.failedSets + 1 : 0;
    if (failed && failedSets >= cfg.failedSetsToDrop && s.stage !== 'strings') {
      s = { ...s, stage: stageBelow(s.stage), combo: 0, repsInSet: 0, cleanInSet: 0, failedSets: 0 };
      return { state: s, event: 'dropped', clean, setEnded: true, setFailed: true };
    }
    s = { ...s, repsInSet: 0, cleanInSet: 0, failedSets: failedSets >= cfg.failedSetsToDrop ? 0 : failedSets };
    return { state: s, event: 'set_done', clean, setEnded: true, setFailed: failed };
  }
  return { state: s, event, clean, setEnded: false, setFailed: false };
}

/** Rebuilds the state of a step by replaying its staged attempts, oldest first. Attempts without a stage are skipped. */
export function replay(attempts: { stage?: Stage; score: ScoreResult }[], cfg: PipelineConfig = DEFAULT_CONFIG): StageState {
  let s = initialState('strings');
  let any = false;
  for (const a of attempts) {
    if (!a.stage || a.stage === 'watch') continue;
    any = true;
    s = applyRep(s, a.score, cfg).state;
  }
  return any ? s : initialState('watch');
}

/** How the strings look: a fraying level from 0 (new) to 1 (about to snap) for each of `count` strings, staggered. */
export function frayLevels(combo: number, need: number, count = FINGERS.length): number[] {
  const p = need > 0 ? Math.max(0, Math.min(1, combo / need)) : 0;
  const stagger = 0.4;
  return Array.from({ length: count }, (_, i) => {
    const delay = count > 1 ? (stagger * i) / (count - 1) : 0;
    return Math.max(0, Math.min(1, (p - delay) / (1 - stagger)));
  });
}
