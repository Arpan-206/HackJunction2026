import type { Finger, GloveFrame, HandFrame, JointTriple, Keyframe, MotionSpec, Side } from '../api/types';

/**
 * Faithful TypeScript port of backend/app/services/motion/synthesiser.py (and the quaternion helpers it uses).
 * Mock mode needs the same pose maths as the backend so that guide hands, the simulated glove stream and the
 * scoring port agree with each other exactly as the real services do.
 */

export const FINGER_NAMES: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];

const FRAME_DECIMALS = 4;
const RELAXED_FLEXION = [
  [0.1, 0.18, 0.15],
  [0.28, 0.38, 0.24],
  [0.28, 0.38, 0.24],
  [0.28, 0.38, 0.24],
  [0.3, 0.4, 0.26],
];
const FULL_FLEXION = [
  [0.75, 0.75, 0.55],
  [1.15, 1.3, 0.85],
  [1.15, 1.3, 0.85],
  [1.15, 1.3, 0.85],
  [1.15, 1.3, 0.85],
];
/** The guide hand's thumb flexes this fraction of the curl table; the scorer's nominal ranges use the same scale. */
export const THUMB_FLEXION_SCALE = 0.8;
const CURL_MIN = -0.2;
const CURL_MAX = 1.0;
const BREATHE_AMPLITUDE = 0.02;
const BREATHE_RATE = 1.3;
const IDLE_CURL = 0.05;
const SEQ_PRESS_WINDOW = 0.42;
const SEQ_LIFT_START = 0.75;
const SEQ_LIFT_AMOUNT = 0.12;
const SEQ_PRESS_CURL = 0.36;
const SEQ_NEIGHBOUR_CURL = 0.05;
const SWING_BACKSWING_END = 0.55;
const SWING_CONTACT_END = 0.68;
const SWING_BACKSWING_YAW = 0.55;
const SWING_CONTACT_SWEEP = 1.25;
const SWING_FOLLOW_YAW = -0.7;
const SWING_SQUEEZE = 0.06;
const SWING_ROLL_FACTOR = 0.35;
const SWING_PITCH = -0.25;
const GRIP_CURLS: Record<string, number[]> = {
  shakehand: [0.62, 0.8, 0.84, 0.86, 0.88],
  penhold: [0.55, 0.35, 0.85, 0.88, 0.9],
};
const PINCH_THUMB_CURL = 0.45;
const PINCH_FINGER_CURL = 0.5;
const DEFAULT_SEQUENCE_BEAT_MS = 620;
const DEFAULT_SWING_BEAT_MS = 1500;
const DEFAULT_PINCH_BEAT_MS = 800;
const KEYFRAME_BLEND = 0.5;

type Quat = [number, number, number, number];

export interface Pose {
  curls: number[];
  yaw: number;
  pitch: number;
  roll: number;
}

const round = (v: number): number => {
  const k = 10 ** FRAME_DECIMALS;
  return Math.round(v * k) / k;
};

/** Python-style modulo (result takes the sign of the divisor). */
const mod = (a: number, b: number): number => ((a % b) + b) % b;

function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function normaliseQuat(q: Quat): Quat {
  const n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (n === 0) return [0, 0, 0, 1];
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

function axisAngle(axis: 0 | 1 | 2, angle: number): Quat {
  const half = angle / 2;
  const v: Quat = [0, 0, 0, Math.cos(half)];
  v[axis] = Math.sin(half);
  return v;
}

/** Compose yaw (about y), then pitch (about x), then roll (about z). */
export function fromYawPitchRoll(yaw: number, pitch: number, roll: number): Quat {
  const q = multiply(axisAngle(1, yaw), axisAngle(0, pitch));
  return normaliseQuat(multiply(q, axisAngle(2, roll)));
}

/** Normalised linear interpolation from a to b along the shortest arc. */
export function nlerp(a: Quat, b: Quat, alpha: number): Quat {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  return normaliseQuat([
    a[0] + alpha * (sign * b[0] - a[0]),
    a[1] + alpha * (sign * b[1] - a[1]),
    a[2] + alpha * (sign * b[2] - a[2]),
    a[3] + alpha * (sign * b[3] - a[3]),
  ]);
}

function sequencePose(spec: Extract<MotionSpec, { preset: 'finger_sequence' }>, t: number): Pose {
  const beat = (spec.beat_ms || DEFAULT_SEQUENCE_BEAT_MS) / 1000;
  const seq = spec.sequence?.length ? spec.sequence : [1, 2, 3, 4, 5];
  const idx = mod(Math.floor(t / beat), seq.length);
  const active = seq[idx] - 1;
  const next = seq[(idx + 1) % seq.length] - 1;
  const phase = mod(t, beat) / beat;
  const press = phase < SEQ_PRESS_WINDOW ? Math.sin((phase / SEQ_PRESS_WINDOW) * Math.PI) : 0;
  let lift = 0;
  if (phase > SEQ_LIFT_START) lift = Math.sin(((phase - SEQ_LIFT_START) / (1 - SEQ_LIFT_START)) * Math.PI) * SEQ_LIFT_AMOUNT;
  const curls: number[] = [];
  for (let i = 0; i < 5; i++) {
    let v = 0;
    if (i === active) v = press * SEQ_PRESS_CURL;
    else if (Math.abs(i - active) === 1) v = press * SEQ_NEIGHBOUR_CURL;
    if (i === next && i !== active) v -= lift;
    curls.push(v);
  }
  return { curls, yaw: 0, pitch: 0, roll: 0 };
}

function swingPose(spec: Extract<MotionSpec, { preset: 'grip_and_swing' }>, t: number): Pose {
  const beat = (spec.beat_ms || DEFAULT_SWING_BEAT_MS) / 1000;
  const phase = mod(t, beat) / beat;
  let yaw: number;
  let contact = 0;
  if (phase < SWING_BACKSWING_END) {
    yaw = SWING_BACKSWING_YAW * Math.sin(((phase / SWING_BACKSWING_END) * Math.PI) / 2);
  } else if (phase < SWING_CONTACT_END) {
    const k = (phase - SWING_BACKSWING_END) / (SWING_CONTACT_END - SWING_BACKSWING_END);
    yaw = SWING_BACKSWING_YAW - SWING_CONTACT_SWEEP * k;
    contact = Math.sin(k * Math.PI);
  } else {
    yaw = SWING_FOLLOW_YAW * (1 - (phase - SWING_CONTACT_END) / (1 - SWING_CONTACT_END));
  }
  if (spec.swing === 'backhand') yaw = -yaw;
  const squeeze = SWING_SQUEEZE * contact;
  const grip = GRIP_CURLS[spec.grip] ?? GRIP_CURLS.shakehand;
  return { curls: grip.map((v) => v + squeeze), yaw, pitch: SWING_PITCH, roll: 0 };
}

function pinchPose(spec: Extract<MotionSpec, { preset: 'pinch' }>, t: number): Pose {
  const beat = (spec.beat_ms || DEFAULT_PINCH_BEAT_MS) / 1000;
  const press = 0.5 - 0.5 * Math.cos((2 * Math.PI * mod(t, beat)) / beat);
  const curls = [PINCH_THUMB_CURL * press, 0, 0, 0, 0];
  for (const f of spec.fingers ?? []) curls[f - 1] = PINCH_FINGER_CURL * press;
  return { curls, yaw: 0, pitch: 0, roll: 0 };
}

const smoothstep = (k: number): number => {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
};

/** Seconds one loop of keyframes lasts. */
export const keysPeriod = (keys: Keyframe[]): number => keys.reduce((s, k) => s + k.ms, 0) / 1000;

/**
 * The pose at time t with the keys stretched to last `period` seconds. Each key owns a slot of its `ms`; over the first
 * KEYFRAME_BLEND of the slot the hand eases in from the previous key (the last one for the first key), then holds it.
 */
export function keyframePose(keys: Keyframe[], t: number, period: number): Pose {
  const scale = period / keysPeriod(keys);
  const phase = mod(t, period);
  let start = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const slot = (key.ms / 1000) * scale;
    if (phase < start + slot || i === keys.length - 1) {
      const prev = keys[(i - 1 + keys.length) % keys.length];
      const k = smoothstep((phase - start) / (slot * KEYFRAME_BLEND));
      const mix = (a = 0, b = 0) => a + (b - a) * k;
      return {
        curls: FINGER_NAMES.map((n) => mix(prev.pose?.[n] ?? 0, key.pose?.[n] ?? 0)),
        yaw: mix(prev.yaw, key.yaw),
        pitch: mix(prev.pitch, key.pitch),
        roll: mix(prev.roll, key.roll),
      };
    }
    start += slot;
  }
  throw new Error('unreachable');
}

/** The pose a motion is in at time t seconds, for the given hand. */
export function poseAt(spec: MotionSpec, t: number, side: Side = 'right'): Pose {
  switch (spec.preset) {
    case 'finger_sequence':
      return sequencePose(spec, t);
    case 'grip_and_swing':
      return swingPose(spec, t);
    case 'pinch':
      return pinchPose(spec, t);
    case 'hold_pose': {
      const pose = side === 'left' && spec.left_pose ? spec.left_pose : spec.pose;
      return { curls: FINGER_NAMES.map((n) => pose?.[n] ?? 0), yaw: 0, pitch: 0, roll: 0 };
    }
    case 'keyframes': {
      const keys = side === 'left' && spec.left_keys?.length ? spec.left_keys : spec.keys;
      return keyframePose(keys, t, keysPeriod(spec.keys));
    }
    default:
      return { curls: [IDLE_CURL, IDLE_CURL, IDLE_CURL, IDLE_CURL, IDLE_CURL], yaw: 0, pitch: 0, roll: 0 };
  }
}

/** Seconds after which a moving motion repeats exactly, or null for held poses and idle. */
function motionPeriod(spec: MotionSpec): number | null {
  switch (spec.preset) {
    case 'finger_sequence':
      return ((spec.beat_ms || DEFAULT_SEQUENCE_BEAT_MS) / 1000) * (spec.sequence?.length ? spec.sequence.length : 5);
    case 'grip_and_swing':
      return (spec.beat_ms || DEFAULT_SWING_BEAT_MS) / 1000;
    case 'pinch':
      return (spec.beat_ms || DEFAULT_PINCH_BEAT_MS) / 1000;
    case 'keyframes':
      return keysPeriod(spec.keys);
    default:
      return null;
  }
}

/**
 * Breathing offset in radians. A moving motion gets the whole number of breaths per period nearest the natural rate,
 * as a cosine peaking mid-period, so it repeats with the motion period (attempts are phase-locked to it while the
 * reference starts at t=0) and lines up with the swing squeeze. Held poses and idle keep the free-running rate.
 */
function breathing(t: number, period: number | null): number {
  if (period === null) return Math.sin(t * BREATHE_RATE) * BREATHE_AMPLITUDE;
  const cycles = Math.max(1, Math.round((period * BREATHE_RATE) / (2 * Math.PI)));
  return -Math.cos((t * 2 * Math.PI * cycles) / period) * BREATHE_AMPLITUDE;
}

function flexionFor(curls: number[], t: number, period: number | null): Record<Finger, JointTriple> {
  const breathe = breathing(t, period);
  const out = {} as Record<Finger, JointTriple>;
  FINGER_NAMES.forEach((name, i) => {
    const curl = Math.max(CURL_MIN, Math.min(CURL_MAX, curls[i] ?? 0));
    const scale = i === 0 ? THUMB_FLEXION_SCALE : 1;
    const extra = i ? breathe : 0;
    const j = (s: number) => round((RELAXED_FLEXION[i][s] + FULL_FLEXION[i][s] * curl + extra) * scale);
    out[name] = [j(0), j(1), j(2)];
  });
  return out;
}

/** Synthesises one hand at time t (seconds). */
export function handFrame(spec: MotionSpec, side: Side, t: number): HandFrame {
  const pose = poseAt(spec, t, side);
  const mirror = side === 'left' ? -1 : 1;
  const q = fromYawPitchRoll(pose.yaw * mirror, pose.pitch, (pose.yaw * SWING_ROLL_FACTOR + pose.roll) * mirror);
  return {
    side,
    wrist_quat: [round(q[0]), round(q[1]), round(q[2]), round(q[3])],
    wrist_pos: null,
    flexion: flexionFor(pose.curls, t, motionPeriod(spec)),
    spread: { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 },
  };
}

/** Synthesises a simulator frame for the given sides at time t. */
export function frameAt(spec: MotionSpec, t: number, sides: Side[] = ['left', 'right']): GloveFrame {
  return { t, source: 'simulator', hands: sides.map((s) => handFrame(spec, s, t)) };
}

/** Returns a duration_s long list of single-hand frames at fps. */
export function synthesise(spec: MotionSpec, side: Side, durationS: number, fps = 60): GloveFrame[] {
  const count = Math.max(1, Math.round(durationS * fps));
  return Array.from({ length: count }, (_, i) => frameAt(spec, i / fps, [side]));
}
