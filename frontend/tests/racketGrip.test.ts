import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Euler, Group, Line3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { curlsToFlexion } from '../src/three/motion';
import { FINGER_ORDER } from '../src/three/anatomy';
import { buildHandTemplate } from '../src/three/handModel';
import { applyHandPose, createBones } from '../src/three/handPose';
import { RACKET_BLADE, RACKET_GRIP } from '../src/three/props';

/** The shakehand grip curls the table tennis guide motion holds (mock/synth.ts GRIP_CURLS). */
const SHAKEHAND = [0.62, 0.8, 0.84, 0.86, 0.88];

let segs: { name: string; line: Line3 }[] = [];
let thumbTip = new Vector3();

beforeAll(async () => {
  const buf = fs.readFileSync(path.resolve(__dirname, '../public/models/hands/right.glb'));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  const tpl = buildHandTemplate(gltf.scene);
  const root = new Group();
  const bones = createBones(tpl.layout, root);
  const fl = curlsToFlexion(SHAKEHAND);
  applyHandPose(bones, tpl.layout, FINGER_ORDER.flatMap((n) => fl[n]), [0, 0, 0, 0, 0]);
  root.updateMatrixWorld(true);
  const at = (i: number) => bones[i].getWorldPosition(new Vector3());
  segs = tpl.layout.bones.flatMap((b, i) => (b.parent < 0 ? [] : [{ name: b.name, line: new Line3(at(b.parent), at(i)) }]));
  thumbTip = at(tpl.layout.fingers[0].tip);
});

/** A point along the racket's own axis (x), in hand space. */
const onRacket = (x: number) =>
  new Vector3(x * RACKET_GRIP.scale, 0, 0).applyEuler(new Euler(...RACKET_GRIP.rotation)).add(new Vector3(...RACKET_GRIP.position));

const nearestBone = (p: Vector3) => Math.min(...segs.map((s) => s.line.closestPointToPoint(p, true, new Vector3()).distanceTo(p)));

describe('racket grip', () => {
  it('runs the handle through the curled fingers, clear of every bone but wrapped by them', () => {
    // Throat (-0.62) to just inside the butt (0.5) in the racket's own units; the butt itself sticks out of the hand.
    for (let k = 0; k <= 7; k++) {
      const d = nearestBone(onRacket(-0.62 + (1.12 * k) / 8));
      expect(d).toBeGreaterThan(0.13);
      expect(d).toBeLessThan(0.3);
    }
  });

  it('puts the throat at the thumb and the blade beyond the index finger side', () => {
    const throat = onRacket(-0.62);
    const nearest = segs.reduce((a, b) => (a.line.closestPointToPoint(throat, true, new Vector3()).distanceTo(throat) <= b.line.closestPointToPoint(throat, true, new Vector3()).distanceTo(throat) ? a : b));
    expect(nearest.name.startsWith('thumb')).toBe(true);
    expect(throat.distanceTo(thumbTip)).toBeLessThan(0.5);
    // Thumb and index finger are on -x, fingertips on -z.
    expect(RACKET_BLADE.x).toBeLessThan(-0.9);
    expect(RACKET_BLADE.z).toBeLessThan(-1);
  });

  it('lets the butt come out past the little finger', () => {
    expect(onRacket(0.5).x).toBeGreaterThan(0.55);
  });
});
