import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Finger, Side } from '../../api/types';
import { FINGER_ORDER } from '../anatomy';
import { movableJoints, type UrdfJoint, type UrdfModel, type Vec3 } from './urdf';

/**
 * Pure kinematics for a URDF hand: which finger a joint belongs to, the capsule each link is drawn as, forward
 * kinematics, and the change of basis from the URDF frame into the app's hand space. No WebGL here, so all of it is
 * unit tested against the real Dex3-1 files.
 *
 * Hand space (see handPose.ts): right hand, palm down, fingers along -z, y up, thumb towards -x; left hands mirrored.
 * The Dex3-1 URDF has the fingers along +x and the palm facing +y (right) or -y (left), with the index at +z.
 */

/** 1 scene unit is 10 cm: the skinned human hand's knuckles sit one unit from its wrist. */
export const URDF_TO_SCENE = 10;

/** The finger named in a joint or link name, for example `right_hand_index_0_joint` gives `index`. */
export function fingerOfName(name: string): Finger | null {
  for (const f of FINGER_ORDER) if (name.includes(f)) return f;
  if (name.includes('pinky')) return 'little';
  return null;
}

/** Radii in metres for the capsules, by part. The real Dex3-1 fingers are about 2 cm across. */
export const RADII = { finger: 0.0105, thumbBase: 0.013, tip: 0.0095 } as const;

export type LinkShape =
  | { kind: 'capsule'; from: Vec3; to: Vec3; radius: number }
  | { kind: 'box'; center: Vec3; size: Vec3; bevel: number };

/** Finger tip point in its link's frame, for strings and overlays. */
export interface TipPoint {
  link: string;
  point: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/**
 * Draws each link from the joint origins alone, since the STL meshes are not shipped: a capsule from the link origin to
 * each child joint, and for a fingertip a capsule out to twice the centre of mass (the mass sits mid-segment). The palm
 * (the root link) becomes a bevelled block that spans its finger bases, with a round flange behind it for the mount.
 */
export function linkShapes(model: UrdfModel): { shapes: Map<string, LinkShape[]>; tips: Partial<Record<Finger, TipPoint>> } {
  const shapes = new Map<string, LinkShape[]>();
  const tips: Partial<Record<Finger, TipPoint>> = {};
  const byParent = new Map<string, UrdfJoint[]>();
  for (const j of model.joints) byParent.set(j.parent, [...(byParent.get(j.parent) ?? []), j]);

  for (const link of model.links) {
    const children = byParent.get(link.name) ?? [];
    const out: LinkShape[] = [];
    if (link.name === model.root) {
      // Palm: from just behind the origin to the furthest finger base, as wide as the bases plus a finger radius.
      const bases = children.map((j) => j.origin.xyz);
      const reach = Math.max(0.05, ...bases.map((b) => b[0]));
      const halfZ = Math.max(0.02, ...bases.map((b) => Math.abs(b[2]))) + RADII.finger + 0.002;
      const back = -0.012;
      out.push({ kind: 'box', center: [(back + reach) / 2, 0, 0], size: [reach - back, 0.031, halfZ * 2], bevel: 0.008 });
      out.push({ kind: 'capsule', from: [back - 0.004, 0, 0], to: [back - 0.03, 0, 0], radius: 0.021 });
    } else if (children.length) {
      const finger = fingerOfName(link.name);
      const first = !finger || /_0_link$/.test(link.name);
      const radius = finger === 'thumb' && first ? RADII.thumbBase : RADII.finger;
      for (const j of children) out.push({ kind: 'capsule', from: [0, 0, 0], to: j.origin.xyz, radius });
    } else {
      // A fingertip: the centre of mass is halfway along the segment.
      const com = link.inertialOrigin;
      const to: Vec3 = com && len(com) > 1e-4 ? scale(com, 2) : [0.04, 0, 0];
      out.push({ kind: 'capsule', from: [0, 0, 0], to, radius: RADII.tip });
      const finger = fingerOfName(link.name);
      if (finger) tips[finger] = { link: link.name, point: to };
    }
    shapes.set(link.name, out);
  }
  return { shapes, tips };
}

/** Rz(yaw) Ry(pitch) Rx(roll), the URDF fixed-axis convention, as a three.js quaternion. */
export function rpyToQuaternion(rpy: Vec3, out = new Quaternion()): Quaternion {
  return out.setFromEuler(new Euler(rpy[0], rpy[1], rpy[2], 'ZYX'));
}

/**
 * Transform of every link in the root link's frame for the joint values `q` (radians; missing joints read as 0).
 * child = parent * T(origin) * R(rpy) * R(axis, q).
 */
export function forwardKinematics(model: UrdfModel, q: Record<string, number> = {}): Map<string, Matrix4> {
  const world = new Map<string, Matrix4>();
  world.set(model.root, new Matrix4());
  const pending = [...model.joints];
  const fixed = new Quaternion();
  const turn = new Quaternion();
  const axis = new Vector3();
  const local = new Matrix4();
  // Joints may appear in any order in the file: place a child once its parent is placed.
  let guard = 0;
  while (pending.length && guard++ < 1000) {
    const j = pending.shift() as UrdfJoint;
    const parent = world.get(j.parent);
    if (!parent) {
      pending.push(j);
      continue;
    }
    rpyToQuaternion(j.origin.rpy, fixed);
    axis.set(...j.axis).normalize();
    turn.setFromAxisAngle(axis, q[j.name] ?? 0);
    local.compose(new Vector3(...j.origin.xyz), fixed.multiply(turn), new Vector3(1, 1, 1));
    world.set(j.child, parent.clone().multiply(local));
  }
  return world;
}

/** World point of a link-frame point, in the root frame. */
export function pointInRoot(world: Map<string, Matrix4>, link: string, point: Vec3, out = new Vector3()): Vector3 {
  const m = world.get(link);
  out.set(...point);
  return m ? out.applyMatrix4(m) : out;
}

/**
 * Change of basis from the URDF frame to hand space (unscaled): the images of the URDF x, y and z axes as columns.
 * Fingers (+x) go along -z. The palm normal (+y right, -y left) goes down (-y). The third axis completes a proper
 * rotation, which puts the index on the thumb side for both hands.
 */
export function urdfToHandMatrix(side: Side, out = new Matrix4()): Matrix4 {
  const x = new Vector3(0, 0, -1);
  const y = new Vector3(0, side === 'right' ? -1 : 1, 0);
  const z = new Vector3(side === 'right' ? -1 : 1, 0, 0);
  return out.makeBasis(x, y, z);
}

/** Joint values that put every joint at zero: the Dex3-1's straight, open hand. */
export function restPose(model: UrdfModel): Record<string, number> {
  const q: Record<string, number> = {};
  for (const j of movableJoints(model)) q[j.name] = 0;
  return q;
}

/** Clamps a joint value to the URDF range. */
export function clampToLimits(j: Pick<UrdfJoint, 'lower' | 'upper'>, value: number): number {
  return Math.min(j.upper, Math.max(j.lower, value));
}

export { sub as vecSub };
