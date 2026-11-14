import { describe, expect, it } from 'vitest';
import { FINGER_KEYS, normalizeKey, rowOfKey } from '../src/features/typing/chart';
import { DRILLS } from '../src/features/typing/drills';
import { applyVerdict, done, lineFor, linkCore, newRun, pressKey, tally, totals, type FingerVerdict, type Run } from '../src/features/typing/typingRun';

const verdict = (id: number, key: string, v: FingerVerdict['verdict'], detected: FingerVerdict['detected'] = null): FingerVerdict => ({
  id,
  key,
  verdict: v,
  expected: [],
  detected,
  reason: v === 'unclear' ? 'no_press' : null,
  confidence: 2,
});

function type(run: Run, keys: string): Run {
  for (const k of keys) run = pressKey(run, k)!.run;
  return run;
}

describe('typing chart', () => {
  it('maps every key to one finger and the space bar to the thumbs', () => {
    expect(rowOfKey('f')).toBe('left.index');
    expect(rowOfKey('J')).toBe('right.index');
    expect(rowOfKey(';')).toBe('right.little');
    expect(rowOfKey(':')).toBe('right.little');
    expect(rowOfKey(' ')).toBe('both.thumb');
    expect(rowOfKey('Enter')).toBeNull();
    const all = Object.values(FINGER_KEYS).join('');
    expect(new Set(all).size).toBe(all.length);
  });

  it('every drill types with chart keys only', () => {
    for (const d of DRILLS) for (const ch of d.text) expect(normalizeKey(ch), `${d.id}: ${ch}`).not.toBeNull();
  });
});

describe('typing run', () => {
  it('moves on right keys and stays on wrong keys', () => {
    let run = newRun('fj');
    run = type(run, 'fk');
    expect(run.pos).toBe(1);
    expect(run.attempts.map((a) => a.keyOk)).toEqual([true, false]);
    run = type(run, 'j');
    expect(done(run)).toBe(true);
    expect(pressKey(run, 'f')).toBeNull();
    expect(pressKey(newRun('f'), 'Shift')).toBeNull();
  });

  it('links verdicts whether the ack or the event comes first', () => {
    let run = type(newRun('fj'), 'fj');
    run = linkCore(run, 0, 11);
    run = applyVerdict(run, verdict(11, 'f', 'good'));
    run = applyVerdict(run, verdict(12, 'j', 'wrong_finger', { hand: 'right', finger: 'middle' }));
    expect(run.early[12]).toBeDefined();
    run = linkCore(run, 1, 12);
    expect(run.early[12]).toBeUndefined();
    expect(run.attempts[1].finger?.verdict).toBe('wrong_finger');
    const t = tally(run);
    expect(t['left.index']).toMatchObject({ keys: 1, rightKey: 1, good: 1 });
    expect(t['right.index']).toMatchObject({ keys: 1, wrongFinger: 1 });
    expect(totals(run)).toMatchObject({ keys: 2, rightKey: 2, good: 1, wrongFinger: 1, unclear: 0 });
  });

  it('says right key, wrong finger in plain words', () => {
    let run = type(newRun('j'), 'j');
    run = linkCore(run, 0, 1);
    run = applyVerdict(run, verdict(1, 'j', 'wrong_finger', { hand: 'right', finger: 'middle' }));
    const l = lineFor(run.attempts[0], true);
    expect(l.tone).toBe('fix');
    expect(l.text).toBe('Right key, wrong finger. You used your right middle finger. Use your right index finger.');
    expect(lineFor(type(newRun('f'), 'g').attempts[0], true).text).toBe('That was G. Type F with your left index finger.');
    expect(lineFor(type(newRun('f'), 'f').attempts[0], false).tone).toBe('plain');
  });
});
