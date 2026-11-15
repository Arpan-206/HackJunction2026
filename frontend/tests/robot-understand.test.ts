import { describe, expect, it } from 'vitest';
import type { Finger } from '../src/api/types';
import { echo, EXAMPLE_PHRASES, understand } from '../src/features/shared/robot/teach/understand';
import type { Instruction } from '../src/features/shared/robot/teach/robotSkill';

const ins = (finger: Finger, axis: 'bend' | 'time', dir: 1 | -1, amount = 1): Instruction => ({ finger, axis, dir, amount });

function one(text: string, last: Finger | null = null) {
  const u = understand(text, last);
  return u.kind === 'instructions' ? u.instructions : u;
}

describe('understand: single instructions', () => {
  const cases: [string, Instruction[]][] = [
    ['curl your index more', [ins('index', 'bend', 1)]],
    ['bend the middle finger', [ins('middle', 'bend', 1)]],
    ['straighten the ring', [ins('ring', 'bend', -1)]],
    ['open your pinky', [ins('little', 'bend', -1)]],
    ['extend the thumb', [ins('thumb', 'bend', -1)]],
    ['little finger too bent', [ins('little', 'bend', -1)]],
    ['index too bent', [ins('index', 'bend', -1)]],
    ['the index is too much', [ins('index', 'bend', -1)]],
    ['little finger too straight', [ins('little', 'bend', 1)]],
    ['the ring is too straight', [ins('ring', 'bend', 1)]],
    ['index not curled enough', [ins('index', 'bend', 1)]],
    ["don't curl the ring", [ins('ring', 'bend', -1)]],
    ['thumb is late', [ins('thumb', 'time', -1)]],
    ['thumb a bit earlier', [ins('thumb', 'time', -1, 0.5)]],
    ['middle later', [ins('middle', 'time', 1)]],
    ['the index is too early', [ins('index', 'time', 1)]],
    ['ring slightly later', [ins('ring', 'time', 1, 0.5)]],
    ['curl the index a lot', [ins('index', 'bend', 1, 1.8)]],
    ['curl the index a little more', [ins('index', 'bend', 1, 0.5)]],
    ['straighten the little finger a bit', [ins('little', 'bend', -1, 0.5)]],
    ['little finger curl a lot more', [ins('little', 'bend', 1, 1.8)]],
    ['Curl INDEX more!', [ins('index', 'bend', 1)]],
    ['move your thumb sooner', [ins('thumb', 'time', -1)]],
  ];
  it.each(cases)('%s', (text, expected) => {
    expect(one(text)).toEqual(expected);
  });
});

describe('understand: several fingers and clauses', () => {
  it('splits on "and" when both halves have an action', () => {
    expect(one('curl index and straighten little')).toEqual([ins('index', 'bend', 1), ins('little', 'bend', -1)]);
  });
  it('keeps "index and middle more" as one action on both fingers', () => {
    expect(one('index and middle more')).toEqual([ins('index', 'bend', 1), ins('middle', 'bend', 1)]);
  });
  it('splits on commas', () => {
    expect(one('curl the index, straighten the ring')).toEqual([ins('index', 'bend', 1), ins('ring', 'bend', -1)]);
  });
  it('splits on then', () => {
    expect(one('thumb earlier then ring straighten')).toEqual([ins('thumb', 'time', -1), ins('ring', 'bend', -1)]);
  });
  it('splits on but', () => {
    expect(one('curl the index but straighten the middle')).toEqual([ins('index', 'bend', 1), ins('middle', 'bend', -1)]);
  });
  it('straighten the ring and little: both fingers', () => {
    expect(one('straighten the ring and little finger')).toEqual([ins('ring', 'bend', -1), ins('little', 'bend', -1)]);
  });
});

describe('understand: little finger vs amount', () => {
  it('"little" alone with an action is the finger', () => {
    expect(one('curl little')).toEqual([ins('little', 'bend', 1)]);
  });
  it('"a little more" is an amount, on the last finger', () => {
    expect(one('a little more', 'middle')).toEqual([ins('middle', 'bend', 1, 0.5)]);
  });
});

describe('understand: last finger', () => {
  it('uses lastFinger when no finger is named', () => {
    expect(one('curl more', 'ring')).toEqual([ins('ring', 'bend', 1)]);
    expect(one('a bit earlier', 'thumb')).toEqual([ins('thumb', 'time', -1, 0.5)]);
  });
  it('a named finger wins over lastFinger', () => {
    expect(one('straighten the index', 'ring')).toEqual([ins('index', 'bend', -1)]);
  });
});

describe('understand: ok, ask, unknown', () => {
  it.each(["that's right", 'looks good', 'the index is right', 'perfect', 'nothing is wrong'])('praise: %s', (t) => {
    expect(understand(t)).toEqual({ kind: 'ok' });
  });
  it('a finger with no action asks', () => {
    const u = understand('the index');
    expect(u.kind).toBe('ask');
    if (u.kind === 'ask') expect(u.fingers).toEqual(['index']);
  });
  it('an action with no finger and no lastFinger asks', () => {
    expect(understand('curl more').kind).toBe('ask');
    expect(understand('earlier', null).kind).toBe('ask');
  });
  it.each(['asdf qwerty', 'what is the weather', '', '   ', '12345'])('unknown: %j', (t) => {
    expect(understand(t).kind).toBe('unknown');
  });
});

describe('echo', () => {
  it('says bend instructions back', () => {
    expect(echo(ins('index', 'bend', 1))).toBe('Curl my index finger more.');
    expect(echo(ins('index', 'bend', 1, 0.5))).toBe('Curl my index finger a little more.');
    expect(echo(ins('ring', 'bend', -1))).toBe('Straighten my ring finger.');
    expect(echo(ins('middle', 'bend', -1, 1.8))).toBe('Straighten my middle finger a lot.');
  });
  it('says timing instructions back', () => {
    expect(echo(ins('thumb', 'time', -1))).toBe('Move my thumb earlier.');
    expect(echo(ins('little', 'time', 1, 0.5))).toBe('Move my little finger a little later.');
    expect(echo(ins('thumb', 'time', 1, 1.8))).toBe('Move my thumb a lot later.');
  });
});

describe('understand: the example phrases the teach panel offers', () => {
  it('parses each one into instructions', () => {
    expect(EXAMPLE_PHRASES.map((p) => one(p))).toEqual([
      [ins('index', 'bend', 1)],
      [ins('little', 'bend', -1, 0.5)],
      [ins('middle', 'bend', 1), ins('thumb', 'bend', -1)],
    ]);
  });
});
