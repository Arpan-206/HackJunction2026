import { Euler, Quaternion, Vector3 } from 'three';
import type { Finger, HandFrame, JointTriple, MotionSpec, Side } from '../api/types';
import { FINGER_ORDER, FULL, RELAXED } from './anatomy';
import { fromYawPitchRoll, keyframePose, keysPeriod } from '../mock/synth';

/**
 * Local motion synthesiser, for PREVIEW ONLY: lets screens show animated guide hands when the backend is down.
 * The backend owns the canonical synthesiser; keep this small and do not use it for scoring.
 */

interface Pose {
  active: number;
  curls: number[];
  press: number;
  swing: number;
}

const DEFAULT_SEQ: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];

function sequencePose(t: number, beat: number, seq: number[]): Pose {
  const step = Math.floor(t / beat);
  const idx = ((step % seq.length) + seq.length) % seq.length;
  const active = seq[idx] - 1;
  const next = seq[(idx + 1) % seq.length] - 1;
  const phase = (t % beat) / beat;
  const press = phase < 0.42 ? Math.sin((phase / 0.42) * Math.PI) : 0;
  const lift = phase > 0.75 ? Math.sin(((phase - 0.75) / 0.25) * Math.PI) * 0.12 : 0;
  const curls = [-0.08, -0.08, -0.08, -0.08, -0.08];
  for (let i = 0; i < 5; i++) {
    let v = -0.08;
    if (i === active) v += press * 0.4;
    else if (Math.abs(i - active) === 1) v += press * 0.05;
    if (i === next && i !== active) v -= lift;
    curls[i] = v;
  }
  return { active, curls, press, swing: 0 };
}

function swingPose(t: number, beat: number, backhand: boolean): Pose {
  const phase = (t % beat) / beat;
  let yaw: number;
  let contact = 0;
  if (phase < 0.55) yaw = 0.55 * Math.sin(((phase / 0.55) * Math.PI) / 2);
  else if (phase < 0.68) {
    const k = (phase - 0.55) / 0.13;
    yaw = 0.55 - 1.25 * k;
    contact = Math.sin(k * Math.PI);
  } else yaw = -0.7 + 0.7 * ((phase - 0.68) / 0.32);
  const squeeze = 0.06 * contact;
  const curls = [0.62 + squeeze, 0.8 + squeeze, 0.84 + squeeze, 0.86 + squeeze, 0.88 + squeeze];
  return { active: -1, curls, press: contact, swing: backhand ? -yaw : yaw };
}

function pinchPose(t: number, beat: number, fingers: number[]): Pose {
  const phase = (t % beat) / beat;
  const k = phase < 0.5 ? Math.sin((phase / 0.5) * (Math.PI / 2)) : Math.cos(((phase - 0.5) / 0.5) * (Math.PI / 2));
  const curls = [0.25 * k, 0.05, 0.05, 0.05, 0.05];
  for (const f of fingers) curls[f - 1] = 0.3 * k;
  return { active: -1, curls, press: k, swing: 0 };
}

function holdPose(pose: Partial<Record<Finger, number>>): Pose {
  return { active: -1, curls: FINGER_ORDER.map((n) => pose[n] ?? 0), press: 0, swing: 0 };
}

/** Maps a 0..1 curl per finger (thumb first) to joint flexion in radians. */
export function curlsToFlexion(curls: number[]): Record<Finger, JointTriple> {
  const out = {} as Record<Finger, JointTriple>;
  FINGER_ORDER.forEach((name, i) => {
    const c = Math.max(-0.2, Math.min(1, curls[i] ?? 0));
    out[name] = [RELAXED[i][0] + FULL[i][0] * c, RELAXED[i][1] + FULL[i][1] * c, RELAXED[i][2] + FULL[i][2] * c];
  });
  return out;
}

const Y_AXIS = new Vector3(0, 1, 0);
const eul = new Euler();
const qa = new Quaternion();
const qb = new Quaternion();

function poseAt(spec: MotionSpec, t: number, side: Side): Pose {
  switch (spec.preset) {
    case 'finger_sequence':
      return sequencePose(t, (spec.beat_ms || 620) / 1000, spec.sequence?.length ? spec.sequence : DEFAULT_SEQ);
    case 'grip_and_swing':
      return swingPose(t, (spec.beat_ms || 1500) / 1000, spec.swing === 'backhand');
    case 'pinch':
      return pinchPose(t, (spec.beat_ms || 900) / 1000, spec.fingers);
    case 'hold_pose':
      return holdPose(side === 'left' && spec.left_pose ? spec.left_pose : spec.pose);
    default:
      return holdPose({ thumb: -0.05, index: -0.1, middle: -0.1, ring: -0.1, little: -0.1 });
  }
}

/** A relaxed, slightly curled hand with identity orientation. */
export function restFrame(side: Side = 'right'): HandFrame {
  return {
    side,
    wrist_quat: [0, 0, 0, 1],
    wrist_pos: null,
    flexion: curlsToFlexion([-0.05, -0.1, -0.1, -0.1, -0.1]),
  };
}

/**
 * Synthesises one hand frame for a MotionSpec at time t (seconds). Identity wrist_quat means palm down,
 * fingers forward. The index of the pressing finger (0 thumb .. 4 little) is returned alongside for key highlighting.
 */
export function synthFrame(spec: MotionSpec, t: number, side: Side = 'right'): HandFrame & { active: number } {
  const mirror = side === 'left' ? -1 : 1;
  if (spec.preset === 'keyframes') {
    // The same key maths as the backend synthesiser, so the guide and the simulated glove agree.
    const keys = side === 'left' && spec.left_keys?.length ? spec.left_keys : spec.keys;
    const k = keyframePose(keys, t, keysPeriod(spec.keys));
    const q = fromYawPitchRoll(k.yaw * mirror, k.pitch, k.roll * mirror);
    return { side, wrist_quat: q, wrist_pos: null, flexion: curlsToFlexion(k.curls), active: -1 };
  }
  const pose = poseAt(spec, t, side);
  const swinging = spec.preset === 'grip_and_swing';
  let quat: [number, number, number, number] = [0, 0, 0, 1];
  if (swinging) {
    qa.setFromAxisAngle(Y_AXIS, pose.swing * mirror);
    eul.set(-0.25, 0, pose.swing * 0.35 * mirror);
    qb.setFromEuler(eul);
    qa.multiply(qb);
    quat = [qa.x, qa.y, qa.z, qa.w];
  }
  return { side, wrist_quat: quat, wrist_pos: null, flexion: curlsToFlexion(pose.curls), active: pose.active };
}
