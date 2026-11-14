import { FINGERS, type Finger, type HandFrame, type Keyframe, type MotionSpec, type Side } from '../../../api/types';
import { FULL, RELAXED } from '../../../three/anatomy';
import { mulberry32 } from '../test/PianoPlayAlong/piano';
import { fingerForKey, HOME_KEYS, type KeyFinger } from './fingerMap';
import { AirTypingJudge, type Strike, type TypedLetter, type TypingScore } from './strikes';

/**
 * The simulated typist: what the glove simulator and the mock glove do while nobody wears the gloves. It types the run on an
 * even beat with the right finger most of the time and, seeded, a neighbouring finger now and then, so the screen shows both
 * a malachite letter and a vermilion correction. Same curls as the touch typing drills (backend/app/data/moves.json).
 */

/** The hover pose over the home row, per finger (an estimate until an expert records it). */
export const HOVER: Record<Finger, number> = { thumb: 0.2, index: 0.35, middle: 0.35, ring: 0.35, little: 0.3 };
/** Extra curl of a striking finger. */
export const STRIKE_CURL = 0.3;
/**
 * Share of a beat the strike key takes; the rest is the lift back to the hover. Half the beat keeps the finger down long enough
 * to be seen between sparse frames when the page is busy drawing.
 */
const STRIKE_SHARE = 0.5;
/** Beat of the simulated typist in milliseconds: 0.4 s per keystroke is 30 words per minute. */
export const TYPIST_BEAT_MS = 400;
/** How often the simulated typist uses a neighbouring finger. */
export const TYPIST_SLIP = 0.12;

const NEIGHBOUR: Record<Finger, Finger[]> = { thumb: ['thumb'], index: ['middle'], middle: ['index', 'ring'], ring: ['middle', 'little'], little: ['ring'] };

/** A finger next to the right one on the same hand: the usual slip. */
export function slipOf(kf: KeyFinger, rng: () => number): KeyFinger {
  const options = NEIGHBOUR[kf.finger];
  return { side: kf.side, finger: options[Math.floor(rng() * options.length)] };
}

function pose(finger?: Finger): Record<Finger, number> {
  const p = { ...HOVER };
  if (finger) p[finger] = Math.round((p[finger] + STRIKE_CURL) * 100) / 100;
  return p;
}

/**
 * Keyframes that strike `letters` one per beat: for each letter a strike key on the finger used and a lift back to the hover,
 * with the other hand hovering. Returns the motion and the finger each letter was struck with.
 */
export function typistMotion(letters: TypedLetter[], beatMs = TYPIST_BEAT_MS, seed = 11, slip = TYPIST_SLIP): { motion: MotionSpec; used: KeyFinger[] } {
  const rng = mulberry32(seed);
  const strikeMs = Math.round(beatMs * STRIKE_SHARE);
  const keys: Keyframe[] = [];
  const left: Keyframe[] = [];
  const used: KeyFinger[] = [];
  for (const l of letters) {
    const u = rng() < slip ? slipOf(l.expected, rng) : l.expected;
    used.push(u);
    for (const [side, out] of [['right', keys], ['left', left]] as [Side, Keyframe[]][]) {
      out.push({ pose: pose(side === u.side ? u.finger : undefined), ms: strikeMs });
      out.push({ pose: pose(), ms: beatMs - strikeMs });
    }
  }
  if (!keys.length) return { motion: { preset: 'hold_pose', pose: pose() }, used };
  return { motion: { preset: 'keyframes', keys, left_keys: left }, used };
}

/** The first moment at or after `after` that starts a whole loop of a motion lasting `period` seconds from the stream origin. */
export function alignToLoop(after: number, period: number): number {
  return period > 0 ? Math.ceil(after / period) * period : after;
}

/**
 * The simulated glove for the real keyboard mode: each keydown gets a strike from the finger that owns the key, or (seeded)
 * from a neighbour, so the matcher has something to correct without gloves on.
 */
export class SimulatedStriker {
  private readonly rng: () => number;

  constructor(
    seed = 5,
    private readonly slip = 0.2,
  ) {
    this.rng = mulberry32(seed);
  }

  strike(key: string, t: number): Strike | null {
    const kf = fingerForKey(key);
    if (!kf) return null;
    const u = this.rng() < this.slip ? slipOf(kf, this.rng) : kf;
    return { ...u, t: t - 0.02 };
  }
}

/** How long a drawn strike takes, seconds. */
const STRIKE_DRAW_S = 0.26;

/** Curls of one hand for drawing: the hover pose plus a quick dip on any finger that struck in the last quarter second. */
export function strikeCurls(recent: Strike[], side: Side, now: number): number[] {
  return FINGERS.map((f) => {
    let extra = 0;
    for (const s of recent) {
      if (s.side !== side || s.finger !== f) continue;
      const dt = now - s.t;
      if (dt >= 0 && dt < STRIKE_DRAW_S) extra = Math.max(extra, STRIKE_CURL * Math.sin((dt / STRIKE_DRAW_S) * Math.PI));
    }
    return HOVER[f] + extra;
  });
}

/** The bot typist's score for the same letters: an even beat with a little jitter and the odd slip, scaled by its skill (0 to 1). */
export function botTyping(letters: TypedLetter[], seed = 7, skill = 0.5): TypingScore {
  const k = Math.max(0, Math.min(1, skill));
  const slip = 0.18 - 0.14 * k;
  const jitter = 0.16 - 0.12 * k;
  const beat = 0.5 - 0.2 * k;
  const rng = mulberry32(seed);
  const judge = new AirTypingJudge(letters);
  let t = 0;
  for (const l of letters) {
    t += beat * (1 + (rng() - 0.5) * 2 * jitter);
    const u = rng() < slip ? slipOf(l.expected, rng) : l.expected;
    judge.push({ ...u, t });
    judge.flush(t + 1);
  }
  return judge.score();
}

/** Curl of each finger recovered from a frame's flexion (the inverse of the synthesiser's curl to flexion), thumb first. */
export function curlsOf(hand: HandFrame): number[] {
  return FINGERS.map((f, i) => {
    const sum = hand.flexion[f][0] + hand.flexion[f][1] + hand.flexion[f][2];
    const scale = i === 0 ? 0.8 : 1;
    const rest = RELAXED[i][0] + RELAXED[i][1] + RELAXED[i][2];
    const full = FULL[i][0] + FULL[i][1] + FULL[i][2];
    return (sum / scale - rest) / full;
  });
}

/** Wrist turn (radians) at which an index finger counts as reaching in to G or H. */
const REACH_YAW = 0.05;

/**
 * The key a hand is striking in a drill frame: the home key of the finger curled well past its hover, or G or H when an index
 * finger strikes with the wrist turned in. Null when the hand is at rest. Drawn on the keyboard only; never scored.
 */
export function strikingKey(hand: HandFrame | null): string | null {
  if (!hand) return null;
  const curls = curlsOf(hand);
  let best = -1;
  FINGERS.forEach((f, i) => {
    if (curls[i] - HOVER[f] > STRIKE_CURL / 2 && (best < 0 || curls[i] - HOVER[FINGERS[best]] > curls[best] - HOVER[FINGERS[best]])) best = i;
  });
  if (best < 0) return null;
  const finger = FINGERS[best];
  if (finger === 'index') {
    const [, qy, , qw] = hand.wrist_quat;
    const yaw = 2 * Math.atan2(qy, qw) * (hand.side === 'left' ? -1 : 1);
    if (yaw > REACH_YAW) return hand.side === 'left' ? 'g' : 'h';
  }
  return HOME_KEYS[hand.side][finger];
}
