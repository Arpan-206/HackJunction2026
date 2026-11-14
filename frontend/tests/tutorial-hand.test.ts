import { describe, expect, it } from 'vitest';
import type { GloveFrame, HandFrame } from '../src/api/types';
import { FrameWatch, lockedToGlove, STALE_FRAME_MS } from '../src/features/apprentice/training/coach/frameClock';
import { trackFromFrames, trackFromMotion } from '../src/features/apprentice/training/coach/reference';
import { formingAmount, isStillTrack, tutorialTrack } from '../src/features/apprentice/tutorial/formingTrack';

const simFrame = (t: number): GloveFrame => ({ t, source: 'simulator', hands: [] });

describe('the expert hand clock when the glove stream stalls', () => {
  it('a frame that keeps arriving is fresh, the same frame left standing goes stale', () => {
    const watch = new FrameWatch();
    const a = simFrame(4.2);
    expect(watch.fresh(a, 1000)).toBe(true);
    expect(watch.fresh(a, 1000 + STALE_FRAME_MS - 1)).toBe(true);
    expect(watch.fresh(a, 1000 + STALE_FRAME_MS + 100)).toBe(false);
    expect(watch.fresh(simFrame(4.3), 1500)).toBe(true);
    expect(watch.fresh(null, 1500)).toBe(false);
  });

  it('a stalled simulator no longer pins the expert to its last frame time (the hand stood still)', () => {
    const watch = new FrameWatch();
    const last = simFrame(12.5);
    expect(lockedToGlove(last, watch.fresh(last, 0), true, 1)).toBe(true);
    // The socket dropped or the source changed: the store keeps handing back the same frame.
    expect(lockedToGlove(last, watch.fresh(last, 2000), true, 1)).toBe(false);
  });

  it('locks only to a simulated glove, on a periodic reference at full speed', () => {
    const f = simFrame(1);
    expect(lockedToGlove(f, true, true, 1)).toBe(true);
    expect(lockedToGlove(f, true, false, 1)).toBe(false);
    expect(lockedToGlove(f, true, true, 0.5)).toBe(false);
    expect(lockedToGlove({ ...f, source: 'rokoko' } as GloveFrame, true, true, 1)).toBe(false);
  });
});

const flexSum = (h: HandFrame) => Object.values(h.flexion).reduce((s, j) => s + j[0] + j[1] + j[2], 0);

describe('the tutorial hand for a held shape', () => {
  it('a hold pose (the grip, a letter) is still, and the tutorial forms it from a relaxed hand instead', () => {
    const grip = trackFromMotion({ preset: 'hold_pose', pose: { thumb: 0.62, index: 0.8, middle: 0.84, ring: 0.86, little: 0.88 } }, 'right');
    expect(isStillTrack(grip)).toBe(true);
    const shown = tutorialTrack(grip);
    const p = grip.period;
    const start = flexSum(shown.handAt(0));
    const held = flexSum(shown.handAt(p * 0.6));
    expect(held).toBeCloseTo(flexSum(grip.handAt(p * 0.6)), 6);
    expect(held - start).toBeGreaterThan(1);
    expect(flexSum(shown.handAt(p * 0.2))).toBeGreaterThan(start);
    expect(flexSum(shown.handAt(p * 0.2))).toBeLessThan(held);
  });

  it('a recorded take that barely moves (the stored grip recordings) also forms', () => {
    const hand = (k: number): HandFrame => ({
      side: 'left',
      wrist_quat: [0, 0, 0, 1],
      wrist_pos: null,
      flexion: { thumb: [0.45, 0.52, 0.4], index: [1.2 + k, 1.43, 0.94], middle: [1.26, 1.49, 0.97], ring: [1.29, 1.51, 0.99], little: [1.33, 1.56, 1.03] },
    });
    const frames: GloveFrame[] = Array.from({ length: 146 }, (_, i) => ({ t: i / 60, source: 'simulator', hands: [hand(0.03 * Math.sin(i / 9)), { ...hand(0.03 * Math.sin(i / 9)), side: 'right' }] }));
    const rec = trackFromFrames(frames, 'right');
    expect(isStillTrack(rec)).toBe(true);
    const shown = tutorialTrack(rec);
    expect(Math.abs(flexSum(shown.handAt(rec.period * 0.6)) - flexSum(shown.handAt(0)))).toBeGreaterThan(1);
  });

  it('a take that moves plays exactly as recorded', () => {
    const swing = trackFromMotion({ preset: 'grip_and_swing', grip: 'shakehand', swing: 'forehand', beat_ms: 1500 }, 'right');
    expect(isStillTrack(swing)).toBe(false);
    expect(tutorialTrack(swing)).toBe(swing);
    const scale = trackFromMotion({ preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 620 }, 'right');
    expect(tutorialTrack(scale)).toBe(scale);
  });

  it('forms, holds, then lets go within one loop', () => {
    expect(formingAmount(0, 6)).toBe(0);
    expect(formingAmount(3, 6)).toBe(1);
    expect(formingAmount(5.99, 6)).toBeLessThan(0.05);
    expect(formingAmount(7, 6)).toBeCloseTo(formingAmount(1, 6), 9);
    expect(formingAmount(1, 0)).toBe(1);
  });
});
