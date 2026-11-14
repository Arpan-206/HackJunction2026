import { FINGERS, type Finger } from '../../../../api/types';

/** Finger numbers as pianists say them: 1 is the thumb, 5 the little finger. */
export type FingerNumber = 1 | 2 | 3 | 4 | 5;

export const FINGER_BY_NUMBER: Record<FingerNumber, Finger> = { 1: 'thumb', 2: 'index', 3: 'middle', 4: 'ring', 5: 'little' };
export const NUMBER_BY_FINGER: Record<Finger, FingerNumber> = { thumb: 1, index: 2, middle: 3, ring: 4, little: 5 };

/** The five-finger scale used by the seed piano lesson, up and back down. */
export const DEFAULT_PHRASE: FingerNumber[] = [1, 2, 3, 4, 5, 4, 3, 2, 1];
export const DEFAULT_BEAT_S = 0.62;
/** Where in a beat the press lands, as a fraction (the simulator starts its press at the beat line). */
export const PRESS_OFFSET = 0.04;
/** Time either side of a note within which a press counts for it, in seconds. */
export const NOTE_WINDOW_S = 0.3;

export interface PhraseNote {
  index: number;
  finger: FingerNumber;
  /** Stream time in seconds at which the note should be played. */
  time: number;
}

/** Lays a phrase out on a beat grid starting at `start`, repeated `rounds` times back to back. */
export function schedulePhrase(phrase: FingerNumber[], start: number, beat: number, rounds: number): PhraseNote[] {
  const notes: PhraseNote[] = [];
  for (let r = 0; r < rounds; r++) {
    phrase.forEach((finger, i) => {
      const index = r * phrase.length + i;
      notes.push({ index, finger, time: start + index * beat + beat * PRESS_OFFSET });
    });
  }
  return notes;
}

/** The first moment at or after `after` that is a whole number of phrases from the stream origin, so a simulator loop lines up. */
export function alignToPhrase(after: number, beat: number, length: number): number {
  const span = beat * length;
  return Math.ceil(after / span) * span;
}

export interface PressEvent {
  finger: Finger;
  t: number;
}

const VELOCITY_WINDOW_S = 0.09;
/** Per-finger press thresholds in degrees per second and degrees of travel; the thumb moves less, so it needs gentler ones. */
const PRESS_LIMITS: Record<Finger, { velocity: number; travel: number }> = {
  thumb: { velocity: 100, travel: 8 },
  index: { velocity: 220, travel: 14 },
  middle: { velocity: 220, travel: 14 },
  ring: { velocity: 220, travel: 14 },
  little: { velocity: 220, travel: 14 },
};
const REARM_VELOCITY = 40;

interface Track {
  history: { t: number; v: number }[];
  armed: boolean;
  lastPress: number;
}

/**
 * Detects key presses from finger flexion velocity: a press is a fast curl (over 220 degrees per second and at least 14 degrees
 * of travel; gentler limits for the thumb) and the finger must relax again before it can press once more. Feed it every frame.
 */
export class PressDetector {
  private readonly tracks = {} as Record<Finger, Track>;

  constructor() {
    for (const f of FINGERS) this.tracks[f] = { history: [], armed: true, lastPress: -9 };
  }

  /** Adds a frame of total flexion per finger in degrees at stream time `t` and returns any presses it reveals. */
  push(t: number, flexionDeg: Record<Finger, number>): PressEvent[] {
    const out: PressEvent[] = [];
    for (const f of FINGERS) {
      const tr = this.tracks[f];
      tr.history.push({ t, v: flexionDeg[f] });
      while (tr.history.length > 2 && tr.history[0].t < t - 0.5) tr.history.shift();
      let ref = tr.history[0];
      for (const h of tr.history) {
        if (h.t <= t - VELOCITY_WINDOW_S) ref = h;
        else break;
      }
      const dt = t - ref.t;
      if (dt < 0.03) continue;
      const velocity = (flexionDeg[f] - ref.v) / dt;
      let low = flexionDeg[f];
      for (const h of tr.history) low = Math.min(low, h.v);
      if (tr.armed && velocity > PRESS_LIMITS[f].velocity && flexionDeg[f] - low >= PRESS_LIMITS[f].travel && t - tr.lastPress > 0.15) {
        tr.armed = false;
        tr.lastPress = t;
        out.push({ finger: f, t });
      } else if (!tr.armed && velocity < REARM_VELOCITY) {
        tr.armed = true;
      }
    }
    return out;
  }
}

export type NoteResult = 'hit' | 'wrong_finger' | 'missed';

export interface JudgedNote {
  note: PhraseNote;
  result: NoteResult;
  /** Seconds late (positive) or early (negative); 0 for a miss. */
  offset: number;
  /** The finger actually used, when a press was found. */
  used: FingerNumber | null;
  points: number;
}

export interface PianoScore {
  /** 0 to 100. */
  overall: number;
  /** Share of notes played at all, 0 to 100. */
  notes: number;
  timing: number;
  fingering: number;
  streak: number;
}

/** Scores presses against a phrase: the right note in time with the right finger is worth 100. */
export class NoteJudge {
  readonly judged: JudgedNote[] = [];
  private readonly pending: PhraseNote[];
  private run = 0;
  bestStreak = 0;
  /** Latest call-out for the screen, such as "Right note, wrong finger". */
  callout = '';

  constructor(notes: PhraseNote[]) {
    this.pending = [...notes];
  }

  /** Judges one press against the nearest note within the window, preferring the note for that finger. */
  press(p: PressEvent): JudgedNote | null {
    const used = NUMBER_BY_FINGER[p.finger];
    let best = -1;
    let bestWrong = -1;
    this.pending.forEach((n, i) => {
      const d = Math.abs(n.time - p.t);
      if (d > NOTE_WINDOW_S) return;
      if (n.finger === used) {
        if (best < 0 || d < Math.abs(this.pending[best].time - p.t)) best = i;
      } else if (bestWrong < 0 || d < Math.abs(this.pending[bestWrong].time - p.t)) bestWrong = i;
    });
    const idx = best >= 0 ? best : bestWrong;
    if (idx < 0) return null;
    const note = this.pending.splice(idx, 1)[0];
    const offset = p.t - note.time;
    if (note.finger === used) {
      const points = Math.round(70 + 30 * (1 - Math.min(1, Math.abs(offset) / NOTE_WINDOW_S)));
      this.run += 1;
      this.bestStreak = Math.max(this.bestStreak, this.run);
      this.callout = Math.abs(offset) < 0.08 ? 'Right on the beat' : offset > 0 ? 'Right note, a touch late' : 'Right note, a touch early';
      return this.record({ note, result: 'hit', offset, used, points });
    }
    this.run = 0;
    this.callout = `Right note, wrong finger: use ${note.finger} (${FINGER_BY_NUMBER[note.finger]}), not ${used}`;
    return this.record({ note, result: 'wrong_finger', offset, used, points: 45 });
  }

  /** Marks every note that is now too old to be played as missed. */
  expire(now: number): JudgedNote[] {
    const out: JudgedNote[] = [];
    while (this.pending.length && this.pending[0].time + NOTE_WINDOW_S < now) {
      const note = this.pending.shift() as PhraseNote;
      this.run = 0;
      this.callout = `Missed note ${note.index + 1}: finger ${note.finger}`;
      out.push(this.record({ note, result: 'missed', offset: 0, used: null, points: 0 }));
    }
    return out;
  }

  private record(j: JudgedNote): JudgedNote {
    this.judged.push(j);
    return j;
  }

  /** Whole-phrase score from everything judged so far. */
  score(): PianoScore {
    const n = this.judged.length;
    if (!n) return { overall: 0, notes: 0, timing: 0, fingering: 0, streak: 0 };
    const played = this.judged.filter((j) => j.result !== 'missed');
    const hits = this.judged.filter((j) => j.result === 'hit');
    const timing = played.length ? (played.reduce((s, j) => s + (1 - Math.min(1, Math.abs(j.offset) / NOTE_WINDOW_S)), 0) / played.length) * 100 : 0;
    return {
      overall: Math.round(this.judged.reduce((s, j) => s + j.points, 0) / n),
      notes: Math.round((played.length / n) * 100),
      timing: Math.round(timing),
      fingering: Math.round((hits.length / n) * 100),
      streak: this.bestStreak,
    };
  }
}

/** A seeded generator so the bot pianist plays the same performance every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bot skill used when none is given: reproduces the original fixed difficulty. */
export const DEFAULT_BOT_SKILL = 0.5;

/**
 * The bot pianist's score for a phrase: mostly right, with the odd slip. `skill` (0 clumsy, 1 expert) scales how often it
 * slips and how far it drifts off the beat; the default keeps the original performance.
 */
export function botPerformance(notes: PhraseNote[], seed = 7, skill: number = DEFAULT_BOT_SKILL): PianoScore {
  const slip = 1.7 - 1.4 * Math.max(0, Math.min(1, skill));
  const rng = mulberry32(seed);
  const judge = new NoteJudge(notes);
  for (const n of notes) {
    const r = rng();
    const offset = (rng() - 0.5) * 0.28 * slip;
    if (r < 0.06 * slip) {
      judge.expire(n.time + NOTE_WINDOW_S + 0.001);
    } else if (r < 0.12 * slip) {
      const wrong = FINGERS[(n.finger % 5)];
      judge.press({ finger: wrong, t: n.time + offset });
    } else {
      judge.press({ finger: FINGER_BY_NUMBER[n.finger], t: n.time + offset });
    }
  }
  return judge.score();
}
