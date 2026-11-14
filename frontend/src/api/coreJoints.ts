import { coreEndpoint } from './coreCommand';
import type { Side } from './types';

/**
 * The glove core's full skeleton for the live hand. The contract's GloveFrame carries joint angles only, and angles lose
 * what the core's skeleton shows: they are unsigned (a finger bent back reads as bent forward) and say nothing of which
 * way a finger turns. The core's own socket (SPEC.md `/ws`, the one its debug view draws) sends all 26 joint positions
 * every frame, so the live hand reads them from there and poses every bone from them (three/handPose.ts applyJointPose).
 *
 * Process-wide and lazy: the socket opens on the first `wantCoreJoints()` (a live hand on a stage fed by the core) and
 * closes a few seconds after the last one. Never in mock mode. Nothing here re-renders React.
 */

export interface CoreHandJoints {
  /** 26 joints x, y, z in the wrist frame of a right hand (a left hand mirrored in x): fingers -z, back +y, thumb -x. */
  joints: Float32Array;
  /**
   * The same flexion triples core/compat.py derives from these joints for /ws/gloves (thumb CMC stand-in, MCP, IP; every
   * other finger MCP, PIP, DIP; radians, finger-major), so a caller can check a GloveFrame came from this skeleton.
   */
  flex: Float32Array;
  /** performance.now() when it arrived. */
  at: number;
}

/** How long the socket stays open after the last request, and the wait before a retry after it drops (ms). */
const IDLE_MS = 4000;
const RETRY_MS = 3000;

interface CoreFrameHand {
  joints?: number[][];
  wrist?: { p?: number[]; q?: number[] };
}

let ws: WebSocket | null = null;
let lastWant = 0;
let retryAt = 0;
let idleTimer: number | null = null;
const latest: Partial<Record<Side, CoreHandJoints>> = {};

function disabled(): boolean {
  return typeof window === 'undefined' || typeof WebSocket === 'undefined' || window.__apprenticeMock === true;
}

function close(): void {
  if (idleTimer !== null) window.clearInterval(idleTimer);
  idleTimer = null;
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
  ws = null;
  delete latest.left;
  delete latest.right;
}

function open(): void {
  let sock: WebSocket;
  try {
    sock = new WebSocket(coreEndpoint());
  } catch {
    retryAt = performance.now() + RETRY_MS;
    return;
  }
  ws = sock;
  sock.onmessage = (ev) => {
    if (typeof ev.data !== 'string' || !ev.data.includes('"frame"')) return;
    try {
      const m = JSON.parse(ev.data) as { type?: string; hands?: Partial<Record<Side, CoreFrameHand | null>> };
      if (m.type !== 'frame' || !m.hands) return;
      for (const side of ['left', 'right'] as const) {
        const h = m.hands[side];
        const parsed = h ? toLocal(h, side) : null;
        if (parsed) latest[side] = parsed;
        else delete latest[side];
      }
    } catch {
      /* not a frame */
    }
  };
  sock.onerror = () => sock.close();
  sock.onclose = () => {
    if (ws === sock) ws = null;
    delete latest.left;
    delete latest.right;
    retryAt = performance.now() + RETRY_MS;
  };
  if (idleTimer === null)
    idleTimer = window.setInterval(() => {
      if (performance.now() - lastWant > IDLE_MS) close();
    }, 1000);
}

/** World joints and wrist pose to the right-hand wrist frame: R(q)^-1 (j - p), mirrored in x for a left hand. */
export function toLocal(h: CoreFrameHand, side: Side, at = typeof performance !== 'undefined' ? performance.now() : 0): CoreHandJoints | null {
  const J = h.joints;
  const p = h.wrist?.p;
  const q = h.wrist?.q;
  if (!J || J.length !== 26 || !p || !q || p.length < 3 || q.length < 4) return null;
  // Inverse rotation of v by the unit quaternion q (x, y, z, w): rotate by the conjugate.
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const qx = -q[0] / n;
  const qy = -q[1] / n;
  const qz = -q[2] / n;
  const qw = q[3] / n;
  const joints = new Float32Array(78);
  const mirror = side === 'left' ? -1 : 1;
  for (let i = 0; i < 26; i++) {
    const vx = J[i][0] - p[0];
    const vy = J[i][1] - p[1];
    const vz = J[i][2] - p[2];
    // t = 2 q x v; v' = v + w t + q x t
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    joints[i * 3] = (vx + qw * tx + (qy * tz - qz * ty)) * mirror;
    joints[i * 3 + 1] = vy + qw * ty + (qz * tx - qx * tz);
    joints[i * 3 + 2] = vz + qw * tz + (qx * ty - qy * tx);
  }
  return { joints, flex: coreFlexion(joints), at };
}

function angleAt(j: ArrayLike<number>, a0: number, a1: number, b0: number, b1: number): number {
  const ax = j[a1 * 3] - j[a0 * 3];
  const ay = j[a1 * 3 + 1] - j[a0 * 3 + 1];
  const az = j[a1 * 3 + 2] - j[a0 * 3 + 2];
  const bx = j[b1 * 3] - j[b0 * 3];
  const by = j[b1 * 3 + 1] - j[b0 * 3 + 1];
  const bz = j[b1 * 3 + 2] - j[b0 * 3 + 2];
  const d = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
  return d > 0 ? Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / d))) : 0;
}

/** core/compat.py's flexion triples from 26 joints (core/hand.py angle_features), radians, finger-major. */
export function coreFlexion(j: ArrayLike<number>): Float32Array {
  const out = new Float32Array(15);
  out[0] = angleAt(j, 2, 3, 6, 7);
  out[1] = angleAt(j, 2, 3, 3, 4);
  out[2] = angleAt(j, 3, 4, 4, 5);
  [6, 11, 16, 21].forEach((b, k) => {
    out[3 + k * 3] = angleAt(j, b, b + 1, b + 1, b + 2);
    out[4 + k * 3] = angleAt(j, b + 1, b + 2, b + 2, b + 3);
    out[5 + k * 3] = angleAt(j, b + 2, b + 3, b + 3, b + 4);
  });
  return out;
}

/** Asks for the core skeleton (opens the socket if needed) and returns the latest for `side`, or null. Cheap per frame. */
export function wantCoreJoints(side: Side): CoreHandJoints | null {
  if (disabled()) return null;
  const now = performance.now();
  lastWant = now;
  if (!ws && now >= retryAt) open();
  return latest[side] ?? null;
}
