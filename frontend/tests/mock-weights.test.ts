import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Calibration, Finger } from '../src/api/types';
import { calibrationMasks, compare, focusFingers, takeWeights, toResult, weightMap, type Comparison, type Series } from '../src/mock/scoring';
import { handleMockRequest } from '../src/mock/router';

/**
 * Per-finger step weights in the mock scorer. The expected results were produced by the Python scorer
 * (backend/app/services/scoring.py to_result and take_weights) on the same inputs, so the port is pinned to the backend.
 */

const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];
const CMP: Comparison = {
  errorDeg: { thumb: 3, index: 5, middle: 12, ring: 40, little: 2 },
  deviationDeg: { thumb: 1, index: -5, middle: -12, ring: -40, little: 2 },
  timingAbsMs: 60,
  timingSignedMs: -60,
};
const TOL = { angle_deg: 18, timing_ms: 250 };

describe('weighted toResult matches the Python scorer', () => {
  it('without weights is unchanged', () => {
    const r = toResult(CMP, TOL);
    expect(r.overall).toBe(87.2);
    expect(r.worst_finger).toBe('ring');
    expect(r.within_tolerance).toBe(false);
  });

  it('a light ring is never the one to fix and costs less', () => {
    const r = toResult(CMP, TOL, 'standard', { thumb: 1, index: 1, middle: 1, ring: 0.1, little: 0.5 });
    expect(r.overall).toBe(95.6);
    expect(r.worst_finger).toBe('middle');
    expect(r.hint).toBe('Curl your middle finger more, it is about 12 degrees (in total) too straight.');
    expect(r.within_tolerance).toBe(false);
  });

  it('zero-weight fingers never break within_tolerance or get named', () => {
    const r = toResult(CMP, TOL, 'standard', { thumb: 0, index: 1, middle: 0, ring: 0, little: 0 });
    expect(r.overall).toBe(98.4);
    expect(r.worst_finger).toBe('index');
    expect(r.within_tolerance).toBe(true);
    expect(r.hint).toContain('index');
  });

  it('focus falls back to the heaviest fingers', () => {
    expect(focusFingers(weightMap({ thumb: 0.1, index: 0.2, middle: 0.1, ring: 0.1, little: 0.1 }))).toEqual(['index']);
    expect(focusFingers(weightMap({ thumb: 0, index: 0, middle: 0, ring: 0, little: 0 }))).toEqual([]);
    expect(weightMap(null)).toEqual({ thumb: 1, index: 1, middle: 1, ring: 1, little: 1 });
  });
});

describe('takes and calibration', () => {
  const series = (ring: number): Series => Array.from({ length: 10 }, () => FINGERS.map((f) => (f === 'ring' ? [ring, ring, ring] : [0.5, 0.5, 0.5])));

  it('take weights drop a finger the expert varies (pinned to take_weights)', () => {
    const { weights, spreadDeg } = takeWeights([series(0.1), series(0.5), series(0.9)]);
    expect(weights).toEqual({ thumb: 1, index: 1, middle: 1, ring: 0.2, little: 1 });
    expect(spreadDeg.ring).toBe(56.1);
  });

  it('a joint mask leaves a joint out of total flexion', () => {
    const ref: Series = Array.from({ length: 20 }, () => FINGERS.map(() => [0, 0, 0]));
    const att: Series = ref.map((frame) => frame.map((j, fi) => (fi === 3 ? [Math.PI / 6, 0, 0] : [...j])));
    expect(compare(ref, att).errorDeg.ring).toBeGreaterThan(25);
    const mask = FINGERS.map((_, fi) => (fi === 3 ? [0, 1, 1] : [1, 1, 1]));
    expect(compare(ref, att, 30, undefined, mask).errorDeg.ring).toBe(0);
  });

  it("Arpan's real right-hand range masks the unreadable thumb joints", () => {
    const cal: Calibration = {
      id: 'c8713cacaff6',
      side: 'right',
      flat: { thumb: [0.9129, 0.8876, 0.2603], index: [0.8082, 0.293, 0.1962], middle: [0.5602, 0.8699, 0.5828], ring: [0.3921, 1.0903, 0.7319], little: [0.3146, 0.8156, 0.5462] },
      fist: { thumb: [1.1208, 0.4842, 0.1908], index: [1.4608, 1.423, 0.9574], middle: [1.7345, 1.345, 0.9032], ring: [1.8115, 1.37, 0.9207], little: [1.7811, 1.2779, 0.8594] },
      created_at: '2026-11-14T11:34:24Z',
    };
    const m = calibrationMasks(cal);
    expect(m?.joints[0]).toEqual([1, 0, 0]);
    expect(m?.fingers).toEqual({ thumb: 1, index: 1, middle: 1, ring: 1, little: 1 });
  });
});

describe('mock router', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
      matchMedia: () => ({ matches: false }),
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('accepts weights on POST /score and keeps the ring out of the hint', async () => {
    const frames = Array.from({ length: 60 }, (_, i) => ({
      t: i / 30,
      source: 'simulator',
      hands: [{ side: 'right', wrist_quat: [0, 0, 0, 1], wrist_pos: null, flexion: { thumb: [0.2, 0.2, 0.2], index: [0.5, 0.5, 0.5], middle: [0.5, 0.5, 0.5], ring: [0.1, 0.1, 0.1], little: [0.5, 0.5, 0.5] } }],
    }));
    const body = { reference_motion: { preset: 'hold_pose', pose: { thumb: 0.2, index: 0.5, middle: 0.5, ring: 0.9, little: 0.5 } }, attempt_frames: frames, tolerance: TOL };
    const post = async (extra: object) => {
      const res = await handleMockRequest({ method: 'POST', path: '/score', query: new URLSearchParams(), json: { ...body, ...extra } });
      return res.body as { worst_finger: Finger; hint: string; overall: number };
    };
    const plain = await post({});
    expect(plain.worst_finger).toBe('ring');
    const weighted = await post({ weights: { thumb: 1, index: 1, middle: 1, ring: 0, little: 1 } });
    expect(weighted.worst_finger).not.toBe('ring');
    expect(weighted.hint).not.toContain('ring');
    expect(weighted.overall).toBeGreaterThan(plain.overall);
  });
});
