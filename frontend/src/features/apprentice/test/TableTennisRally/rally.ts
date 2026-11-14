import {
  newBall,
  planGoodReturn,
  planLongReturn,
  planNetReturn,
  stepBall,
  STEP,
  TABLE,
  type BallState,
  type Launch,
  type Vec3,
} from './ball';
import { decideReturn, type ReturnDecision, type SwingReading } from './swing';

/** a stands at the near end (+z, the right glove), b at the far end (-z): the bot or the left glove. */
export type PlayerId = 'a' | 'b';

/** Distance from the table centre to each player's racket plane, in metres. */
export const PADDLE_Z = 1.95;
const CONTACT_HEIGHT = TABLE.top + 0.3;
const SERVE_WAIT_S = 1.4;
const POINT_PAUSE_S = 2.6;
const ROUND_PAUSE_S = 3.2;
const POINTS_PER_ROUND = 5;

export type RallyEvent =
  | { type: 'serve'; server: PlayerId }
  | { type: 'contact'; who: PlayerId; decision: ReturnDecision; reading: SwingReading | null; bot: boolean }
  | { type: 'point'; winner: PlayerId; caption: string; rally: number }
  | { type: 'round'; winner: PlayerId; round: number }
  | { type: 'match'; winner: PlayerId };

export type RallyPhase = 'serve' | 'flight' | 'point' | 'round' | 'match';

/** Bot skill used when none is given: reproduces the original fixed difficulty. */
export const DEFAULT_BOT_SKILL = 0.5;

/** Chance that the bot returns well, given the length of the rally and its skill (0 clumsy, 1 expert). */
export function botGoodChance(rally: number, skill: number = DEFAULT_BOT_SKILL): number {
  const s = Math.max(0, Math.min(1, skill));
  const base = 0.65 + 0.3 * s;
  const floor = 0.3 + 0.3 * s;
  return Math.max(floor, base - rally * 0.02);
}

export interface RallyOptions {
  twoPlayer: boolean;
  /** How well the bot plays, 0 to 1; scaled to the learner's rank. Defaults to the original difficulty. */
  botSkill?: number;
  rounds: number;
  rng?: () => number;
  /** Stream time now, in seconds. */
  streamNow?: () => number;
  /** Stream time of the first swing contact at or after the given time, or null when contacts cannot be predicted. */
  scheduleContact?: (afterStream: number) => number | null;
}

export interface BestMoment {
  text: string;
  value: number;
}

/**
 * The rally referee. It owns the ball: it serves, knows when the ball reaches each racket, reads the glove at that moment and
 * decides the return (good, net or long), then lets the physics play it out. Pure and deterministic given its rng.
 */
export class RallyGame {
  ball: BallState = newBall({ x: 0, y: CONTACT_HEIGHT, z: -PADDLE_Z });
  phase: RallyPhase = 'serve';
  clock = 0;
  points: Record<PlayerId, number> = { a: 0, b: 0 };
  rounds: Record<PlayerId, number> = { a: 0, b: 0 };
  /** Points won over the whole match, across rounds. */
  totals: Record<PlayerId, number> = { a: 0, b: 0 };
  round = 1;
  rally = 0;
  caption = '';
  best: BestMoment = { text: '', value: 0 };
  longestRally = 0;
  paddle: Record<PlayerId, { x: number; y: number }> = { a: { x: 0, y: CONTACT_HEIGHT }, b: { x: 0, y: CONTACT_HEIGHT } };
  /** Who the ball is travelling towards, if anyone. */
  incoming: PlayerId | null = null;
  winner: PlayerId | null = null;

  private readonly rng: () => number;
  private timer = SERVE_WAIT_S;
  private server: PlayerId = 'b';
  private lastHitter: PlayerId = 'b';
  private lastDecision: ReturnDecision | null = null;
  private lastBotMiss = false;
  private acc = 0;

  constructor(private readonly opts: RallyOptions) {
    this.rng = opts.rng ?? Math.random;
  }

  /** Display names of the two players. */
  name(p: PlayerId): string {
    if (this.opts.twoPlayer) return p === 'a' ? 'Player 2' : 'Player 1';
    return p === 'a' ? 'You' : 'The bot';
  }

  /** Seconds until the ball reaches the receiver's racket, or null when no ball is on its way. */
  eta(): number | null {
    if (this.phase !== 'flight' || !this.incoming) return null;
    const zPlane = this.incoming === 'a' ? PADDLE_Z : -PADDLE_Z;
    const vz = this.ball.v.z;
    if (!vz || Math.sign(zPlane - this.ball.p.z) !== Math.sign(vz)) return null;
    return (zPlane - this.ball.p.z) / vz;
  }

  /** Advances the game by `dt` seconds. `read` returns the glove reading for a human player at the current moment. */
  update(dt: number, read: (p: PlayerId) => SwingReading | null): RallyEvent[] {
    const events: RallyEvent[] = [];
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.clock += STEP;
      this.tick(STEP, read, events);
    }
    this.movePaddles(dt);
    return events;
  }

  private tick(dt: number, read: (p: PlayerId) => SwingReading | null, events: RallyEvent[]): void {
    if (this.phase === 'serve' || this.phase === 'point' || this.phase === 'round') {
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.phase === 'serve') this.launchServe(events);
      else if (this.phase === 'point') this.afterPoint(events);
      else this.nextRound(events);
      return;
    }
    if (this.phase !== 'flight') return;
    for (const e of stepBall(this.ball, dt)) {
      if (e.type !== 'bounce') this.endPoint(this.lastHitter === 'a' ? 'b' : 'a', events);
    }
    if (this.phase !== 'flight') return;
    if (!this.incoming) {
      if (Math.abs(this.ball.p.z) > TABLE.halfLength + 0.45) this.endPoint(this.lastHitter === 'a' ? 'b' : 'a', events);
      return;
    }
    const zPlane = this.incoming === 'a' ? PADDLE_Z : -PADDLE_Z;
    if ((this.ball.p.z - zPlane) * Math.sign(zPlane) >= 0) this.contact(this.incoming, read, events);
  }

  private launchServe(events: RallyEvent[]): void {
    const from: Vec3 = { x: (this.rng() - 0.5) * 0.5, y: CONTACT_HEIGHT, z: this.server === 'a' ? PADDLE_Z : -PADDLE_Z };
    this.lastHitter = this.server;
    this.lastDecision = null;
    this.rally = 0;
    events.push({ type: 'serve', server: this.server });
    this.fire(from, this.server === 'a' ? 'b' : 'a', 'good');
  }

  private contact(who: PlayerId, read: (p: PlayerId) => SwingReading | null, events: RallyEvent[]): void {
    const human = this.opts.twoPlayer || who === 'a';
    let decision: ReturnDecision;
    let reading: SwingReading | null = null;
    if (human) {
      reading = read(who);
      decision = reading ? decideReturn(reading) : { outcome: 'net', reason: 'no glove signal: the ball dies at your racket', quality: 0 };
    } else {
      const pGood = botGoodChance(this.rally, this.opts.botSkill);
      const miss = this.rng() > pGood;
      decision = miss
        ? this.rng() < 0.5
          ? { outcome: 'net', reason: 'the bot mistimes it into the net', quality: 0 }
          : { outcome: 'long', reason: 'the bot overhits it long', quality: 0 }
        : { outcome: 'good', reason: 'a tidy return', quality: 0.6 };
    }
    this.lastBotMiss = !human && decision.outcome !== 'good';
    this.lastDecision = decision;
    this.lastHitter = who;
    this.paddle[who] = { x: this.ball.p.x, y: this.ball.p.y };
    events.push({ type: 'contact', who, decision, reading, bot: !human });
    if (human && reading && decision.outcome === 'good') {
      if (reading.peakSpeed > this.best.value && who === 'a') this.best = { text: `Return at ${reading.peakSpeed.toFixed(1)} rad/s in a rally of ${this.rally + 1}`, value: reading.peakSpeed };
    }
    if (decision.outcome === 'good') this.rally += 1;
    this.longestRally = Math.max(this.longestRally, this.rally);
    const from: Vec3 = { x: this.ball.p.x, y: this.ball.p.y, z: who === 'a' ? PADDLE_Z : -PADDLE_Z };
    this.fire(from, who === 'a' ? 'b' : 'a', decision.outcome);
  }

  private fire(from: Vec3, to: PlayerId, kind: 'good' | 'net' | 'long'): void {
    const toPoint: Vec3 = { x: (this.rng() - 0.5) * 0.9, y: CONTACT_HEIGHT, z: to === 'a' ? PADDLE_Z : -PADDLE_Z };
    const human = this.opts.twoPlayer || to === 'a';
    let time = 1.15 + this.rng() * 0.2;
    if (human && this.opts.streamNow && this.opts.scheduleContact) {
      const now = this.opts.streamNow();
      const next = this.opts.scheduleContact(now + 0.95);
      if (next !== null) time = Math.min(2.8, Math.max(0.9, next - now));
    }
    const launch: Launch = planKind(kind)(from, toPoint, time);
    this.ball = newBall(from);
    this.ball.v = { ...launch.v };
    this.ball.topspin = launch.topspin;
    this.incoming = kind === 'good' ? to : null;
    this.phase = 'flight';
  }

  private endPoint(winner: PlayerId, events: RallyEvent[]): void {
    const loser: PlayerId = winner === 'a' ? 'b' : 'a';
    this.points[winner] += 1;
    this.totals[winner] += 1;
    const why = this.lastDecision ? this.lastDecision.reason : 'the serve was lost';
    const subject = this.lastBotMiss ? '' : `${this.name(loser)}: `;
    this.caption = `${this.name(winner)} win${winner === 'a' && !this.opts.twoPlayer ? '' : 's'} the point. ${subject}${why}.`;
    this.phase = 'point';
    this.timer = POINT_PAUSE_S;
    this.incoming = null;
    events.push({ type: 'point', winner, caption: this.caption, rally: this.rally });
  }

  private afterPoint(events: RallyEvent[]): void {
    const leader: PlayerId = this.points.a >= this.points.b ? 'a' : 'b';
    if (this.points[leader] >= POINTS_PER_ROUND) {
      this.rounds[leader] += 1;
      events.push({ type: 'round', winner: leader, round: this.round });
      const need = Math.floor(this.opts.rounds / 2) + 1;
      if (this.rounds[leader] >= need || this.round >= this.opts.rounds) {
        this.winner = this.rounds.a === this.rounds.b ? leader : this.rounds.a > this.rounds.b ? 'a' : 'b';
        this.phase = 'match';
        events.push({ type: 'match', winner: this.winner });
        return;
      }
      this.phase = 'round';
      this.timer = ROUND_PAUSE_S;
      return;
    }
    this.server = this.server === 'a' ? 'b' : 'a';
    this.phase = 'serve';
    this.timer = SERVE_WAIT_S;
    this.ball = newBall({ x: 0, y: CONTACT_HEIGHT, z: this.server === 'a' ? PADDLE_Z : -PADDLE_Z });
  }

  private nextRound(events: RallyEvent[]): void {
    void events;
    this.round += 1;
    this.points = { a: 0, b: 0 };
    this.phase = 'serve';
    this.timer = SERVE_WAIT_S;
    this.ball = newBall({ x: 0, y: CONTACT_HEIGHT, z: this.server === 'a' ? PADDLE_Z : -PADDLE_Z });
  }

  private movePaddles(dt: number): void {
    const k = Math.min(1, dt * 7);
    for (const p of ['a', 'b'] as const) {
      const chasing = this.phase === 'flight' && this.incoming === p;
      const tx = chasing ? this.ball.p.x : 0;
      const ty = chasing ? Math.max(TABLE.top + 0.1, this.ball.p.y) : CONTACT_HEIGHT;
      this.paddle[p].x += (tx - this.paddle[p].x) * k;
      this.paddle[p].y += (ty - this.paddle[p].y) * k;
    }
  }
}

type PlanFn = (from: Vec3, to: Vec3, time: number) => Launch;

function planKind(kind: 'good' | 'net' | 'long'): PlanFn {
  if (kind === 'net') return planNetReturn;
  if (kind === 'long') return planLongReturn;
  return (from, to, time) => planGoodReturn(from, to, time);
}
