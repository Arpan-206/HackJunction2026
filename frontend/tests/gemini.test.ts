import { describe, expect, it } from 'vitest';
import { videoProblem } from '../src/features/master/generate/useGenerate';
import { trimAttempts, type LoggedAttempt } from '../src/features/shared/practiceLog';
import { motionProviderLine } from '../src/features/shared/useMotionFromText';

const attempt = (n: number): LoggedAttempt => ({
  step_id: `s${n}`,
  score: { overall: n, per_finger: { thumb: 1, index: 1, middle: 1, ring: 1, little: 1 }, timing: 1, within_tolerance: true, worst_finger: 'ring', hint: '', warnings: [] },
});

describe('videoProblem', () => {
  it('accepts mp4, webm and mov under the limit', () => {
    expect(videoProblem({ name: 'a.mp4', type: 'video/mp4', size: 1000 })).toBeNull();
    expect(videoProblem({ name: 'a.MOV', type: '', size: 1000 })).toBeNull();
    expect(videoProblem({ name: 'a', type: 'video/webm', size: 1000 })).toBeNull();
  });
  it('refuses other types and oversize clips in plain words', () => {
    expect(videoProblem({ name: 'a.txt', type: 'text/plain', size: 10 })).toMatch(/mp4, webm or mov/);
    expect(videoProblem({ name: 'a.mp4', type: 'video/mp4', size: 51 * 1024 * 1024 })).toMatch(/50 MB/);
  });
});

describe('trimAttempts', () => {
  it('keeps the newest attempts', () => {
    const list = Array.from({ length: 70 }, (_, i) => attempt(i));
    const kept = trimAttempts(list);
    expect(kept).toHaveLength(60);
    expect(kept[0].step_id).toBe('s10');
  });
});

describe('motionProviderLine', () => {
  it('is honest about the offline fallback', () => {
    expect(motionProviderLine('fake')).toMatch(/keyword rules while the AI Assistant was unavailable/);
    // Provider names stay in the developer panel: users only ever read "the AI Assistant".
    expect(motionProviderLine('gemini')).toBe('Read by the AI Assistant.');
    expect(motionProviderLine('ollama')).not.toMatch(/Gemma|Gemini|ollama/i);
  });
});
