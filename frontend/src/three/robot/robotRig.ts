import { BufferGeometry, CapsuleGeometry, Group, Mesh, Object3D, Quaternion, TorusGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Finger, Side } from '../../api/types';
import type { StageColors } from '../../theme/themes';
import { FINGER_ORDER } from '../anatomy';
import { clampToLimits, fingerOfName, linkShapes, rpyToQuaternion, URDF_TO_SCENE, urdfToHandMatrix, type LinkShape } from './kinematics';
import { createRobotMaterials, type RobotMaterialSet } from './robotMaterials';
import { movableJoints, type UrdfJoint, type UrdfModel, type Vec3 } from './urdf';

/**
 * One drawable robot hand built from a parsed URDF: a group per link, placed at its joint origin, with capsules for
 * the segments, a bevelled block for the palm, bronze rings on the joints and ghost capsules where the missing human
 * fingers would be. Joint values turn the link groups about their URDF axes; nothing here re-renders React.
 */

export interface RigJoint {
  name: string;
  /** The child link's group, turned about `axis`. */
  link: Group;
  axis: Vector3;
  /** The joint's fixed rotation (URDF rpy); the turn is composed on top. */
  base: Quaternion;
  lower: number;
  upper: number;
  finger: Finger | null;
}

export interface RobotRig {
  /** In hand space, already turned from the URDF frame and scaled to scene units. */
  root: Group;
  model: UrdfModel;
  links: Map<string, Group>;
  joints: RigJoint[];
  /** A point at the end of each robot finger, for strings. */
  tips: Partial<Record<Finger, Object3D>>;
  fingers: Finger[];
  missing: Finger[];
  materials: RobotMaterialSet;
  setFingerTint: (finger: Finger, color: string | null) => void;
  dispose: () => void;
}

const UP = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/** How much shorter the ghost ring and little fingers are than the middle, as on a human hand. */
const GHOST_SCALE: Partial<Record<Finger, number>> = { ring: 0.92, little: 0.76 };
/** Metres between neighbouring ghost fingers. */
const GHOST_SPACING = 0.022;

function capsule(from: Vec3, to: Vec3, radius: number, geos: BufferGeometry[]): { geo: BufferGeometry; position: Vector3; quaternion: Quaternion } {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const dir = b.clone().sub(a);
  const length = Math.max(0.001, dir.length() - radius * 0.5);
  const geo = new CapsuleGeometry(radius, length, 4, 14);
  geos.push(geo);
  const quaternion = new Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  return { geo, position: a.clone().add(b).multiplyScalar(0.5), quaternion };
}

export function buildRobotRig(model: UrdfModel, side: Side, stage: StageColors, showMissing = true): RobotRig {
  const materials = createRobotMaterials(stage);
  const geos: BufferGeometry[] = [];
  const root = new Group();
  root.quaternion.setFromRotationMatrix(urdfToHandMatrix(side));
  root.scale.setScalar(URDF_TO_SCENE);

  const links = new Map<string, Group>();
  for (const l of model.links) {
    const g = new Group();
    g.name = l.name;
    links.set(l.name, g);
  }
  const palm = links.get(model.root) as Group;
  root.add(palm);

  const { shapes, tips: tipPoints } = linkShapes(model);
  const addShape = (link: Group, shape: LinkShape, fill: Mesh['material'], outline = true) => {
    if (shape.kind === 'capsule') {
      const c = capsule(shape.from, shape.to, shape.radius, geos);
      const m = new Mesh(c.geo, fill);
      m.position.copy(c.position);
      m.quaternion.copy(c.quaternion);
      link.add(m);
      if (outline) {
        const o = new Mesh(c.geo, materials.outline);
        o.position.copy(c.position);
        o.quaternion.copy(c.quaternion);
        link.add(o);
      }
      return;
    }
    const geo = new RoundedBoxGeometry(shape.size[0], shape.size[1], shape.size[2], 3, shape.bevel);
    geos.push(geo);
    const m = new Mesh(geo, fill);
    m.position.set(...shape.center);
    link.add(m);
    if (outline) {
      const o = new Mesh(geo, materials.outline);
      o.position.set(...shape.center);
      link.add(o);
    }
  };

  for (const l of model.links) {
    const g = links.get(l.name) as Group;
    const finger = l.name === model.root ? null : fingerOfName(l.name);
    const fill = finger ? materials.fingers[finger] : materials.palm;
    for (const s of shapes.get(l.name) ?? []) addShape(g, s, fill);
  }

  // Joints: place each child link in its parent, remember the axis, and ring the joint in bronze.
  const joints: RigJoint[] = [];
  const ringGeos = new Map<number, TorusGeometry>();
  for (const j of model.joints) {
    const parent = links.get(j.parent);
    const child = links.get(j.child);
    if (!parent || !child) continue;
    child.position.set(...j.origin.xyz);
    const base = rpyToQuaternion(j.origin.rpy);
    child.quaternion.copy(base);
    parent.add(child);
    if (!movableJoints(model).includes(j)) continue;
    const axis = new Vector3(...j.axis).normalize();
    joints.push({ name: j.name, link: child, axis, base, lower: j.lower, upper: j.upper, finger: fingerOfName(j.name) });
    const radius = ringRadius(j, shapes);
    const key = Math.round(radius * 1e4);
    let ring = ringGeos.get(key);
    if (!ring) {
      ring = new TorusGeometry(radius, 0.0013, 8, 28);
      ringGeos.set(key, ring);
      geos.push(ring);
    }
    const r = new Mesh(ring, materials.bronze);
    r.position.set(...j.origin.xyz);
    r.quaternion.copy(base).multiply(new Quaternion().setFromUnitVectors(Z, axis));
    parent.add(r);
  }

  // Tips: an empty object at the end of each terminal link.
  const tips: Partial<Record<Finger, Object3D>> = {};
  for (const f of FINGER_ORDER) {
    const tp = tipPoints[f];
    const link = tp && links.get(tp.link);
    if (!tp || !link) continue;
    const o = new Object3D();
    o.position.set(...tp.point);
    link.add(o);
    tips[f] = o;
  }

  const fingers = FINGER_ORDER.filter((f) => tips[f]);
  const missing = FINGER_ORDER.filter((f) => !tips[f]);

  // Ghosts of the fingers the robot lacks, stepping away from the index past the last real finger.
  if (showMissing && missing.length) {
    const bases = movableJoints(model).filter((j) => j.parent === model.root && /_0_joint$/.test(j.name) && fingerOfName(j.name) !== 'thumb');
    const index = bases.find((j) => fingerOfName(j.name) === 'index');
    const last = bases.find((j) => fingerOfName(j.name) === 'middle') ?? bases[bases.length - 1];
    if (index && last) {
      // Human finger spacing (about 2.2 cm), not the robot's wide 5.7 cm index-to-middle gap, so the ghosts sit by the
      // middle finger like a hand's ring and little finger instead of floating off the palm.
      const step = Math.sign(last.origin.xyz[2] - index.origin.xyz[2]) * GHOST_SPACING;
      const lastLength = fingerLength(model, last);
      missing.forEach((f, i) => {
        const k = GHOST_SCALE[f] ?? 0.8;
        const base: Vec3 = [last.origin.xyz[0], last.origin.xyz[1], last.origin.xyz[2] + step * (i + 1)];
        const tip: Vec3 = [base[0] + lastLength * k, base[1], base[2]];
        addShape(palm, { kind: 'capsule', from: base, to: tip, radius: 0.0095 }, materials.ghost, false);
      });
    }
  }

  return {
    root,
    model,
    links,
    joints,
    tips,
    fingers,
    missing,
    materials,
    setFingerTint: materials.setTint,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      materials.dispose();
    },
  };
}

function ringRadius(j: UrdfJoint, shapes: Map<string, LinkShape[]>): number {
  const own = shapes.get(j.child)?.find((s) => s.kind === 'capsule');
  return (own && own.kind === 'capsule' ? own.radius : 0.0105) + 0.0022;
}

/** Straight length of a finger chain from its base joint to its tip point, in metres. */
function fingerLength(model: UrdfModel, base: UrdfJoint): number {
  let total = 0;
  let link = base.child;
  const { tips } = linkShapes(model);
  for (let guard = 0; guard < 10; guard++) {
    const next = model.joints.find((j) => j.parent === link);
    if (!next) break;
    total += Math.hypot(...next.origin.xyz);
    link = next.child;
  }
  const tip = Object.values(tips).find((t) => t && t.link === link);
  return total + (tip ? Math.hypot(...tip.point) : 0.04);
}

const turn = new Quaternion();

/** Turns every joint to `q` (radians by URDF name, clamped to the limits; a missing joint reads as 0). */
export function applyRobotPose(rig: RobotRig, q: Record<string, number>): void {
  for (const j of rig.joints) {
    const angle = clampToLimits(j, q[j.name] ?? 0);
    turn.setFromAxisAngle(j.axis, angle);
    j.link.quaternion.copy(j.base).multiply(turn);
  }
}
