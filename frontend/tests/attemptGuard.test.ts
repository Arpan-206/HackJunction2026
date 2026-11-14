import { describe, expect, it } from 'vitest';
import { attemptRetryLine, checkAttempt, MIN_ATTEMPT_FRAMES, recordedSeconds } from '../src/features/apprentice/training/coach/attemptGuard';

const frames = (seconds: number, hz = 30) => Array.from({ length: Math.round(seconds * hz) + 1 }, (_, i) => ({ t: i / hz }));

describe('attempt guard', () => {
  it('measures the recorded span from the first to the last frame', () => {
    expect(recordedSeconds([])).toBe(0);
    expect(recordedSeconds([{ t: 2 }])).toBe(0);
    expect(recordedSeconds([{ t: 1 }, { t: 1.5 }, { t: 4 }])).toBeCloseTo(3, 6);
  });

  it('accepts a full attempt and one at 80% of the planned length', () => {
    expect(checkAttempt(frames(5.58), 5.58).ok).toBe(true);
    expect(checkAttempt(frames(5.58 * 0.8), 5.58).ok).toBe(true);
  });

  it('rejects the 13-frame, 0.4 s attempt that used to be scored', () => {
    const check = checkAttempt(frames(0.4).slice(0, 13), 5.58);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe('too_short');
      expect(attemptRetryLine(check)).toMatch(/too short to score: 0\.4 of 5\.6 seconds/);
    }
  });

  it('rejects an attempt under 80% of the planned length', () => {
    const check = checkAttempt(frames(4), 5.58);
    expect(check).toMatchObject({ ok: false, reason: 'too_short' });
  });

  it('says so plainly when no frame was recorded at all', () => {
    const check = checkAttempt([], 6);
    expect(check).toMatchObject({ ok: false, reason: 'no_frames' });
    if (!check.ok) expect(attemptRetryLine(check)).toMatch(/No glove movement/);
  });

  it('only applies the frame floor when there is no planned length (Follow practice)', () => {
    expect(frames(0.2).length).toBeLessThan(MIN_ATTEMPT_FRAMES);
    expect(checkAttempt(frames(0.2), 0).ok).toBe(false);
    expect(checkAttempt(frames(1), 0).ok).toBe(true);
    const short = checkAttempt(frames(0.1), 0);
    expect(short.ok).toBe(false);
    if (!short.ok) expect(attemptRetryLine(short)).not.toMatch(/of 0\.0 seconds/);
  });
});
