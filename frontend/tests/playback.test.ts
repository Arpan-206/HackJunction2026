import { describe, expect, it } from 'vitest';
import type { GloveFrame, HandFrame, MotionSpec } from '../src/api/types';
import { FINGERS } from '../src/api/types';
import { framesDuration, handAt, lerpHand } from '../src/features/shared/playback';
import { HandSmoother } from '../src/three/smoothing';
import { curlsToFlexion, restFrame, synthFrame } from '../src/three/motion';
import { handWith } from './helpers';

const frame = (t: number, hands: HandFrame[]): GloveFrame => ({ t, source: 'replay', hands });
const norm = (q: number[]) => Math.hypot(q[0], q[1], q[2], q[3]);

describe('playback', () => {
  it('lerpHand interpolates flexion and position, and keeps the quaternion unit length', () => {
    const a = { ...handWith({ index: 0 }, [0, 0, 0, 1]), wrist_pos: [0, 0, 0] as [number, number, number] };
    const b = { ...handWith({ index: 90 }, [0, Math.SQRT1_2, 0, Math.SQRT1_2]), wrist_pos: [2, 4, 6] as [number, number, number] };
    const mid = lerpHand(a, b, 0.5);
    expect(mid.flexion.index[0]).toBeCloseTo((b.flexion.index[0] + a.flexion.index[0]) / 2, 9);
    expect(mid.wrist_pos).toEqual([1, 2, 3]);
    for (const k of [0, 0.25, 0.5, 0.9, 1]) expect(norm(lerpHand(a, b, k).wrist_quat)).toBeCloseTo(1, 9);
    expect(lerpHand(a, b, 0).wrist_quat).toEqual([0, 0, 0, 1]);
  });

  it('nlerp takes the short way round for opposite-sign quaternions', () => {
    const a = handWith({}, [0, 0, 0, 1]);
    const b = handWith({}, [0, 0, 0, -1]); // same orientation
    const q = lerpHand(a, b, 0.5).wrist_quat;
    expect(norm(q)).toBeCloseTo(1, 9);
    expect(Math.abs(q[3])).toBeCloseTo(1, 9);
  });

  it('lerpHand keeps a null position when either end has none', () => {
    expect(lerpHand(handWith(), handWith(), 0.5).wrist_pos).toBeNull();
  });

  it('framesDuration measures from the first timestamp', () => {
    expect(framesDuration([])).toBe(0);
    expect(framesDuration([frame(5, [])])).toBe(0);
    expect(framesDuration([frame(5, []), frame(7.5, [])])).toBe(2.5);
  });

  const frames = [frame(10, [handWith({ index: 0 })]), frame(11, [handWith({ index: 60 })]), frame(13, [handWith({ index: 120 })])];
  const idx = (h: HandFrame | null) => (h!.flexion.index[0] * 3 * 180) / Math.PI;

  it('handAt interpolates in time relative to the first frame', () => {
    expect(idx(handAt(frames, 0.5, 'right'))).toBeCloseTo(30, 6);
    expect(idx(handAt(frames, 1, 'right'))).toBeCloseTo(60, 6);
    expect(idx(handAt(frames, 2, 'right'))).toBeCloseTo(90, 6);
  });

  it('handAt clamps before the start and after the end, and is null for no frames', () => {
    expect(idx(handAt(frames, -3, 'right'))).toBeCloseTo(0, 6);
    expect(idx(handAt(frames, 99, 'right'))).toBeCloseTo(120, 6);
    expect(handAt([], 1, 'right')).toBeNull();
  });

  it('handAt falls back to the first hand when the side is missing, and null when a frame has no hands', () => {
    expect(handAt(frames, 1, 'left')).not.toBeNull();
    expect(handAt([frame(0, [])], 0, 'right')).toBeNull();
  });
});

describe('HandSmoother', () => {
  const target = handWith({ index: 90, ring: 60 }, [0, 0, 0, 1]);

  it('snaps on the first step', () => {
    const s = new HandSmoother();
    s.step(target, 0.016);
    expect(s.flex[3]).toBeCloseTo(target.flexion.index[0], 6);
  });

  it('eases towards a new target at the time constant and never overshoots', () => {
    const s = new HandSmoother();
    s.step(handWith(), 0.016);
    s.step(target, 0.045, { tau: 0.045 });
    const want = target.flexion.index[0];
    expect(s.flex[3]).toBeCloseTo(want * (1 - Math.exp(-1)), 5);
    let prev = s.flex[3];
    for (let i = 0; i < 100; i++) {
      s.step(target, 0.016);
      expect(s.flex[3]).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(s.flex[3]).toBeLessThanOrEqual(want + 1e-6);
      prev = s.flex[3];
    }
    expect(s.flex[3]).toBeCloseTo(want, 3);
  });

  it('smoothing disabled (false or tau 0) jumps straight to the target', () => {
    const s = new HandSmoother();
    s.step(handWith(), 0.016);
    s.step(target, 0.016, false);
    expect(s.flex[3]).toBeCloseTo(target.flexion.index[0], 6);
  });

  it('reset makes the next step snap, and the quaternion stays unit length', () => {
    const s = new HandSmoother();
    s.step(handWith({}, [0, 0, 0, 1]), 0.016);
    s.step(handWith({}, [0, 0, 0, -1]), 0.016);
    expect(s.quat.length()).toBeCloseTo(1, 6);
    s.reset();
    s.step(target, 0.016);
    expect(s.flex[9]).toBeCloseTo(target.flexion.ring[0], 6);
  });

  it('spread defaults to zero without spread data', () => {
    const s = new HandSmoother();
    s.step(target, 0.016);
    expect(Array.from(s.spread)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('synthFrame', () => {
  const specs: MotionSpec[] = [
    { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 620 },
    { preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: 1500 },
    { preset: 'grip_and_swing', grip: 'shakehand', swing: 'backhand', beat_ms: 1500 },
    { preset: 'pinch', fingers: [2], beat_ms: 900 },
    { preset: 'hold_pose', pose: { thumb: 0.5, index: 0.5, middle: 0.5, ring: 0.5, little: 0.5 } },
    { preset: 'idle' },
  ];

  it('is deterministic', () => {
    for (const s of specs) expect(synthFrame(s, 0.37)).toEqual(synthFrame(s, 0.37));
  });

  it('produces finite, bounded flexion and a unit wrist quaternion at every time', () => {
    for (const s of specs) {
      for (let t = 0; t < 4; t += 0.05) {
        const h = synthFrame(s, t);
        expect(norm(h.wrist_quat)).toBeCloseTo(1, 6);
        for (const f of FINGERS) {
          for (const a of h.flexion[f]) {
            expect(Number.isFinite(a)).toBe(true);
            expect(a).toBeGreaterThan(-0.5);
            expect(a).toBeLessThan(2.5);
          }
        }
      }
    }
  });

  it('a finger sequence presses each finger in turn and reports it as active', () => {
    const spec: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 1000 };
    const seen = [0, 1, 2, 3, 4].map((i) => synthFrame(spec, i + 0.2).active);
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    const peak = synthFrame(spec, 3.2); // ring pressed
    const rest = synthFrame(spec, 3.9);
    expect(peak.flexion.ring[0]).toBeGreaterThan(rest.flexion.ring[0]);
    expect(peak.flexion.ring[0]).toBeGreaterThan(peak.flexion.index[0]);
  });

  it('is periodic in the beat', () => {
    const spec: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3], beat_ms: 500 };
    expect(synthFrame(spec, 0.3).flexion).toEqual(synthFrame(spec, 0.3 + 1.5).flexion);
  });

  it('forehand and backhand swings rotate the wrist in opposite directions, and static poses do not rotate', () => {
    const fh = synthFrame(specs[1], 0.6);
    const bh = synthFrame(specs[2], 0.6);
    expect(fh.wrist_quat[1]).toBeCloseTo(-bh.wrist_quat[1], 6);
    expect(fh.wrist_quat[1]).not.toBeCloseTo(0, 3);
    expect(synthFrame(specs[5], 1).wrist_quat).toEqual([0, 0, 0, 1]);
  });

  it('curlsToFlexion clamps curls to [-0.2, 1] and restFrame is a relaxed identity hand', () => {
    const over = curlsToFlexion([9, 9, 9, 9, 9]);
    const one = curlsToFlexion([1, 1, 1, 1, 1]);
    expect(over).toEqual(one);
    expect(curlsToFlexion([-9, 0, 0, 0, 0]).thumb).toEqual(curlsToFlexion([-0.2, 0, 0, 0, 0]).thumb);
    const r = restFrame('left');
    expect(r.side).toBe('left');
    expect(r.wrist_quat).toEqual([0, 0, 0, 1]);
  });

  it('left hand mirrors only a swinging wrist', () => {
    const right = synthFrame(specs[1], 0.6, 'right');
    const left = synthFrame(specs[1], 0.6, 'left');
    expect(left.side).toBe('left');
    expect(left.flexion).toEqual(right.flexion);
    expect(left.wrist_quat[1]).toBeCloseTo(-right.wrist_quat[1], 6);
  });
});
