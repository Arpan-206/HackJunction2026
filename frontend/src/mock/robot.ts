import type { Finger, HandFrame, JointTriple, Side } from '../api/types';
import type { RobotDescription, RobotMessage, RobotSource } from '../api/robotTypes';
import { jointByName, type UrdfModel } from '../three/robot/urdf';

/**
 * Browser port of core/robot.py `Retargeter`, for mock mode and for when the core is down. It is a port like
 * mock/scoring.ts, not a second retarget path: the core owns retargeting (DECISIONS.md D25) and this file copies its
 * maths and the `[robot]` table of config.toml so the robot twin still moves offline. Change both together and keep
 * frontend/tests/robotRetarget.test.ts (values produced by running core/robot.py) passing.
 *
 * Each robot joint = offset_deg + sum(weight * angle feature in degrees), in radians, times the flexion sign, clamped
 * to the URDF limits. The sign is set per side or follows the URDF (the side of the limit range with the larger
 * magnitude). Fidelity per robot finger = coverage (robot joints over human flexion joints) x (1 - mean clip loss).
 */

/** The 18 angle features of core/hand.py `ANGLE_NAMES`, in order. */
export const ANGLE_NAMES = [
  'thumb_mcp',
  'thumb_ip',
  'index_mcp',
  'index_pip',
  'index_dip',
  'middle_mcp',
  'middle_pip',
  'middle_dip',
  'ring_mcp',
  'ring_pip',
  'ring_dip',
  'little_mcp',
  'little_pip',
  'little_dip',
  'spread_thumb_index',
  'spread_index_middle',
  'spread_middle_ring',
  'spread_ring_little',
] as const;
export type AngleName = (typeof ANGLE_NAMES)[number];

export const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];

export interface RetargetEntry {
  key: string;
  finger: Finger;
  offsetDeg: number;
  weights: Partial<Record<AngleName, number>>;
  signLeft: number | null;
  signRight: number | null;
}

/** config.toml `[robot]`, copied. */
export const ROBOT_CONFIG = {
  model: 'dex3_1',
  urdf: { left: 'dex3_1_l.urdf', right: 'dex3_1_r.urdf' } as Record<Side, string>,
  jointName: '{side}_hand_{key}_joint',
  humanDofs: { thumb: 2, index: 3, middle: 3, ring: 3, little: 3 } as Record<Finger, number>,
  retarget: [
    { key: 'thumb_0', finger: 'thumb', offsetDeg: -40, weights: { spread_thumb_index: 1 }, signLeft: 1, signRight: -1 },
    { key: 'thumb_1', finger: 'thumb', offsetDeg: 0, weights: { thumb_mcp: 1 }, signLeft: null, signRight: null },
    { key: 'thumb_2', finger: 'thumb', offsetDeg: 0, weights: { thumb_ip: 1 }, signLeft: null, signRight: null },
    { key: 'index_0', finger: 'index', offsetDeg: 0, weights: { index_mcp: 1 }, signLeft: null, signRight: null },
    { key: 'index_1', finger: 'index', offsetDeg: 0, weights: { index_pip: 0.7, index_dip: 0.5 }, signLeft: null, signRight: null },
    { key: 'middle_0', finger: 'middle', offsetDeg: 0, weights: { middle_mcp: 1 }, signLeft: null, signRight: null },
    { key: 'middle_1', finger: 'middle', offsetDeg: 0, weights: { middle_pip: 0.7, middle_dip: 0.5 }, signLeft: null, signRight: null },
  ] as RetargetEntry[],
};

/**
 * The contract's spread is abduction from a neutral pose (0 at rest); the core's spread_thumb_index is the absolute angle
 * between the thumb and index proximal bones. The thumb_0 offset (-40 degrees) is the core's statement of that neutral
 * angle, so a contract spread of 0 maps to 40 degrees and the thumb rotation joint sits at 0.
 */
export const THUMB_INDEX_NEUTRAL_DEG = 40;

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const roundTo = (v: number, d: number): number => {
  const k = 10 ** d;
  const r = Math.round(v * k) / k;
  return r === 0 ? 0 : r;
};

export function jointNameFor(side: Side, key: string): string {
  return ROBOT_CONFIG.jointName.replace('{side}', side).replace('{key}', key);
}

/** core/robot.py `_auto_sign`: the side of the limit range with the larger magnitude is the flexion direction. */
export function autoSign(lower: number, upper: number): number {
  return Math.abs(upper) >= Math.abs(lower) ? 1 : -1;
}

export interface RobotTargets {
  model: string;
  hand: Side;
  q: Record<string, number>;
  qNorm: Record<string, number>;
  fidelity: Partial<Record<Finger, number>>;
  missing: Finger[];
}

/** Retargets angle features to joint targets for the left or right robot hand. Mirrors core/robot.py `Retargeter`. */
export class Retargeter {
  readonly fingers: Finger[];
  readonly missing: Finger[];

  constructor(readonly models: Record<Side, UrdfModel>) {
    for (const side of ['left', 'right'] as Side[]) {
      for (const e of ROBOT_CONFIG.retarget) {
        const name = jointNameFor(side, e.key);
        if (!jointByName(models[side], name)) throw new Error(`joint ${name} is not in ${models[side].name}`);
      }
    }
    const used = new Set(ROBOT_CONFIG.retarget.map((e) => e.finger));
    this.fingers = FINGERS.filter((f) => used.has(f));
    this.missing = FINGERS.filter((f) => !used.has(f));
  }

  jointNames(side: Side): string[] {
    return ROBOT_CONFIG.retarget.map((e) => jointNameFor(side, e.key));
  }

  /** Joint targets from 18 angle features in degrees (ANGLE_NAMES order). */
  targets(angles: ArrayLike<number>, side: Side): RobotTargets {
    const q: Record<string, number> = {};
    const qNorm: Record<string, number> = {};
    const loss: Partial<Record<Finger, number[]>> = {};
    for (const e of ROBOT_CONFIG.retarget) {
      const name = jointNameFor(side, e.key);
      const j = jointByName(this.models[side], name);
      if (!j) continue;
      let deg = e.offsetDeg;
      for (const [a, w] of Object.entries(e.weights)) deg += (w as number) * (angles[ANGLE_NAMES.indexOf(a as AngleName)] ?? 0);
      const forced = side === 'left' ? e.signLeft : e.signRight;
      const sign = forced === null ? autoSign(j.lower, j.upper) : forced;
      const raw = sign * deg * DEG;
      const val = clamp(raw, j.lower, j.upper);
      const range = Math.max(1e-9, j.upper - j.lower);
      q[name] = val;
      qNorm[name] = (val - j.lower) / range;
      (loss[e.finger] ??= []).push(Math.abs(raw - val) / range);
    }
    const fidelity: Partial<Record<Finger, number>> = {};
    for (const f of this.fingers) {
      const nRobot = ROBOT_CONFIG.retarget.filter((e) => e.finger === f).length;
      const coverage = Math.min(1, nRobot / Math.max(1, ROBOT_CONFIG.humanDofs[f] ?? 3));
      const l = loss[f] ?? [];
      const clip = l.length ? l.reduce((s, v) => s + v, 0) / l.length : 0;
      fidelity[f] = clamp(coverage * (1 - clip), 0, 1);
    }
    return { model: ROBOT_CONFIG.model, hand: side, q, qNorm, fidelity, missing: [...this.missing] };
  }

  /** core/robot.py `describe()`, the `hello.robot` block. */
  describe(): RobotDescription {
    const limits = (side: Side) =>
      Object.fromEntries(
        this.jointNames(side).map((n) => {
          const j = jointByName(this.models[side], n);
          return [n, [j?.lower ?? 0, j?.upper ?? 0] as [number, number]];
        }),
      );
    return {
      model: ROBOT_CONFIG.model,
      fingers: [...this.fingers],
      missing: [...this.missing],
      joints: { left: this.jointNames('left'), right: this.jointNames('right') },
      limits: { left: limits('left'), right: limits('right') },
      urdf: { ...ROBOT_CONFIG.urdf },
    };
  }
}

/** core/robot.py `RobotTargets.to_message` plus the envelope core/server.py adds. */
export function toMessage(t: RobotTargets, source: Exclude<RobotSource, 'off'>, anglesFrom: 'hand' | 'lesson', tUs: number): RobotMessage {
  const round = (o: Partial<Record<string, number>>, d: number) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, roundTo(v as number, d)]));
  return {
    v: 1,
    type: 'robot',
    t: Math.round(tUs),
    model: t.model,
    source,
    hand: t.hand,
    angles_from: anglesFrom,
    q: round(t.q, 5),
    q_norm: round(t.qNorm, 3),
    fidelity: round(t.fidelity, 3),
    missing: [...t.missing],
  };
}

/**
 * The 18 angle features (degrees) from a contract hand frame, the inverse of core/compat.py `hand_to_glove_hand`:
 * thumb [CMC, MCP, IP] gives thumb_mcp and thumb_ip (the core has no thumb CMC feature), the fingers give MCP, PIP, DIP,
 * and the contract spreads (abduction from neutral) become the core's bone angles (see THUMB_INDEX_NEUTRAL_DEG).
 */
export function anglesFromHand(hand: HandFrame): number[] {
  const d = (rad: number | undefined) => (rad ?? 0) / DEG;
  const f = hand.flexion;
  const s = hand.spread;
  return [
    d(f.thumb[1]),
    d(f.thumb[2]),
    ...(['index', 'middle', 'ring', 'little'] as Finger[]).flatMap((n) => [d(f[n][0]), d(f[n][1]), d(f[n][2])]),
    THUMB_INDEX_NEUTRAL_DEG + d(s?.thumb),
    d(s?.index),
    d(s?.ring),
    d(s?.little),
  ];
}

/**
 * The robot's copy expressed as a human hand, for scoring the robot like a learner. Each joint's target is turned back
 * into the angle features it was built from: (sign x q - offset) is shared over the features in proportion so their
 * weighted sum gives the joint back (the index's PIP and DIP each get q / 1.2). Features the robot has no joint for
 * (ring and little) stay straight. The thumb CMC is not one of the core's features, so it is not part of the retarget:
 * it is taken from `base` (the hand the robot copied), along with the wrist.
 */
export function handFromTargets(q: Record<string, number>, side: Side, rt: Retargeter, base: HandFrame): HandFrame {
  const feat = new Array<number>(ANGLE_NAMES.length).fill(0);
  feat[ANGLE_NAMES.indexOf('spread_thumb_index')] = THUMB_INDEX_NEUTRAL_DEG;
  for (const e of ROBOT_CONFIG.retarget) {
    const name = jointNameFor(side, e.key);
    const j = jointByName(rt.models[side], name);
    if (!j || q[name] === undefined) continue;
    const forced = side === 'left' ? e.signLeft : e.signRight;
    const sign = forced === null ? autoSign(j.lower, j.upper) : forced;
    const total = (sign * q[name]) / DEG - e.offsetDeg;
    const weights = Object.entries(e.weights) as [AngleName, number][];
    const sumW = weights.reduce((s, [, w]) => s + w, 0) || 1;
    for (const [a] of weights) feat[ANGLE_NAMES.indexOf(a)] = total / sumW;
  }
  const r = (deg: number) => deg * DEG;
  const triple = (i: number): JointTriple => [r(feat[i]), r(feat[i + 1]), r(feat[i + 2])];
  return {
    side,
    wrist_quat: base.wrist_quat,
    wrist_pos: base.wrist_pos,
    flexion: {
      thumb: [base.flexion.thumb[0], r(feat[0]), r(feat[1])],
      index: triple(2),
      middle: triple(5),
      ring: triple(8),
      little: triple(11),
    },
    spread: { thumb: r(feat[14] - THUMB_INDEX_NEUTRAL_DEG), index: r(feat[15]), middle: 0, ring: r(feat[16]), little: r(feat[17]) },
  };
}
