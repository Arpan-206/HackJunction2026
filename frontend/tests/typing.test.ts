import { describe, expect, it } from 'vitest';
import type { GloveFrame } from '../src/api/types';
import { frameAt } from '../src/mock/synth';
import { MOVES } from '../src/mock/seed';
import { fingerForKey, fingerPhrase, HOME_KEYS, keyLabel, sameFinger } from '../src/features/apprentice/typing/fingerMap';
import {
  AirTypingJudge, correctionLine, isMastery, KeystrokeMatcher, keyWindow, lettersFor, rhythmEvenness, StrikeDetector, wordsPerMinute,
  type Strike,
} from '../src/features/apprentice/typing/strikes';
import { alignToLoop, botTyping, SimulatedStriker, strikeCurls, typistMotion, HOVER, TYPIST_BEAT_MS } from '../src/features/apprentice/typing/typist';
import { ALL_WORDS, HOME_WORDS, isHomeRowWord, pickWords } from '../src/features/apprentice/typing/words';

const at = (side: 'left' | 'right', finger: Strike['finger'], t: number): Strike => ({ side, finger, t });

describe('QWERTY touch typing finger map', () => {
  it('gives each home row key its finger', () => {
    const row = 'asdfjkl;'.split('').map((k) => fingerForKey(k));
    expect(row).toEqual([
      { side: 'left', finger: 'little' }, { side: 'left', finger: 'ring' }, { side: 'left', finger: 'middle' }, { side: 'left', finger: 'index' },
      { side: 'right', finger: 'index' }, { side: 'right', finger: 'middle' }, { side: 'right', finger: 'ring' }, { side: 'right', finger: 'little' },
    ]);
    for (const side of ['left', 'right'] as const) for (const [f, k] of Object.entries(HOME_KEYS[side])) if (f !== 'thumb') expect(fingerForKey(k)).toEqual({ side, finger: f });
  });

  it('follows the columns: index fingers own two each, the little fingers the edges, thumbs the space bar', () => {
    const owner = (k: string) => {
      const kf = fingerForKey(k);
      return kf ? `${kf.side} ${kf.finger}` : null;
    };
    expect(['r', 't', 'g', 'b', 'v', '4', '5'].map(owner).every((o) => o === 'left index')).toBe(true);
    expect(['y', 'u', 'h', 'n', 'm', '6', '7'].map(owner).every((o) => o === 'right index')).toBe(true);
    expect(['q', 'z', '1', 'Tab'].map(owner).every((o) => o === 'left little')).toBe(true);
    expect(['p', '/', "'", '[', 'Enter', 'Backspace'].map(owner).every((o) => o === 'right little')).toBe(true);
    expect([owner('e'), owner('c'), owner('i'), owner(','), owner('w'), owner('o'), owner('.')]).toEqual([
      'left middle', 'left middle', 'right middle', 'right middle', 'left ring', 'right ring', 'right ring',
    ]);
    expect(owner('E')).toBe('left middle');
    expect(owner(' ')).toBe('right thumb');
    expect(fingerForKey('Shift')).toBeNull();
    expect(fingerForKey('é')).toBeNull();
  });

  it('every letter of the alphabet has an owner, and either thumb may take the space bar', () => {
    for (const c of 'abcdefghijklmnopqrstuvwxyz') expect(fingerForKey(c), c).not.toBeNull();
    const space = fingerForKey(' ')!;
    expect(sameFinger(space, { side: 'left', finger: 'thumb' })).toBe(true);
    expect(sameFinger(fingerForKey('d')!, { side: 'right', finger: 'middle' })).toBe(false);
  });

  it('names keys and fingers for the screen', () => {
    expect(keyLabel('e')).toBe('E');
    expect(keyLabel(' ')).toBe('Space');
    expect(fingerPhrase({ side: 'left', finger: 'middle' })).toBe('left middle finger');
    expect(fingerPhrase({ side: 'right', finger: 'thumb' })).toBe('thumb');
  });
});

describe('words', () => {
  it('home row words use only home row keys, and picks are seeded', () => {
    expect(HOME_WORDS.every(isHomeRowWord)).toBe(true);
    expect(ALL_WORDS.some((w) => !isHomeRowWord(w))).toBe(true);
    expect(pickWords('home', 6, 3)).toEqual(pickWords('home', 6, 3));
    expect(pickWords('home', 6, 3).every(isHomeRowWord)).toBe(true);
    const w = pickWords('all', 30, 9);
    for (let i = 1; i < w.length; i++) expect(w[i]).not.toBe(w[i - 1]);
  });

  it('lays out letters with a space between words, the space belonging to the word before it', () => {
    const l = lettersFor(['as', 'dad']);
    expect(l.map((x) => x.char).join('')).toBe('as dad');
    expect(l.map((x) => x.word)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(l[2].expected.finger).toBe('thumb');
  });
});

describe('words per minute and rhythm', () => {
  it('counts five keystrokes as a word, timed from the first strike to the last', () => {
    const times = Array.from({ length: 11 }, (_, i) => i * 0.4);
    expect(wordsPerMinute(times)).toBeCloseTo(30);
    expect(wordsPerMinute([1])).toBe(0);
    expect(wordsPerMinute([2, 2])).toBe(0);
  });

  it('scores an even beat 100 and an uneven one lower, more gently with a wider margin', () => {
    expect(rhythmEvenness([0.4, 0.4, 0.4, 0.4])).toBe(100);
    const ragged = [0.2, 0.6, 0.25, 0.55, 0.3];
    const standard = rhythmEvenness(ragged);
    expect(standard).toBeLessThan(70);
    expect(rhythmEvenness(ragged, 'relaxed')).toBeGreaterThan(standard);
    expect(rhythmEvenness(ragged, 'strict')).toBeLessThan(standard);
    // A long pause to read the next word is not part of the rhythm.
    expect(rhythmEvenness([0.4, 0.4, 5, 0.4])).toBe(100);
  });
});

describe('AirTypingJudge', () => {
  it('moves through the letters, marks the right finger and the wrong one, and scores fingering, rhythm and speed', () => {
    const judge = new AirTypingJudge(lettersFor(['ask']));
    expect(judge.current()?.char).toBe('a');
    judge.push(at('left', 'little', 1.0));
    expect(judge.flush(1.2)?.ok).toBe(true);
    judge.push(at('left', 'middle', 1.4)); // s is the ring finger
    const wrong = judge.flush(1.6)!;
    expect(wrong).toMatchObject({ ok: false, used: { side: 'left', finger: 'middle' } });
    judge.push(at('right', 'middle', 1.8));
    judge.flush(2.0);
    expect(judge.done()).toBe(true);
    expect(judge.judged.map((j) => j.ok)).toEqual([true, false, true]);
    const s = judge.score();
    expect(s.fingering).toBe(67);
    expect(s.rhythm).toBe(100);
    expect(s.wpm).toBe(Math.round(2 / 5 / (0.8 / 60)));
    expect(s.overall).toBe(Math.round(0.7 * 67 + 0.3 * 100));
  });

  it('treats a neighbour twitching along as one strike, within a window the margin widens', () => {
    const twitch = (margin: 'strict' | 'standard' | 'just_trying') => {
      const j = new AirTypingJudge(lettersFor(['s']), margin);
      j.push(at('left', 'middle', 1.0));
      j.push(at('left', 'ring', 1.05));
      j.flush(2);
      return j.judged[0].ok;
    };
    expect(twitch('standard')).toBe(true);
    expect(twitch('just_trying')).toBe(true);
    expect(twitch('strict')).toBe(false);
  });

  it('keeps gold for mastery at standard or strict only', () => {
    const top = { overall: 96, fingering: 100, rhythm: 87, wpm: 30, streak: 20, letters: 20 };
    expect(isMastery(top, 'standard')).toBe(true);
    expect(isMastery(top, 'relaxed')).toBe(false);
    expect(isMastery({ ...top, fingering: 90 }, 'strict')).toBe(false);
  });

  it('the bot typist is seeded and better with more skill', () => {
    const l = lettersFor(pickWords('all', 8, 2));
    expect(botTyping(l, 7, 0.5)).toEqual(botTyping(l, 7, 0.5));
    expect(botTyping(l, 7, 1).overall).toBeGreaterThanOrEqual(botTyping(l, 7, 0).overall);
  });
});

/** Runs glove frames at 60 Hz through the strike detector, with a 9 to 11 Hz tremor like the mock glove's. */
function detect(frames: (t: number) => GloveFrame, seconds: number, tremor = 0.035): Strike[] {
  const det = new StrikeDetector();
  const out: Strike[] = [];
  for (let i = 0; i <= seconds * 60; i++) {
    const f = frames(i / 60);
    for (const h of f.hands)
      for (const [k, name] of (['thumb', 'index', 'middle', 'ring', 'little'] as const).entries())
        h.flexion[name] = h.flexion[name].map((v, j) => v + tremor * Math.sin(2 * Math.PI * 8.6 * f.t + (k * 3 + j) * 1.7)) as [number, number, number];
    out.push(...det.push(f));
  }
  return out;
}

describe('strike detection on synthetic glove frames', () => {
  it('finds every strike of the simulated typist, on the right hand and finger, one beat apart', () => {
    const letters = lettersFor(['flask', 'jade', 'quick']);
    const { motion, used } = typistMotion(letters);
    const strikes = detect((t) => frameAt(motion, t), (letters.length * TYPIST_BEAT_MS) / 1000 - 0.05);
    expect(strikes.map((s) => `${s.side} ${s.finger}`)).toEqual(used.map((u) => `${u.side} ${u.finger}`));
    for (let i = 1; i < strikes.length; i++) expect(strikes[i].t - strikes[i - 1].t).toBeCloseTo(TYPIST_BEAT_MS / 1000, 1);
  });

  it('the simulated typist slips now and then, seeded, so a run shows a correction', () => {
    const letters = lettersFor(pickWords('home', 6, 1));
    const a = typistMotion(letters);
    expect(a.used).toEqual(typistMotion(letters).used);
    const wrong = a.used.filter((u, i) => !sameFinger(letters[i].expected, u)).length;
    expect(wrong).toBeGreaterThan(0);
    expect(wrong).toBeLessThan(letters.length / 3);
  });

  it('the drill moves strike too: F and J are felt as left index then right index', () => {
    const fj = MOVES.find((m) => m.id === 'ty_index_fj')!.default_motion;
    const strikes = detect((t) => frameAt(fj, t), 2.35);
    expect(strikes.map((s) => `${s.side} ${s.finger}`)).toEqual(['left index', 'right index', 'left index', 'right index']);
  });

  it('a hand resting on the home row strikes nothing', () => {
    const rest = MOVES.find((m) => m.id === 'ty_home_row')!.default_motion;
    expect(detect((t) => frameAt(rest, t), 3)).toEqual([]);
  });

  it('a loop of the typist starts on a whole period, so the first strike after the count-in is the first letter', () => {
    expect(alignToLoop(7.3, 2)).toBe(8);
    expect(alignToLoop(8, 2)).toBe(8);
  });
});

describe('KeystrokeMatcher: which key from the keyboard, which finger from the gloves', () => {
  it('pairs a key with the strike felt at that moment and says which finger to use', () => {
    const m = new KeystrokeMatcher(0.18);
    m.key('e', 10);
    m.strike(at('left', 'index', 10.03));
    expect(m.resolve(10.1)).toEqual([]);
    const [v] = m.resolve(10.2);
    expect(v).toMatchObject({ key: 'e', result: 'wrong', expected: { side: 'left', finger: 'middle' }, used: { side: 'left', finger: 'index' } });
    expect(correctionLine(v)).toBe('You pressed E with your left index finger; use your left middle finger.');
  });

  it('prefers the right finger when two moved at once, and claims each strike once', () => {
    const m = new KeystrokeMatcher(0.18);
    m.key('k', 5);
    m.key('j', 5.05);
    m.strike(at('right', 'index', 4.99));
    m.strike(at('right', 'middle', 5.02));
    const v = m.resolve(6);
    expect(v.map((x) => x.result)).toEqual(['right', 'right']);
    expect(correctionLine(v[0])).toBe('K with your right middle finger. Right finger.');
  });

  it('says so when no strike was felt, or when the key is not in the map', () => {
    const m = new KeystrokeMatcher(0.18);
    m.key('a', 1);
    m.strike(at('left', 'little', 1.5));
    m.key('Shift', 2);
    const v = m.resolve(3);
    expect(v.map((x) => x.result)).toEqual(['unseen', 'unmapped']);
    expect(correctionLine(v[0])).toMatch(/felt no strike/);
  });

  it('widens the window with the margin of error', () => {
    expect(keyWindow('relaxed')).toBeGreaterThan(keyWindow('standard'));
    expect(keyWindow('strict')).toBeLessThan(keyWindow('standard'));
    const late = (margin: 'standard' | 'just_trying') => {
      const m = new KeystrokeMatcher(keyWindow(margin));
      m.key('f', 1);
      m.strike(at('left', 'index', 1.3));
      return m.resolve(5)[0].result;
    };
    expect(late('standard')).toBe('unseen');
    expect(late('just_trying')).toBe('right');
  });

  it('the simulated glove strikes the right finger most of the time and slips early enough to show a correction', () => {
    const sim = new SimulatedStriker();
    const line = 'the quick brown fox';
    const used = [...line].map((c, i) => sim.strike(c, i))!;
    const wrong = used.map((u, i) => (u && !sameFinger(fingerForKey(line[i])!, u) ? i : -1)).filter((i) => i >= 0);
    expect(wrong.length).toBeGreaterThan(0);
    expect(wrong[0]).toBeLessThan(8);
    expect(wrong.length).toBeLessThan(line.length / 3);
  });

  it('draws a strike as a quick dip of that finger from the hover pose', () => {
    const s = [at('left', 'ring', 1)];
    expect(strikeCurls(s, 'left', 0.9)).toEqual([HOVER.thumb, HOVER.index, HOVER.middle, HOVER.ring, HOVER.little]);
    expect(strikeCurls(s, 'left', 1.13)[3]).toBeGreaterThan(HOVER.ring + 0.25);
    expect(strikeCurls(s, 'right', 1.13)[3]).toBe(HOVER.ring);
  });
});
