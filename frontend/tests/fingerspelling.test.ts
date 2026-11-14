import { describe, expect, it } from 'vitest';
import { FINGERS } from '../src/api/types';
import { CHART, gloveTwins, LETTERS, letterShape, spellable, TWIN_REASON, twinGroups, twinReason, wordMotion } from '../src/features/fingerspelling/chart';
import { DEFAULT_DRILL, drillFrame, frameMatch, holdProgress, skipLetter, startDrill, summarise } from '../src/features/fingerspelling/drill';
import movesJson from '../src/mock/data/moves.json';
import seedWords from '../src/mock/data/seed-fingerspelling-words.json';
import type { FingerValues } from '../src/features/apprentice/training/coach/deviation';

const deg = (v: number): FingerValues => ({ thumb: v, index: v, middle: v, ring: v, little: v });

describe('fingerspelling chart', () => {
  it('has all 26 letters, each read from its fs_ move', () => {
    expect(CHART.map((c) => c.letter).join('')).toBe(LETTERS.join(''));
    const moves = movesJson as { id: string; default_motion: unknown }[];
    for (const c of CHART) expect(moves.find((m) => m.id === `fs_${c.letter.toLowerCase()}`)?.default_motion).toEqual(c.motion);
    expect(letterShape('a')?.letter).toBe('A');
    expect(letterShape('?')).toBeNull();
    expect(CHART.every((c) => !/estimates/.test(c.shape))).toBe(true);
    expect(CHART.filter((c) => c.movement).map((c) => c.letter)).toEqual(['J', 'P', 'Q', 'Z']);
  });

  it('finds the letters the gloves cannot separate, and says why for every pair', () => {
    expect(gloveTwins('U')).toEqual(['H', 'R', 'V']);
    expect(gloveTwins('B')).toEqual([]);
    expect(twinGroups()).toEqual([
      ['C', 'O'],
      ['G', 'L', 'Q'],
      ['H', 'R', 'U', 'V'],
      ['I', 'J'],
      ['K', 'P'],
      ['M', 'N', 'S', 'T'],
    ]);
    for (const c of CHART) for (const t of gloveTwins(c.letter)) expect(TWIN_REASON[[c.letter, t].sort().join('')], `${c.letter}${t}`).toBeTruthy();
    expect(twinReason('v', 'u')).toMatch(/spread/);
    // No reason is kept for a pair the curls already separate.
    for (const key of Object.keys(TWIN_REASON)) expect(gloveTwins(key[0])).toContain(key[1]);
  });

  it('spells words the same way the seeded word lessons were built', () => {
    expect(spellable('Hi, Ada 2!')).toEqual(['H', 'I', 'A', 'D', 'A']);
    for (const step of seedWords.steps) {
      const word = step.title.replace(/^.*Spell /, '');
      expect(wordMotion(word)).toEqual(step.motion);
    }
    const j = wordMotion('J');
    expect(j.preset === 'keyframes' && j.keys.reduce((n, k) => n + k.ms, 0)).toBe(1200);
  });
});

describe('fingerspelling drill', () => {
  it('passes a letter after every finger holds inside the tolerance', () => {
    let s = startDrill(['A', 'B'], 0);
    s = drillFrame(s, deg(100), deg(100), 100);
    expect(s.index).toBe(0);
    expect(holdProgress(s, 400)).toBeCloseTo(0.5);
    s = drillFrame(s, deg(100), deg(100), 400);
    expect(s.index).toBe(0);
    s = drillFrame(s, deg(100), deg(100), 700);
    expect(s.index).toBe(1);
    expect(s.results[0]).toMatchObject({ letter: 'A', passed: true, match: 100, ms: 700 });
  });

  it('restarts the hold when a finger slips out, and names it', () => {
    let s = startDrill(['A'], 0);
    s = drillFrame(s, deg(100), deg(100), 0);
    s = drillFrame(s, { ...deg(100), ring: 160 }, deg(100), 400);
    expect(s.off).toEqual(['ring']);
    expect(s.inSinceMs).toBeNull();
    s = drillFrame(s, deg(100), deg(100), 500);
    s = drillFrame(s, deg(100), deg(100), 1000);
    expect(s.done).toBe(false);
    s = drillFrame(s, deg(100), deg(100), 1100);
    expect(s.done).toBe(true);
  });

  it('gives up a letter that is never reached, and the learner can skip one', () => {
    let s = startDrill(['A', 'B', 'C'], 0);
    s = drillFrame(s, deg(0), deg(200), DEFAULT_DRILL.giveUpMs);
    expect(s.results[0]).toMatchObject({ letter: 'A', passed: false, match: 0 });
    s = skipLetter(s, DEFAULT_DRILL.giveUpMs + 50);
    expect(s.results[1]).toMatchObject({ letter: 'B', passed: false });
    expect(s.index).toBe(2);
  });

  it('matches frames like the local score and summarises the word', () => {
    expect(frameMatch(deg(100), deg(100), 20).match).toBe(100);
    expect(frameMatch(deg(120), deg(100), 20)).toEqual({ match: 50, off: [] });
    expect(frameMatch({ ...deg(100), thumb: 150 }, deg(100), 20).off).toEqual(['thumb']);
    expect(FINGERS.length).toBe(5);
    const sum = summarise([
      { letter: 'A', ms: 1000, match: 90, passed: true },
      { letter: 'B', ms: 2000, match: 60, passed: true },
      { letter: 'C', ms: 12000, match: 20, passed: false },
    ]);
    expect(sum).toEqual({ passed: 2, total: 3, match: 57, lettersPerMinute: 40, hardest: 'C' });
  });
});
