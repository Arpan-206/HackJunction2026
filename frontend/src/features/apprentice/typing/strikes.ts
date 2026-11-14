import { MARGIN_MULTIPLIERS } from '../../../api/margin';
import type { GloveFrame, Margin, Side } from '../../../api/types';
import { PressDetector } from '../test/PianoPlayAlong/piano';
import { flexionDegrees } from '../training/coach/deviation';
import { fingerForKey, fingerPhrase, keyLabel, sameFinger, type KeyFinger } from './fingerMap';

/**
 * Strikes from the gloves, and how typing is judged from them. The gloves feel which finger curled fast and when (per-finger
 * flexion at about 83 Hz); they do not know where the hand is, so they never know which key a finger landed on. Air typing is
 * therefore judged on the finger and the rhythm only, and the real keyboard mode pairs each keydown (which key) with the
 * strike felt at that moment (which finger).
 */

export interface Strike extends KeyFinger {
  /** Seconds, on whichever clock the caller feeds in (the glove stream for frames, the page clock for keys). */
  t: number;
}

/** Strikes on different fingers within this many seconds count as one strike (a neighbour twitching along). Standard margin. */
export const GROUP_S = 0.06;
/** A keydown and a glove strike this close in seconds belong together. Standard margin. */
export const KEY_WINDOW_S = 0.18;
/** The spread of the gaps between taps (standard deviation over mean) at which the rhythm score reaches zero. Standard margin. */
export const RHYTHM_CV_LIMIT = 0.8;
/** A gap longer than this is a pause (reading the next word), not part of the rhythm. */
export const PAUSE_S = 2;

const scale = (margin: Margin): number => MARGIN_MULTIPLIERS[margin];
export const groupWindow = (margin: Margin): number => GROUP_S * scale(margin);
export const keyWindow = (margin: Margin): number => KEY_WINDOW_S * scale(margin);

/** Turns glove frames into strikes on both hands, reusing the piano game's press detection (a fast curl of one finger). */
export class StrikeDetector {
  private readonly detectors: Record<Side, PressDetector> = { left: new PressDetector(), right: new PressDetector() };

  push(frame: GloveFrame): Strike[] {
    const out: Strike[] = [];
    for (const h of frame.hands) for (const p of this.detectors[h.side].push(frame.t, flexionDegrees(h))) out.push({ side: h.side, finger: p.finger, t: p.t });
    return out;
  }
}

/** Gross words per minute from strike times: a word is five keystrokes, timed from the first strike to the last. */
export function wordsPerMinute(times: number[]): number {
  if (times.length < 2) return 0;
  const span = times[times.length - 1] - times[0];
  if (span <= 0) return 0;
  return (times.length - 1) / 5 / (span / 60);
}

/** 0 to 100 for how even the gaps are: 100 for a metronome, 0 once the spread reaches the margin's limit. */
export function rhythmEvenness(gaps: number[], margin: Margin = 'standard'): number {
  const g = gaps.filter((x) => x > 0 && x <= PAUSE_S);
  if (g.length < 2) return 100;
  const mean = g.reduce((s, x) => s + x, 0) / g.length;
  const sd = Math.sqrt(g.reduce((s, x) => s + (x - mean) ** 2, 0) / g.length);
  const cv = sd / mean;
  return Math.round(100 * Math.max(0, Math.min(1, 1 - cv / (RHYTHM_CV_LIMIT * scale(margin)))));
}

export interface TypedLetter {
  index: number;
  /** The character to strike, ' ' for the space bar. */
  char: string;
  /** Which word it belongs to; a space belongs to the word before it. */
  word: number;
  expected: KeyFinger;
}

export interface JudgedLetter {
  letter: TypedLetter;
  used: KeyFinger;
  ok: boolean;
  t: number;
}

export interface TypingScore {
  /** 0 to 100: fingering weighs 70, rhythm 30. */
  overall: number;
  /** Share of letters struck with the right finger, 0 to 100. */
  fingering: number;
  rhythm: number;
  wpm: number;
  streak: number;
  letters: number;
}

/** Splits words into the letters to strike, a space between words, each with the finger that owns it. */
export function lettersFor(words: string[]): TypedLetter[] {
  const out: TypedLetter[] = [];
  words.forEach((w, wi) => {
    const chars = wi < words.length - 1 ? [...w, ' '] : [...w];
    for (const c of chars) {
      const expected = fingerForKey(c);
      if (expected) out.push({ index: out.length, char: c, word: wi, expected });
    }
  });
  return out;
}

/**
 * Judges air typing: the learner works through the letters at their own pace and every strike answers the letter in front of
 * them. Strikes within the margin's group window are one strike; it is right when any of them is the right finger (so a
 * neighbour twitching along is forgiven), wrong otherwise, and either way the learner moves on to the next letter.
 */
export class AirTypingJudge {
  readonly judged: JudgedLetter[] = [];
  readonly letters: TypedLetter[];
  private group: Strike[] = [];
  private run = 0;
  bestStreak = 0;

  constructor(
    letters: TypedLetter[],
    private readonly margin: Margin = 'standard',
  ) {
    this.letters = letters;
  }

  /** The letter waiting to be struck, or null when the run is over. */
  current(): TypedLetter | null {
    return this.letters[this.judged.length] ?? null;
  }

  done(): boolean {
    return this.judged.length >= this.letters.length;
  }

  /** Adds a strike; returns the letter it settled, if an earlier group closed because of it. */
  push(s: Strike): JudgedLetter | null {
    if (this.done()) return null;
    let settled: JudgedLetter | null = null;
    if (this.group.length && s.t - this.group[0].t > groupWindow(this.margin)) settled = this.resolve();
    if (!this.done()) this.group.push(s);
    return settled;
  }

  /** Settles the open group once its window has passed; call it on a timer with the stream time. */
  flush(now: number): JudgedLetter | null {
    if (!this.group.length || now - this.group[0].t < groupWindow(this.margin)) return null;
    return this.resolve();
  }

  private resolve(): JudgedLetter | null {
    const letter = this.current();
    const group = this.group;
    this.group = [];
    if (!letter || !group.length) return null;
    const hit = group.find((s) => sameFinger(letter.expected, s));
    const used = hit ?? group[0];
    const ok = Boolean(hit);
    this.run = ok ? this.run + 1 : 0;
    this.bestStreak = Math.max(this.bestStreak, this.run);
    const j: JudgedLetter = { letter, used: { side: used.side, finger: used.finger }, ok, t: group[0].t };
    this.judged.push(j);
    return j;
  }

  score(): TypingScore {
    return scoreLetters(this.judged, this.bestStreak, this.margin);
  }
}

/** The score for a list of judged letters. */
export function scoreLetters(judged: JudgedLetter[], streak: number, margin: Margin = 'standard'): TypingScore {
  const n = judged.length;
  if (!n) return { overall: 0, fingering: 0, rhythm: 0, wpm: 0, streak: 0, letters: 0 };
  const fingering = Math.round((judged.filter((j) => j.ok).length / n) * 100);
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) if (judged[i].letter.word === judged[i - 1].letter.word) gaps.push(judged[i].t - judged[i - 1].t);
  const rhythm = rhythmEvenness(gaps, margin);
  const wpm = Math.round(wordsPerMinute(judged.map((j) => j.t)));
  return { overall: Math.round(0.7 * fingering + 0.3 * rhythm), fingering, rhythm, wpm, streak, letters: n };
}

/** Gold is only for mastery: nearly every letter on the right finger, an even beat, judged at standard or strict. */
export function isMastery(score: TypingScore, margin: Margin): boolean {
  return (margin === 'standard' || margin === 'strict') && score.letters >= 10 && score.overall >= 90 && score.fingering >= 95;
}

export type KeyResult = 'right' | 'wrong' | 'unseen' | 'unmapped';

export interface KeyVerdict {
  key: string;
  t: number;
  expected: KeyFinger | null;
  /** The finger the gloves felt strike at that moment, or null when none did. */
  used: KeyFinger | null;
  result: KeyResult;
}

/**
 * Pairs keydowns (which key) with glove strikes (which finger) on one clock. A key waits one window for its strike, then takes
 * the closest unclaimed strike within the window either side, preferring the right finger when two fingers moved at once.
 */
export class KeystrokeMatcher {
  private keys: { key: string; t: number }[] = [];
  private strikes: (Strike & { claimed: boolean })[] = [];

  constructor(private readonly windowS: number = KEY_WINDOW_S) {}

  key(key: string, t: number): void {
    this.keys.push({ key, t });
  }

  strike(s: Strike): void {
    this.strikes.push({ ...s, claimed: false });
  }

  /** Verdicts for every key whose window has closed by `now`. */
  resolve(now: number): KeyVerdict[] {
    const out: KeyVerdict[] = [];
    while (this.keys.length && this.keys[0].t + this.windowS <= now) {
      const k = this.keys.shift() as { key: string; t: number };
      const expected = fingerForKey(k.key);
      if (!expected) {
        out.push({ key: k.key, t: k.t, expected: null, used: null, result: 'unmapped' });
        continue;
      }
      const near = this.strikes.filter((s) => !s.claimed && Math.abs(s.t - k.t) <= this.windowS);
      const right = near.filter((s) => sameFinger(expected, s));
      const pool = right.length ? right : near;
      let best: (Strike & { claimed: boolean }) | null = null;
      for (const s of pool) if (!best || Math.abs(s.t - k.t) < Math.abs(best.t - k.t)) best = s;
      if (best) best.claimed = true;
      const used = best ? { side: best.side, finger: best.finger } : null;
      out.push({ key: k.key, t: k.t, expected, used, result: !used ? 'unseen' : sameFinger(expected, used) ? 'right' : 'wrong' });
    }
    this.strikes = this.strikes.filter((s) => s.t > now - 2);
    return out;
  }
}

/** The line the learner reads for one key: "You pressed E with your left index finger; use your left middle finger." */
export function correctionLine(v: KeyVerdict): string {
  const label = keyLabel(v.key);
  if (v.result === 'unmapped' || !v.expected) return `${label} is outside the touch typing map, so it is not judged.`;
  if (v.result === 'unseen' || !v.used) return `${label}: the gloves felt no strike. Tap from the knuckle so they can feel it.`;
  if (v.result === 'right') return `${label} with your ${fingerPhrase(v.expected)}. Right finger.`;
  return `You pressed ${label} with your ${fingerPhrase(v.used)}; use your ${fingerPhrase(v.expected)}.`;
}
