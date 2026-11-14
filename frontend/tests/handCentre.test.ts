import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { centredPosition } from '../src/three/Hand';
import { buildHandTemplate, type HandTemplate } from '../src/three/handModel';

describe('hand centring', () => {
  let tpl: HandTemplate;
  beforeAll(async () => {
    const buf = fs.readFileSync(path.resolve(__dirname, '../public/models/hands/right.glb'));
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    tpl = buildHandTemplate(gltf.scene);
  });

  it('the visual centre lies over the palm and fingers, towards the thumb, not at the wrist', () => {
    const [x, z] = tpl.centre;
    expect(z).toBeGreaterThan(-1.3);
    expect(z).toBeLessThan(-0.8);
    expect(x).toBeGreaterThan(-0.2);
    expect(x).toBeLessThan(0);
  });

  it('puts the centre on the anchor, mirrored for a left hand and turned with the yaw', () => {
    const anchor = [0.4, -0.5] as const;
    for (const side of ['right', 'left'] as const) {
      for (const yaw of [0, 0.1, 1]) {
        const at = centredPosition([0, 0.2, 0], [0, yaw, 0], 1, side, tpl.centre, anchor);
        // The wrist plus the centre offset, turned by the yaw about y, lands on the anchor.
        const cx = side === 'left' ? -tpl.centre[0] : tpl.centre[0];
        const cz = tpl.centre[1];
        const wx = at[0] + cx * Math.cos(yaw) + cz * Math.sin(yaw);
        const wz = at[2] - cx * Math.sin(yaw) + cz * Math.cos(yaw);
        expect(wx).toBeCloseTo(anchor[0], 6);
        expect(wz).toBeCloseTo(anchor[1], 6);
        expect(at[1]).toBe(0.2);
      }
    }
  });

  it('leaves the wrist at position with no anchor, or for a raised hand', () => {
    expect(centredPosition([1, 2, 3], [0, 0, 0], 1, 'right', tpl.centre, null)).toEqual([1, 2, 3]);
    expect(centredPosition([1, 2, 3], [1.25, 0, 0], 1, 'right', tpl.centre, [0, -0.5])).toEqual([1, 2, 3]);
  });
});

describe('puppet shadow centre', () => {
  it('a symmetric pair of wings casts its shadow about the middle of the wall', async () => {
    const { puppetLayout, puppetShadowCentre } = await import('../src/three/ShadowTheatre');
    const [x] = puppetShadowCentre(puppetLayout('wings'), [0, 0, -1]);
    expect(Math.abs(x)).toBeLessThan(0.3);
  });

  it('a one-handed puppet casts its shadow off the middle, which a preview then re-centres', async () => {
    const { puppetLayout, puppetShadowCentre } = await import('../src/three/ShadowTheatre');
    const [x, y] = puppetShadowCentre(puppetLayout('right'), [-0.2, -0.2, -1.25]);
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    expect(Math.abs(x)).toBeGreaterThan(0.05);
  });
});
