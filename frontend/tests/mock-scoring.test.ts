import { describe, expect, it } from 'vitest';
import type { Calibration, Finger, GloveFrame, MotionSpec, ScoreResult } from '../src/api/types';
import { dtwPath, scoreFrames, buildHint } from '../src/mock/scoring';
import { frameAt, synthesise } from '../src/mock/synth';

/**
 * The expected numbers below were produced by running the Python scorer (backend/app/services/scoring.py) on the
 * same inputs (breathing is periodic in the motion period since the phase-lock fix), so these tests pin the TypeScript port to the backend rather than to itself.
 */

const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];
const SEQ: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5, 4, 3, 2, 1], beat_ms: 620 };
const FWD: MotionSpec = { preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: 1500 };
const PEN: MotionSpec = { preset: 'grip_and_swing', grip: 'penhold', swing: 'backhand', beat_ms: 1500 };
const HOLD: MotionSpec = { preset: 'hold_pose', pose: { thumb: 0.2, index: 0.5, middle: 0.5, ring: 0.5, little: 0.5 } };
const GRIP: MotionSpec = { preset: 'hold_pose', pose: { thumb: 0.62, index: 0.8, middle: 0.84, ring: 0.86, little: 0.88 } };

function attempt(spec: MotionSpec, dur: number, shift = 0, bump?: [Finger, number]): GloveFrame[] {
  const n = Math.round(dur * 60);
  return Array.from({ length: n }, (_, i) => {
    const f = frameAt(spec, i / 60 + shift, ['right']);
    f.t = i / 60;
    if (bump) {
      const h = f.hands[0];
      h.flexion[bump[0]] = h.flexion[bump[0]].map((v) => v + bump[1]) as [number, number, number];
    }
    return f;
  });
}

function run(ref: MotionSpec, att: MotionSpec, dur: number, o: { shift?: number; bump?: [Finger, number]; tol?: [number, number]; cal?: Calibration } = {}): ScoreResult {
  const [angle, timing] = o.tol ?? [18, 250];
  return scoreFrames(synthesise(ref, 'right', dur, 30), attempt(att, dur, o.shift ?? 0, o.bump), 'right', { angle_deg: angle, timing_ms: timing }, o.cal ? { own: o.cal, reference: null } : undefined);
}

const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.15);

function expectScore(r: ScoreResult, e: { overall: number; per: number[]; timing: number; within: boolean; worst?: Finger; hint: string }) {
  close(r.overall, e.overall);
  FINGERS.forEach((f, i) => close(r.per_finger[f], e.per[i]));
  close(r.timing, e.timing);
  expect(r.within_tolerance).toBe(e.within);
  if (e.worst) expect(r.worst_finger).toBe(e.worst);
  expect(r.hint).toBe(e.hint);
}

const CAL: Calibration = {
  id: 'c',
  side: 'right',
  created_at: 'x',
  flat: { thumb: [0, 0.1, 0.1], index: [0.1, 0.2, 0.1], middle: [0.1, 0.2, 0.1], ring: [0.1, 0.2, 0.1], little: [0.1, 0.2, 0.1] },
  fist: { thumb: [0.9, 0.9, 0.7], index: [1.2, 1.4, 0.9], middle: [1.2, 1.4, 0.9], ring: [1.2, 1.4, 0.9], little: [1.2, 1.4, 0.9] },
};

describe('mock scoring parity with the Python scorer', () => {
  it('scores an identical attempt at 100', () => {
    const r = run(SEQ, SEQ, 4);
    expect(r.overall).toBe(100);
    expect(r.timing).toBe(100);
    expect(r.within_tolerance).toBe(true);
    expect(r.hint).toBe('Great match. Keep the same shape and rhythm.');
  });

  it('reports a late attempt', () => {
    expectScore(run(SEQ, SEQ, 4, { shift: -0.3 }), {
      overall: 96.4, per: [100, 100, 99.1, 100, 100], timing: 82.7, within: true, worst: 'middle',
      hint: "Your finger shapes are right, but you are about 231 ms late. Match the guide hand's beat.",
    });
  });

  it('penalises the wrong grip on the index finger', () => {
    expectScore(run(FWD, PEN, 3), {
      overall: 82.8, per: [97.1, 0.7, 100, 99.8, 99.8], timing: 96.2, within: false, worst: 'index',
      hint: 'Curl your index finger more, it is about 85 degrees (in total) too straight.',
    });
  });

  it('scores total flexion, so one over-curled finger is off tolerance', () => {
    expectScore(run(HOLD, HOLD, 2, { bump: ['index', 0.12] }), {
      overall: 96.0, per: [100, 74.7, 100, 100, 100], timing: 100, within: false, worst: 'index',
      hint: 'Relax your index finger, it is curled about 21 degrees (in total) too much.',
    });
  });

  it('applies the learner calibration before comparing', () => {
    expectScore(run(FWD, FWD, 3, { cal: CAL }), {
      overall: 71.8, per: [92.1, 40.1, 55.5, 64, 72.3], timing: 100, within: false, worst: 'index',
      hint: 'Relax your index finger, it is curled about 36 degrees (in total) too much.',
    });
  });

  it('honours tight tolerances', () => {
    expectScore(run(SEQ, SEQ, 4, { shift: 0.15, tol: [8, 100] }), {
      overall: 94.1, per: [99.9, 99.6, 98.7, 99, 99.7], timing: 73.1, within: false, worst: 'middle',
      hint: 'Great match. Keep the same shape and rhythm.',
    });
  });
});

describe('held poses carry no timing penalty', () => {
  // Without the fix a 2 s breathing-phase offset scored timing 51 ("about 435 ms early") on this grip.
  it('ignores the breathing phase of a held grip', () => {
    expectScore(run(GRIP, GRIP, 3, { shift: 2 }), { overall: 99.7, per: [100, 99.6, 99.6, 99.6, 99.6], timing: 100, within: true, hint: 'Great match. Keep the same shape and rhythm.' });
  });

  it('ignores a long phase offset on a longer hold', () => {
    expectScore(run(HOLD, HOLD, 4, { shift: 3.1 }), { overall: 99.7, per: [100, 99.5, 99.5, 99.5, 99.5], timing: 100, within: true, hint: 'Great match. Keep the same shape and rhythm.' });
  });

  it('still reports a wrong finger on a held grip, not timing', () => {
    expectScore(run(GRIP, GRIP, 3, { shift: 2, bump: ['index', 0.2] }), {
      overall: 92.0, per: [100, 51.2, 99.6, 99.6, 99.6], timing: 100, within: false, worst: 'index',
      hint: 'Relax your index finger, it is curled about 31 degrees (in total) too much.',
    });
  });

  it('keeps timing for a moving reference', () => {
    expect(run(SEQ, SEQ, 4, { shift: -0.3 }).timing).toBeLessThan(90);
  });
});

describe('mock scoring parts', () => {
  it('keeps the DTW path inside the band and ends at the corner', () => {
    const a = Array.from({ length: 40 }, (_, i) => [Math.sin(i / 5), 0, 0]);
    const path = dtwPath(a, a);
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([39, 39]);
    expect(path.every(([i, j]) => i === j)).toBe(true);
  });

  it('warns when a calibration phase is missing', () => {
    const zeros = { thumb: [0, 0, 0], index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], little: [0, 0, 0] } as Calibration['flat'];
    const r = run(FWD, FWD, 2, { cal: { ...CAL, fist: zeros } });
    expect(r.warnings.length).toBe(1);
    expect(r.overall).toBe(100);
  });

  it('builds hints like the backend', () => {
    expect(buildHint({ index: -12 }, 0)).toContain('Curl your index finger more');
    expect(buildHint({}, 0)).toBe('Great match. Keep the same shape and rhythm.');
  });
});
