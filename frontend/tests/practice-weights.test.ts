import { describe, expect, it } from 'vitest';
import type { Finger, ScoreResult } from '../src/api/types';
import { configFromTolerance, lightFingers, matchMeter } from '../src/features/apprentice/training/coach/deviation';
import { localScore } from '../src/features/apprentice/training/coach/localScore';
import { algorithmicTip, worstFinger } from '../src/features/apprentice/training/coach/tips';
import { weakestFinger } from '../src/features/apprentice/training/score/scoreRules';

/** The practice view honours the step's per-finger weights: light fingers are dimmed and never the one to fix. */

const W = (over: Partial<Record<Finger, number>>): Record<Finger, number> => ({ thumb: 1, index: 1, middle: 1, ring: 1, little: 1, ...over });
const DEV = { thumb: 0, index: 2, middle: -25, ring: -60, little: 0 };

describe('light fingers', () => {
  it('are the fingers under the focus weight, with the scorer fallback', () => {
    expect(lightFingers(null)).toEqual([]);
    expect(lightFingers(W({ ring: 0.2, thumb: 0 }))).toEqual(['thumb', 'ring']);
    expect(lightFingers({ thumb: 0.1, index: 0.2, middle: 0.1, ring: 0.1, little: 0.1 })).toEqual(['thumb', 'middle', 'ring', 'little']);
  });

  it('configFromTolerance keeps the old config without weights', () => {
    expect(configFromTolerance({ angle_deg: 18, timing_ms: 250 })).toEqual({
      toleranceDeg: 18,
      fingerToleranceDeg: { thumb: 18, index: 18, middle: 18, ring: 18, little: 18 },
      deadZoneDeg: 4,
      timingMs: 250,
    });
    const c = configFromTolerance({ angle_deg: 18, timing_ms: 250 }, 'standard', W({ ring: 0.2 }));
    expect(c.light).toEqual(['ring']);
    expect(c.weights?.ring).toBe(0.2);
  });
});

describe('the one to fix is only a weighted finger', () => {
  it('live tip and worst finger skip light fingers', () => {
    expect(worstFinger(DEV, 18)?.finger).toBe('ring');
    expect(worstFinger(DEV, 18, ['ring'])?.finger).toBe('middle');
    expect(algorithmicTip(DEV, 18, 0, 250, ['ring', 'middle'])).toBeNull();
  });

  it('the match meter ignores light fingers', () => {
    expect(matchMeter(DEV, 18)).toBeLessThan(matchMeter(DEV, 18, ['ring']));
  });

  it('the score card never names a light finger', () => {
    const r: ScoreResult = { overall: 70, per_finger: { thumb: 95, index: 96, middle: 60, ring: 20, little: 90 }, timing: 90, within_tolerance: false, worst_finger: 'ring', hint: '', warnings: [] };
    expect(weakestFinger(r)).toBe('ring');
    expect(weakestFinger(r, ['ring'])).toBe('middle');
    expect(weakestFinger(r, ['thumb', 'index', 'middle', 'ring', 'little'])).toBe('ring');
  });

  it('the local score weights fingers like the scorer', () => {
    const stats = {
      seconds: 3,
      meanAbs: { thumb: 0, index: 0, middle: 0, ring: 60, little: 0 },
      inTolerance: { thumb: 1, index: 1, middle: 1, ring: 0, little: 1 },
      meanLagMs: 0,
      worst: 'index' as Finger,
      worstDeviation: 0,
      tip: null,
    };
    const plain = localScore(stats, configFromTolerance(undefined));
    const weighted = localScore(stats, configFromTolerance(undefined, 'standard', W({ ring: 0 })));
    expect(plain.within_tolerance).toBe(false);
    expect(weighted.within_tolerance).toBe(true);
    expect(weighted.overall).toBeGreaterThan(plain.overall);
  });
});
