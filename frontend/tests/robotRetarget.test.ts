import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HandFrame, Side } from '../src/api/types';
import { anglesFromHand, ANGLE_NAMES, handFromTargets, Retargeter, THUMB_INDEX_NEUTRAL_DEG, toMessage } from '../src/mock/robot';
import { parseUrdf } from '../src/three/robot/urdf';

/**
 * The expected values in fixtures/robot-pins.json were produced by running the core's own retarget (core/robot.py with
 * config.toml, read-only) on the same angle vectors:
 *   .venv/Scripts/python.exe -I pins.py <repo root>
 * where pins.py builds `Retargeter(load_config("config.toml").robot, root)` and prints `targets(a, side).to_message(...)`
 * for each case and `describe()`. So these tests pin the TypeScript port to the core, not to itself.
 */

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const urdf = (f: string) => parseUrdf(readFileSync(path.resolve(here, '../public/models/robots/dex3_1', f), 'utf8'));
const rt = new Retargeter({ left: urdf('dex3_1_l.urdf'), right: urdf('dex3_1_r.urdf') });

interface Pinned {
  q: Record<string, number>;
  q_norm: Record<string, number>;
  fidelity: Record<string, number>;
  missing: string[];
  model: string;
  hand: string;
}
const pins = JSON.parse(readFileSync(path.resolve(here, 'fixtures/robot-pins.json'), 'utf8')) as {
  cases: Record<string, number[]>;
  out: Record<string, Record<Side, Pinned>> & { describe: unknown };
};

describe('mock retarget port (pinned to core/robot.py)', () => {
  for (const name of Object.keys(pins.cases)) {
    for (const side of ['left', 'right'] as Side[]) {
      it(`${name}, ${side} hand`, () => {
        const want = pins.out[name][side];
        const got = toMessage(rt.targets(pins.cases[name], side), 'learner', 'hand', 0);
        expect(got.model).toBe(want.model);
        expect(got.hand).toBe(want.hand);
        expect(got.missing).toEqual(want.missing);
        expect(Object.keys(got.q)).toEqual(Object.keys(want.q));
        for (const k of Object.keys(want.q)) expect(got.q[k]).toBeCloseTo(want.q[k], 5);
        for (const k of Object.keys(want.q_norm)) expect(got.q_norm![k]).toBeCloseTo(want.q_norm[k], 3);
        expect(Object.keys(got.fidelity)).toEqual(Object.keys(want.fidelity));
        for (const k of Object.keys(want.fidelity)) expect(got.fidelity[k as 'thumb']).toBeCloseTo(want.fidelity[k], 3);
      });
    }
  }

  it('describes the hand like the core hello', () => {
    expect(rt.describe()).toEqual(pins.out.describe);
  });
});

const hand = (side: Side, deg: Partial<Record<'thumb' | 'index' | 'middle' | 'ring' | 'little', [number, number, number]>>, spreadThumbDeg = 0): HandFrame => {
  const r = (d: number) => (d * Math.PI) / 180;
  const t = (k: keyof typeof deg): [number, number, number] => (deg[k] ?? [0, 0, 0]).map(r) as [number, number, number];
  return {
    side,
    wrist_quat: [0, 0, 0, 1],
    wrist_pos: null,
    flexion: { thumb: t('thumb'), index: t('index'), middle: t('middle'), ring: t('ring'), little: t('little') },
    spread: { thumb: r(spreadThumbDeg), index: 0, middle: 0, ring: 0, little: 0 },
  };
};

describe('contract hands in and out', () => {
  it('reads the 18 features from a contract hand (inverse of core/compat.py)', () => {
    const a = anglesFromHand(hand('right', { thumb: [12, 30, 25], index: [45, 50, 30], little: [40, 50, 30] }, 15));
    expect(a).toHaveLength(ANGLE_NAMES.length);
    expect(a[0]).toBeCloseTo(30, 9);
    expect(a[1]).toBeCloseTo(25, 9);
    expect(a.slice(2, 5).map((v) => Math.round(v))).toEqual([45, 50, 30]);
    expect(a.slice(11, 14).map((v) => Math.round(v))).toEqual([40, 50, 30]);
    expect(a[14]).toBeCloseTo(THUMB_INDEX_NEUTRAL_DEG + 15, 9);
  });

  it('a relaxed contract hand puts every robot joint near zero', () => {
    const t = rt.targets(anglesFromHand(hand('right', {})), 'right');
    for (const v of Object.values(t.q)) expect(Math.abs(v)).toBeLessThan(1e-9);
  });

  it('the robot copy keeps total flexion where the robot can follow, and drops ring and little', () => {
    for (const side of ['left', 'right'] as Side[]) {
      const src = hand(side, { thumb: [20, 30, 25], index: [40, 40, 40], middle: [30, 50, 50], ring: [40, 40, 40] }, 10);
      const t = rt.targets(anglesFromHand(src), side);
      const copy = handFromTargets(t.q, side, rt, src);
      const sum = (v: number[]) => (v.reduce((s, x) => s + x, 0) * 180) / Math.PI;
      expect(sum(copy.flexion.index)).toBeCloseTo(120, 6);
      expect(sum(copy.flexion.middle)).toBeCloseTo(30 + 100, 6);
      expect(sum(copy.flexion.thumb)).toBeCloseTo(75, 6);
      expect(sum(copy.flexion.ring)).toBe(0);
      expect(sum(copy.flexion.little)).toBe(0);
      expect((copy.spread!.thumb * 180) / Math.PI).toBeCloseTo(10, 6);
      // Round trip: the copy retargets to the same joints.
      const again = rt.targets(anglesFromHand(copy), side);
      for (const k of Object.keys(t.q)) expect(again.q[k]).toBeCloseTo(t.q[k], 9);
    }
  });

  it('a fist beyond the limits loses flexion in the copy, as the robot would', () => {
    const src = hand('right', { index: [100, 110, 90] });
    const copy = handFromTargets(rt.targets(anglesFromHand(src), 'right').q, 'right', rt, src);
    const total = (copy.flexion.index.reduce((s, x) => s + x, 0) * 180) / Math.PI;
    expect(total).toBeLessThan(300 - 40);
    expect((copy.flexion.index[0] * 180) / Math.PI).toBeCloseTo(90, 3);
  });
});
