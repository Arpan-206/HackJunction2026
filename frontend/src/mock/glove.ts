import type { Finger, GloveFrame, HandFrame, JointTriple, MotionSpec, Side } from '../api/types';
import { getStore } from './store';
import { FINGER_NAMES, frameAt, nlerp, normaliseQuat } from './synth';

/**
 * Mock glove pipeline: a simulator at about 60 Hz, a light hand tremor, and the One Euro smoothing stage from
 * backend/app/services/smoothing/one_euro.py. Smoothing settings from /api/dev/state act on the tremor exactly as
 * they do on the real stream, so the steadiness controls have a visible effect.
 */

export const STREAM_HZ = 60;
const TREMOR_RAD = 0.035;
const TREMOR_HZ = [8.6, 11.3];
const QUAT_TREMOR = 0.006;
const D_CUTOFF = 1;
const DEADBAND_RAD = 0.004;
const FALLBACK_DT = 1 / STREAM_HZ;
const DECIMALS = 4;

type Quat = [number, number, number, number];
const round = (v: number): number => Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS;
const alpha = (dt: number, cutoff: number): number => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

/** Casiez et al. (2012) adaptive low-pass filter for one signal, with a deadband. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private out = 0;

  filter(v: number, dt: number, minCutoff: number, beta: number): number {
    if (this.x === null) {
      this.x = v;
      this.out = v;
      return v;
    }
    const step = dt > 0 ? dt : FALLBACK_DT;
    this.dx += alpha(step, D_CUTOFF) * ((v - this.x) / step - this.dx);
    this.x += alpha(step, minCutoff + beta * Math.abs(this.dx)) * (v - this.x);
    if (Math.abs(this.x - this.out) >= DEADBAND_RAD) this.out = this.x;
    return this.out;
  }
}

interface HandState {
  joints: OneEuro[];
  quat: Quat | null;
  lastT: number | null;
}

/** Smooths frames per hand; separate state for each side. */
class Smoother {
  private hands = new Map<Side, HandState>();

  smooth(frame: GloveFrame, enabled: boolean, minCutoff: number, beta: number): GloveFrame {
    if (!enabled) {
      this.hands.clear();
      return frame;
    }
    return { ...frame, hands: frame.hands.map((h) => this.hand(h, frame.t, minCutoff, beta)) };
  }

  private hand(hand: HandFrame, t: number, minCutoff: number, beta: number): HandFrame {
    let state = this.hands.get(hand.side);
    if (state && state.lastT !== null && t < state.lastT) state = undefined;
    if (!state) {
      state = { joints: Array.from({ length: 15 }, () => new OneEuro()), quat: null, lastT: null };
      this.hands.set(hand.side, state);
    }
    const dt = state.lastT === null ? FALLBACK_DT : t - state.lastT;
    state.lastT = t;
    let k = 0;
    const flexion = {} as Record<Finger, JointTriple>;
    for (const name of FINGER_NAMES) {
      const v = hand.flexion[name].map((x) => round(state.joints[k++].filter(x, dt, minCutoff, beta))) as JointTriple;
      flexion[name] = v;
    }
    const raw = normaliseQuat(hand.wrist_quat);
    state.quat = state.quat ? nlerp(state.quat, raw, alpha(dt > 0 ? dt : FALLBACK_DT, minCutoff)) : raw;
    return { ...hand, flexion, wrist_quat: state.quat.map(round) as Quat };
  }
}

/** Adds a deterministic two-tone tremor (about 9 to 11 Hz) to every joint and a hint of wobble to the wrist. */
function addTremor(frame: GloveFrame): GloveFrame {
  const t = frame.t;
  return {
    ...frame,
    hands: frame.hands.map((h, hi) => {
      const flexion = {} as Record<Finger, JointTriple>;
      FINGER_NAMES.forEach((name, fi) => {
        flexion[name] = h.flexion[name].map((v, j) => {
          const k = hi * 15 + fi * 3 + j;
          const wave = Math.sin(2 * Math.PI * TREMOR_HZ[0] * t + k * 1.7) * 0.6 + Math.sin(2 * Math.PI * TREMOR_HZ[1] * t + k * 0.9) * 0.4;
          return round(v + TREMOR_RAD * wave);
        }) as JointTriple;
      });
      const wob = QUAT_TREMOR * Math.sin(2 * Math.PI * TREMOR_HZ[0] * t + hi);
      const q = normaliseQuat([h.wrist_quat[0] + wob, h.wrist_quat[1] - wob, h.wrist_quat[2], h.wrist_quat[3]]);
      return { ...h, flexion, wrist_quat: q.map(round) as Quat };
    }),
  };
}

type FrameSink = (frame: GloveFrame) => void;

/** The shared simulator. It only ticks while somebody listens, but its clock runs from page load like the backend's. */
class GloveHub {
  private origin = performance.now();
  private timer: number | null = null;
  private sinks = new Set<FrameSink>();
  private smoother = new Smoother();
  private external = false;
  motion: MotionSpec = getStore().dev.simulator_motion;

  /** Seconds since the hub was created. */
  now(): number {
    return (performance.now() - this.origin) / 1000;
  }

  setMotion(motion: MotionSpec): void {
    this.motion = motion;
    const store = getStore();
    store.dev.simulator_motion = motion;
  }

  /** Subscribes to smoothed frames. Returns the unsubscribe function. */
  subscribe(sink: FrameSink): () => void {
    this.sinks.add(sink);
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 1000 / STREAM_HZ);
    return () => {
      this.sinks.delete(sink);
      if (!this.sinks.size && this.timer !== null) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** In external mode the simulator is silent and only ingested frames reach subscribers. */
  setExternal(on: boolean): void {
    this.external = on;
  }

  isExternal(): boolean {
    return this.external;
  }

  /** Pushes externally supplied frames through the smoothing stage to every subscriber, marked as replay frames. */
  ingest(frames: GloveFrame[]): void {
    const { smoothing } = getStore().dev;
    for (const f of frames) {
      const out = this.smoother.smooth({ ...f, source: 'replay' }, smoothing.enabled, smoothing.min_cutoff, smoothing.beta);
      this.sinks.forEach((s) => s(out));
    }
  }

  private tick(): void {
    if (this.external) return;
    const { smoothing } = getStore().dev;
    const frame = this.smoother.smooth(addTremor(frameAt(this.motion, this.now())), smoothing.enabled, smoothing.min_cutoff, smoothing.beta);
    this.sinks.forEach((s) => s({ ...frame, t: round(frame.t) }));
  }
}

let hub: GloveHub | null = null;

/** The process-wide mock glove hub. */
export function getHub(): GloveHub {
  hub ??= new GloveHub();
  return hub;
}

const MOTION_PRESETS = ['finger_sequence', 'grip_and_swing', 'pinch', 'hold_pose', 'keyframes', 'idle'];

/** True for a payload that looks like a MotionSpec (the real backend validates the full schema). */
export function isMotionSpec(value: unknown): value is MotionSpec {
  return !!value && typeof value === 'object' && MOTION_PRESETS.includes((value as { preset?: string }).preset ?? '');
}

/** Matches the URLs the mock socket stands in for. */
export function isGloveSocketUrl(url: string | URL): boolean {
  try {
    return new URL(String(url), window.location.href).pathname.endsWith('/ws/gloves');
  } catch {
    return false;
  }
}

/** Stand-in for WebSocket on /ws/gloves: opens immediately, streams frames, understands set_motion. */
export class MockGloveSocket extends EventTarget {
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

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    window.setTimeout(() => this.open(), 0);
  }

  private fire(ev: Event, handler: ((e: never) => void) | null): void {
    handler?.call(this, ev as never);
    this.dispatchEvent(ev);
  }

  private open(): void {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.fire(new Event('open'), this.onopen);
    this.unsubscribe = getHub().subscribe((frame) => {
      if (this.readyState === 1) this.fire(new MessageEvent('message', { data: JSON.stringify(frame) }), this.onmessage);
    });
  }

  send(data: unknown): void {
    if (this.readyState !== 1 || typeof data !== 'string') return;
    try {
      const msg = JSON.parse(data) as { type?: string; motion?: unknown };
      if (msg.type === 'set_motion' && isMotionSpec(msg.motion)) getHub().setMotion(msg.motion);
    } catch {
      /* ignore malformed client messages, like the backend */
    }
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.setTimeout(() => this.fire(new CloseEvent('close', { code, reason, wasClean: true }), this.onclose), 0);
  }
}
