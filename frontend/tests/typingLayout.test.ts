import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { curlsToFlexion } from '../src/three/motion';
import { FINGER_ORDER } from '../src/three/anatomy';
import { buildHandTemplate, type HandTemplate } from '../src/three/handModel';
import { applyHandPose, createBones } from '../src/three/handPose';
import { HOME_Z, INDEX_TIP_X, KEY_PITCH, keyCenter, SPACE, TYPING_HAND_X } from '../src/three/typingLayout';
import { HOVER } from '../src/features/apprentice/typing/typist';

let tpl: HandTemplate;

beforeAll(async () => {
  const buf = fs.readFileSync(path.resolve(__dirname, '../public/models/hands/right.glb'));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  tpl = buildHandTemplate(gltf.scene);
});

/** Fingertips of the right hand model in the hover pose, in hand space. */
function hoverTips(): Vector3[] {
  const root = new Group();
  const bones = createBones(tpl.layout, root);
  const fl = curlsToFlexion(FINGER_ORDER.map((f) => HOVER[f]));
  applyHandPose(bones, tpl.layout, FINGER_ORDER.flatMap((f) => fl[f]), [0, 0, 0, 0, 0]);
  root.updateMatrixWorld(true);
  return tpl.layout.fingers.map((f) => bones[f.tip].getWorldPosition(new Vector3()));
}

describe('the typing keyboard layout', () => {
  it('lays out the home row evenly with G and H either side of the middle, and staggers the rows', () => {
    expect(keyCenter('f')).toEqual([-1.5 * KEY_PITCH, HOME_Z]);
    expect(keyCenter('J')).toEqual([1.5 * KEY_PITCH, HOME_Z]);
    expect(keyCenter('g')![0]).toBeCloseTo(-0.5 * KEY_PITCH);
    expect(keyCenter('q')![0]).toBeCloseTo(keyCenter('a')![0] - 0.25 * KEY_PITCH);
    expect(keyCenter('z')![0]).toBeCloseTo(keyCenter('a')![0] + 0.5 * KEY_PITCH);
    expect(keyCenter('q')![1]).toBeLessThan(HOME_Z);
    expect(keyCenter('z')![1]).toBeGreaterThan(HOME_Z);
    expect(keyCenter(' ')).toEqual([SPACE.x, SPACE.z]);
    expect(keyCenter('1')).toBeNull();
  });

  it('puts each fingertip of the hover pose over its home key (measured on the hand model)', () => {
    const tips = hoverTips();
    expect(tips[1].x).toBeCloseTo(INDEX_TIP_X, 1);
    // Right hand: index over J, middle over K, ring over L, little over the semicolon, within a third of a key.
    const keys = ['j', 'k', 'l', ';'];
    keys.forEach((k, i) => expect(Math.abs(TYPING_HAND_X + tips[i + 1].x - keyCenter(k)![0])).toBeLessThan(KEY_PITCH / 3));
  });
});
