/**
 * A small ball integrator for the rally test: gravity, quadratic drag, a Magnus dip for topspin, a table bounce and the net.
 * Metres and seconds. The table top is at y = TABLE.top, the net sits on z = 0, the near end is +z and the far end is -z.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BallState {
  p: Vec3;
  v: Vec3;
  /** Topspin in rad/s: positive values dip the ball whichever way it flies. */
  topspin: number;
  alive: boolean;
}

export const TABLE = { halfLength: 1.37, halfWidth: 0.7625, top: 0.76, netHeight: 0.1525, netHalfWidth: 0.9 };
export const BALL_RADIUS = 0.04;
export const GRAVITY = 7.5;
const DRAG = 0.1;
const MAGNUS = 0.0012;
const RESTITUTION = 0.9;
const BOUNCE_FRICTION = 0.93;
/** Fixed physics step in seconds. */
export const STEP = 1 / 240;

export type BallEvent = { type: 'bounce'; half: 'near' | 'far'; at: Vec3 } | { type: 'net' } | { type: 'out' };

/** A ball at rest at a point. */
export function newBall(p: Vec3): BallState {
  return { p: { ...p }, v: { x: 0, y: 0, z: 0 }, topspin: 0, alive: true };
}

/** Advances the ball by one fixed step and reports what it touched. */
export function stepBall(b: BallState, dt: number = STEP, ignoreNet = false): BallEvent[] {
  const events: BallEvent[] = [];
  if (!b.alive) return events;
  const { p, v } = b;
  const speed = Math.hypot(v.x, v.y, v.z);
  const dragK = DRAG * speed;
  // Topspin adds a downward Magnus force whichever way the ball is travelling.
  const dip = MAGNUS * b.topspin * speed;
  v.x += -dragK * v.x * dt;
  v.y += (-GRAVITY - dragK * v.y - dip) * dt;
  v.z += -dragK * v.z * dt;
  const prevZ = p.z;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  const onTable = Math.abs(p.x) <= TABLE.halfWidth && Math.abs(p.z) <= TABLE.halfLength;
  if (onTable && v.y < 0 && p.y - BALL_RADIUS <= TABLE.top) {
    p.y = TABLE.top + BALL_RADIUS;
    v.y = -v.y * RESTITUTION;
    v.x *= BOUNCE_FRICTION;
    v.z *= BOUNCE_FRICTION;
    events.push({ type: 'bounce', half: p.z >= 0 ? 'near' : 'far', at: { ...p } });
  }
  if (!ignoreNet && prevZ * p.z <= 0 && prevZ !== p.z && Math.abs(p.x) < TABLE.netHalfWidth && p.y - BALL_RADIUS < TABLE.top + TABLE.netHeight && p.y > TABLE.top - 0.2) {
    b.alive = false;
    p.z = 0;
    v.x = v.y = v.z = 0;
    events.push({ type: 'net' });
    return events;
  }
  if (p.y < TABLE.top - 0.9 || Math.abs(p.z) > 3.4 || Math.abs(p.x) > 3) {
    b.alive = false;
    events.push({ type: 'out' });
  }
  return events;
}

/** Launch velocity that carries a drag-free ball from `from` to `to` in `time` seconds. */
export function ballisticVelocity(from: Vec3, to: Vec3, time: number): Vec3 {
  return { x: (to.x - from.x) / time, y: (to.y - from.y + 0.5 * GRAVITY * time * time) / time, z: (to.z - from.z) / time };
}

/** Launch speed and arrival height for a bounce at a fraction of the flight time (analytic, no drag). */
function bouncePlan(from: Vec3, time: number, bounceFraction: number): { vy: number; yEnd: number } {
  const t1 = time * bounceFraction;
  const yb = TABLE.top + BALL_RADIUS;
  const vy = (yb - from.y + 0.5 * GRAVITY * t1 * t1) / t1;
  const vAtBounce = vy - GRAVITY * t1;
  const up = -vAtBounce * RESTITUTION;
  const t2 = time - t1;
  return { vy, yEnd: yb + up * t2 - 0.5 * GRAVITY * t2 * t2 };
}

export interface Launch {
  v: Vec3;
  topspin: number;
}

/**
 * Plans a legal return: one bounce on the receiver's half, arriving at `to` after `time` seconds. A short scan chooses where
 * the ball bounces, then the integrator is run a few times to correct the flight time for drag.
 */
export function planGoodReturn(from: Vec3, to: Vec3, time: number, topspin = 60): Launch {
  const dir = Math.sign(to.z - from.z) || 1;
  const wantBounceZ = dir * 0.75;
  let fraction = (wantBounceZ - from.z) / (to.z - from.z);
  let effective = time;
  let launch: Launch = { v: ballisticVelocity(from, to, time), topspin };
  for (let i = 0; i < 14; i++) {
    launch = { v: { x: (to.x - from.x) / effective, y: bouncePlan(from, effective, fraction).vy, z: (to.z - from.z) / effective }, topspin };
    const flight = simulateArrival(from, launch, to.z, time * 2.5);
    if (!flight) break;
    effective *= 1 - ((flight.t - time) / time) * 0.8;
    if (flight.bounceZ !== null) fraction += ((wantBounceZ - flight.bounceZ) / (to.z - from.z)) * 0.8;
    fraction = Math.max(0.25, Math.min(0.85, fraction));
  }
  return launch;
}

/** A flawed return for a ball that goes into the net. */
export function planNetReturn(from: Vec3, to: Vec3, time: number): Launch {
  const target: Vec3 = { x: (from.x + to.x) / 2, y: TABLE.top + 0.14, z: 0 };
  const t = time * Math.abs(from.z) / (Math.abs(to.z - from.z) || 1);
  return { v: ballisticVelocity(from, target, t), topspin: 0 };
}

/** A flawed return that sails past the end of the table. */
export function planLongReturn(from: Vec3, to: Vec3, time: number): Launch {
  const dir = Math.sign(to.z - from.z) || 1;
  const target: Vec3 = { x: to.x, y: TABLE.top + 0.3, z: dir * (TABLE.halfLength + 0.9) };
  return { v: ballisticVelocity(from, target, time * 0.8), topspin: 0 };
}

/** Runs the integrator until the ball reaches the plane z = `zPlane`; returns the time, position and first bounce, or null if it never arrives. */
export function simulateArrival(from: Vec3, launch: Launch, zPlane: number, maxTime: number): { t: number; p: Vec3; bounceZ: number | null } | null {
  const b = newBall(from);
  b.v = { ...launch.v };
  b.topspin = launch.topspin;
  const dir = Math.sign(zPlane - from.z) || 1;
  let t = 0;
  let bounceZ: number | null = null;
  while (t < maxTime) {
    for (const e of stepBall(b, STEP, true)) if (e.type === 'bounce' && bounceZ === null) bounceZ = e.at.z;
    t += STEP;
    if (!b.alive) return null;
    if ((b.p.z - zPlane) * dir >= 0) return { t, p: { ...b.p }, bounceZ };
  }
  return null;
}
