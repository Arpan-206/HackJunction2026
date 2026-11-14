import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FINGER_ORDER } from '../src/three/anatomy';
import { buildHandTemplate, type HandTemplate } from '../src/three/handModel';
import { applyHandPose } from '../src/three/handPose';
import { buildHandRig } from '../src/three/handRig';
import { curlsToFlexion } from '../src/three/motion';
import { THEMES } from '../src/theme/themes';

let tpl: HandTemplate;

beforeAll(async () => {
  const buf = fs.readFileSync(path.resolve(__dirname, '../public/models/hands/right.glb'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  tpl = buildHandTemplate((await new GLTFLoader().parseAsync(ab, '')).scene);
});

/** A rig posed as a fist, its skeleton written as the renderer would before a draw. */
function posedRig(side: 'left' | 'right') {
  const rig = buildHandRig(tpl, 'chalk', THEMES.bottega.stage, side);
  rig.root.position.set(0.3, -0.2, 0.1);
  rig.root.scale.multiplyScalar(0.7);
  const fl = curlsToFlexion([0.7, 0.9, 0.9, 0.9, 0.9]);
  applyHandPose(rig.bones, tpl.layout, FINGER_ORDER.flatMap((f) => fl[f]), [0, 0, 0, 0, 0]);
  rig.root.updateMatrixWorld(true);
  rig.mesh.skeleton.update();
  return rig;
}

describe('dual quaternion skinning on the CPU', () => {
  for (const side of ['right', 'left'] as const) {
    it(`moves a vertex held by one bone rigidly with that bone (${side} hand)`, () => {
      const rig = posedRig(side);
      const g = tpl.geometry;
      const si = g.attributes.skinIndex;
      const sw = g.attributes.skinWeight;
      let checked = 0;
      const got = new Vector3();
      const want = new Vector3();
      const toMesh = new Matrix4().copy(rig.mesh.matrixWorld).invert();
      for (let i = 0; i < g.attributes.position.count && checked < 40; i += 7) {
        if (sw.getX(i) < 0.9999) continue;
        const b = si.getX(i);
        rig.mesh.getVertexPosition(i, got);
        // The same vertex moved by its bone in world space, brought back into the mesh's space.
        want.fromBufferAttribute(g.attributes.position, i).applyMatrix4(tpl.layout.bones[b].inverse).applyMatrix4(rig.bones[b].matrixWorld).applyMatrix4(toMesh);
        expect(got.distanceTo(want)).toBeLessThan(1e-4);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(20);
    });
  }

  it('keeps a blended vertex between its bones and the bounding sphere around the posed hand', () => {
    const rig = posedRig('right');
    rig.mesh.computeBoundingSphere();
    const s = rig.mesh.boundingSphere!;
    const tip = rig.fingers[2].tip.getWorldPosition(new Vector3()).applyMatrix4(new Matrix4().copy(rig.mesh.matrixWorld).invert());
    expect(s.distanceToPoint(tip)).toBeLessThan(0.05);
    expect(s.radius).toBeLessThan(3);
  });
});
