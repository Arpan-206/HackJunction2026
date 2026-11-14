import { describe, expect, it } from 'vitest';
import {
  alignToPhrase, botPerformance, DEFAULT_BEAT_S, DEFAULT_PHRASE, mulberry32, NOTE_WINDOW_S, NoteJudge, PressDetector, PRESS_OFFSET,
  schedulePhrase, type PressEvent,
} from '../src/features/apprentice/test/PianoPlayAlong/piano';
import { vals } from './helpers';

/** Feeds a 60 Hz trace of one finger's flexion and returns all presses. */
function feed(finger: 'thumb' | 'index' | 'ring', fn: (t: number) => number, seconds: number, det = new PressDetector()): PressEvent[] {
  const out: PressEvent[] = [];
  for (let i = 0; i <= seconds * 60; i++) {
    const t = i / 60;
    out.push(...det.push(t, vals({ [finger]: fn(t) })));
  }
  return out;
}

describe('PressDetector', () => {
  it('fires on a fast curl', () => {
    const presses = feed('index', (t) => (t < 0.5 ? 0 : Math.min(40, (t - 0.5) * 500)), 1.2);
    expect(presses).toHaveLength(1);
    expect(presses[0].finger).toBe('index');
    expect(presses[0].t).toBeGreaterThanOrEqual(0.5);
    expect(presses[0].t).toBeLessThan(0.7);
  });

  it('does not fire on slow drift, even over a large range', () => {
    expect(feed('index', (t) => t * 40, 3)).toEqual([]);
  });

  it('does not fire on a fast but tiny twitch (under the travel threshold)', () => {
    expect(feed('ring', (t) => (t < 0.5 ? 0 : Math.min(8, (t - 0.5) * 500)), 1.2)).toEqual([]);
  });

  it('the thumb uses gentler limits', () => {
    const slowish = (t: number) => (t < 0.5 ? 0 : Math.min(15, (t - 0.5) * 150));
    expect(feed('thumb', slowish, 1.5)).toHaveLength(1);
    expect(feed('index', slowish, 1.5)).toEqual([]);
  });

  it('needs the finger to relax before pressing again, then fires again', () => {
    const det = new PressDetector();
    // Press, hold, release, press again.
    const trace = (t: number) => {
      if (t < 0.3) return 0;
      if (t < 0.4) return (t - 0.3) * 500;
      if (t < 1) return 50;
      if (t < 1.1) return 50 - (t - 1) * 500;
      if (t < 1.5) return 0;
      if (t < 1.6) return (t - 1.5) * 500;
      return 50;
    };
    const presses = feed('index', trace, 2, det);
    expect(presses).toHaveLength(2);
    expect(presses[0].t).toBeLessThan(0.5);
    expect(presses[1].t).toBeGreaterThan(1.5);
  });

  it('holding a curled finger without releasing does not retrigger', () => {
    const presses = feed('index', (t) => (t < 0.3 ? 0 : Math.min(50, (t - 0.3) * 500)), 3);
    expect(presses).toHaveLength(1);
  });
});

describe('phrase scheduling', () => {
  it('lays notes on the beat grid with the press offset', () => {
    const notes = schedulePhrase([1, 2, 3], 10, 0.5, 2);
    expect(notes).toHaveLength(6);
    expect(notes[0]).toEqual({ index: 0, finger: 1, time: 10 + 0.5 * PRESS_OFFSET });
    expect(notes[4]).toEqual({ index: 4, finger: 2, time: 10 + 4 * 0.5 + 0.5 * PRESS_OFFSET });
  });

  it('alignToPhrase rounds up to a whole phrase', () => {
    const span = DEFAULT_BEAT_S * DEFAULT_PHRASE.length;
    expect(alignToPhrase(0, DEFAULT_BEAT_S, DEFAULT_PHRASE.length)).toBe(0);
    expect(alignToPhrase(0.1, DEFAULT_BEAT_S, DEFAULT_PHRASE.length)).toBeCloseTo(span);
    expect(alignToPhrase(span * 2 + 0.01, DEFAULT_BEAT_S, DEFAULT_PHRASE.length)).toBeCloseTo(span * 3);
  });
});

describe('NoteJudge', () => {
  const notes = schedulePhrase([1, 2, 3], 0, 1, 1);

  it('scores an on-time press with the right finger as 100', () => {
    const j = new NoteJudge(notes);
    const r = j.press({ finger: 'thumb', t: notes[0].time })!;
    expect(r).toMatchObject({ result: 'hit', points: 100, used: 1 });
    expect(j.callout).toBe('Right on the beat');
  });

  it('late and early presses are still hits with fewer points', () => {
    const j = new NoteJudge(notes);
    const late = j.press({ finger: 'thumb', t: notes[0].time + 0.2 })!;
    expect(late.result).toBe('hit');
    expect(late.points).toBeLessThan(100);
    expect(late.points).toBeGreaterThanOrEqual(70);
    expect(j.callout).toMatch(/late/);
    const early = j.press({ finger: 'index', t: notes[1].time - 0.2 })!;
    expect(early.offset).toBeLessThan(0);
    expect(j.callout).toMatch(/early/);
  });

  it('wrong finger on a note scores 45 and names the correct one', () => {
    const j = new NoteJudge(notes);
    const r = j.press({ finger: 'ring', t: notes[0].time })!;
    expect(r).toMatchObject({ result: 'wrong_finger', points: 45, used: 4 });
    expect(j.callout).toMatch(/use 1 \(thumb\), not 4/);
  });

  it('a press outside the window matches nothing', () => {
    const j = new NoteJudge(notes);
    expect(j.press({ finger: 'thumb', t: notes[0].time + NOTE_WINDOW_S + 0.05 })).toBeNull();
    expect(j.judged).toHaveLength(0);
  });

  it('prefers the note for the finger used when two are in range', () => {
    const j = new NoteJudge(schedulePhrase([1, 2], 0, 0.3, 1));
    const r = j.press({ finger: 'index', t: 0.2 })!;
    expect(r.note.finger).toBe(2);
    expect(r.result).toBe('hit');
  });

  it('expire marks old notes missed and resets the streak', () => {
    const j = new NoteJudge(notes);
    j.press({ finger: 'thumb', t: notes[0].time });
    expect(j.expire(notes[0].time)).toEqual([]);
    const missed = j.expire(notes[1].time + NOTE_WINDOW_S + 0.01);
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ result: 'missed', points: 0, used: null });
    expect(j.callout).toMatch(/Missed note 2/);
  });

  it('score aggregates and tracks the best streak', () => {
    const j = new NoteJudge(notes);
    j.press({ finger: 'thumb', t: notes[0].time });
    j.press({ finger: 'index', t: notes[1].time });
    j.expire(100);
    const s = j.score();
    expect(s.streak).toBe(2);
    expect(s.notes).toBe(67);
    expect(s.fingering).toBe(67);
    expect(s.overall).toBe(Math.round((100 + 100 + 0) / 3));
    expect(new NoteJudge(notes).score()).toEqual({ overall: 0, notes: 0, timing: 0, fingering: 0, streak: 0 });
  });
});

describe('bot pianist', () => {
  it('mulberry32 is seeded and in [0,1)', () => {
    const a = mulberry32(3);
    const b = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('plays the same performance every run, mostly right with the odd slip', () => {
    const notes = schedulePhrase(DEFAULT_PHRASE, 0, DEFAULT_BEAT_S, 3);
    const s1 = botPerformance(notes);
    expect(botPerformance(notes)).toEqual(s1);
    expect(s1.overall).toBeGreaterThan(60);
    expect(s1.overall).toBeLessThanOrEqual(100);
  });
});
