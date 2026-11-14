import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Group, Quaternion, Vector3, type Bone } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { curlsToFlexion } from '../src/three/motion';
import { FINGER_ORDER } from '../src/three/anatomy';
import { buildHandTemplate, type HandTemplate } from '../src/three/handModel';
import { applyHandPose, createBones, jointQuaternion, PINCH, signedAngle } from '../src/three/handPose';

let tpl: HandTemplate;

beforeAll(async () => {
  const buf = fs.readFileSync(path.resolve(__dirname, '../public/models/hands/right.glb'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new GLTFLoader().parseAsync(ab, '');
  tpl = buildHandTemplate(gltf.scene);
});

/** Poses a fresh skeleton and returns world positions (hand space) of every bone. */
function pose(curls: number[], spread: number[] = [0, 0, 0, 0, 0]): { tip: Vector3[]; knuckle: Vector3[]; bones: Bone[] } {
  const root = new Group();
  const bones = createBones(tpl.layout, root);
  const fl = curlsToFlexion(curls);
  const flex = FINGER_ORDER.flatMap((f) => fl[f]);
  applyHandPose(bones, tpl.layout, flex, spread);
  root.updateMatrixWorld(true);
  const at = (i: number) => bones[i].getWorldPosition(new Vector3());
  return {
    tip: tpl.layout.fingers.map((f) => at(f.tip)),
    knuckle: tpl.layout.fingers.map((f) => at(f.joints[0].bone)),
    bones,
  };
}

/** Flexion triples straight from radians, thumb first. */
function poseRad(flex: number[], spread = [0, 0, 0, 0, 0]) {
  const root = new Group();
  const bones = createBones(tpl.layout, root);
  applyHandPose(bones, tpl.layout, flex, spread);
  root.updateMatrixWorld(true);
  return tpl.layout.fingers.map((f) => bones[f.tip].getWorldPosition(new Vector3()));
}

describe('hand template', () => {
  it('lands in hand space: palm down, fingers along -z, thumb towards -x', () => {
    const p = tpl.layout.palm;
    expect(p.palmar.y).toBeLessThan(-0.97);
    expect(p.distal.z).toBeLessThan(-0.97);
    expect(p.radial.x).toBeLessThan(-0.97);
  });

  it('is one welded, closed, subdivided skin whose weights sum to one', () => {
    const g = tpl.geometry;
    expect(g.attributes.position.count).toBeGreaterThan(4000);
    const idx = g.index!.array;
    const edges = new Map<string, number>();
    for (let t = 0; t < idx.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = idx[t + k];
        const b = idx[t + ((k + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
    const w = g.attributes.skinWeight;
    for (let i = 0; i < w.count; i += 97) expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 4);
  });

  it('finds the finger flex axis on the bone local x axis, as the WebXR joint convention says', () => {
    for (const f of tpl.layout.fingers.slice(1)) for (const j of f.joints) expect(Math.abs(j.flexAxis.x)).toBeGreaterThan(0.9);
  });

  it('reproduces the bind pose when given the bind flexion and no spread', () => {
    const q = new Quaternion();
    for (const f of tpl.layout.fingers)
      for (const j of f.joints) {
        jointQuaternion(tpl.layout.bones[j.bone].quaternion, j, j.bindFlex, 0, 0, q);
        expect(q.angleTo(tpl.layout.bones[j.bone].quaternion)).toBeLessThan(1e-3);
      }
  });
});

describe('flexion to bones', () => {
  it('straightens every finger at zero flexion: phalanges in line, knuckle unbent in the flexion plane', () => {
    const root = new Group();
    const bones = createBones(tpl.layout, root);
    applyHandPose(bones, tpl.layout, new Array(15).fill(0), [0, 0, 0, 0, 0]);
    root.updateMatrixWorld(true);
    const at = (i: number) => bones[i].getWorldPosition(new Vector3());
    for (const f of tpl.layout.fingers.slice(1)) {
      const mcp = f.joints[0].bone;
      const meta = at(mcp).sub(at(tpl.layout.bones[mcp].parent)).normalize();
      const prox = at(f.joints[1].bone).sub(at(mcp)).normalize();
      const rest = at(f.tip).sub(at(f.joints[1].bone)).normalize();
      expect(Math.acos(Math.min(1, prox.dot(rest)))).toBeLessThan(0.12);
      const axis = f.joints[0].flexAxis.clone().applyQuaternion(bones[mcp].getWorldQuaternion(new Quaternion()));
      expect(Math.abs(signedAngle(meta, prox, axis))).toBeLessThan(0.02);
    }
  });

  it('curls a full fist into the palm: tips below the knuckles and back towards the wrist', () => {
    const open = pose([0, 0, 0, 0, 0]);
    const fist = pose([0.9, 1, 1, 1, 1]);
    for (let f = 1; f < 5; f++) {
      expect(fist.tip[f].y).toBeLessThan(fist.knuckle[f].y - 0.2);
      expect(fist.tip[f].z).toBeGreaterThan(fist.knuckle[f].z);
      expect(fist.tip[f].distanceTo(tpl.layout.palm.centre)).toBeLessThan(open.tip[f].distanceTo(tpl.layout.palm.centre) * 0.6);
    }
  });

  it('moves a tip monotonically palmwards as one joint flexes', () => {
    let lastY = Infinity;
    for (const a of [0, 0.4, 0.8, 1.2]) {
      const flex = new Array(15).fill(0);
      flex[3 * 2 + 1] = a;
      const y = poseRad(flex)[2].y;
      expect(y).toBeLessThan(lastY);
      lastY = y;
    }
  });

  it('opposes the thumb across the front of the palm', () => {
    const open = pose([0, 0, 0, 0, 0]);
    const bent = pose([1, 0, 0, 0, 0]);
    expect(bent.tip[0].x).toBeGreaterThan(open.tip[0].x + 0.3);
    expect(bent.tip[0].y).toBeLessThan(tpl.layout.palm.centre.y - 0.3);
  });

  it('lays the thumb over the index and middle fingers in a fist', () => {
    const fist = pose([0.7, 0.8, 0.85, 0.9, 0.9]);
    const at = (i: number) => fist.bones[i].getWorldPosition(new Vector3());
    const [index, middle] = [1, 2].map((f) => at(tpl.layout.fingers[f].joints[1].bone));
    const over = index.clone().lerp(middle, 0.5);
    expect(fist.tip[0].distanceTo(over)).toBeLessThan(0.25);
  });

  it('closes a pinch: thumb and index tips meet at the pinch curls', () => {
    // The synthesiser's pinch peak (thumb 0.45, index 0.5): the tip joints sit one fingertip's thickness apart.
    const pinch = pose([0.45, 0.5, 0, 0, 0]);
    expect(pinch.tip[0].distanceTo(pinch.tip[1])).toBeLessThan(0.2);
    // Halfway through the press the pads are still apart, so the pinch visibly opens and closes.
    const half = pose([0.22, 0.25, 0, 0, 0]);
    expect(half.tip[0].distanceTo(half.tip[1])).toBeGreaterThan(0.35);
  });

  it('leaves the thumb alone outside a pinch (open hand, fist, rabbit)', () => {
    const unaided = (curls: number[]) => {
      const keep = { ...PINCH };
      PINCH.near = PINCH.far = -1;
      try {
        return pose(curls).tip[0];
      } finally {
        Object.assign(PINCH, keep);
      }
    };
    for (const curls of [
      [0, 0, 0, 0, 0],
      [0.8, 0.95, 0.95, 0.95, 0.95],
      [0.7, 0, 0, 0.9, 0.9],
    ]) {
      expect(pose(curls).tip[0].distanceTo(unaided(curls))).toBeLessThan(1e-6);
    }
  });

  it('spreads index and little away from the middle finger', () => {
    const flat = poseRad(new Array(15).fill(0));
    const wide = poseRad(new Array(15).fill(0), [0, 0.3, 0.3, 0.3, 0.3]);
    expect(wide[1].x).toBeLessThan(flat[1].x - 0.1);
    expect(wide[4].x).toBeGreaterThan(flat[4].x + 0.1);
    expect(wide[2].distanceTo(flat[2])).toBeLessThan(1e-6);
  });

  it('measures signed angles about an axis', () => {
    const x = new Vector3(1, 0, 0);
    expect(signedAngle(new Vector3(0, 0, -1), new Vector3(0, 1, 0), x)).toBeCloseTo(Math.PI / 2);
    expect(signedAngle(new Vector3(0, 0, -1), new Vector3(0, -1, 0), x)).toBeCloseTo(-Math.PI / 2);
  });
});
