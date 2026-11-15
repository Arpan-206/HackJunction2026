import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Finger, ScoreResult } from '../src/api/types';
import { isAssistantPath, setAssistantOn } from '../src/features/shared/assistant';
import { writtenByModel } from '../src/features/apprentice/training/ScoreCard';
import { buildReview, ignoredFingers, reviewWeakest } from '../src/mock/review';
import { handleMockRequest } from '../src/mock/router';

// Inputs mirror backend/tests/test_coach_review.py; the sentences are those of backend/app/services/llm/review.py.
function score(over: Partial<ScoreResult> & { per_finger?: Partial<Record<Finger, number>> } = {}): ScoreResult {
  const { per_finger, ...rest } = over;
  return {
    overall: 92,
    per_finger: { thumb: 96, index: 86, middle: 82, ring: 95, little: 97, ...per_finger },
    timing: 100,
    within_tolerance: true,
    worst_finger: 'middle',
    hint: 'Great match. Keep the same shape and rhythm.',
    warnings: [],
    margin: 'relaxed',
    ...rest,
  } as ScoreResult;
}

const LIGHT = { thumb: 1, index: 1, middle: 0.6, ring: 0.25, little: 0.1 };

describe('buildReview (port of backend build_review)', () => {
  it('clean rep: praise and repeat', () => {
    expect(buildReview({ score: score(), weights: null })).toBe('That was a clean one: your whole hand held the shape. Do it again the same way.');
  });

  it('close but not clean', () => {
    expect(buildReview({ score: score({ within_tolerance: false }), weights: null })).toBe('Your hand shape was close all the way through. Hold it a touch steadier next time.');
  });

  it('shape right but timing weak', () => {
    const s = score({ timing: 55, per_finger: { thumb: 96, index: 92, middle: 90, ring: 95, little: 97 } });
    expect(buildReview({ score: s, weights: null })).toBe('Your hand shape was right. Next time, move with the guide hand so you land on the beat.');
  });

  it('weak finger with a curl hint, failed rep', () => {
    const s = score({
      overall: 90,
      per_finger: { thumb: 78, index: 94, middle: 81, ring: 86, little: 97 },
      within_tolerance: false,
      worst_finger: 'thumb',
      hint: 'Curl your thumb more, it is about 19 degrees (in total) too straight.',
    });
    expect(buildReview({ score: s, weights: null })).toBe('Nearly there, most of your hand was right. Next time, curl your thumb a little more.');
  });

  it('weak finger with a relax hint, passing rep', () => {
    const s = score({
      per_finger: { thumb: 96, index: 60, middle: 90, ring: 95, little: 97 },
      worst_finger: 'index',
      hint: 'Relax your index finger, it is curled about 30 degrees (in total) too much.',
    });
    expect(buildReview({ score: s, weights: null })).toBe('Good rep, the rest of your hand was right. Next time, let your index finger relax a little.');
  });

  it('weak finger with no direction in the hint', () => {
    const s = score({ per_finger: { thumb: 96, index: 92, middle: 50, ring: 95, little: 97 }, hint: 'Great match.' });
    expect(buildReview({ score: s, weights: null })).toBe('Good rep, the rest of your hand was right. Next time, watch your middle finger and match the guide more closely.');
  });

  it('a hint that names another finger gives no direction', () => {
    const s = score({ per_finger: { thumb: 96, index: 92, middle: 50, ring: 95, little: 97 }, hint: 'Curl your index finger more.' });
    expect(buildReview({ score: s, weights: null })).toContain('watch your middle finger');
  });

  it('a light finger is never the subject', () => {
    const s = score({ per_finger: { thumb: 96, index: 92, middle: 90, ring: 95, little: 40 }, worst_finger: 'little' });
    const req = { score: s, weights: LIGHT };
    expect(ignoredFingers(req)).toEqual(['ring', 'little']);
    expect(reviewWeakest(req)).toBeNull();
    const text = buildReview(req);
    expect(text).toBe('That was a clean one: your whole hand held the shape. Do it again the same way.');
    expect(text).not.toContain('little');
  });

  it('falls back to all fingers when every finger is light', () => {
    const w = { thumb: 0.1, index: 0.1, middle: 0.1, ring: 0.1, little: 0.1 };
    const s = score({ per_finger: { thumb: 96, index: 92, middle: 90, ring: 95, little: 40 }, hint: 'Relax your little finger.' });
    expect(ignoredFingers({ weights: w })).toHaveLength(5);
    expect(reviewWeakest({ score: s, weights: w })).toBe('little');
    expect(buildReview({ score: s, weights: w })).toBe('Good rep, the rest of your hand was right. Next time, let your little finger relax a little.');
  });

  it('never contains a digit or measuring word', () => {
    const s = score({ hint: 'Curl your thumb more, it is about 19 degrees too straight.', per_finger: { thumb: 70, index: 90, middle: 90, ring: 90, little: 90 } });
    expect(buildReview({ score: s, weights: null })).not.toMatch(/\d|degree|tolerance/);
  });
});

describe('writtenByModel', () => {
  it.each(['gemini', 'openai'])('%s is a model', (p) => expect(writtenByModel(p)).toBe(true));
  it.each(['algorithmic', 'fake', 'fake (rate limited)', 'offline', 'mock', null, undefined])('%s is not', (p) => expect(writtenByModel(p)).toBe(false));
});

describe('assistant path and mock route', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('window', { setTimeout, localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
  });

  afterEach(() => {
    setAssistantOn(true);
    vi.unstubAllGlobals();
  });

  it('/coach/review is an assistant path', () => {
    expect(isAssistantPath('/coach/review')).toBe(true);
  });

  it('the mock router answers with the algorithmic sentence', async () => {
    setAssistantOn(true);
    const res = await handleMockRequest({ method: 'POST', path: '/coach/review', query: new URLSearchParams(), json: { score: score() } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ feedback: 'That was a clean one: your whole hand held the shape. Do it again the same way.', provider: 'algorithmic' });
  });

  it('the mock router rejects a body without a score', async () => {
    const res = await handleMockRequest({ method: 'POST', path: '/coach/review', query: new URLSearchParams(), json: {} });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('the mock router refuses while the AI Assistant is off', async () => {
    setAssistantOn(false);
    const res = await handleMockRequest({ method: 'POST', path: '/coach/review', query: new URLSearchParams(), json: { score: score() } });
    expect(res.status).toBe(403);
  });
});
