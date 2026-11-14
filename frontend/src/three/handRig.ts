import {
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import type { Finger, Side } from '../api/types';
import type { StageColors } from '../theme/themes';
import { FINGER_SPECS, PALM, type FingerSpec } from './anatomy';
import { createHandMaterials, type HandMaterialSet, type HandStyle } from './materials';
import type { HandSmoother } from './smoothing';

export interface FingerRig {
  name: Finger;
  spec: FingerSpec;
  base: Group;
  /** MCP, PIP, DIP joint groups (CMC, MCP, IP for the thumb). Rotate about x to flex. */
  joints: [Group, Group, Group];
  /** Group at the fingertip, for trails and key presses. */
  tip: Group;
  mat: Material;
}

export interface HandRig {
  /** Mirrored for left hands. Add props (racket) as children. */
  root: Group;
  fingers: FingerRig[];
  style: HandStyle;
  materials: HandMaterialSet;
  /** Tints one finger's fill (null restores the base colour). Cheap; call from effects, not per frame. */
  setFingerTint: (finger: Finger, color: string | null) => void;
  dispose: () => void;
}

const geoCache = new Map<string, BufferGeometry>();

function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

function inflated(geo: BufferGeometry, amount: number): BufferGeometry {
  return cached(`${geo.uuid}|infl${amount}`, () => {
    const g = geo.clone();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * amount, p.getY(i) + n.getY(i) * amount, p.getZ(i) + n.getZ(i) * amount);
    p.needsUpdate = true;
    return g;
  });
}

function capsuleZ(r: number, len: number): BufferGeometry {
  return cached(`cap:${r.toFixed(3)}:${len.toFixed(3)}`, () => {
    const g = new CapsuleGeometry(r, Math.max(0.01, len - r * 1.2), 6, 16);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, -len / 2);
    return g;
  });
}

function wristGeometry(): BufferGeometry {
  return cached('wrist', () => {
    const c = new CylinderGeometry(0.235, 0.27, 0.36, 32, 1, false);
    c.rotateX(Math.PI / 2);
    c.scale(1.12, 0.64, 1);
    return c;
  });
}

function cuffGeometry(): BufferGeometry {
  return cached('cuff', () => {
    const c = new TorusGeometry(0.25, 0.03, 10, 36);
    c.scale(1.12, 0.64, 1);
    return c;
  });
}

function ellipsoid(rx: number, ry: number, rz: number): BufferGeometry {
  return cached(`ell:${rx}:${ry}:${rz}`, () => {
    const g = new SphereGeometry(1, 28, 18);
    g.scale(rx, ry, rz);
    return g;
  });
}

const gauss = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

/**
 * A lofted palm: superellipse sections from the wrist (s=0) to the knuckle line (s=1), wider on the thumb side
 * (thenar swell) and gently arched, which avoids the blobby capsule look from above.
 */
function palmGeometry(squareness: number): BufferGeometry {
  return cached(`palm:${squareness}`, () => {
    const NS = 26;
    const NR = 32;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const e = 2 / squareness;
    const capA = 0.1;
    const capB = 0.045;
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      const z = PALM.zWrist + (PALM.zKnuckle - PALM.zWrist) * s;
      const wl = 0.3 + 0.06 * s + 0.1 * gauss(s, 0.33, 0.2);
      const wr = 0.27 + 0.08 * s + 0.03 * gauss(s, 0.55, 0.25);
      const h = 0.1 + 0.05 * Math.pow(Math.sin(Math.PI * s), 0.6);
      const yc = 0.012 * Math.sin(Math.PI * s) - 0.01;
      let k = 1;
      if (s < capA) k = Math.sqrt(Math.max(0, 1 - ((capA - s) / capA) ** 2));
      else if (s > 1 - capB) k = Math.sqrt(Math.max(0, 1 - ((s - (1 - capB)) / capB) ** 2));
      for (let j = 0; j < NR; j++) {
        const a = (j / NR) * Math.PI * 2;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const xs = Math.sign(c) * Math.pow(Math.abs(c), e);
        let ys = Math.sign(sn) * Math.pow(Math.abs(sn), e);
        if (ys < 0) ys *= 0.86;
        pos.push((xs >= 0 ? wr : wl) * xs * k, yc + h * ys * k, z);
        uv.push(j / NR, s);
      }
    }
    for (let i = 0; i < NS; i++)
      for (let j = 0; j < NR; j++) {
        const a = i * NR + j;
        const b = i * NR + ((j + 1) % NR);
        const c = (i + 1) * NR + j;
        const d = (i + 1) * NR + ((j + 1) % NR);
        idx.push(a, c, b, b, c, d);
      }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

/** Builds the full articulated rig for one hand. Geometry is cached module-wide; materials are owned by the rig. */
export function buildHandRig(style: HandStyle, stage: StageColors, side: Side, tint?: string): HandRig {
  const mats = createHandMaterials(style, stage, tint);
  const isWood = style === 'wood';
  const root = new Group();
  if (side === 'left') root.scale.x = -1;

  const palmMat = mats.fill();
  const fingerMats: Material[] = [];

  const part = (parent: Group, geo: BufferGeometry, mat: Material, outline = mats.outline, line: Material | null = mats.line): Mesh => {
    const m = new Mesh(geo, mat);
    parent.add(m);
    if (line && outline > 0) parent.add(new Mesh(inflated(geo, outline), line));
    return m;
  };
  /** Adds a fill part and its outline as a pair sharing one transform group. */
  const placed = (parent: Group, geo: BufferGeometry, mat: Material, x: number, y: number, z: number, ry = 0, rz = 0) => {
    const g = new Group();
    g.position.set(x, y, z);
    g.rotation.set(0, ry, rz);
    parent.add(g);
    part(g, geo, mat);
    return g;
  };

  /* palm, wrist, thenar, hypothenar and the thumb web */
  part(root, palmGeometry(isWood ? 3.6 : 2.5), palmMat);
  placed(root, wristGeometry(), palmMat, 0, -0.01, 0.33);
  if (!isWood) placed(root, cuffGeometry(), palmMat, 0, -0.01, 0.5);
  placed(root, ellipsoid(0.17, 0.085, 0.27), palmMat, -0.3, -0.075, -0.3, 0.45);
  placed(root, ellipsoid(0.1, 0.07, 0.27), palmMat, 0.27, -0.055, -0.4, -0.08);
  placed(root, ellipsoid(0.1, 0.045, 0.27), palmMat, -0.38, -0.02, -0.64, -0.56);

  if (isWood) {
    const ball = ellipsoid(0.2, 0.15, 0.2);
    placed(root, ball, palmMat, 0, -0.01, 0.2);
    pegAcross(root, mats, 0, -0.01, 0.2, 0.26);
  }

  const fingers: FingerRig[] = FINGER_SPECS.map((spec) => {
    const mat = mats.fill();
    fingerMats.push(mat);
    const base = new Group();
    base.position.set(spec.base[0], spec.base[1], spec.base[2]);
    base.rotation.order = 'YXZ';
    base.rotation.y = spec.yaw;
    base.rotation.z = spec.roll;
    root.add(base);

    const knuckleR = spec.rad[0] * (isWood ? 1.02 : 1.14);
    part(base, ellipsoid(knuckleR, knuckleR * (isWood ? 1 : 0.88), knuckleR), mat);
    if (isWood) pegAcross(base, mats, 0, 0, 0, spec.rad[0] * 1.3);

    const joints: Group[] = [];
    let parent: Group = base;
    spec.lens.forEach((len, si) => {
      const j = new Group();
      parent.add(j);
      const r = spec.rad[si];
      if (isWood) {
        const segLen = len * 0.8;
        const geo = cached(`wseg:${r.toFixed(3)}:${segLen.toFixed(3)}`, () => {
          const g = new CapsuleGeometry(r * 0.94, Math.max(0.01, segLen - r * 1.6), 6, 16);
          g.rotateX(Math.PI / 2);
          g.translate(0, 0, -(len * 0.12 + segLen / 2));
          return g;
        });
        part(j, geo, mat);
        if (si > 0) {
          part(j, ellipsoid(r * 0.78, r * 0.78, r * 0.78), mat);
          pegAcross(j, mats, 0, 0, 0, r * 1.15);
        }
      } else {
        part(j, capsuleZ(r, len), mat);
      }
      joints.push(j);
      const next = new Group();
      next.position.z = -len;
      j.add(next);
      parent = next;
    });
    return { name: spec.name, spec, base, joints: joints as [Group, Group, Group], tip: parent, mat };
  });

  const baseColor = new Color();
  const rig: HandRig = {
    root,
    fingers,
    style,
    materials: mats,
    setFingerTint(finger, color) {
      const f = fingers.find((x) => x.name === finger);
      if (!f) return;
      const m = f.mat as Material & { color?: Color };
      if (!m.color) return;
      if (color) m.color.set(color);
      else m.color.copy(isWood ? baseColor.set('#ffffff') : mats.base);
    },
    dispose() {
      mats.dispose();
    },
  };
  return rig;
}

function pegAcross(parent: Group, mats: HandMaterialSet, x: number, y: number, z: number, halfLen: number): void {
  if (!mats.peg) return;
  const shaft = cached(`peg:${halfLen.toFixed(3)}`, () => {
    const g = new CylinderGeometry(0.02, 0.02, halfLen * 2, 10);
    g.rotateZ(Math.PI / 2);
    return g;
  });
  const cap = cached('pegCap', () => {
    const g = new CylinderGeometry(0.036, 0.036, 0.016, 12);
    g.rotateZ(Math.PI / 2);
    return g;
  });
  const grp = new Group();
  grp.position.set(x, y, z);
  grp.add(new Mesh(shaft, mats.peg));
  const a = new Mesh(cap, mats.peg);
  a.position.x = halfLen;
  const b = new Mesh(cap, mats.peg);
  b.position.x = -halfLen;
  grp.add(a, b);
  parent.add(grp);
}

/** Writes a smoothed pose onto the rig. Pure mutation, no allocation. */
export function applyPose(rig: HandRig, s: HandSmoother): void {
  for (let i = 0; i < 5; i++) {
    const f = rig.fingers[i];
    const spec = f.spec;
    f.base.rotation.y = spec.yaw + spec.spreadDir * s.spread[i];
    for (let k = 0; k < 3; k++) {
      const ang = s.flex[i * 3 + k];
      if (i === 0) {
        f.joints[k].rotation.x = -ang * 0.8;
        f.joints[k].rotation.y = k === 0 ? -ang * 0.5 : 0;
      } else {
        f.joints[k].rotation.x = -ang;
      }
    }
  }
}
