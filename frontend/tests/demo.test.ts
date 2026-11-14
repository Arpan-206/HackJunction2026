import { describe, expect, it } from 'vitest';
import type { HandFrame } from '../src/api/types';
import { parseLesson, parseLessons } from '../src/api/useCoreSession';
import { GUEST_POSES, GUEST_TOTAL_S, guestName, handFromKeyAngles, hintLine, localScore, shownScore, sidesFrom } from '../src/features/apprentice/demo/demoLogic';

const hand = (curl: number, side: 'left' | 'right' = 'right'): HandFrame => ({
  side,
  wrist_quat: [0, 0, 0, 1],
  wrist_pos: null,
  flexion: { thumb: [curl, curl, curl], index: [curl, curl, curl], middle: [curl, curl, curl], ring: [curl, curl, curl], little: [curl, curl, curl] },
});

describe('guest calibration plan', () => {
  it('runs flat, fist, then thumb folded, in about 20 seconds', () => {
    expect(GUEST_POSES.map((p) => p.id)).toEqual(['flat', 'fist', 'thumb']);
    expect(GUEST_TOTAL_S).toBeGreaterThanOrEqual(12);
    expect(GUEST_TOTAL_S).toBeLessThanOrEqual(20);
  });

  it('names each guest by the time, within the 40 character wearer limit', () => {
    const name = guestName(new Date(2026, 10, 14, 9, 5, 7));
    expect(name).toBe('Guest 09:05:07');
    expect(name.length).toBeLessThanOrEqual(40);
  });

  it('calibrates the hands that stream, or the right hand when none does', () => {
    expect(sidesFrom(undefined)).toEqual(['right']);
    expect(sidesFrom([{ side: 'right' }, { side: 'left' }, { side: 'right' }])).toEqual(['left', 'right']);
  });
});

describe('live score helpers', () => {
  it('shows the core score as a whole number from 0 to 100', () => {
    expect(shownScore(0.849)).toBe(85);
    expect(shownScore(1.2)).toBe(100);
    expect(shownScore(null)).toBeNull();
    expect(shownScore(Number.NaN)).toBeNull();
  });

  it('turns the core hint into one plain correction', () => {
    expect(hintLine('ring', 'too_flat')).toBe('Curl your ring finger more.');
    expect(hintLine('thumb', 'too_curled')).toBe('Straighten your thumb.');
    expect(hintLine(null, 'too_flat')).toBeNull();
    expect(hintLine('index', null)).toBeNull();
  });

  it('scores an identical hand 1 and names no finger', () => {
    const s = localScore(hand(0.5), hand(0.5));
    expect(s.overall).toBeCloseTo(1);
    expect(s.worst).toBeNull();
    expect(s.hint).toBeNull();
  });

  it('follows the core per-frame rule: 45 degrees off is 0, and the flat finger is told to curl', () => {
    const target = hand(0.6);
    const learner = hand(0.6);
    const off = (45 * Math.PI) / 180;
    learner.flexion.index = [0.6 - off, 0.6 - off, 0.6 - off];
    const s = localScore(learner, target);
    expect(s.fingers.index).toBeCloseTo(0);
    expect(s.fingers.middle).toBeCloseTo(1);
    expect(s.worst).toBe('index');
    expect(s.hint).toBe('too_flat');
    expect(s.overall).toBeCloseTo(0.8);
  });
});

describe('core lesson messages', () => {
  it('builds the target hand from the 18 key angles in the compat layout', () => {
    const angles = [10, 20, 30, 31, 32, 40, 41, 42, 50, 51, 52, 60, 61, 62, 5, 6, 7, 8];
    const h = handFromKeyAngles(angles, 'left')!;
    const deg = (r: number) => Math.round((r * 180) / Math.PI);
    expect(h.side).toBe('left');
    expect(h.flexion.thumb.slice(1).map(deg)).toEqual([10, 20]);
    expect(h.flexion.index.map(deg)).toEqual([30, 31, 32]);
    expect(h.flexion.little.map(deg)).toEqual([60, 61, 62]);
    expect(deg(h.spread!.ring)).toBe(7);
    expect(handFromKeyAngles(angles.slice(0, 10), 'right')).toBeNull();
    expect(handFromKeyAngles(null, 'right')).toBeNull();
  });

  it('keeps readable lessons from a hello and the step poses from a lesson', () => {
    expect(
      parseLessons([
        { id: 'fake-demo', title: 'Fake demo', task: 'general', steps_total: 4 },
        { id: 'broken', title: '(unreadable: bad json)', task: 'general', steps_total: 0 },
        { title: 'no id' },
      ]).map((l) => l.id),
    ).toEqual(['fake-demo']);
    const l = parseLesson({ id: 'x', title: 'X', steps: [{ name: 'Fist', key_angles: [1, 2] }, { note: 'unnamed' }] });
    expect(l.steps).toEqual([
      { name: 'Fist', key_angles: [1, 2] },
      { name: 'Step 2', key_angles: null },
    ]);
  });
});
