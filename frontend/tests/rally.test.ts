import { describe, expect, it } from 'vitest';
import {
  ballisticVelocity, BALL_RADIUS, GRAVITY, newBall, planGoodReturn, planLongReturn, planNetReturn, simulateArrival, stepBall, STEP, TABLE,
} from '../src/features/apprentice/test/TableTennisRally/ball';
import {
  decideReturn, faceAngleOf, gripDegrees, quatAngle, RULES, SwingTracker, type SwingReading,
} from '../src/features/apprentice/test/TableTennisRally/swing';
import { PADDLE_Z, RallyGame, type PlayerId, type RallyEvent } from '../src/features/apprentice/test/TableTennisRally/rally';
import { DEG, handWith } from './helpers';

describe('ball physics', () => {
  it('falls under gravity', () => {
    const b = newBall({ x: 0, y: 2, z: 0.5 });
    for (let i = 0; i < 120; i++) stepBall(b); // 0.5 s
    expect(b.v.y).toBeLessThan(0);
    expect(b.v.y).toBeCloseTo(-GRAVITY * 0.5, 0);
    expect(b.p.y).toBeLessThan(2);
    expect(b.p.y).toBeCloseTo(2 - 0.5 * GRAVITY * 0.25, 0);
  });

  it('bounces off the table, losing some energy, and reports the half', () => {
    const b = newBall({ x: 0, y: 1.2, z: 0.6 });
    const events = [];
    let steps = 0;
    while (steps++ < 2000 && !events.some((e) => e.type === 'bounce')) events.push(...stepBall(b));
    const bounce = events.find((e) => e.type === 'bounce');
    expect(bounce).toMatchObject({ type: 'bounce', half: 'near' });
    expect(b.alive).toBe(true);
    expect(b.v.y).toBeGreaterThan(0);
    expect(b.p.y).toBeCloseTo(TABLE.top + BALL_RADIUS, 6);
    // Rebound apex stays below the drop height.
    let apex = b.p.y;
    for (let i = 0; i < 400; i++) { stepBall(b); apex = Math.max(apex, b.p.y); }
    expect(apex).toBeLessThan(1.2);
    expect(apex).toBeGreaterThan(TABLE.top + 0.2);
  });

  it('a ball on the far half bounces as far', () => {
    const b = newBall({ x: 0, y: 1.2, z: -0.6 });
    let ev: ReturnType<typeof stepBall> = [];
    for (let i = 0; i < 2000 && !ev.length; i++) ev = stepBall(b);
    expect(ev[0]).toMatchObject({ type: 'bounce', half: 'far' });
  });

  it('a ball that misses the table falls out of play', () => {
    const b = newBall({ x: 2, y: 1, z: 0.5 });
    let out = false;
    for (let i = 0; i < 4000 && !out; i++) out = stepBall(b).some((e) => e.type === 'out');
    expect(out).toBe(true);
    expect(b.alive).toBe(false);
    expect(stepBall(b)).toEqual([]);
  });

  it('a low ball crossing the net line hits the net', () => {
    const b = newBall({ x: 0, y: TABLE.top + 0.1, z: 0.05 });
    b.v = { x: 0, y: 0, z: -3 };
    let net = false;
    for (let i = 0; i < 100 && !net; i++) net = stepBall(b).some((e) => e.type === 'net');
    expect(net).toBe(true);
    expect(b.alive).toBe(false);
  });

  it('ballisticVelocity lands on the target without drag', () => {
    const from = { x: 0, y: 1, z: 2 };
    const to = { x: 0.3, y: 1, z: -2 };
    const v = ballisticVelocity(from, to, 1);
    expect(v.z).toBeCloseTo(-4);
    expect(from.y + v.y - 0.5 * GRAVITY).toBeCloseTo(to.y);
  });

  it('a planned good return arrives at the receiver after bouncing on their half', () => {
    const from = { x: 0, y: TABLE.top + 0.3, z: PADDLE_Z };
    const to = { x: 0.1, y: TABLE.top + 0.3, z: -PADDLE_Z };
    const launch = planGoodReturn(from, to, 1.2);
    const arr = simulateArrival(from, launch, -PADDLE_Z, 3);
    expect(arr).not.toBeNull();
    expect(arr!.bounceZ).not.toBeNull();
    expect(arr!.bounceZ!).toBeLessThan(0);
    expect(Math.abs(arr!.t - 1.2)).toBeLessThan(0.15);
  });

  it('the net and long plans are flawed as intended', () => {
    const from = { x: 0, y: TABLE.top + 0.3, z: PADDLE_Z };
    const to = { x: 0, y: TABLE.top + 0.3, z: -PADDLE_Z };
    const run = (l: ReturnType<typeof planNetReturn>) => {
      const b = newBall(from);
      b.v = { ...l.v };
      b.topspin = l.topspin;
      const evs: string[] = [];
      for (let i = 0; i < 4 * 240 && b.alive; i++) for (const e of stepBall(b)) evs.push(e.type);
      return evs;
    };
    expect(run(planNetReturn(from, to, 1.2))).toContain('net');
    const long = run(planLongReturn(from, to, 1.2));
    expect(long).not.toContain('net');
    expect(long.at(-1)).toBe('out');
  });
});

function quatX(theta: number): [number, number, number, number] {
  return [Math.sin(theta / 2), 0, 0, Math.cos(theta / 2)];
}

describe('swing', () => {
  it('quatAngle measures rotation, treating q and -q as the same orientation', () => {
    expect(quatAngle([0, 0, 0, 1], quatX(1))).toBeCloseTo(1, 6);
    expect(quatAngle([0, 0, 0, 1], [0, 0, 0, -1])).toBeCloseTo(0, 6);
  });

  it('face angle is zero at identity, closes with +x rotation and opens with -x', () => {
    expect(faceAngleOf([0, 0, 0, 1])).toBeCloseTo(0, 9);
    expect(faceAngleOf(quatX(0.4))).toBeCloseTo(-0.4, 6);
    expect(faceAngleOf(quatX(-0.4))).toBeCloseTo(0.4, 6);
  });

  it('grip is the mean total flexion of the four wrapping fingers', () => {
    expect(gripDegrees(handWith({ index: 100, middle: 120, ring: 140, little: 160, thumb: 0 }))).toBeCloseTo(130, 6);
  });

  function track(omega: number, grip = 150, from = 0): SwingTracker {
    const tr = new SwingTracker();
    for (let i = 0; i <= 30; i++) {
      const t = from + i / 60;
      tr.push(t, handWith({ index: grip, middle: grip, ring: grip, little: grip }, quatX(omega * (t - from))));
    }
    return tr;
  }

  it('reads a fast wrist rotation as a swing and a still wrist as none', () => {
    const fast = track(8).read(0.5)!;
    expect(fast.swinging).toBe(true);
    expect(fast.peakSpeed).toBeCloseTo(8, 0);
    const still = track(0).read(0.5)!;
    expect(still.swinging).toBe(false);
    expect(still.peakSpeed).toBeCloseTo(0, 6);
    expect(new SwingTracker().read(1)).toBeNull();
  });

  const reading = (o: Partial<SwingReading> = {}): SwingReading => ({ swinging: true, peakSpeed: 6, faceAngle: 0, gripDeg: 150, ...o });

  it('a clean swing at contact returns the ball', () => {
    const d = decideReturn(reading());
    expect(d.outcome).toBe('good');
    expect(d.quality).toBeCloseTo(6 / 9, 6);
  });

  it('end to end: tracker reading at contact of a fast swing decides good', () => {
    const r = track(7).read(0.5)!;
    expect(decideReturn(r).outcome).toBe('good');
  });

  it('no swing, closed face, open face and loose grip each fail as documented', () => {
    expect(decideReturn(reading({ swinging: false, peakSpeed: 0.3 })).outcome).toBe('net');
    expect(decideReturn(reading({ faceAngle: RULES.closedFace - 0.01 })).outcome).toBe('net');
    expect(decideReturn(reading({ faceAngle: RULES.openFace + 0.01 })).outcome).toBe('long');
    expect(decideReturn(reading({ gripDeg: RULES.firmGrip - 1 })).outcome).toBe('long');
  });

  it('boundaries are inclusive on the good side', () => {
    expect(decideReturn(reading({ faceAngle: RULES.closedFace })).outcome).toBe('good');
    expect(decideReturn(reading({ faceAngle: RULES.openFace })).outcome).toBe('good');
    expect(decideReturn(reading({ gripDeg: RULES.firmGrip })).outcome).toBe('good');
    expect(decideReturn(reading({ peakSpeed: RULES.swingSpeed })).outcome).toBe('good');
  });

  it('quality is clamped between 0.3 and 1', () => {
    expect(decideReturn(reading({ peakSpeed: 2.6 })).quality).toBe(0.3);
    expect(decideReturn(reading({ peakSpeed: 40 })).quality).toBe(1);
  });

  it('open face reason reports degrees', () => {
    expect(decideReturn(reading({ faceAngle: 60 * DEG })).reason).toMatch(/\+60/);
  });
});

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function run(game: RallyGame, seconds: number, read: (p: PlayerId) => SwingReading | null): RallyEvent[] {
  const evs: RallyEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) evs.push(...game.update(1 / 60, read));
  return evs;
}

const GOOD: SwingReading = { swinging: true, peakSpeed: 6, faceAngle: 0, gripDeg: 150 };

describe('RallyGame', () => {
  it('serves after the wait, and a glove that swings returns the ball', () => {
    const game = new RallyGame({ twoPlayer: false, rounds: 1, rng: seeded(1) });
    expect(game.phase).toBe('serve');
    const evs = run(game, 6, () => GOOD);
    expect(evs[0]).toMatchObject({ type: 'serve', server: 'b' });
    const mine = evs.find((e) => e.type === 'contact' && e.who === 'a');
    expect(mine).toMatchObject({ type: 'contact', bot: false });
    expect(mine && mine.type === 'contact' && mine.decision.outcome).toBe('good');
    expect(game.rally).toBeGreaterThanOrEqual(1);
  });

  it('with no glove signal the human loses the point and the bot is credited', () => {
    const game = new RallyGame({ twoPlayer: false, rounds: 1, rng: seeded(2) });
    const evs = run(game, 8, () => null);
    const point = evs.find((e) => e.type === 'point');
    expect(point).toMatchObject({ type: 'point', winner: 'b' });
    expect(game.points.b).toBe(1);
    expect(game.points.a).toBe(0);
    expect(game.caption).toMatch(/no glove signal/);
  });

  it('a no-swing reading ends the point against the learner', () => {
    const game = new RallyGame({ twoPlayer: false, rounds: 1, rng: seeded(3) });
    const evs = run(game, 8, () => ({ ...GOOD, swinging: false, peakSpeed: 0.2 }));
    const c = evs.find((e) => e.type === 'contact' && e.who === 'a');
    expect(c && c.type === 'contact' && c.decision.outcome).toBe('net');
    expect(evs.some((e) => e.type === 'point' && e.winner === 'b')).toBe(true);
  });

  it('is deterministic for a given rng', () => {
    const a = run(new RallyGame({ twoPlayer: false, rounds: 1, rng: seeded(9) }), 20, () => GOOD);
    const b = run(new RallyGame({ twoPlayer: false, rounds: 1, rng: seeded(9) }), 20, () => GOOD);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a single-round match ends at five points and names the winner', () => {
    const game = new RallyGame({ twoPlayer: false, rounds: 1, rng: seeded(4) });
    const evs = run(game, 200, () => null);
    expect(game.phase).toBe('match');
    expect(game.winner).toBe('b');
    expect(game.totals.b).toBe(5);
    expect(evs.filter((e) => e.type === 'match')).toHaveLength(1);
  });

  it('eta is null with no ball in flight and display names follow the mode', () => {
    const game = new RallyGame({ twoPlayer: false, rounds: 1, rng: seeded(5) });
    expect(game.eta()).toBeNull();
    expect(game.name('a')).toBe('You');
    expect(new RallyGame({ twoPlayer: true, rounds: 1 }).name('a')).toBe('Player 2');
  });

  it('ignores huge frame gaps (dt capped) so a stalled tab cannot skip the match', () => {
    const game = new RallyGame({ twoPlayer: false, rounds: 1, rng: seeded(6) });
    game.update(60, () => null);
    expect(game.clock).toBeLessThanOrEqual(0.1 + STEP);
  });
});
