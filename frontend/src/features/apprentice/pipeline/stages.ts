import { FINGERS, type Finger, type ScoreResult, type Step } from '../../../api/types';

/**
 * The stages of one step. Practice has two phases: Watch (the expert's hand works a puppet on strings beside the learner's
 * own hand, nothing scored), then Try it, where the learner's ghost switch picks the stage: ghost on is 'ghost', ghost off is
 * 'blind', and only clean reps with the ghost off master the step. 'strings' (a scored stage with strings to the learner's
 * fingers) is no longer offered; it stays in the type so older practice logs still replay.
 */
export type Stage = 'watch' | 'strings' | 'ghost' | 'blind';

/** The stages the practice screen offers, in order. */
export const STAGES: Stage[] = ['watch', 'ghost', 'blind'];

export const STAGE_LABEL: Record<Stage, string> = { watch: 'Watch', strings: 'Strings', ghost: 'Ghost on', blind: 'Ghost off' };

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

/** Moves on from watching to trying it with the ghost. */
export function finishWatch(state: StageState): StageState {
  return state.stage === 'watch' ? { ...state, stage: 'ghost', combo: 0, repsInSet: 0, cleanInSet: 0 } : state;
}

/**
 * The learner's ghost switch: ghost on is the 'ghost' stage, off is 'blind'. Switching starts a fresh count (combo, set and
 * failed sets) at the chosen stage and keeps the mastery; watching, or choosing the stage already set, changes nothing.
 */
export function chooseStage(state: StageState, stage: 'ghost' | 'blind'): StageState {
  if (state.stage === 'watch' || state.stage === stage) return state;
  return { ...state, stage, combo: 0, repsInSet: 0, cleanInSet: 0, failedSets: 0 };
}

/** The stages a link can open the practice screen at (`?stage=`), for revisiting a lesson from its timeline. */
export type OpenStage = 'watch' | 'ghost' | 'blind';

/** Reads a `?stage=` value; anything else is null (the screen resumes where the log left off). */
export function askedStage(raw: string | null | undefined): OpenStage | null {
  return raw === 'watch' || raw === 'ghost' || raw === 'blind' ? raw : null;
}

/**
 * Opens a step at the stage a link asked for, keeping its mastery: Watch starts the puppet again, Ghost on and Ghost off
 * are the learner's switch (a fresh count at that stage). With no ask the resumed state stands.
 */
export function openAt(state: StageState, ask: OpenStage | null): StageState {
  if (!ask) return state;
  if (ask === 'watch') return state.stage === 'watch' ? state : { ...initialState('watch'), mastered: state.mastered };
  return chooseStage(finishWatch(state), ask);
}

/** The fingers whose per-finger score fell short of the pass score. */
export function wrongFingersOf(score: Pick<ScoreResult, 'per_finger'>, passScore: number): Finger[] {
  return FINGERS.filter((f) => score.per_finger[f] < passScore);
}

function stageBelow(stage: Stage): Stage {
  return stage === 'blind' ? 'ghost' : stage;
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
    if (failed && failedSets >= cfg.failedSetsToDrop && s.stage === 'blind') {
      s = { ...s, stage: stageBelow(s.stage), combo: 0, repsInSet: 0, cleanInSet: 0, failedSets: 0 };
      return { state: s, event: 'dropped', clean, setEnded: true, setFailed: true };
    }
    s = { ...s, repsInSet: 0, cleanInSet: 0, failedSets: failedSets >= cfg.failedSetsToDrop ? 0 : failedSets };
    return { state: s, event: 'set_done', clean, setEnded: true, setFailed: failed };
  }
  return { state: s, event, clean, setEnded: false, setFailed: false };
}

/**
 * Rebuilds the state of a step by replaying its staged attempts, oldest first. Attempts without a stage are skipped. A rep
 * logged at another stage than the machine is in means the learner flipped the ghost switch first, so the machine follows
 * it there before the rep is applied (an older 'strings' rep starts the machine at the strings).
 */
export function replay(attempts: { stage?: Stage; score: ScoreResult }[], cfg: PipelineConfig = DEFAULT_CONFIG): StageState {
  let s = initialState('ghost');
  let any = false;
  for (const a of attempts) {
    if (!a.stage || a.stage === 'watch') continue;
    if (!any && a.stage === 'strings') s = initialState('strings');
    else if (a.stage !== s.stage && (a.stage === 'ghost' || a.stage === 'blind')) s = chooseStage(s, a.stage);
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
