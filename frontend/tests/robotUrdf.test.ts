import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fingerOf, fingertips, flexSign, linkInfo, robotFingers, urdfToHand } from '../src/three/robot/kinematics';
import { jointByName, parseUrdf, parseXml } from '../src/three/robot/urdf';
import { Vector3 } from 'three';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const pub = (f: string) => readFileSync(path.resolve(here, '../public/models/robots/dex3_1', f), 'utf8');
const root = (f: string) => readFileSync(path.resolve(here, '../../models/robots/dex3_1', f), 'utf8');

describe('URDF parse', () => {
  it('the served copies are identical to the core files', () => {
    for (const f of ['dex3_1_l.urdf', 'dex3_1_r.urdf']) expect(pub(f)).toBe(root(f));
  });

  it('reads the seven Dex3-1 joints with origins, axes and limits, as core/robot.py does', () => {
    const m = parseUrdf(pub('dex3_1_r.urdf'));
    expect(m.name).toBe('dex3_1_r');
    expect(m.root).toBe('right_hand_palm_link');
    expect(m.joints.map((j) => j.name)).toEqual([
      'right_hand_thumb_0_joint',
      'right_hand_thumb_1_joint',
      'right_hand_thumb_2_joint',
      'right_hand_middle_0_joint',
      'right_hand_middle_1_joint',
      'right_hand_index_0_joint',
      'right_hand_index_1_joint',
    ]);
    const idx = jointByName(m, 'right_hand_index_0_joint');
    expect(idx).toMatchObject({ type: 'revolute', parent: 'right_hand_palm_link', child: 'right_hand_index_0_link', axis: [0, 0, 1], lower: 0 });
    expect(idx?.upper).toBeCloseTo(1.5708, 3);
    expect(idx?.xyz).toEqual([0.0777, -0.0016, 0.0285]);
    expect(jointByName(m, 'right_hand_thumb_0_joint')?.axis).toEqual([0, 1, 0]);
    expect(jointByName(m, 'right_hand_thumb_2_joint')).toMatchObject({ lower: -1.74532925, upper: 0 });
    expect(m.links.right_hand_index_1_link.com).toEqual([0.02628192939, -0.00171735242, -0.00010778879]);
  });

  it('skips commented-out joints and mirrors the left limits', () => {
    const m = parseUrdf(pub('dex3_1_l.urdf'));
    expect(m.joints).toHaveLength(7);
    expect(m.joints.some((j) => j.name === 'floating_base_joint')).toBe(false);
    expect(jointByName(m, 'left_hand_index_0_joint')).toMatchObject({ lower: -1.57079632, upper: 0 });
    expect(jointByName(m, 'left_hand_thumb_1_joint')).toMatchObject({ lower: -0.61086523, upper: 1.04719755 });
  });

  it('rejects text with no robot or no movable joint', () => {
    expect(() => parseUrdf('<foo/>')).toThrow(/no <robot>/);
    expect(() => parseUrdf('<robot name="r"><link name="a"/></robot>')).toThrow(/no movable joints/);
    expect(parseXml('<a x="1"><b y=\'2\'/></a>').children[0].children[0].attrs.y).toBe('2');
  });
});

describe('robot kinematics', () => {
  const right = parseUrdf(pub('dex3_1_r.urdf'));
  const left = parseUrdf(pub('dex3_1_l.urdf'));

  it('names each part after its finger and finds the three robot fingers', () => {
    expect(fingerOf('right_hand_middle_1_link')).toBe('middle');
    expect(fingerOf('right_hand_palm_link')).toBeNull();
    expect(robotFingers(right)).toEqual(['thumb', 'index', 'middle']);
    const info = linkInfo(right);
    expect(info.right_hand_index_0_link.end).toEqual([0.0458, 0, 0]);
    expect(info.right_hand_index_1_link.tip).toBe(true);
    expect(info.right_hand_palm_link.joints).toHaveLength(3);
  });

  it('flexes the right hand positive and the left negative, as the core reads the limits', () => {
    expect(flexSign(right)).toBe(1);
    expect(flexSign(left)).toBe(-1);
  });

  it('puts the fingers along -z with the palm down, the index on the thumb side of the middle', () => {
    for (const [m, thumbSide] of [
      [right, -1],
      [left, 1],
    ] as const) {
      const fwd = new Vector3(1, 0, 0).applyQuaternion(urdfToHand(m));
      expect(fwd.z).toBeCloseTo(-1, 6);
      const tips = fingertips(m, {});
      expect(tips.index!.z).toBeLessThan(-0.08);
      expect(Math.sign(tips.index!.x - tips.middle!.x)).toBe(thumbSide);
    }
  });

  it('curls a flexed finger towards the palm (down) on both hands', () => {
    for (const [m, s] of [
      [right, 'right'],
      [left, 'left'],
    ] as const) {
      const sign = flexSign(m);
      const flat = fingertips(m, {});
      const curled = fingertips(m, { [`${s}_hand_index_0_joint`]: sign * 1.2, [`${s}_hand_index_1_joint`]: sign * 1.2 });
      expect(curled.index!.y).toBeLessThan(flat.index!.y - 0.03);
      expect(curled.middle!.distanceTo(flat.middle!)).toBeLessThan(1e-9);
    }
  });
});
