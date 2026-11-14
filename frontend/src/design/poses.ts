import { Euler, Quaternion } from 'three';
import type { HandFrame, MotionSpec, Side } from '../api/types';
import { curlsToFlexion, synthFrame } from '../three';
import { FROZEN } from './scene';

export const SWING: MotionSpec = { preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: 1500 };
export const SCALE: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 620 };
export const SCALE_DOWN: MotionSpec = { preset: 'finger_sequence', sequence: [5, 4, 3, 2, 1], beat_ms: 620 };

const q = new Quaternion();
const e = new Euler();

/** A held hand pose: curls 0..1 thumb first, and a wrist rotation in radians (x pitch, y yaw, z roll). */
export function pose(curls: number[], rot: [number, number, number] = [0, 0, 0], side: Side = 'right'): HandFrame {
  const m = side === 'left' ? -1 : 1;
  e.set(rot[0], rot[1] * m, rot[2] * m);
  q.setFromEuler(e);
  return { side, wrist_quat: [q.x, q.y, q.z, q.w], wrist_pos: null, flexion: curlsToFlexion(curls) };
}

/** Curl of one finger (0 thumb) of a frame, averaged over its three joints, in degrees. */
export function curlDeg(f: HandFrame, i: number): number {
  const names = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
  const j = f.flexion[names[i]];
  return ((j[0] + j[1] + j[2]) / 3) * (180 / Math.PI);
}

/** A swing frame with one finger held off by `extra` curl, for the correction frames. */
export function offFinger(spec: MotionSpec, t: number, finger: number, extra: number, side: Side = 'right'): (tt: number) => HandFrame {
  return (tt) => {
    const f = synthFrame(spec, FROZEN ? t : tt + t, side);
    const names = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
    const j = f.flexion[names[finger]];
    f.flexion[names[finger]] = [j[0] - extra, j[1] - extra * 1.1, j[2] - extra * 0.8];
    return f;
  };
}

/** Skill card poses: each is what the skill looks like at a glance. */
export const SKILL_POSES = {
  tableTennis: synthFrame(SWING, 0.88),
  piano: synthFrame(SCALE, 0.22),
  shadow: pose([0.05, -0.05, 0.95, 0.95, -0.05], [-0.15, 0.5, -1.2]),
  spelling: pose([0.55, 1, 1, 1, -0.1], [1.15, 0.2, 0]),
  boxing: pose([0.8, 1, 1, 1, 1], [0, 0, -1.4]),
  guitar: pose([0.2, 0.55, 0.7, 0.62, 0.4], [0.95, -0.4, 0.25]),
  rps: pose([0.85, -0.05, -0.05, 1, 1], [-0.2, 0.1, -0.2]),
  therapy: pose([0.3, 0.75, 0.78, 0.8, 0.82], [1.2, 0, 0]),
} satisfies Record<string, HandFrame>;
