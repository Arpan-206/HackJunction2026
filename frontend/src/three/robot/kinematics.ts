import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Finger, Side } from '../../api/types';
import type { UrdfJoint, UrdfModel, Vec3 } from './urdf';

/** Scene units per metre, the same as the human hand (handModel.ts HAND_SCALE), so both hands read at true size. */
export const ROBOT_SCALE = 12;

const FINGER_RE = /(thumb|index|middle|ring|little)/;

/** The finger a joint or link belongs to, read from its name (Dex3-1 names every finger part after its finger). */
export function fingerOf(name: string): Finger | null {
  const m = FINGER_RE.exec(name);
  return m ? (m[1] as Finger) : null;
}

export interface LinkInfo {
  name: string;
  finger: Finger | null;
  /** Movable joints whose parent is this link. */
  joints: UrdfJoint[];
  /** Where the drawn segment ends, in the link frame: the single child joint, else twice the centre of mass. */
  end: Vec3;
  /** True when no joint hangs off this link: its end is a fingertip. */
  tip: boolean;
}

/**
 * Per link, its child joints and the end of the segment that represents it. The meshes are not shipped, so a finger
 * link is drawn from its joint to the next joint, and a last link to twice its centre of mass, which for Dex3-1's
 * slim phalanges lands close to the real fingertip.
 */
export function linkInfo(model: UrdfModel): Record<string, LinkInfo> {
  const out: Record<string, LinkInfo> = {};
  for (const name of Object.keys(model.links)) {
    const joints = model.joints.filter((j) => j.parent === name);
    const com = model.links[name].com ?? [0, 0, 0];
    const end: Vec3 = joints.length === 1 ? joints[0].xyz : [com[0] * 2, com[1] * 2, com[2] * 2];
    out[name] = { name, finger: fingerOf(name), joints, end, tip: joints.length === 0 };
  }
  return out;
}

/** The flexion direction of the model's fingers, by core/robot.py's rule on the first non-thumb joint. */
export function flexSign(model: UrdfModel): 1 | -1 {
  const j = model.joints.find((x) => fingerOf(x.name) !== 'thumb' && fingerOf(x.name) !== null) ?? model.joints[0];
  return Math.abs(j.upper) >= Math.abs(j.lower) ? 1 : -1;
}

/**
 * Rotation from the URDF palm frame to hand space (fingers along -z, palm down, y up). In the Dex3-1 files the fingers
 * point along +x and curl about +z towards the palm, which is +y on the right hand and -y on the left (mirrored
 * limits), so the palm side is found from the flexion sign rather than assumed.
 */
export function urdfToHand(model: UrdfModel): Quaternion {
  const s = flexSign(model);
  const x = new Vector3(0, 0, -1);
  const y = new Vector3(0, -s, 0);
  const z = new Vector3().crossVectors(x, y);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** The fixed part of a joint transform: origin translation then roll, pitch, yaw (URDF fixed-axis order). */
export function jointFrame(j: UrdfJoint): Matrix4 {
  const q = new Quaternion().setFromEuler(new Euler(j.rpy[0], j.rpy[1], j.rpy[2], 'ZYX'));
  return new Matrix4().compose(new Vector3(...j.xyz), q, new Vector3(1, 1, 1));
}

/** The moving part: rotation about the joint axis by q radians (revolute and continuous; prismatic slides). */
export function jointMotion(j: UrdfJoint, q: number): Matrix4 {
  const axis = new Vector3(...j.axis).normalize();
  if (j.type === 'prismatic') return new Matrix4().makeTranslation(axis.multiplyScalar(q));
  return new Matrix4().makeRotationAxis(axis, q);
}

/**
 * Forward kinematics: the world transform of every link in the URDF frame (metres) for joint values q. Unknown joints
 * sit at 0, clamped into their limits.
 */
export function linkTransforms(model: UrdfModel, q: Record<string, number>): Record<string, Matrix4> {
  const out: Record<string, Matrix4> = { [model.root]: new Matrix4() };
  const visit = (link: string) => {
    for (const j of model.joints.filter((x) => x.parent === link)) {
      const v = Math.min(j.upper, Math.max(j.lower, q[j.name] ?? 0));
      out[j.child] = out[link].clone().multiply(jointFrame(j)).multiply(jointMotion(j, v));
      visit(j.child);
    }
  };
  visit(model.root);
  return out;
}

/** Fingertip positions in hand space (metres, before ROBOT_SCALE) for joint values q, per finger the robot has. */
export function fingertips(model: UrdfModel, q: Record<string, number>): Partial<Record<Finger, Vector3>> {
  const info = linkInfo(model);
  const xf = linkTransforms(model, q);
  const toHand = urdfToHand(model);
  const out: Partial<Record<Finger, Vector3>> = {};
  for (const l of Object.values(info)) {
    if (!l.tip || !l.finger || !xf[l.name]) continue;
    out[l.finger] = new Vector3(...l.end).applyMatrix4(xf[l.name]).applyQuaternion(toHand);
  }
  return out;
}

/** Robot fingers in the model, in contract order. */
export function robotFingers(model: UrdfModel): Finger[] {
  const set = new Set(model.joints.map((j) => fingerOf(j.name)).filter(Boolean) as Finger[]);
  return (['thumb', 'index', 'middle', 'ring', 'little'] as Finger[]).filter((f) => set.has(f));
}

export type RobotModels = Record<Side, UrdfModel>;
