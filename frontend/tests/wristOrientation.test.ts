import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { HandFrame } from '../src/api/types';
import { coreCmdFrame } from '../src/api/coreCommand';
import { buildHandTemplate, type HandTemplate } from '../src/three/handModel';
import { restFrame } from '../src/three/motion';
import { HandSmoother } from '../src/three/smoothing';

/**
 * The glove core's world is the three.js stage (SPEC.md: Y up, X right, Z toward the person), and its wrist_quat is the
 * hand's turn from the rest pose: fingers along -z (into the scene, away from the camera), palm down (-y), thumb side
 * +x for a right hand. The hand group takes the smoothed quaternion as is, so a calibrated flat hand with its fingers
 * at the screen must draw with its fingers away from the camera and its palm down.
 */
describe('wrist orientation of the live hand', () => {
  let tpl: HandTemplate;
  beforeAll(async () => {
    const buf = fs.readFileSync(path.resolve(__dirname, '../public/models/hands/right.glb'));
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    tpl = buildHandTemplate(gltf.scene);
  });

  const shown = (wrist_quat: HandFrame['wrist_quat']) => {
    const s = new HandSmoother();
    s.step({ ...restFrame('right'), wrist_quat }, 1 / 60, false);
    return s.quat;
  };
  const near = (v: Vector3, x: number, y: number, z: number) => {
    expect(v.x).toBeCloseTo(x, 3);
    expect(v.y).toBeCloseTo(y, 3);
    expect(v.z).toBeCloseTo(z, 3);
  };

  it('the unturned template has its fingers along -z, away from the camera', () => {
    expect(tpl.centre[1]).toBeLessThan(-0.8);
  });

  it('a flat, fingers-at-the-screen glove (identity after the core calibrate) keeps fingers at -z and palm down', () => {
    const q = shown([0, 0, 0, 1]);
    near(new Vector3(0, 0, -1).applyQuaternion(q), 0, 0, -1);
    near(new Vector3(0, -1, 0).applyQuaternion(q), 0, -1, 0);
  });

  it('an uncalibrated heading of 137 degrees points the fingers at the camera: the flipped hand', () => {
    const half = (137 * Math.PI) / 360;
    const q = shown([0, Math.sin(half), 0, Math.cos(half)]);
    expect(new Vector3(0, 0, -1).applyQuaternion(q).z).toBeGreaterThan(0.5);
  });

  it('pitching up, rolling and turning left map without a mirror or an axis swap', () => {
    const turn = (axis: Vector3, deg: number) => new Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180);
    const f = new Vector3(0, 0, -1);
    const up = shown(turn(new Vector3(1, 0, 0), 30).toArray() as HandFrame['wrist_quat']);
    expect(f.clone().applyQuaternion(up).y).toBeGreaterThan(0.4);
    const left = shown(turn(new Vector3(0, 1, 0), 30).toArray() as HandFrame['wrist_quat']);
    expect(f.clone().applyQuaternion(left).x).toBeLessThan(-0.4);
    const roll = shown(turn(new Vector3(0, 0, -1), 30).toArray() as HandFrame['wrist_quat']);
    expect(new Vector3(0, -1, 0).applyQuaternion(roll).x).toBeLessThan(-0.4);
  });
});

describe('core command frame', () => {
  it('is the SPEC.md cmd shape the core acks', () => {
    expect(JSON.parse(coreCmdFrame('c-1', 'calibrate'))).toEqual({ v: 1, type: 'cmd', id: 'c-1', name: 'calibrate', args: {} });
  });
});
