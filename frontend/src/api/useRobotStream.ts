import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react';
import { parseRobotIncoming, type RobotAck, type RobotCommand, type RobotHello, type RobotMessage, type RobotSource } from './robot';
import type { Side } from './types';

export type RobotStatus = 'connecting' | 'open' | 'closed';

/** A robot message is "live" for this long after it arrives; the core sends one per tick at 30 Hz while a source is on. */
export const ROBOT_LIVE_MS = 700;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;
const COMMAND_TIMEOUT_MS = 3000;
const LIVENESS_POLL_MS = 200;
/** The core's own port (config.toml [server]); route B keeps the backend on 8000 and the core here. */
export const CORE_PORT = 8765;

/** Slow-changing state of the robot socket, safe to render from. */
export interface RobotState {
  status: RobotStatus;
  /** Endpoint that answered with a hello, once one has. */
  url: string | null;
  /** The in-browser mock answered, not an engine. */
  mock: boolean;
  hello: RobotHello | null;
  /** Last known source: from the hello, from our acks and from the messages themselves. */
  source: RobotSource | null;
  /** A robot message arrived within ROBOT_LIVE_MS. */
  live: boolean;
  /** Hand of the last robot message. */
  hand: Side | null;
  /** Last command error, cleared by the next successful command. */
  error: string | null;
  busy: boolean;
}

/** Latest robot message and the performance.now() it arrived at; read inside useFrame. */
export interface RobotLatest {
  msg: RobotMessage | null;
  at: number;
}

export type RobotListener = (msg: RobotMessage) => void;

/**
 * Where the robot socket may live, in the order tried: an explicit VITE_ROBOT_WS, the core on its own port (route B,
 * the agreed demo wiring), then this origin's /ws/robot (route A through the Vite proxy, or the mock when it is on).
 * A candidate that closes before its hello is skipped for the next one.
 */
export function robotEndpoints(): string[] {
  const out: string[] = [];
  const env = import.meta.env.VITE_ROBOT_WS as string | undefined;
  if (env) out.push(env);
  if (typeof location !== 'undefined') {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    out.push(`ws://${location.hostname}:${CORE_PORT}/ws/robot`);
    out.push(`${proto}://${location.host}/ws/robot`);
  }
  return [...new Set(out)];
}

function sameOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).host === location.host;
  } catch {
    return false;
  }
}

interface Pending {
  resolve: (ack: RobotAck) => void;
  reject: (e: Error) => void;
  timer: number;
}

const INITIAL: RobotState = { status: 'closed', url: null, mock: false, hello: null, source: null, live: false, hand: null, error: null, busy: false };

/**
 * Process-wide singleton around /ws/robot, like the glove store: one reference-counted connection, the latest message in
 * a ref for the 3D side, a small immutable snapshot for React, and one ack per command.
 */
class RobotStore {
  state: RobotState = INITIAL;
  latest: RobotLatest = { msg: null, at: -1e9 };
  private ws: WebSocket | null = null;
  private refs = 0;
  private retry = RECONNECT_MIN_MS;
  private timer: number | null = null;
  private liveness: number | null = null;
  private candidates: string[] = [];
  private index = 0;
  private gotHello = false;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private listeners = new Set<RobotListener>();
  private stateListeners = new Set<() => void>();

  subscribe = (cb: () => void): (() => void) => {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  };

  getState = (): RobotState => this.state;

  onMessage(cb: RobotListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  acquire(): () => void {
    this.refs += 1;
    if (this.refs === 1) {
      this.candidates = robotEndpoints();
      this.index = 0;
      this.connect();
    }
    return () => {
      this.refs -= 1;
      if (this.refs === 0) this.disconnect();
    };
  }

  send(name: RobotCommand['name'], args?: Record<string, unknown>): Promise<RobotAck> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('The robot engine is not connected.'));
    const id = `r${++this.seq}`;
    const cmd: RobotCommand = { v: 1, type: 'cmd', id, name, ...(args ? { args } : {}) };
    this.patch({ busy: true });
    return new Promise<RobotAck>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        this.patch({ busy: this.pending.size > 0, error: 'The robot engine did not answer.' });
        reject(new Error('The robot engine did not answer.'));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(cmd));
    });
  }

  async setSource(source: RobotSource): Promise<RobotAck> {
    const ack = await this.send('set_robot_source', { source });
    if (ack.ok) {
      const result = ack.result as { source?: RobotSource } | undefined;
      this.patch({ source: result?.source ?? source, error: null, live: source === 'off' ? false : this.state.live });
    }
    return ack;
  }

  private patch(p: Partial<RobotState>) {
    this.state = { ...this.state, ...p };
    this.stateListeners.forEach((l) => l());
  }

  private connect() {
    if (!this.candidates.length) {
      this.patch({ status: 'closed' });
      return;
    }
    const url = this.candidates[this.index % this.candidates.length];
    this.patch({ status: 'connecting' });
    this.gotHello = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.index += 1;
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => this.patch({ status: 'open' });
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      const m = parseRobotIncoming(ev.data);
      if (!m) return;
      if (m.type === 'hello') {
        this.gotHello = true;
        this.retry = RECONNECT_MIN_MS;
        const mock = typeof window !== 'undefined' && window.__apprenticeMock === true && sameOrigin(url);
        this.patch({ status: 'open', url, mock, hello: m, source: m.session.robot_source ?? this.state.source ?? 'off', error: null });
        this.startLiveness();
        return;
      }
      if (m.type === 'robot') {
        this.latest = { msg: m, at: performance.now() };
        if (!this.state.live || this.state.source !== m.source || this.state.hand !== m.hand) this.patch({ live: true, source: m.source, hand: m.hand });
        this.listeners.forEach((l) => l(m));
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      window.clearTimeout(p.timer);
      this.patch({ busy: this.pending.size > 0, error: m.ok ? null : (m.error?.message ?? 'The robot engine refused the command.') });
      p.resolve(m);
    };
    ws.onclose = () => {
      this.ws = null;
      this.stopLiveness();
      this.failPending('The robot engine closed the connection.');
      if (this.refs > 0) {
        // No hello from this endpoint: it is not a robot socket (or not up), try the next one.
        if (!this.gotHello) this.index += 1;
        this.patch({ status: 'connecting', live: false });
        this.scheduleReconnect();
      } else this.patch({ status: 'closed', live: false });
    };
    ws.onerror = () => ws.close();
  }

  private failPending(message: string) {
    this.pending.forEach((p) => {
      window.clearTimeout(p.timer);
      p.reject(new Error(message));
    });
    this.pending.clear();
    if (this.state.busy) this.patch({ busy: false });
  }

  private startLiveness() {
    this.stopLiveness();
    this.liveness = window.setInterval(() => {
      if (this.state.live && performance.now() - this.latest.at > ROBOT_LIVE_MS) this.patch({ live: false });
    }, LIVENESS_POLL_MS);
  }

  private stopLiveness() {
    if (this.liveness !== null) window.clearInterval(this.liveness);
    this.liveness = null;
  }

  private scheduleReconnect() {
    if (this.timer !== null) return;
    // Cycling through untried endpoints is quick; once every endpoint has had a turn the wait grows.
    const quick = this.index < this.candidates.length;
    this.timer = window.setTimeout(
      () => {
        this.timer = null;
        if (this.refs > 0) this.connect();
      },
      quick ? 150 : this.retry,
    );
    if (!quick) this.retry = Math.min(this.retry * 1.6, RECONNECT_MAX_MS);
  }

  private disconnect() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.stopLiveness();
    this.failPending('The robot view closed.');
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.patch({ status: 'closed', live: false, busy: false });
  }
}

const store = new RobotStore();

export interface RobotStreamHandle extends RobotState {
  /** Latest message and arrival time, updated at stream rate without re-rendering. Read it inside useFrame. */
  latest: MutableRefObject<RobotLatest>;
  /** Subscribe to every robot message. Returns the unsubscribe function. No React renders. */
  onMessage: (cb: RobotListener) => () => void;
  /** `set_robot_source` on the engine; resolves with the ack (check `ok`). */
  setSource: (source: RobotSource) => Promise<RobotAck>;
  send: (name: RobotCommand['name'], args?: Record<string, unknown>) => Promise<RobotAck>;
}

/**
 * Connects to the core's /ws/robot (shared, auto-reconnecting, trying each endpoint in turn) while mounted. Only the
 * slow state re-renders; messages flow through `latest` and `onMessage`.
 */
export function useRobotStream(enabled = true): RobotStreamHandle {
  useEffect(() => (enabled ? store.acquire() : undefined), [enabled]);
  const state = useSyncExternalStore(store.subscribe, store.getState, () => INITIAL);
  const latest = useRef<RobotLatest>(store.latest);
  useEffect(() => {
    latest.current = store.latest;
    return store.onMessage(() => {
      latest.current = store.latest;
    });
  }, []);
  const onMessage = useCallback((cb: RobotListener) => store.onMessage(cb), []);
  const setSource = useCallback((s: RobotSource) => store.setSource(s), []);
  const send = useCallback((name: RobotCommand['name'], args?: Record<string, unknown>) => store.send(name, args), []);
  return { ...(enabled ? state : { ...INITIAL, status: 'closed' as const }), latest, onMessage, setSource, send };
}

/** The latest robot message sampled at a slow rate for panels (null while nothing is live). */
export function useRobotView(hz = 8): RobotMessage | null {
  const [msg, setMsg] = useState<RobotMessage | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const live = performance.now() - store.latest.at <= ROBOT_LIVE_MS;
      const next = live ? store.latest.msg : null;
      setMsg((prev) => (prev === next || (prev && next && prev.t === next.t) ? prev : next));
    }, 1000 / hz);
    return () => window.clearInterval(id);
  }, [hz]);
  return msg;
}
