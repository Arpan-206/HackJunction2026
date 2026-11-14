import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoreResult } from '../src/api/types';
import { MARGINS } from '../src/api/margin';
import { configFromTolerance } from '../src/features/apprentice/training/coach/deviation';
import { localScore } from '../src/features/apprentice/training/coach/localScore';
import { algorithmicTip } from '../src/features/apprentice/training/coach/tips';
import { isMastery } from '../src/features/apprentice/training/score/scoreRules';
import { getMargin, MARGIN_INFO, marginPref, marginSentence, prefersReducedMotion, reduceMotionPref, roomFor, scoreViewPref } from '../src/features/shared/settings';
import { handleMockRequest } from '../src/mock/router';
import { vals } from './helpers';

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    matchMedia: () => ({ matches: false }),
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
  });
  return store;
}

const resetAll = () => [marginPref, scoreViewPref, reduceMotionPref].forEach((p) => p.reset());

describe('settings store', () => {
  beforeEach(resetAll);
  afterEach(() => {
    resetAll();
    vi.unstubAllGlobals();
  });

  it('defaults: relaxed margin, 3D score, motion follows the device', () => {
    stubStorage();
    expect(getMargin()).toBe('relaxed');
    expect(scoreViewPref.get()).toBe('3d');
    expect(reduceMotionPref.get()).toBeNull();
    expect(prefersReducedMotion()).toBe(false);
  });

  it('persists each choice in localStorage and reads it back after a reload', () => {
    const store = stubStorage();
    marginPref.set('relaxed');
    scoreViewPref.set('2d');
    reduceMotionPref.set(true);
    expect(store.get('apprentice.margin')).toBe('relaxed');
    expect(store.get('apprentice.scoreView')).toBe('2d');
    expect(store.get('apprentice.reduceMotion')).toBe('1');
    resetAll();
    expect(getMargin()).toBe('relaxed');
    expect(scoreViewPref.get()).toBe('2d');
    expect(prefersReducedMotion()).toBe(true);
  });

  it('ignores junk in storage and survives blocked storage', () => {
    const store = stubStorage();
    store.set('apprentice.margin', 'sloppy');
    store.set('apprentice.scoreView', 'hologram');
    expect(getMargin()).toBe('relaxed');
    expect(scoreViewPref.get()).toBe('3d');
    resetAll();
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('window', { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(getMargin()).toBe('relaxed');
    marginPref.set('strict');
    expect(getMargin()).toBe('strict');
  });

  it('says the margin in plain words with what it allowed', () => {
    expect(marginSentence('standard', { angle_deg: 18, timing_ms: 250 })).toBe("Judged with the expert's standard margin of error: 18 degrees per finger and 250 ms of timing.");
    expect(marginSentence('relaxed', { angle_deg: 18, timing_ms: 250 })).toBe('Judged with a relaxed margin of error: 27 degrees per finger and 375 ms of timing.');
    expect(roomFor({ angle_deg: 18, timing_ms: 250 }, 'strict')).toEqual({ angle: 11, timing: 150 });
    for (const m of MARGINS) expect(MARGIN_INFO[m].label.length).toBeGreaterThan(0);
  });
});

describe('margin of error in the live corrections', () => {
  it('scales the coach band with the same multiplier as the scorer; standard is unchanged', () => {
    const tol = { angle_deg: 18, timing_ms: 250 };
    expect(configFromTolerance(tol)).toEqual(configFromTolerance(tol, 'standard'));
    expect(configFromTolerance(tol)).toMatchObject({ toleranceDeg: 18, timingMs: 250 });
    expect(configFromTolerance(tol, 'relaxed')).toMatchObject({ toleranceDeg: 27, timingMs: 375 });
    expect(configFromTolerance(tol, 'strict').toleranceDeg).toBeCloseTo(10.8);
    expect(configFromTolerance(tol, 'just_trying')).toMatchObject({ toleranceDeg: 45, timingMs: 625 });
  });

  it('relaxed does not nag about a slightly-off finger that standard corrects, strict corrects one standard lets pass', () => {
    const slightlyOff = vals({ ring: -22 });
    expect(algorithmicTip(slightlyOff, configFromTolerance(undefined).toleranceDeg, 0, 250)).toMatch(/ring/i);
    expect(algorithmicTip(slightlyOff, configFromTolerance(undefined, 'relaxed').toleranceDeg, 0, 375)).toBeNull();
    const small = vals({ index: 14 });
    expect(algorithmicTip(small, configFromTolerance(undefined).toleranceDeg, 0, 250)).toBeNull();
    expect(algorithmicTip(small, configFromTolerance(undefined, 'strict').toleranceDeg, 0, 150)).toMatch(/index/i);
  });

  it('the offline local score reads its band from the same config', () => {
    // The same rep as the live coach saw it: the ring finger 22 degrees off, inside the band half the time under standard.
    const stats = { meanAbs: vals({ ring: 22 }), inTolerance: vals({ thumb: 1, index: 1, middle: 1, ring: 0.5, little: 1 }), meanLagMs: 0, worst: 'ring', tip: null };
    const standard = localScore(stats as never, configFromTolerance(undefined));
    const relaxed = localScore(stats as never, configFromTolerance(undefined, 'relaxed'));
    expect(standard.within_tolerance).toBe(false);
    expect(relaxed.per_finger.ring).toBeGreaterThan(standard.per_finger.ring);
  });
});

describe('margin of error through the mock backend', () => {
  beforeEach(() => void stubStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('POST /score echoes the margin and rejects unknown names; POST /coach/hint stays quiet under relaxed', async () => {
    const motion = { preset: 'hold_pose', pose: { thumb: 0.2, index: 0.5, middle: 0.5, ring: 0.5, little: 0.5 } };
    const frames = Array.from({ length: 60 }, (_, i) => ({
      t: i / 30,
      source: 'simulator',
      hands: [{ side: 'right', wrist_quat: [0, 0, 0, 1], wrist_pos: null, flexion: { thumb: [0.2, 0.3, 0.2], index: [0.9, 1, 0.7], middle: [0.8, 0.9, 0.6], ring: [0.8, 0.9, 0.6], little: [0.8, 0.9, 0.6] } }],
    }));
    const send = (json: unknown, path = '/score') => handleMockRequest({ method: 'POST', path, query: new URLSearchParams(), json });
    const plain = await send({ reference_motion: motion, attempt_frames: frames });
    expect(plain.body).toMatchObject({ margin: 'standard' });
    const relaxed = await send({ reference_motion: motion, attempt_frames: frames, margin: 'relaxed' });
    expect((relaxed.body as ScoreResult).margin).toBe('relaxed');
    expect((relaxed.body as ScoreResult).overall).toBeGreaterThanOrEqual((plain.body as ScoreResult).overall);
    expect((await send({ reference_motion: motion, attempt_frames: frames, margin: 'lenient' })).status).toBe(422);
    const hint = (margin?: string) => send({ instruction: '', deviations: { ring: -22 }, timing_ms: 0, ...(margin ? { margin } : {}) }, '/coach/hint');
    expect(((await hint()).body as { hint: string }).hint).toMatch(/ring/);
    expect(((await hint('relaxed')).body as { hint: string }).hint).toBe('Great match. Keep the same shape and rhythm.');
  });
});

describe('gold only for mastery', () => {
  const r = (over: Partial<ScoreResult>): ScoreResult => ({ overall: 95, per_finger: vals({ thumb: 95, index: 95, middle: 95, ring: 95, little: 95 }), timing: 95, within_tolerance: true, worst_finger: 'ring', hint: '', warnings: [], ...over });
  it('a high rep is mastery under strict, standard or relaxed, not under just trying it', () => {
    expect(isMastery(r({}))).toBe(true);
    expect(isMastery(r({ margin: 'strict' }))).toBe(true);
    expect(isMastery(r({ margin: 'relaxed' }))).toBe(true);
    expect(isMastery(r({ margin: 'just_trying' }))).toBe(false);
    expect(isMastery(r({ within_tolerance: false }))).toBe(false);
  });
});
