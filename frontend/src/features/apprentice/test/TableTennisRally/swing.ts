import type { HandFrame } from '../../../../api/types';

type Quat = readonly [number, number, number, number];

const RAD2DEG = 180 / Math.PI;

/** What the glove says about the stroke at the moment the ball arrives. */
export interface SwingReading {
  swinging: boolean;
  /** Peak wrist rotation speed in the lead-up to contact, rad/s. */
  peakSpeed: number;
  /** Racket face pitch in radians: positive is open (face tilted up), negative is closed. */
  faceAngle: number;
  /** Mean total flexion of index to little finger, degrees. */
  gripDeg: number;
}

export type ReturnOutcome = 'good' | 'net' | 'long';

export interface ReturnDecision {
  outcome: ReturnOutcome;
  /** One plain-language reason, shown in the instant-replay caption. */
  reason: string;
  /** 0 to 1, how clean the stroke was (drives the speed of the ball). */
  quality: number;
}

/** Thresholds for turning a glove reading into a return. */
export const RULES = {
  swingSpeed: 2.5,
  closedFace: -0.2,
  openFace: 0.5,
  firmGrip: 120,
  /** Seconds before contact that count towards the swing. */
  lookBack: 0.32,
};

/** Rotation angle in radians between two unit quaternions. */
export function quatAngle(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
}

/** Pitch of the racket face, whose normal is +z in hand space: the asin of the normal's vertical component. */
export function faceAngleOf(q: Quat): number {
  const [x, y, z, w] = q;
  const ny = 2 * (y * z - w * x);
  return Math.asin(Math.max(-1, Math.min(1, ny)));
}

/** Mean total flexion of the four fingers that wrap the handle, in degrees. */
export function gripDegrees(hand: HandFrame): number {
  let sum = 0;
  for (const f of ['index', 'middle', 'ring', 'little'] as const) sum += hand.flexion[f][0] + hand.flexion[f][1] + hand.flexion[f][2];
  return (sum / 4) * RAD2DEG;
}

interface Sample {
  t: number;
  q: Quat;
  grip: number;
}

/** Keeps a short history of one glove and reads the stroke from it. Feed it every frame with the stream time. */
export class SwingTracker {
  private readonly buf: Sample[] = [];

  /** Adds a frame of the hand. */
  push(t: number, hand: HandFrame): void {
    this.buf.push({ t, q: hand.wrist_quat, grip: gripDegrees(hand) });
    while (this.buf.length > 2 && this.buf[0].t < t - 1.2) this.buf.shift();
  }

  /** Reads the stroke at time `t` from the preceding `lookBack` seconds. Returns null before any frame has arrived. */
  read(t: number): SwingReading | null {
    const n = this.buf.length;
    if (!n) return null;
    const lag = 3;
    let peak = 0;
    for (let i = lag; i < n; i++) {
      const cur = this.buf[i];
      const prev = this.buf[i - lag];
      if (cur.t < t - RULES.lookBack || cur.t > t + 0.05) continue;
      const dt = cur.t - prev.t;
      if (dt > 0.005) peak = Math.max(peak, quatAngle(cur.q, prev.q) / dt);
    }
    let last = this.buf[n - 1];
    for (const s of this.buf) if (s.t <= t) last = s;
    return { swinging: peak >= RULES.swingSpeed, peakSpeed: peak, faceAngle: faceAngleOf(last.q), gripDeg: last.grip };
  }
}

/** The wrist speed in plain words, for captions: players never see rad/s. */
export function swingWord(peakSpeed: number): string {
  if (peakSpeed < RULES.swingSpeed) return 'barely moving';
  if (peakSpeed < 5) return 'steady';
  if (peakSpeed < 7.5) return 'quick';
  return 'fast';
}

/** Turns a reading into a return: no swing or a closed face finds the net, an open face or a loose grip sails long. */
export function decideReturn(r: SwingReading): ReturnDecision {
  const deg = Math.round(r.faceAngle * RAD2DEG);
  if (!r.swinging) return { outcome: 'net', reason: 'no swing, the wrist was barely moving: the ball drops into the net', quality: 0 };
  if (r.faceAngle < RULES.closedFace) return { outcome: 'net', reason: `racket face too closed (${deg}°): into the net`, quality: 0.2 };
  if (r.faceAngle > RULES.openFace) return { outcome: 'long', reason: `racket face too open (+${deg}°): long`, quality: 0.2 };
  if (r.gripDeg < RULES.firmGrip) return { outcome: 'long', reason: `loose grip (${Math.round(r.gripDeg)}° curl): the racket twisted, long`, quality: 0.3 };
  const quality = Math.max(0.3, Math.min(1, r.peakSpeed / 9));
  return { outcome: 'good', reason: `clean stroke, a ${swingWord(r.peakSpeed)} wrist, face ${deg >= 0 ? '+' : ''}${deg}°`, quality };
}
