import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BackSide,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Finger } from '../../api/types';
import { getWalnutTextures } from '../surfaces';
import { useStageColors } from '../stageContext';
import { flexSign, jointFrame, linkInfo, robotFingers, ROBOT_SCALE, urdfToHand } from './kinematics';
import type { UrdfJoint, UrdfModel, Vec3 } from './urdf';

/**
 * The robot twin: a Unitree Dex3-1 hand built from its URDF kinematics (joint origins, axes and limits) and drawn as a
 * Renaissance automaton, because the STL meshes are not shipped: walnut segments, aged brass hinge pins and a wrist
 * flange, and a fine ink outline like the chalk hand's. Ring and little fingers, which Dex3-1 lacks, are faint dotted
 * ghosts so the gap reads. Driven by joint targets in radians (a /ws/robot `q`), smoothed per frame in refs.
 */

/** Aged brass, browner and darker than the gold token so it never reads as mastery. */
const BRASS = '#8a6a3c';
const WALNUT_TINT = '#d9b48c';
const OUTLINE_M = 0.0011;
const SMOOTH_TAU_S = 0.05;

export interface RobotHandHandle {
  group: Group;
  /** World position of a fingertip, ghosts included; null for a finger the twin does not draw. */
  getTipWorld: (finger: Finger, out: Vector3) => Vector3 | null;
}

export interface RobotHandProps {
  model: UrdfModel;
  /** Latest joint targets by joint name (radians), read every frame, e.g. from useRobotStream().latest. */
  q?: RefObject<{ q: Record<string, number> } | null>;
  /** Called every frame instead of `q`, for replays. */
  getQ?: (t: number) => Record<string, number> | null;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Multiplies ROBOT_SCALE. */
  scale?: number;
  /** Draw the fingers the robot lacks as dotted ghosts. Default true. */
  showMissing?: boolean;
}

interface Pivot {
  joint: UrdfJoint;
  group: Group;
  axis: Vector3;
  value: number;
}

interface Built {
  root: Group;
  pivots: Pivot[];
  tips: Partial<Record<Finger, Object3D>>;
  /** Screen-space line material of the ghosts; its resolution follows the canvas. */
  lines: LineMaterial;
  dispose: () => void;
}

const UP = new Vector3(0, 1, 0);

/** Walnut segment with its ink hull, from a to b in the parent frame. */
function segment(parent: Object3D, a: Vec3, b: Vec3, radius: number, fill: Material, ink: Material, geos: BufferGeometry[]): void {
  const va = new Vector3(...a);
  const vb = new Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = Math.max(1e-4, dir.length());
  const q = new Quaternion().setFromUnitVectors(UP, dir.normalize());
  const mid = va.add(vb).multiplyScalar(0.5);
  const body = new CapsuleGeometry(radius, len, 6, 14);
  const hull = new CapsuleGeometry(radius + OUTLINE_M, len, 6, 14);
  geos.push(body, hull);
  for (const [g, m] of [
    [body, fill],
    [hull, ink],
  ] as const) {
    const mesh = new Mesh(g, m);
    mesh.position.copy(mid);
    mesh.quaternion.copy(q);
    parent.add(mesh);
  }
}

/** A brass hinge pin across a joint, along its axis, with an ink rim. */
function pin(parent: Object3D, axis: Vec3, length: number, radius: number, brass: Material, ink: Material, geos: BufferGeometry[]): void {
  const g = new CylinderGeometry(radius, radius, length, 16);
  const h = new CylinderGeometry(radius + OUTLINE_M * 0.8, radius + OUTLINE_M * 0.8, length + OUTLINE_M * 1.6, 16);
  geos.push(g, h);
  const q = new Quaternion().setFromUnitVectors(UP, new Vector3(...axis).normalize());
  for (const [geo, m] of [
    [g, brass],
    [h, ink],
  ] as const) {
    const mesh = new Mesh(geo, m);
    mesh.quaternion.copy(q);
    parent.add(mesh);
  }
}

function dashedLine(points: Vector3[], mat: LineMaterial): Line2 {
  const geo = new LineGeometry();
  geo.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  const line = new Line2(geo, mat);
  line.computeLineDistances();
  return line;
}

/** A dotted finger outline (seen from above and the side) for a finger the robot does not have. */
function ghostFinger(parent: Object3D, base: Vector3, length: number, radius: number, palmSide: number, mat: LineMaterial): Object3D {
  const g = new Group();
  g.position.copy(base);
  const pts: Vector3[] = [];
  const n = 10;
  pts.push(new Vector3(0, 0, radius));
  pts.push(new Vector3(length - radius, 0, radius));
  for (let i = 1; i < n; i++) {
    const a = Math.PI / 2 - (i / n) * Math.PI;
    pts.push(new Vector3(length - radius + Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  pts.push(new Vector3(length - radius, 0, -radius));
  pts.push(new Vector3(0, 0, -radius));
  g.add(dashedLine(pts, mat));
  // A knuckle ring at the base and halfway, so the ghost reads as a finger with joints, not a slot.
  for (const x of [0, length * 0.47]) {
    const ring: Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ring.push(new Vector3(x, Math.cos(a) * radius * palmSide, Math.sin(a) * radius));
    }
    g.add(dashedLine(ring, mat));
  }
  const tip = new Object3D();
  tip.position.set(length, 0, 0);
  g.add(tip);
  parent.add(g);
  return tip;
}

function build(model: UrdfModel, ink: string, showMissing: boolean): Built {
  const geos: BufferGeometry[] = [];
  const w = getWalnutTextures([0.35, 0.35]);
  const walnut = new MeshStandardMaterial({ color: new Color(WALNUT_TINT), map: w.map, normalMap: w.normalMap, roughnessMap: w.roughnessMap, roughness: 0.62, metalness: 0 });
  const brass = new MeshStandardMaterial({ color: new Color(BRASS), metalness: 0.85, roughness: 0.38 });
  const inkMat = new MeshBasicMaterial({ color: new Color(ink), side: BackSide });
  const ghostMat = new LineMaterial({ color: new Color(ink).getHex(), linewidth: 2, dashed: true, dashSize: 0.0045, gapSize: 0.0035, transparent: true, opacity: 0.55, depthWrite: false });
  const mats: Material[] = [walnut, brass, inkMat, ghostMat];

  const info = linkInfo(model);
  const s = flexSign(model);
  const root = new Group();
  root.quaternion.copy(urdfToHand(model));
  root.scale.setScalar(ROBOT_SCALE);
  const pivots: Pivot[] = [];
  const tips: Partial<Record<Finger, Object3D>> = {};

  // Palm block, wrist flange and a short walnut socket, in the root link frame. The palm side is +s along y.
  const palm = new Group();
  root.add(palm);
  const palmGeo = new RoundedBoxGeometry(0.094, 0.028, 0.088, 3, 0.009);
  const palmHull = new RoundedBoxGeometry(0.094 + OUTLINE_M * 2, 0.028 + OUTLINE_M * 2, 0.088 + OUTLINE_M * 2, 3, 0.009 + OUTLINE_M);
  geos.push(palmGeo, palmHull);
  for (const [g, m] of [
    [palmGeo, walnut],
    [palmHull, inkMat],
  ] as const) {
    const mesh = new Mesh(g, m);
    mesh.position.set(0.042, -s * 0.005, 0);
    palm.add(mesh);
  }
  const flange = new Group();
  flange.position.set(-0.007, -s * 0.004, 0);
  pin(flange, [1, 0, 0], 0.01, 0.03, brass, inkMat, geos);
  palm.add(flange);
  segment(palm, [-0.05, -s * 0.004, 0], [-0.016, -s * 0.004, 0], 0.022, walnut, inkMat, geos);

  const visit = (link: string, parent: Object3D) => {
    for (const j of info[link]?.joints ?? []) {
      const frame = new Group();
      frame.matrixAutoUpdate = false;
      frame.matrix.copy(jointFrame(j));
      parent.add(frame);
      const piv = new Group();
      frame.add(piv);
      const axis = new Vector3(...j.axis).normalize();
      pivots.push({ joint: j, group: piv, axis, value: 0 });
      const child = info[j.child];
      const finger = child?.finger;
      const thumbBase = finger === 'thumb' && (child?.joints.length ?? 0) > 0 && info[link]?.finger !== 'thumb';
      const radius = thumbBase ? 0.0115 : child?.tip ? 0.0084 : 0.0094;
      pin(frame, j.axis, (thumbBase ? 0.028 : 0.024) + 0.002, thumbBase ? 0.0068 : 0.0056, brass, inkMat, geos);
      if (child) {
        segment(piv, [0, 0, 0], child.end, radius, walnut, inkMat, geos);
        if (child.tip && finger) {
          const tip = new Object3D();
          tip.position.set(...child.end);
          piv.add(tip);
          tips[finger] = tip;
        }
        visit(child.name, piv);
      }
    }
  };
  visit(model.root, palm);

  if (showMissing) {
    const have = new Set(robotFingers(model));
    const base = (f: Finger) => model.joints.find((j) => j.parent === model.root && info[j.child]?.finger === f);
    const idx = base('index');
    const mid = base('middle');
    if (idx && mid) {
      const step = new Vector3(...mid.xyz).sub(new Vector3(...idx.xyz)).multiplyScalar(0.72);
      const len = new Vector3(...(info[idx.child]?.end ?? [0.046, 0, 0])).length() + new Vector3(...(info[info[idx.child]?.joints[0]?.child ?? '']?.end ?? [0.052, 0, 0])).length();
      const missing = (['ring', 'little'] as Finger[]).filter((f) => !have.has(f));
      missing.forEach((f) => {
        const k = f === 'ring' ? 1 : 2;
        const b = new Vector3(...mid.xyz).add(step.clone().multiplyScalar(k)).add(new Vector3(-0.004 * k, 0, 0));
        tips[f] = ghostFinger(palm, b, len * (f === 'ring' ? 0.95 : 0.78), 0.0084, s, ghostMat);
      });
      if (missing.length) {
        // The palm's missing edge, dotted, so the ghosts hang off something.
        const z0 = mid.xyz[2] + 0.015 * Math.sign(mid.xyz[2] - idx.xyz[2]);
        const far = new Vector3(...mid.xyz).add(step.clone().multiplyScalar(missing.length + 0.4));
        const edge = [new Vector3(0.0, -s * 0.005, z0), new Vector3(0.0, -s * 0.005, far.z), new Vector3(0.07, -s * 0.005, far.z), new Vector3(0.082, -s * 0.005, z0)];
        palm.add(dashedLine(edge, ghostMat));
      }
    }
  }

  return {
    root,
    pivots,
    tips,
    lines: ghostMat,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      root.traverse((o) => {
        if (o instanceof Line2) o.geometry.dispose();
      });
    },
  };
}

const _m = new Matrix4();

/** The Dex3-1 twin. Joint values ease towards their targets; with no target the hand relaxes to 0, inside every limit. */
export const RobotHand = forwardRef<RobotHandHandle, RobotHandProps>(function RobotHand({ model, q, getQ, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, showMissing = true }, ref) {
  const stage = useStageColors();
  const outer = useRef<Group>(null);
  const built = useMemo(() => build(model, stage.ink, showMissing), [model, stage.ink, showMissing]);
  useEffect(() => () => built.dispose(), [built]);

  const handle = useMemo<RobotHandHandle>(
    () => ({
      get group() {
        return outer.current as Group;
      },
      getTipWorld: (finger, out) => {
        const t = built.tips[finger];
        if (!t) return null;
        return t.getWorldPosition(out);
      },
    }),
    [built],
  );
  useImperativeHandle(ref, () => handle, [handle]);

  useFrame((state, delta) => {
    built.lines.resolution.set(state.size.width, state.size.height);
    const target = getQ ? getQ(state.clock.elapsedTime) : (q?.current?.q ?? null);
    const k = 1 - Math.exp(-Math.min(delta, 0.1) / SMOOTH_TAU_S);
    for (const p of built.pivots) {
      const want = Math.min(p.joint.upper, Math.max(p.joint.lower, target?.[p.joint.name] ?? 0));
      p.value += (want - p.value) * k;
      if (p.joint.type === 'prismatic') p.group.position.copy(p.axis).multiplyScalar(p.value);
      else p.group.quaternion.setFromRotationMatrix(_m.makeRotationAxis(p.axis, p.value));
    }
  });

  return (
    <group ref={outer} position={position} rotation={rotation} scale={scale}>
      <primitive object={built.root} />
    </group>
  );
});
