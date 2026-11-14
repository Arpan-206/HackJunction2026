import { FINGERS, type Finger, type HandFrame, type JointTriple } from '../../../../api/types';
import { gaussianScore } from '../../../../mock/scoring';
import { flexionDegrees } from '../../../apprentice/training/coach/deviation';

/**
 * The apprentice robot's skill: how it performs a lesson step, as a change applied to the expert's hand finger by finger.
 * It is a learner, not a copy. Every correction moves these numbers in the direction it is told, by the amount it is
 * told, whether or not that was right, so the robot is only as good as its teaching (research/14).
 *
 * - `bend`, -1 to 1: 0 does what the expert does; negative straightens each joint towards flat (at -1 the finger stays
 *   straight), positive curls each joint towards a full curl (at 1 the finger stays curled).
 * - `lag`, seconds: positive moves the finger behind the expert's timing, negative ahead of it.
 */
export interface FingerSkill {
  bend: number;
  lag: number;
}
export type RobotSkill = Record<Finger, FingerSkill>;

/** What the robot can be told to change: bend more or less, or move earlier or later. */
export type SkillAxis = 'bend' | 'time';

/** One instruction, from the chips, from words or from speech: finger, what to change, which way and how much. */
export interface Instruction {
  finger: Finger;
  axis: SkillAxis;
  /** +1 bend more, or move later; -1 straighten, or move earlier. */
  dir: 1 | -1;
  /** 1 for a plain instruction, 0.5 for "a little", 1.8 for "a lot". */
  amount: number;
}

/** A fault the robot starts a round with. Null is a catch round: it does the step right and should be left alone. */
export interface Fault {
  finger: Finger;
  axis: SkillAxis;
  /** The value of `bend`, or of `lag` in seconds. */
  value: number;
}

/** A full curl for one joint, in radians: where `bend` 1 takes a joint. */
export const FULL_CURL_RAD = 1.6;
/** How far one plain "bend more" or "straighten" moves `bend`. */
export const BEND_STEP = 0.25;
/** How far one plain "earlier" or "later" moves `lag`, in seconds. */
export const LAG_STEP_S = 0.12;
/** The size of a bend fault: a finger that clearly does too little or too much, fixed by two plain corrections. */
export const BEND_FAULT = 0.55;
/** The longest timing fault in seconds, and its share of the step's cycle when the cycle is short. */
export const LAG_FAULT_MAX_S = 0.3;
export const LAG_FAULT_SHARE = 0.2;
/** A relapse comes back at this share of the original fault: a believable slip, smaller than the first time. */
export const RELAPSE_SHARE = 0.75;
/** A finger needs this much travel over the cycle, in degrees, for a timing fault to show. */
export const MOVING_RANGE_DEG = 25;
/** Mean total flexion above which a finger reads as curled (a straighten fault shows), below which as open. */
export const CURLED_DEG = 70;
export const OPEN_DEG = 40;
/** Score at or above which the robot has learned the step. */
export const PASS_SCORE = 90;
/** Tolerance in degrees the robot's score is measured against (the scorer's default step tolerance). */
export const SCORE_TOLERANCE_DEG = 18;
/** Samples over one cycle when scoring the robot or recording a demonstration. */
export const CYCLE_SAMPLES = 48;
/** How much of a glove demonstration the robot takes on: most of it, never all at once. */
export const DEMO_WEIGHT = 0.7;

export function perfectSkill(): RobotSkill {
  const s = {} as RobotSkill;
  for (const f of FINGERS) s[f] = { bend: 0, lag: 0 };
  return s;
}

export function withFault(fault: Fault | null): RobotSkill {
  const s = perfectSkill();
  if (fault) s[fault.finger] = fault.axis === 'bend' ? { bend: fault.value, lag: 0 } : { bend: 0, lag: fault.value };
  return s;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The skill after one instruction. The robot does what it is told, right or wrong. */
export function applyInstruction(skill: RobotSkill, ins: Instruction): RobotSkill {
  const next = { ...skill, [ins.finger]: { ...skill[ins.finger] } };
  if (ins.axis === 'bend') next[ins.finger].bend = clamp(skill[ins.finger].bend + ins.dir * BEND_STEP * ins.amount, -1, 1);
  else next[ins.finger].lag = clamp(skill[ins.finger].lag + ins.dir * LAG_STEP_S * ins.amount, -0.6, 0.6);
  return next;
}

function bendJoint(rad: number, bend: number): number {
  if (bend >= 0) return rad + bend * (Math.max(rad, FULL_CURL_RAD) - rad);
  return rad * (1 + bend);
}

/** A source of hands over one looping cycle: the expert's track, or a baked demonstration. */
export type CycleSource = (t: number) => HandFrame;

/** The robot's hand at time t: each finger from the source at its own lagged time, then bent. */
export function robotHandAt(source: CycleSource, skill: RobotSkill, t: number): HandFrame {
  const base = source(t);
  const flexion = { ...base.flexion };
  for (const f of FINGERS) {
    const { bend, lag } = skill[f];
    if (bend === 0 && lag === 0) continue;
    const from = lag === 0 ? base : source(t - lag);
    flexion[f] = from.flexion[f].map((r) => bendJoint(r, bend)) as JointTriple;
  }
  return { ...base, flexion };
}

/** Per-finger mean difference in total flexion between the robot and the expert over one cycle, in degrees. */
export function fingerErrors(expert: CycleSource, robot: CycleSource, period: number, samples = CYCLE_SAMPLES): Record<Finger, number> {
  const sum = { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 } as Record<Finger, number>;
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * period;
    const a = flexionDegrees(expert(t));
    const b = flexionDegrees(robot(t));
    for (const f of FINGERS) sum[f] += Math.abs(a[f] - b[f]);
  }
  for (const f of FINGERS) sum[f] /= samples;
  return sum;
}

/**
 * The robot's score, 0 to 100, on the scorer's curve. The finger errors are combined as a root mean square, so one wrong
 * finger costs what it should instead of being averaged away by four right ones.
 */
export function robotScore(errors: Record<Finger, number>): number {
  const rms = Math.sqrt(FINGERS.reduce((s, f) => s + errors[f] ** 2, 0) / FINGERS.length);
  return Math.round(gaussianScore(rms, SCORE_TOLERANCE_DEG));
}

/** How each finger moves in the step: its mean total flexion and its travel over the cycle, in degrees. */
export function fingerProfile(expert: CycleSource, period: number, samples = CYCLE_SAMPLES): Record<Finger, { mean: number; range: number }> {
  const out = {} as Record<Finger, { mean: number; range: number }>;
  const lo = {} as Record<Finger, number>;
  const hi = {} as Record<Finger, number>;
  const sum = {} as Record<Finger, number>;
  for (const f of FINGERS) {
    lo[f] = Infinity;
    hi[f] = -Infinity;
    sum[f] = 0;
  }
  for (let i = 0; i < samples; i++) {
    const v = flexionDegrees(expert((i / samples) * period));
    for (const f of FINGERS) {
      lo[f] = Math.min(lo[f], v[f]);
      hi[f] = Math.max(hi[f], v[f]);
      sum[f] += v[f];
    }
  }
  for (const f of FINGERS) out[f] = { mean: sum[f] / samples, range: hi[f] - lo[f] };
  return out;
}

/**
 * The faults that show on this step, typical learner slips first: a curled finger that does not curl enough, a finger
 * late on its beat, a straight finger that curls when it should not, a finger that rushes. Fingers the step weights too
 * little to matter are left out.
 */
export function faultCandidates(expert: CycleSource, period: number, weights?: Partial<Record<Finger, number>> | null): Fault[] {
  const profile = fingerProfile(expert, period);
  const lag = Math.min(LAG_FAULT_MAX_S, period * LAG_FAULT_SHARE);
  const typical: Fault[] = [];
  const rarer: Fault[] = [];
  for (const f of FINGERS) {
    if ((weights?.[f] ?? 1) < 0.3) continue;
    const { mean, range } = profile[f];
    if (mean >= CURLED_DEG) typical.push({ finger: f, axis: 'bend', value: -BEND_FAULT });
    else if (mean <= OPEN_DEG) rarer.push({ finger: f, axis: 'bend', value: BEND_FAULT });
    else (Math.random() < 0.5 ? typical : rarer).push({ finger: f, axis: 'bend', value: Math.random() < 0.5 ? -BEND_FAULT : BEND_FAULT });
    if (range >= MOVING_RANGE_DEG && lag >= 0.08) {
      typical.push({ finger: f, axis: 'time', value: lag });
      rarer.push({ finger: f, axis: 'time', value: -lag });
    }
  }
  return [...typical, ...rarer];
}

/** One round: the fault the robot starts with (null in a catch round) and why it is there. */
export interface RoundPlan {
  fault: Fault | null;
  kind: 'fault' | 'catch' | 'relapse';
}

function pick<T>(xs: T[], avoid: (x: T) => boolean): T | null {
  const fresh = xs.filter((x) => !avoid(x));
  const pool = fresh.length ? fresh : xs;
  return pool.length ? pool[Math.floor(Math.random() * Math.min(pool.length, 4))] : null;
}

function shuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Four rounds (research/14): a typical fault first, so a newcomer always has something to find, then, in a random order,
 * a second fault on another finger, a catch round where the robot is right (so "it looks right" is sometimes the
 * answer) and a relapse of the first finger at a smaller size. The order is random so no round number gives it away.
 */
export function planRounds(candidates: Fault[]): RoundPlan[] {
  const first = pick(candidates, () => false);
  if (!first) return [{ fault: null, kind: 'catch' }];
  const second = pick(candidates, (c) => c.finger === first.finger);
  const relapse: RoundPlan = { fault: { ...first, value: first.value * RELAPSE_SHARE }, kind: 'relapse' };
  const rest: RoundPlan[] = [{ fault: null, kind: 'catch' }, relapse, ...(second ? [{ fault: second, kind: 'fault' as const }] : [])];
  return [{ fault: first, kind: 'fault' }, ...shuffle(rest)];
}

/**
 * Plain words for a fault, revealed at the end of a round: the robot's own line ("My ring finger did not curl enough.")
 * or the result card's ("Its ring finger did not curl enough.").
 */
export function describeFault(fault: Fault | null, voice: 'robot' | 'card' = 'card'): string {
  if (!fault) return voice === 'robot' ? 'Nothing was wrong this time.' : 'Nothing was wrong.';
  const f = `${voice === 'robot' ? 'My' : 'Its'} ${fault.finger === 'thumb' ? 'thumb' : `${fault.finger} finger`}`;
  if (fault.axis === 'bend') return fault.value < 0 ? `${f} did not curl enough.` : `${f} curled too much.`;
  return fault.value > 0 ? `${f} was late.` : `${f} was early.`;
}

/** Whether an instruction undoes the fault (right finger, right axis, right direction). */
export function fixesFault(ins: Instruction, fault: Fault | null): boolean {
  if (!fault || ins.finger !== fault.finger || ins.axis !== fault.axis) return false;
  return Math.sign(fault.value) === -ins.dir;
}

/**
 * Bakes a glove demonstration into the robot's motion: at each sample of the cycle the robot's current hand moves most
 * of the way to the learner's. The result replaces the robot's source and its skill resets, so a good demonstration fixes
 * any fault at once and a careless one teaches it the learner's own mistakes.
 */
export function bakeDemo(current: CycleSource, demo: (HandFrame | null)[], period: number, weight = DEMO_WEIGHT): CycleSource {
  const n = demo.length;
  const baked = demo.map((d, i) => {
    const r = current((i / n) * period);
    if (!d) return r;
    const flexion = { ...r.flexion };
    for (const f of FINGERS) flexion[f] = r.flexion[f].map((v, j) => v + (d.flexion[f][j] - v) * weight) as JointTriple;
    return { ...r, flexion };
  });
  return (t: number) => {
    const p = ((((t % period) + period) % period) / period) * n;
    const i = Math.floor(p) % n;
    const j = (i + 1) % n;
    const k = p - Math.floor(p);
    const a = baked[i];
    const b = baked[j];
    const flexion = { ...a.flexion };
    for (const f of FINGERS) flexion[f] = a.flexion[f].map((v, q) => v + (b.flexion[f][q] - v) * k) as JointTriple;
    return { ...a, flexion };
  };
}
