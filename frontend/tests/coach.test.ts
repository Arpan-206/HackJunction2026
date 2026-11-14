import { describe, expect, it } from 'vitest';
import {
  applyDeadZone, configFromTolerance, fingerMatch, flexionDegrees, MATCH_IN_LINE, matchMeter, MovingAverage, statusOf, tension, zeroValues,
} from '../src/features/apprentice/training/coach/deviation';
import { alignedDeviation, meanLagMs } from '../src/features/apprentice/training/coach/alignment';
import { algorithmicTip, fingerTip, worstFinger } from '../src/features/apprentice/training/coach/tips';
import { policyFor } from '../src/features/apprentice/training/coach/fade';
import { FOLLOW_HOLD_S, findCheckpoints, skipCheckpoint, startFollow, stepFollow } from '../src/features/apprentice/training/coach/follow';
import { localScore } from '../src/features/apprentice/training/coach/localScore';
import { ClumsySim, DEFAULT_CLUMSY } from '../src/features/apprentice/training/coach/clumsy';
import type { AttemptStats } from '../src/features/apprentice/training/coach/useCoach';
import { handWith, vals } from './helpers';

const TOL = 18;

describe('deviation', () => {
  it('defaults tolerance to 18 deg and 250 ms, and honours a step override', () => {
    expect(configFromTolerance(undefined)).toMatchObject({ toleranceDeg: 18, timingMs: 250 });
    expect(configFromTolerance({ angle_deg: 10, timing_ms: 100 })).toMatchObject({ toleranceDeg: 10, timingMs: 100 });
  });

  it('flexionDegrees sums the three joints in degrees', () => {
    const d = flexionDegrees(handWith({ ring: 90, thumb: 30 }));
    expect(d.ring).toBeCloseTo(90, 6);
    expect(d.thumb).toBeCloseTo(30, 6);
    expect(d.index).toBeCloseTo(0, 6);
  });

  it('dead zone swallows tremor and shrinks larger errors', () => {
    expect(applyDeadZone(3, 4)).toBe(0);
    expect(applyDeadZone(-4, 4)).toBe(0);
    expect(applyDeadZone(10, 4)).toBe(6);
    expect(applyDeadZone(-10, 4)).toBe(-6);
  });

  it('status is good inside tolerance (inclusive) and off outside', () => {
    expect(statusOf(18, TOL)).toBe('good');
    expect(statusOf(-18, TOL)).toBe('good');
    expect(statusOf(18.01, TOL)).toBe('off');
    expect(statusOf(-25, TOL)).toBe('off');
  });

  it('tension is 0 under half tolerance, 1 at twice tolerance, monotonic', () => {
    expect(tension(0, TOL)).toBe(0);
    expect(tension(TOL * 0.5, TOL)).toBe(0);
    expect(tension(TOL * 2, TOL)).toBe(1);
    expect(tension(TOL * 5, TOL)).toBe(1);
    expect(tension(-TOL, TOL)).toBeGreaterThan(tension(-TOL * 0.7, TOL));
  });

  it('finger match is 100 when exact, 75 at the tolerance edge, below 75 once off, and 0 at three times tolerance', () => {
    expect(fingerMatch(0, TOL)).toBe(100);
    expect(fingerMatch(TOL, TOL)).toBe(MATCH_IN_LINE);
    expect(fingerMatch(TOL + 0.01, TOL)).toBeLessThan(MATCH_IN_LINE);
    expect(fingerMatch(-TOL * 2, TOL)).toBeCloseTo(MATCH_IN_LINE / 2, 6);
    expect(fingerMatch(TOL * 3, TOL)).toBe(0);
    expect(fingerMatch(TOL * 9, TOL)).toBe(0);
  });

  it('match meter follows the worst finger, so a flagged finger always pulls it under the in-line mark', () => {
    expect(matchMeter(zeroValues(), TOL)).toBe(100);
    expect(matchMeter(vals({ ring: TOL * 3 }), TOL)).toBe(0);
    const justOff = vals({ ring: TOL * 1.05 });
    expect(statusOf(justOff.ring, TOL)).toBe('off');
    expect(matchMeter(justOff, TOL)).toBeLessThan(MATCH_IN_LINE);
  });

  it('MovingAverage keeps the last N samples and resets', () => {
    const m = new MovingAverage(3);
    m.push(vals({ index: 0 }));
    m.push(vals({ index: 30 }));
    m.push(vals({ index: 60 }));
    expect(m.push(vals({ index: 90 })).index).toBeCloseTo(60, 6);
    m.reset();
    expect(m.push(vals({ index: 10 })).index).toBeCloseTo(10, 6);
  });
});

describe('tips', () => {
  it('a ring finger 25 deg under-curled is flagged as the worst finger', () => {
    const w = worstFinger(vals({ ring: -25, index: 5, thumb: 10 }), TOL);
    expect(w).toEqual({ finger: 'ring', deviationDeg: -25 });
    expect(algorithmicTip(vals({ ring: -25 }), TOL, 0, 250)).toBe('Ring finger: curl a little more');
  });

  it('picks the largest magnitude when several are out', () => {
    expect(worstFinger(vals({ index: 20, little: -40 }), TOL)?.finger).toBe('little');
  });

  it('within-tolerance error is not flagged', () => {
    expect(worstFinger(vals({ ring: -18, index: 17 }), TOL)).toBeNull();
    expect(algorithmicTip(vals({ ring: -10 }), TOL, 0, 250)).toBeNull();
  });

  it('over-curl says uncurl, big errors say much', () => {
    expect(fingerTip('index', 25, TOL)).toBe('Index finger: uncurl a little');
    expect(fingerTip('index', 60, TOL)).toBe('Index finger: open it out much more');
    expect(fingerTip('little', -60, TOL)).toBe('Little finger: curl it much more');
  });

  it('timing tip only when shape is fine and lag exceeds the limit', () => {
    expect(algorithmicTip(zeroValues(), TOL, 400, 250)).toMatch(/sooner/);
    expect(algorithmicTip(zeroValues(), TOL, -400, 250)).toMatch(/longer/);
    expect(algorithmicTip(zeroValues(), TOL, 250, 250)).toBeNull();
  });
});

describe('alignment', () => {
  // Reference: ring flexion jumps from 0 to 90 at t = 1.0.
  const ref = (t: number) => vals({ ring: t >= 1 ? 90 : 0 });

  it('a late learner within the window is not penalised, and the lag is reported', () => {
    // Asked at t=1.1 the reference is already at 90, but the learner is still at 0 (they trail by up to 100 ms).
    const a = alignedDeviation(vals({ ring: 0 }), ref, 1.1, 0.25)!;
    expect(a.deviation.ring).toBe(0);
    expect(a.lagMs.ring).toBeGreaterThan(0);
  });

  it('a learner late beyond the window is penalised', () => {
    const a = alignedDeviation(vals({ ring: 0 }), ref, 1.6, 0.25)!;
    expect(a.deviation.ring).toBe(-90);
  });

  it('an early learner gets negative lag', () => {
    const a = alignedDeviation(vals({ ring: 90 }), ref, 0.9, 0.25)!;
    expect(a.deviation.ring).toBe(0);
    expect(a.lagMs.ring).toBeLessThan(0);
  });

  it('prefers zero shift on ties and returns null with no reference', () => {
    const flat = alignedDeviation(vals(), () => vals(), 1, 0.25)!;
    expect(flat.lagMs.ring).toBeCloseTo(0, 9);
    expect(alignedDeviation(vals(), () => null, 1, 0.25)).toBeNull();
  });

  it('meanLagMs averages only moving fingers', () => {
    expect(meanLagMs(vals({ ring: 100, index: 300 }))).toBe(200);
    expect(meanLagMs(zeroValues())).toBe(0);
  });
});

describe('fade policy', () => {
  it('fades guidance over attempts', () => {
    expect(policyFor(1)).toMatchObject({ strings: 'all', liveCoach: true, showMaster: true });
    expect(policyFor(2)).toMatchObject({ strings: 'off-only', liveCoach: true, showMaster: true });
    expect(policyFor(3)).toMatchObject({ strings: 'none', liveCoach: false, showMaster: false });
    expect(policyFor(7).attempt).toBe(7);
    expect(policyFor(0).attempt).toBe(1);
  });
});

describe('follow', () => {
  // Ring flexion holds 0 until 1s, ramps to 100 by 1.5s, holds, ramps back at 3.0..3.5.
  const pose = (t: number) => {
    let r = 0;
    if (t >= 3.5) r = 0;
    else if (t >= 3) r = 100 - ((t - 3) / 0.5) * 100;
    else if (t >= 1.5) r = 100;
    else if (t >= 1) r = ((t - 1) / 0.5) * 100;
    return vals({ ring: r });
  };

  it('finds distinct pauses and always returns at least one checkpoint', () => {
    const cps = findCheckpoints(pose, 4);
    expect(cps.length).toBeGreaterThanOrEqual(2);
    expect([...cps].sort((a, b) => a - b)).toEqual(cps);
    expect(findCheckpoints(() => null, 4)).toEqual([0.5]);
    expect(findCheckpoints(() => null, 0.2)).toEqual([0.2]);
  });

  it('ghost walks to the checkpoint, waits, and advances only after a matched hold', () => {
    const cps = [1, 2];
    const s = startFollow();
    stepFollow(s, 0.6, cps, false);
    expect(s.waiting).toBe(false);
    expect(s.refTime).toBeCloseTo(0.6);
    stepFollow(s, 0.6, cps, false);
    expect(s.refTime).toBe(1);
    expect(s.waiting).toBe(true);
    stepFollow(s, 0.4, cps, true);
    stepFollow(s, 0.4, cps, false); // broken hold resets
    expect(s.held).toBe(0);
    expect(s.index).toBe(0);
    stepFollow(s, FOLLOW_HOLD_S, cps, true);
    expect(s.index).toBe(1);
    expect(s.waiting).toBe(false);
  });

  it('finishes after the last checkpoint and stays done; skip advances', () => {
    const cps = [0.2];
    const s = startFollow();
    stepFollow(s, 1, cps, false);
    stepFollow(s, FOLLOW_HOLD_S, cps, true);
    expect(s.done).toBe(true);
    const before = { ...s };
    stepFollow(s, 1, cps, true);
    expect(s).toEqual(before);

    const s2 = startFollow();
    stepFollow(s2, 5, [1, 2], false);
    skipCheckpoint(s2, [1, 2]);
    expect(s2.index).toBe(1);
  });
});

describe('localScore', () => {
  const cfg = configFromTolerance({ angle_deg: 18, timing_ms: 250 });
  const stats = (o: Partial<AttemptStats> = {}): AttemptStats =>
    ({ meanAbs: vals(), inTolerance: vals({ thumb: 1, index: 1, middle: 1, ring: 1, little: 1 }), meanLagMs: 0, worst: null, tip: null, ...o }) as AttemptStats;

  it('a perfect attempt scores 100 and is within tolerance', () => {
    const r = localScore(stats(), cfg);
    expect(r.overall).toBe(100);
    expect(r.timing).toBe(100);
    expect(r.within_tolerance).toBe(true);
    expect(r.hint).toMatch(/clean attempt/i);
  });

  it('a late learner within timing_ms is not penalised on timing', () => {
    expect(localScore(stats({ meanLagMs: 240 }), cfg).timing).toBe(100);
    expect(localScore(stats({ meanLagMs: -250 }), cfg).timing).toBe(100);
    expect(localScore(stats({ meanLagMs: 500 }), cfg).timing).toBe(50);
  });

  it('a finger rarely in tolerance fails within_tolerance and carries worst finger and tip', () => {
    const r = localScore(stats({ inTolerance: vals({ thumb: 1, index: 1, middle: 1, ring: 0.2, little: 1 }), meanAbs: vals({ ring: 25 }), worst: 'ring', tip: 'Ring finger: curl a little more' }), cfg);
    expect(r.within_tolerance).toBe(false);
    expect(r.worst_finger).toBe('ring');
    expect(r.per_finger.ring).toBeLessThan(r.per_finger.index);
    expect(r.hint).toBe('Ring finger: curl a little more');
    expect(r.overall).toBeLessThan(100);
  });
});

describe('ClumsySim', () => {
  it('under-curls only the configured finger by 25 deg and keeps others true', () => {
    const sim = new ClumsySim({ ...DEFAULT_CLUMSY, noiseDeg: 0, lagS: 0 });
    const out = flexionDegrees(sim.apply(handWith({ ring: 100, index: 100 }), 1));
    expect(out.ring).toBeCloseTo(100 - 25, 4);
    expect(out.index).toBeCloseTo(100, 4);
  });

  it('lags the target finger by lagS', () => {
    const sim = new ClumsySim({ finger: 'ring', lagS: 0.3, undercurlDeg: 0, noiseDeg: 0 });
    sim.apply(handWith({ ring: 0 }), 0);
    sim.apply(handWith({ ring: 0 }), 0.2);
    expect(flexionDegrees(sim.apply(handWith({ ring: 90 }), 0.4)).ring).toBeCloseTo(0, 4);
    expect(flexionDegrees(sim.apply(handWith({ ring: 90 }), 0.8)).ring).toBeCloseTo(90, 4);
  });

  it('reset drops history', () => {
    const sim = new ClumsySim({ finger: 'ring', lagS: 0.3, undercurlDeg: 0, noiseDeg: 0 });
    sim.apply(handWith({ ring: 0 }), 0);
    sim.reset();
    expect(flexionDegrees(sim.apply(handWith({ ring: 90 }), 5)).ring).toBeCloseTo(90, 4);
  });
});
