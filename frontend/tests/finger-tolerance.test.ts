import { describe, expect, it } from 'vitest';
import { bandFor, configFromTolerance, matchMeter, MATCH_IN_LINE } from '../src/features/apprentice/training/coach/deviation';
import { localScore } from '../src/features/apprentice/training/coach/localScore';
import { algorithmicTip, fingerTip, worstFinger } from '../src/features/apprentice/training/coach/tips';
import { hintRequest } from '../src/features/apprentice/training/coach/useAiHint';
import { vals } from './helpers';

/**
 * The takes model gives each finger its own band (Step.tolerance.finger_angle_deg). The live corrections read it: a finger
 * the expert held steady is corrected sooner, a finger that varied gets room, and the learner's margin widens every band.
 */
describe('per-finger tolerance in the live corrections', () => {
  const steadyIndex = { angle_deg: 18, timing_ms: 250, finger_angle_deg: { thumb: 18, index: 10, middle: 18, ring: 30, little: 18 } };

  it('fills a band for every finger, falling back to angle_deg for a finger left out, and keeps the scalar', () => {
    const cfg = configFromTolerance({ angle_deg: 18, timing_ms: 250, finger_angle_deg: { index: 10, ring: 30 } });
    expect(cfg.toleranceDeg).toBe(18);
    expect(cfg.fingerToleranceDeg).toEqual({ thumb: 18, index: 10, middle: 18, ring: 30, little: 18 });
  });

  it('without finger_angle_deg every band equals angle_deg, as before', () => {
    expect(configFromTolerance(undefined).fingerToleranceDeg).toEqual(vals({ thumb: 18, index: 18, middle: 18, ring: 18, little: 18 }));
    expect(configFromTolerance({ angle_deg: 12, timing_ms: 200, finger_angle_deg: null }).fingerToleranceDeg.little).toBe(12);
  });

  it('multiplies every band by the margin, as the scorer does', () => {
    const relaxed = configFromTolerance(steadyIndex, 'relaxed').fingerToleranceDeg;
    expect(relaxed.index).toBe(15);
    expect(relaxed.ring).toBe(45);
    expect(configFromTolerance(steadyIndex, 'strict').fingerToleranceDeg.index).toBeCloseTo(6);
  });

  it('ignores a zero or negative band rather than flagging every tremor', () => {
    expect(configFromTolerance({ angle_deg: 18, timing_ms: 250, finger_angle_deg: { index: 0 } }).fingerToleranceDeg.index).toBe(18);
  });

  it('a steady finger is corrected at a deviation a loose finger is allowed', () => {
    const band = configFromTolerance(steadyIndex).fingerToleranceDeg;
    expect(algorithmicTip(vals({ index: 14 }), band, 0, 250)).toMatch(/index/i);
    expect(algorithmicTip(vals({ ring: 24 }), band, 0, 250)).toBeNull();
    // With one band for all, the same index deviation passes.
    expect(algorithmicTip(vals({ index: 14 }), 18, 0, 250)).toBeNull();
  });

  it('names the finger furthest outside its own band, not the largest raw deviation', () => {
    const band = configFromTolerance(steadyIndex).fingerToleranceDeg;
    // Ring is 33 off against a 30 band (1.1x); index is 16 off against a 10 band (1.6x).
    expect(worstFinger(vals({ ring: 33, index: 16 }), band)?.finger).toBe('index');
    // One band for all keeps the old rule: the largest deviation wins.
    expect(worstFinger(vals({ ring: 33, index: 16 }), 18)?.finger).toBe('ring');
  });

  it('words a correction against that finger’s own band', () => {
    const band = configFromTolerance(steadyIndex).fingerToleranceDeg;
    expect(fingerTip('index', 25, band)).toBe('Index finger: open it out much more');
    expect(fingerTip('ring', 25, band)).toBe('Ring finger: uncurl a little');
    expect(bandFor(band, 'ring')).toBe(30);
  });

  it('the match meter reads each finger against its own band', () => {
    const band = configFromTolerance(steadyIndex).fingerToleranceDeg;
    expect(matchMeter(vals({ ring: 30 }), band)).toBeCloseTo(MATCH_IN_LINE);
    expect(matchMeter(vals({ index: 12 }), band)).toBeLessThan(MATCH_IN_LINE);
    expect(matchMeter(vals({ index: 12 }), 18)).toBeGreaterThan(MATCH_IN_LINE);
  });

  it('the offline local score judges closeness per finger band', () => {
    const stats = { meanAbs: vals({ index: 10, ring: 10 }), inTolerance: vals({ thumb: 1, index: 1, middle: 1, ring: 1, little: 1 }), meanLagMs: 0, worst: 'index', tip: null };
    const r = localScore(stats as never, configFromTolerance(steadyIndex));
    expect(r.per_finger.index).toBeLessThan(r.per_finger.ring);
  });
});

describe('the AI Assistant hint request', () => {
  const info = { deviation: vals({ index: 14 }), lagMs: 40 };

  it('sends the step’s per-finger band as finger_tolerance_deg, before the margin', () => {
    const body = hintRequest({ stepId: 's1', instruction: 'Swing', stepToleranceDeg: 18, stepFingerToleranceDeg: { index: 10, ring: 30 }, margin: 'relaxed' }, info);
    expect(body).toEqual({ step_id: 's1', instruction: 'Swing', deviations: info.deviation, timing_ms: 40, tolerance_deg: 18, finger_tolerance_deg: { index: 10, ring: 30 }, margin: 'relaxed' });
  });

  it('leaves the field out when the step has no per-finger band', () => {
    expect(hintRequest({ stepId: 's1', instruction: 'Swing', stepToleranceDeg: 18, stepFingerToleranceDeg: null }, info)).not.toHaveProperty('finger_tolerance_deg');
    expect(hintRequest({ stepId: 's1', instruction: 'Swing', stepFingerToleranceDeg: {} }, info)).not.toHaveProperty('finger_tolerance_deg');
  });
});
