import type { Finger, GloveFrame, HandFrame, Side } from '../api/types';
import { FINGERS } from '../api/types';
import type { RobotAck, RobotDescription, RobotHello, RobotMessage, RobotSource } from '../api/robot';
import { ROBOT_SOURCES } from '../api/robot';
import { movableJoints, parseUrdf, type UrdfModel } from '../three/robot/urdf';
import { getHub } from './glove';

/**
 * Mock robot socket for `/ws/robot`, so the robot twin works offline. The retarget table is a port of the core's
 * `[robot.retarget]` in config.toml and `Retargeter.targets` in core/robot.py: one weighted sum per robot joint over
 * the 18 angle features, in radians, clamped to the URDF limits, with the same per-finger fidelity. It is the mock's
 * stand-in only; the core owns retargeting (RECONCILE.md). The mock's glove stream has three flexion angles per finger
 * and no joint positions, so the angle features are read from those (see angleFeatures).
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export type AngleName =
  | 'thumb_mcp'
  | 'thumb_ip'
  | 'index_mcp'
  | 'index_pip'
  | 'index_dip'
  | 'middle_mcp'
  | 'middle_pip'
  | 'middle_dip'
  | 'ring_mcp'
  | 'ring_pip'
  | 'ring_dip'
  | 'little_mcp'
  | 'little_pip'
  | 'little_dip'
  | 'spread_thumb_index'
  | 'spread_index_middle'
  | 'spread_middle_ring'
  | 'spread_ring_little';

export interface RetargetEntry {
  key: string;
  finger: Finger;
  offsetDeg: number;
  weights: Partial<Record<AngleName, number>>;
  signLeft?: number;
  signRight?: number;
}

/** config.toml [robot.retarget], joint key to finger, offset and weights. */
export const DEX3_RETARGET: readonly RetargetEntry[] = [
  { key: 'thumb_0', finger: 'thumb', offsetDeg: -40, weights: { spread_thumb_index: 1 }, signLeft: 1, signRight: -1 },
  { key: 'thumb_1', finger: 'thumb', offsetDeg: 0, weights: { thumb_mcp: 1 } },
  { key: 'thumb_2', finger: 'thumb', offsetDeg: 0, weights: { thumb_ip: 1 } },
  { key: 'index_0', finger: 'index', offsetDeg: 0, weights: { index_mcp: 1 } },
  { key: 'index_1', finger: 'index', offsetDeg: 0, weights: { index_pip: 0.7, index_dip: 0.5 } },
  { key: 'middle_0', finger: 'middle', offsetDeg: 0, weights: { middle_mcp: 1 } },
  { key: 'middle_1', finger: 'middle', offsetDeg: 0, weights: { middle_pip: 0.7, middle_dip: 0.5 } },
];

/** config.toml [robot] human_dofs: human flexion joints per finger, for the fidelity score. */
export const HUMAN_DOFS: Record<Finger, number> = { thumb: 2, index: 3, middle: 3, ring: 3, little: 3 };
export const MODEL_NAME = 'dex3_1';
const JOINT_NAME = (side: Side, key: string) => `${side}_hand_${key}_joint`;

/** A flat hand's thumb to index spread in the core's angle features (about 40 degrees), the offset the table removes. */
const FLAT_THUMB_INDEX_SPREAD_DEG = 40;

/**
 * The core's 18 angle features in degrees, read from the contract's flexion triples. Fingers: MCP, PIP, DIP. Thumb:
 * the triple is CMC, MCP, IP, and the core's two thumb features are MCP and IP. Spreads come from the optional
 * per-finger spread, measured from a flat hand's spacing.
 */
export function angleFeatures(hand: HandFrame): Record<AngleName, number> {
  const f = hand.flexion;
  const s: Partial<Record<Finger, number>> = hand.spread ?? {};
  const deg = (v: number | undefined) => (v ?? 0) * RAD;
  return {
    thumb_mcp: deg(f.thumb[1]),
    thumb_ip: deg(f.thumb[2]),
    index_mcp: deg(f.index[0]),
    index_pip: deg(f.index[1]),
    index_dip: deg(f.index[2]),
    middle_mcp: deg(f.middle[0]),
    middle_pip: deg(f.middle[1]),
    middle_dip: deg(f.middle[2]),
    ring_mcp: deg(f.ring[0]),
    ring_pip: deg(f.ring[1]),
    ring_dip: deg(f.ring[2]),
    little_mcp: deg(f.little[0]),
    little_pip: deg(f.little[1]),
    little_dip: deg(f.little[2]),
    spread_thumb_index: FLAT_THUMB_INDEX_SPREAD_DEG + deg(s.thumb) + deg(s.index),
    spread_index_middle: 12 + Math.abs(deg(s.index) - deg(s.middle)),
    spread_middle_ring: 12 + Math.abs(deg(s.middle) - deg(s.ring)),
    spread_ring_little: 14 + Math.abs(deg(s.ring) - deg(s.little)),
  };
}

export type Limits = Record<string, [number, number]>;

export interface RobotTargets {
  q: Record<string, number>;
  q_norm: Record<string, number>;
  fidelity: Partial<Record<Finger, number>>;
  missing: Finger[];
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** The side of the limit range with the larger magnitude is the flexion direction (core/robot.py `_auto_sign`). */
export function autoSign(lower: number, upper: number): number {
  return Math.abs(upper) >= Math.abs(lower) ? 1 : -1;
}

/** Port of `Retargeter.targets`: angle features in degrees to clamped joint targets for one side. */
export function retargetAngles(angles: Record<AngleName, number>, side: Side, limits: Limits, table: readonly RetargetEntry[] = DEX3_RETARGET): RobotTargets {
  const q: Record<string, number> = {};
  const q_norm: Record<string, number> = {};
  const loss: Partial<Record<Finger, number[]>> = {};
  for (const e of table) {
    const name = JOINT_NAME(side, e.key);
    const lim = limits[name];
    if (!lim) throw new Error(`joint ${name} is not in the limits table`);
    const [lower, upper] = lim;
    const range = Math.max(1e-9, upper - lower);
    let deg = e.offsetDeg;
    for (const [a, w] of Object.entries(e.weights)) deg += (w ?? 0) * angles[a as AngleName];
    const forced = side === 'left' ? e.signLeft : e.signRight;
    const sign = forced ?? autoSign(lower, upper);
    const raw = sign * deg * DEG;
    const val = Math.min(upper, Math.max(lower, raw));
    q[name] = round(val, 5);
    q_norm[name] = round((val - lower) / range, 3);
    (loss[e.finger] ??= []).push(Math.abs(raw - val) / range);
  }
  const fingers = FINGERS.filter((f) => table.some((e) => e.finger === f));
  const fidelity: Partial<Record<Finger, number>> = {};
  for (const f of fingers) {
    const nRobot = table.filter((e) => e.finger === f).length;
    const coverage = Math.min(1, nRobot / Math.max(1, HUMAN_DOFS[f]));
    const l = loss[f] ?? [];
    const clip = l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0;
    fidelity[f] = round(Math.min(1, Math.max(0, coverage * (1 - clip))), 3);
  }
  return { q, q_norm, fidelity, missing: FINGERS.filter((f) => !fingers.includes(f)) };
}

/** Joint targets for one glove hand. */
export function retargetHand(hand: HandFrame, limits: Limits): RobotTargets {
  return retargetAngles(angleFeatures(hand), hand.side, limits);
}

/** Limits per joint name from a parsed URDF. */
export function limitsOf(model: UrdfModel): Limits {
  const out: Limits = {};
  for (const j of movableJoints(model)) out[j.name] = [j.lower, j.upper];
  return out;
}

/** `hello.robot` for the mock, from both URDFs. */
export function describeRobot(models: Record<Side, UrdfModel>): RobotDescription {
  const fingers = FINGERS.filter((f) => DEX3_RETARGET.some((e) => e.finger === f));
  const joints = { left: DEX3_RETARGET.map((e) => JOINT_NAME('left', e.key)), right: DEX3_RETARGET.map((e) => JOINT_NAME('right', e.key)) };
  const limits = { left: limitsOf(models.left), right: limitsOf(models.right) };
  return { model: MODEL_NAME, fingers, missing: FINGERS.filter((f) => !fingers.includes(f)), joints, limits, urdf: { left: 'dex3_1_l.urdf', right: 'dex3_1_r.urdf' } };
}

/** The glove hand the mock robot follows for a source. The hub has no roles, so the right hand plays the apprentice. */
export function pickHand(frame: GloveFrame, source: RobotSource): HandFrame | null {
  if (source === 'off' || !frame.hands.length) return null;
  const want: Side = source === 'master' ? 'left' : 'right';
  return frame.hands.find((h) => h.side === want) ?? frame.hands[0];
}

export function robotMessage(frame: GloveFrame, source: Exclude<RobotSource, 'off'>, limits: Record<Side, Limits>, tUs: number): RobotMessage | null {
  const hand = pickHand(frame, source);
  if (!hand) return null;
  const t = retargetHand(hand, limits[hand.side]);
  return { v: 1, type: 'robot', t: tUs, model: MODEL_NAME, source, hand: hand.side, angles_from: source === 'lesson' ? 'lesson' : 'hand', ...t };
}

/* ------------------------------------------------------------------ the socket */

/** Matches the same-origin robot socket path; a direct `host:8765` URL is left to the real core. */
export function isRobotSocketUrl(url: string | URL): boolean {
  try {
    const u = new URL(String(url), window.location.href);
    return u.pathname.endsWith('/ws/robot') && u.host === window.location.host;
  } catch {
    return false;
  }
}

/** Source shared by every mock robot socket, as the core keeps one for the whole session. Offline it starts following the apprentice. */
let mockSource: RobotSource = 'learner';
export const getMockRobotSource = (): RobotSource => mockSource;
export const setMockRobotSource = (s: RobotSource): void => {
  mockSource = s;
};

let modelsPromise: Promise<Record<Side, UrdfModel>> | null = null;

/** The two URDFs shipped in public/models/robots/dex3_1, fetched once. */
export function loadMockRobotModels(): Promise<Record<Side, UrdfModel>> {
  modelsPromise ??= Promise.all(
    (['left', 'right'] as Side[]).map(async (side) => {
      const res = await fetch(`/models/robots/dex3_1/dex3_1_${side[0]}.urdf`);
      if (!res.ok) throw new Error(`URDF for the ${side} hand: HTTP ${res.status}`);
      return [side, parseUrdf(await res.text())] as const;
    }),
  ).then((pairs) => Object.fromEntries(pairs) as Record<Side, UrdfModel>);
  return modelsPromise;
}

const nowUs = () => Math.round((performance.timeOrigin + performance.now()) * 1000);

/** Stand-in for WebSocket on /ws/robot: hello with the Dex3-1 description, one robot message per glove frame, acks for commands. */
export class MockRobotSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  readonly url: string;
  readonly protocol = '';
  readonly extensions = '';
  readonly bufferedAmount = 0;
  binaryType: BinaryType = 'blob';
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private limits: Record<Side, Limits> | null = null;
  private tick = 0;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    window.setTimeout(() => void this.open(), 0);
  }

  private fire(ev: Event, handler: ((e: never) => void) | null): void {
    handler?.call(this, ev as never);
    this.dispatchEvent(ev);
  }

  private emit(msg: RobotHello | RobotMessage | RobotAck): void {
    if (this.readyState === 1) this.fire(new MessageEvent('message', { data: JSON.stringify(msg) }), this.onmessage);
  }

  private async open(): Promise<void> {
    if (this.readyState !== 0) return;
    let models: Record<Side, UrdfModel>;
    try {
      models = await loadMockRobotModels();
    } catch {
      this.readyState = 3;
      this.fire(new Event('error'), this.onerror);
      this.fire(new CloseEvent('close', { code: 1011, reason: 'no robot model', wasClean: false }), this.onclose);
      return;
    }
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.limits = { left: limitsOf(models.left), right: limitsOf(models.right) };
    this.fire(new Event('open'), this.onopen);
    const hello: RobotHello = {
      v: 1,
      type: 'hello',
      t: nowUs(),
      robot: describeRobot(models),
      session: { robot_source: mockSource, roles: { left: 'master', right: 'learner' }, mode: 'learn', lesson_id: 'mock', step: 0 },
      fake: true,
    };
    this.emit(hello);
    this.unsubscribe = getHub().subscribe((frame) => {
      // The hub streams at about 60 Hz; the core ticks at 30, so every other frame goes out.
      if (++this.tick % 2 || mockSource === 'off' || !this.limits) return;
      const msg = robotMessage(frame, mockSource, this.limits, nowUs());
      if (msg) this.emit(msg);
    });
  }

  send(data: unknown): void {
    if (this.readyState !== 1 || typeof data !== 'string') return;
    let cmd: { id?: unknown; name?: unknown; args?: { source?: unknown } };
    try {
      cmd = JSON.parse(data) as typeof cmd;
    } catch {
      this.emit({ v: 1, type: 'ack', t: nowUs(), id: '?', ok: false, error: { code: 'bad_args', message: 'not JSON' } });
      return;
    }
    const id = typeof cmd.id === 'string' ? cmd.id : '?';
    if (cmd.name === 'set_robot_source') {
      const src = cmd.args?.source;
      if (typeof src !== 'string' || !ROBOT_SOURCES.includes(src as RobotSource)) {
        this.emit({ v: 1, type: 'ack', t: nowUs(), id, ok: false, error: { code: 'bad_args', message: `source must be one of ${JSON.stringify(ROBOT_SOURCES)}` } });
        return;
      }
      mockSource = src as RobotSource;
      this.emit({ v: 1, type: 'ack', t: nowUs(), id, ok: true, result: { source: mockSource, model: MODEL_NAME } });
      return;
    }
    if (cmd.name === 'ping') {
      this.emit({ v: 1, type: 'ack', t: nowUs(), id, ok: true, result: {} });
      return;
    }
    this.emit({ v: 1, type: 'ack', t: nowUs(), id, ok: false, error: { code: 'bad_args', message: `unknown command ${String(cmd.name)}` } });
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.setTimeout(() => this.fire(new CloseEvent('close', { code, reason, wasClean: true }), this.onclose), 0);
  }
}
