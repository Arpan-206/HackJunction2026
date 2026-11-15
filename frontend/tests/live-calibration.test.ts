import { describe, expect, it } from 'vitest';
import type { Calibration, Finger, GloveFrame, HandFrame, JointTriple } from '../src/api/types';
import { liveScore, flexionDegrees, type FingerValues } from '../src/features/apprentice/training/coach/deviation';
import { calibratedWeights, liveCalibration } from '../src/features/apprentice/training/coach/liveCalibration';
import { scoreFrames } from '../src/mock/scoring';

const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];
const rad = (d: number) => (d * Math.PI) / 180;
const all = (t: [number, number, number]): Record<Finger, JointTriple> =>
  Object.fromEntries(FINGERS.map((f) => [f, t.map(rad) as JointTriple])) as Record<Finger, JointTriple>;
const hand = (flexion: Record<Finger, JointTriple>): HandFrame => ({ side: 'right', wrist_quat: [0, 0, 0, 1], wrist_pos: null, flexion, spread: { thumb: 0, index: 0, middle: 0, ring: 0, little: 0 } }) as HandFrame;
const held = (h: HandFrame, seconds = 2): GloveFrame[] => Array.from({ length: seconds * 30 }, (_, i) => ({ t: i / 30, source: 'rokoko_sdk', hands: [h] }) as GloveFrame);

/** A wearer whose flat hand reads 20, 15, 10 degrees and whose fist reads 95, 100, 70; the thumb barely moves. */
const flat = all([20, 15, 10]);
const fist = { ...all([95, 100, 70]), thumb: [22, 16, 11].map(rad) as JointTriple };
const cal: Calibration = { id: 'c', side: 'right', flat, fist, created_at: '2026-11-15T00:00:00Z' } as Calibration;

const diff = (a: FingerValues, b: FingerValues): FingerValues => Object.fromEntries(FINGERS.map((f) => [f, a[f] - b[f]])) as FingerValues;
const TOL = { angle_deg: 18, timing_ms: 250 };

describe('the live meter reads the same calibrated angles as the final score', () => {
  it('is off without a calibration, or with one that lacks a pose', () => {
    expect(liveCalibration(null)).toBeNull();
    expect(liveCalibration(undefined)).toBeNull();
    expect(liveCalibration({ ...cal, fist: all([0, 0, 0]) })).toBeNull();
  });

  it('leaves out the joints the calibration cannot read, on both sides, and gives that finger weight 0', () => {
    const live = liveCalibration(cal)!;
    expect(live.fingers).toEqual({ thumb: 0, index: 1, middle: 1, ring: 1, little: 1 });
    expect(live.learner(hand(fist)).thumb).toBe(0);
    expect(live.reference(hand(all([30, 30, 30]))).thumb).toBe(0);
    expect(calibratedWeights(undefined, live)).toEqual({ thumb: 0, index: 1, middle: 1, ring: 1, little: 1 });
    expect(calibratedWeights({ thumb: 1, index: 0.5, middle: 1, ring: 1, little: 1 }, live)?.index).toBe(0.5);
    expect(calibratedWeights({ thumb: 1, index: 1, middle: 1, ring: 1, little: 1 }, null)?.thumb).toBe(1);
  });

  it("maps the wearer's own flat and fist to the same angles for any wearer", () => {
    const live = liveCalibration(cal)!;
    const other = liveCalibration({ ...cal, flat: all([35, 30, 25]), fist: all([120, 130, 90]) })!;
    for (const f of ['index', 'ring'] as Finger[]) {
      expect(live.learner(hand(flat))[f]).toBeCloseTo(other.learner(hand(all([35, 30, 25])))[f], 6);
      expect(live.learner(hand(fist))[f]).toBeCloseTo(other.learner(hand(all([120, 130, 90])))[f], 6);
      expect(live.learner(hand(fist))[f]).toBeGreaterThan(live.learner(hand(flat))[f] + 100);
    }
  });

  it('gives the score the scorer gives for a held pose, where the raw comparison is far off', () => {
    // the learner holds a half fist; the reference is the pose a calibrated half fist maps to
    const half = all([57.5, 57.5, 40]);
    const live = liveCalibration(cal)!;
    const calibratedHalf = live.learner(hand(half));
    // a reference that sits 10 degrees per finger above the learner's calibrated pose
    const refTriple = FINGERS.map((f) => (calibratedHalf[f] + 10) / 3);
    const ref = hand(Object.fromEntries(FINGERS.map((f, i) => [f, [rad(refTriple[i]), rad(refTriple[i]), rad(refTriple[i])]])) as Record<Finger, JointTriple>);

    const final = scoreFrames(held(ref), held(hand(half)), 'right', TOL, { own: cal, reference: null });
    const liveDev = diff(live.learner(hand(half)), live.reference(ref));
    const liveNow = liveScore(liveDev, TOL.angle_deg, calibratedWeights(undefined, live));
    const rawNow = liveScore(diff(flexionDegrees(hand(half)), flexionDegrees(ref)), TOL.angle_deg);

    expect(final.timing).toBe(100);
    expect(Math.abs(liveNow - final.overall)).toBeLessThan(1);
    expect(Math.abs(rawNow - final.overall)).toBeGreaterThan(5);
    // per finger, the live deviation is the scorer's own error
    for (const f of ['index', 'middle', 'ring', 'little'] as Finger[]) expect(Math.abs(liveDev[f])).toBeCloseTo(10, 4);
  });
});
