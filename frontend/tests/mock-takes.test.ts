import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Finger, GloveFrame, Margin, MotionSpec, ScoreResult, TakesModel, Tolerance } from '../src/api/types';
import { buildHint, compare, fingerThresholds, resample, scoreFrames, thresholds, toResult } from '../src/mock/scoring';
import { buildModel, modelFromFrames, toleranceFromSpread, TAKES_TOLERANCE_CEIL_DEG, TAKES_TOLERANCE_FLOOR_DEG } from '../src/mock/takes';
import { frameAt, synthesise } from '../src/mock/synth';
import { handleMockRequest } from '../src/mock/router';
import { clearMockStorage, getStore } from '../src/mock/store';

/**
 * Per-finger tolerance and the takes model in the mock port. The expected numbers were produced by running the Python
 * code (backend/app/services/scoring.py and takes.py) on the same inputs, so they pin the port to the backend.
 */

const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];
const SEQ: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5, 4, 3, 2, 1], beat_ms: 620 };
const HOLD: MotionSpec = { preset: 'hold_pose', pose: { thumb: 0.2, index: 0.5, middle: 0.5, ring: 0.5, little: 0.5 } };

function attempt(spec: MotionSpec, dur: number, shift = 0, bumps: Partial<Record<Finger, number>> = {}): GloveFrame[] {
  return Array.from({ length: Math.round(dur * 60) }, (_, i) => {
    const f = frameAt(spec, i / 60 + shift, ['right']);
    f.t = i / 60;
    const h = f.hands[0];
    for (const [finger, d] of Object.entries(bumps) as [Finger, number][]) h.flexion[finger] = h.flexion[finger].map((v) => v + d) as [number, number, number];
    return f;
  });
}

const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.15);

function expectScore(r: ScoreResult, e: { overall: number; per: number[]; timing: number; within: boolean; worst: Finger; hint: string }) {
  close(r.overall, e.overall);
  FINGERS.forEach((f, i) => close(r.per_finger[f], e.per[i]));
  close(r.timing, e.timing);
  expect(r.within_tolerance).toBe(e.within);
  expect(r.worst_finger).toBe(e.worst);
  expect(r.hint).toBe(e.hint);
}

const tol = (fingers: Partial<Record<Finger, number>>): Tolerance => ({ angle_deg: 18, timing_ms: 250, finger_angle_deg: fingers });
const hold = (bumps: Partial<Record<Finger, number>>, t: Tolerance, margin?: Margin) =>
  scoreFrames(synthesise(HOLD, 'right', 2, 30), attempt(HOLD, 2, 0, bumps), 'right', t, undefined, margin);

describe('per-finger tolerance, pinned to the Python scorer', () => {
  it('gives one finger a looser band, still scaled by the margin', () => {
    expectScore(hold({ index: 0.12 }, tol({ index: 30 })), {
      overall: 98.4, per: [100, 90, 100, 100, 100], timing: 100, within: true, worst: 'index',
      hint: 'Relax your index finger, it is curled about 21 degrees (in total) too much.',
    });
    expectScore(hold({ index: 0.12 }, tol({ index: 30 }), 'strict'), {
      overall: 96.0, per: [100, 74.7, 100, 100, 100], timing: 100, within: false, worst: 'index',
      hint: 'Relax your index finger, it is curled about 21 degrees (in total) too much.',
    });
    expectScore(hold({ index: 0.12 }, tol({ index: 10 })), {
      overall: 90.2, per: [100, 38.9, 100, 100, 100], timing: 100, within: false, worst: 'index',
      hint: 'Relax your index finger, it is curled about 21 degrees (in total) too much.',
    });
  });

  it('names the finger furthest outside its own band, not the largest error', () => {
    expectScore(hold({ index: 0.12, ring: -0.08 }, tol({ index: 36, ring: 10 })), {
      overall: 93.4, per: [100, 93, 100, 65.7, 100], timing: 100, within: false, worst: 'ring',
      hint: 'Curl your ring finger more, it is about 14 degrees (in total) too straight.',
    });
  });

  it('works with timing and a quiet margin', () => {
    const r = scoreFrames(synthesise(SEQ, 'right', 3, 30), attempt(SEQ, 3, -0.2, { middle: 0.05 }), 'right', { angle_deg: 18, timing_ms: 250, finger_angle_deg: { thumb: 10, index: 12, middle: 14, ring: 20, little: 30 } }, undefined, 'relaxed');
    expectScore(r, { overall: 99.0, per: [100, 100, 98, 100, 100], timing: 96.5, within: true, worst: 'middle', hint: 'Great match. Keep the same shape and rhythm.' });
  });

  it('matches the scalar tolerance exactly when every finger has the same band', () => {
    const ref = resample(synthesise(HOLD, 'right', 2, 30), 'right');
    const att = resample(attempt(HOLD, 2, 0, { index: 0.12, ring: -0.05 }), 'right');
    const cmp = compare(ref, att);
    const uniform = Object.fromEntries(FINGERS.map((f) => [f, 18])) as Record<Finger, number>;
    expect(toResult(cmp, tol(uniform))).toEqual(toResult(cmp, { angle_deg: 18, timing_ms: 250 }));
    expect(toResult(cmp, tol(uniform), 'relaxed')).toEqual(toResult(cmp, { angle_deg: 18, timing_ms: 250 }, 'relaxed'));
  });

  it('builds per-finger hints like hints.build_hint', () => {
    const per = fingerThresholds(tol({ index: 36, ring: 10 }));
    expect(buildHint({ index: 20, ring: -12 }, 0, thresholds(), per)).toContain('ring');
    expect(buildHint({ index: 20, ring: -12 }, 0)).toContain('index');
    expect(buildHint({ index: 20, ring: -12 }, 0, thresholds('just_trying'), fingerThresholds(tol({ index: 36, ring: 10 }), 'just_trying'))).toBe(
      'Great match. Keep the same shape and rhythm.',
    );
  });
});

const TAKES = [
  attempt(SEQ, 2.5, 0),
  attempt(SEQ, 2.5, 0.05, { index: 0.04 }),
  attempt(SEQ, 2.5, -0.05, { ring: -0.05 }),
  attempt(SEQ, 2.5, 0, { thumb: 0.25, index: 0.25, middle: 0.25, ring: 0.25, little: 0.25 }),
];

function expectModel(m: TakesModel, e: { ref: string; fingers: number[]; angle: number; spread: number[]; consistency: number; steadiest: Finger; loosest: Finger; enough: boolean; warnings: string[] }) {
  expect(m.reference_recording_id).toBe(e.ref);
  FINGERS.forEach((f, i) => close(m.tolerance.finger_angle_deg[f], e.fingers[i]));
  close(m.tolerance.angle_deg, e.angle);
  FINGERS.forEach((f, i) => close(m.spread_deg[f], e.spread[i]));
  close(m.consistency, e.consistency);
  expect(m.steadiest_finger).toBe(e.steadiest);
  expect(m.loosest_finger).toBe(e.loosest);
  expect(m.enough_takes).toBe(e.enough);
  expect(m.warnings).toEqual(e.warnings);
}

describe('takes model, pinned to backend/app/services/takes.py', () => {
  it('maps spread to a clamped tolerance', () => {
    expect(toleranceFromSpread(0)).toBe(TAKES_TOLERANCE_FLOOR_DEG);
    expect(toleranceFromSpread(6)).toBe(15);
    expect(toleranceFromSpread(100)).toBe(TAKES_TOLERANCE_CEIL_DEG);
  });

  it('picks the central take, flags the far one and keeps it out of the spread', () => {
    const m = modelFromFrames(TAKES, ['a', 'b', 'c', 'd']);
    expectModel(m, {
      ref: 'a', fingers: [10, 10.1, 10, 11, 10], angle: 10, spread: [0.6, 4, 1.3, 4.4, 0.8], consistency: 73.3, steadiest: 'thumb', loosest: 'ring', enough: true,
      warnings: ['Take 4 strays from the others, mostly on the thumb. Record it again or leave it out.'],
    });
    expect(m.takes.map((t) => [t.recording_id, t.is_reference, t.worst_finger, t.outlier])).toEqual([
      ['a', true, null, false],
      ['b', false, 'index', false],
      ['c', false, 'ring', false],
      ['d', false, 'thumb', true],
    ]);
    const expected = [
      { distance: 0, score: 100, err: [0, 0, 0, 0, 0] },
      { distance: 1.8, score: 98.9, err: [0.7, 4.9, 1.3, 1.3, 0.9] },
      { distance: 1.8, score: 98.5, err: [0.5, 1.3, 1.3, 5.5, 0.5] },
      { distance: 40.7, score: 22.6, err: [43, 39.2, 39.2, 39.1, 43] },
    ];
    m.takes.forEach((t, k) => {
      close(t.distance_deg, expected[k].distance);
      close(t.score, expected[k].score);
      FINGERS.forEach((f, i) => close(t.error_deg[f], expected[k].err[i]));
    });
  });

  it('builds a three-take model with no warnings', () => {
    expectModel(modelFromFrames(TAKES.slice(0, 3), ['a', 'b', 'c'], 'right'), {
      ref: 'a', fingers: [10, 10.1, 10, 11, 10], angle: 10, spread: [0.6, 4, 1.3, 4.4, 0.8], consistency: 98.7, steadiest: 'thumb', loosest: 'ring', enough: true, warnings: [],
    });
  });

  it('accepts two takes with a warning and never flags either', () => {
    const series = [TAKES[1], TAKES[2]].map((f) => resample(f, 'right'));
    const m = buildModel(series, ['b', 'c'], 'right');
    expectModel(m, {
      ref: 'b', fingers: [10, 14.1, 10, 14.8, 10], angle: 10, spread: [0.7, 5.6, 0, 5.9, 1.1], consistency: 98, steadiest: 'middle', loosest: 'ring', enough: false,
      warnings: ['Only 2 takes: record 3 to 5 so one uneven take cannot set the reference.'],
    });
    expect(m.takes.some((t) => t.outlier)).toBe(false);
  });
});

describe('mock router: takes routes', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage, setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) });
    clearMockStorage();
  });

  const call = (method: string, path: string, json?: unknown) => {
    const [p, q] = path.split('?');
    return handleMockRequest({ method, path: p, query: new URLSearchParams(q ?? ''), json });
  };

  const save = (id: string, stepId: string, frames: GloveFrame[]) =>
    getStore().saveRecording({ id, lesson_id: 'l', step_id: stepId, started_at: `2026-11-14T10:00:0${id.length}Z`, duration_s: frames[frames.length - 1].t, fps: 60, hands: 'right', frames });

  it('lists takes per step without frames and deletes them for good', async () => {
    save('t1', 's1', TAKES[0]);
    save('t22', 's1', TAKES[1]);
    save('t333', 's2', TAKES[2]);
    const listed = (await call('GET', '/recordings?step_id=s1')).body as { id: string; frame_count: number; frames?: unknown }[];
    expect(listed.map((r) => r.id)).toEqual(['t1', 't22']);
    expect(listed[0].frames).toBeUndefined();
    expect(listed[0].frame_count).toBe(TAKES[0].length);
    expect(((await call('GET', '/recordings')).body as unknown[]).length).toBe(3);
    expect((await call('DELETE', '/recordings/t1')).status).toBe(204);
    expect((await call('GET', '/recordings/t1')).status).toBe(404);
    expect((await call('DELETE', '/recordings/t1')).status).toBe(404);
    expect(((await call('GET', '/recordings?step_id=s1')).body as { id: string }[]).map((r) => r.id)).toEqual(['t22']);
  });

  it('builds the model and rejects one, six, repeated and unknown takes', async () => {
    save('a', 's', TAKES[0]);
    save('b', 's', TAKES[1]);
    save('c', 's', TAKES[2]);
    const res = await call('POST', '/recordings/model', { recording_ids: ['b', 'a', 'c'] });
    expect(res.status).toBe(200);
    const m = res.body as TakesModel;
    expect(m.reference_recording_id).toBe('a');
    expect(m.take_ids).toEqual(['b', 'a', 'c']);
    expect(m.side).toBe('right');
    expect((await call('POST', '/recordings/model', { recording_ids: ['a'] })).status).toBe(422);
    expect((await call('POST', '/recordings/model', { recording_ids: ['a', 'b', 'c', 'd', 'e', 'f'] })).status).toBe(422);
    expect((await call('POST', '/recordings/model', { recording_ids: ['a', 'a'] })).status).toBe(422);
    expect((await call('POST', '/recordings/model', { recording_ids: ['a', 'zz'] })).status).toBe(404);
  });

  it('keeps take ids and per-finger tolerance on a saved step', async () => {
    const tolerance = { angle_deg: 12, timing_ms: 250, finger_angle_deg: { thumb: 10, index: 22.5, middle: 10, ring: 12, little: 36 } };
    const created = await call('POST', '/lessons', {
      title: 'Takes',
      skill: 'general',
      steps: [
        { title: 'Grip', instruction: 'Hold it', reference_recording_id: 'a', take_ids: ['a', 'b', 'c'], tolerance },
        { title: 'Plain', instruction: 'As before' },
      ],
    });
    expect(created.status).toBe(201);
    const [rich, plain] = (created.body as { steps: { take_ids: string[]; tolerance: Tolerance }[] }).steps;
    expect(rich.take_ids).toEqual(['a', 'b', 'c']);
    expect(rich.tolerance).toEqual(tolerance);
    expect(plain.take_ids).toEqual([]);
    expect(plain.tolerance.finger_angle_deg).toBeNull();
    const bad = await call('POST', '/lessons', { title: 'x', skill: 'general', steps: [{ title: 'a', instruction: 'b', tolerance: { finger_angle_deg: { index: 0 } } }] });
    expect(bad.status).toBe(422);
  });

  it('honours per-finger tolerance on /coach/hint', async () => {
    const hint = async (extra: object) => ((await call('POST', '/coach/hint', { instruction: '', deviations: { index: 20, ring: -12 }, timing_ms: 0, ...extra })).body as { hint: string }).hint;
    expect(await hint({ finger_tolerance_deg: { index: 36, ring: 10 } })).toContain('ring');
    expect(await hint({})).toContain('index');
    expect((await call('POST', '/coach/hint', { deviations: {}, finger_tolerance_deg: { ring: -1 } })).status).toBe(422);
  });
});
