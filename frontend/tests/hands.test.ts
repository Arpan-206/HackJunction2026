import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScoreResult } from '../src/api/types';
import { combineHandScores } from '../src/features/apprentice/training/coach/twoHands';
import { defaultHands, getShowProps, handsLabel, handsSides, rememberHands, setShowProps, shownProp } from '../src/features/shared/sessionPrefs';
import { vals } from './helpers';

function score(overall: number, over: Partial<ScoreResult> = {}): ScoreResult {
  return { overall, per_finger: vals({ thumb: overall, index: overall, middle: overall, ring: overall, little: overall }), timing: 90, within_tolerance: overall >= 80, worst_finger: 'ring', hint: 'Curl the ring finger more.', warnings: [], ...over };
}

describe('combineHandScores (two-handed reps)', () => {
  it('keeps the weaker hand: overall, timing and each finger take the lower value, the hint names the hand', () => {
    const left = score(60, { per_finger: vals({ thumb: 99, index: 40, middle: 70, ring: 80, little: 90 }), timing: 95, worst_finger: 'index', hint: 'Curl your index finger.' });
    const right = score(85, { per_finger: vals({ thumb: 50, index: 90, middle: 90, ring: 90, little: 90 }), timing: 70 });
    const c = combineHandScores({ left, right });
    expect(c?.overall).toBe(60);
    expect(c?.timing).toBe(70);
    expect(c?.per_finger).toEqual(vals({ thumb: 50, index: 40, middle: 70, ring: 80, little: 90 }));
    expect(c?.within_tolerance).toBe(false);
    expect(c?.worst_finger).toBe('index');
    expect(c?.hint).toBe('Left hand: Curl your index finger.');
  });

  it('is within tolerance only when both hands are, and then speaks of both hands', () => {
    const c = combineHandScores({ left: score(90), right: score(92) });
    expect(c?.within_tolerance).toBe(true);
    expect(c?.hint.startsWith('Both hands: ')).toBe(true);
  });

  it('falls back to the one hand that could be scored, with a warning, and to null when none could', () => {
    const c = combineHandScores({ right: score(88) });
    expect(c?.overall).toBe(88);
    expect(c?.hint.startsWith('Right hand: ')).toBe(true);
    expect(c?.warnings.join(' ')).toMatch(/left hand was missing/);
    expect(combineHandScores({})).toBeNull();
  });
});

describe('session preferences', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('props are off by default and shownProp hides the prop until switched on', () => {
    expect(getShowProps()).toBe(false);
    expect(shownProp('racket', false)).toBe('none');
    expect(shownProp('racket', true)).toBe('racket');
    expect(shownProp(undefined, true)).toBe('none');
  });

  it('hands default: session choice for the move, else the catalogue, else the last choice, else right', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
    expect(defaultHands(null)).toBe('right');
    expect(defaultHands('tt_serve_toss_pinch', 'left')).toBe('left');
    rememberHands('general_pinch', 'both');
    expect(defaultHands('general_pinch', 'right')).toBe('both');
    expect(defaultHands('tt_forehand_swing', 'right')).toBe('right');
    expect(defaultHands(null)).toBe('both');
    setShowProps(true);
    expect(store.get('apprentice.showProps')).toBe('1');
    expect(getShowProps()).toBe(true);
    setShowProps(false);
  });

  it('names and sides of a hands set-up', () => {
    expect(handsSides('both')).toEqual(['left', 'right']);
    expect(handsSides('left')).toEqual(['left']);
    expect(handsLabel('left')).toBe('One hand, left');
    expect(handsLabel('both')).toBe('Two hands');
  });
});
