import { useCallback, useEffect, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import type { GloveFrame, HandFrame } from './types';
import type { CoreAck, CoreCommand, RobotDescription, RobotHello, RobotMessage, RobotSource } from './robotTypes';
import { anglesFromHand, Retargeter, toMessage } from '../mock/robot';
import type { RobotModels } from '../three/robot/kinematics';

/**
 * The robot stream: the core's /ws/robot socket (core/server.py `handle_robot_ws`), shared by every component like
 * useGloveStream shares /ws/gloves. It reads `hello.robot` (joint names and limits) and every `robot` message, sends
 * `set_robot_source` in the core's command envelope (schema/cmd.json), and reconnects quietly.
 *
 * With `?mock=1`, or while the core cannot be reached, the twin is fed in the browser instead: the mock port of the
 * core's retarget (mock/robot.ts) runs at the core's tick rate on whatever hand the screen supplies (the mock glove,
 * or the lesson hand). Frames move through refs and listeners, never React state, so nothing re-renders at 60 Hz.
 */

export type RobotLink = 'connecting' | 'core' | 'mock';

/** The hand the browser retarget follows for a source, and whether it is a live hand or a lesson. */
export interface MockRobotInput {
  hand: HandFrame;
  from: 'hand' | 'lesson';
}
export type MockInputProvider = (source: Exclude<RobotSource, 'off'>) => MockRobotInput | null;

export interface RobotState {
  link: RobotLink;
  /** The core's address as shown to people, e.g. localhost:8765. */
  coreLabel: string;
  /** True once a connection to the core has failed (so the mock is a fallback, not a choice). */
  coreDown: boolean;
  /** True when mock mode was asked for (?mock=1): the core is never tried. */
  mockOnly: boolean;
  /** The robot model from the core's hello (or the browser's copy in mock mode); null when the core has none. */
  robot: RobotDescription | null;
  /** True once a hello (core) or the URDFs (mock) arrived, so `robot === null` means "none" rather than "not yet". */
  described: boolean;
  /** True when the core runs with --fake (no gloves). */
  fake: boolean;
  source: RobotSource;
  /** Roles per glove side from the core's session, used to pick "you". */
  roles: Partial<Record<'left' | 'right', string>>;
  lessonId: string | null;
  /** The core's session mode (learn, playback, ...), for whether its lesson source can play. */
  mode: string | null;
  /** Lessons the core has on disk (id and title), from its hello. */
  lessons: { id: string; title: string }[];
  /** Smoothed time from a glove change to the robot's next changed message, ms; null until measured. */
  lagMs: number | null;
  /** Last command error, in the core's words. */
  error: string | null;
}

export const CORE_RATE_HZ = 60;
const OPEN_TIMEOUT_MS = 2000;
const ACK_TIMEOUT_MS = 3000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 8000;
const LAG_PUBLISH_MS = 500;

/** A glove change smaller than this (summed over all joints, radians) is noise, not a movement. */
export const GLOVE_CHANGE_RAD = 0.02;
/** A robot target change smaller than this (any joint, radians) is not an answer. */
export const ROBOT_CHANGE_RAD = 0.002;
/** A glove change the robot has not answered within this time is dropped (the robot may be clamped or off). */
export const LAG_EXPIRE_MS = 1000;

/**
 * Measures the lag between a glove change and the robot message that answers it: the first unanswered glove change
 * starts the clock, the next robot message whose targets moved stops it. Exponentially smoothed.
 */
export class LagMeter {
  private prevGlove: number[] | null = null;
  private prevQ: Record<string, number> | null = null;
  private changedAt: number | null = null;
  value: number | null = null;

  glove(flex: number[], now: number): void {
    const prev = this.prevGlove;
    this.prevGlove = flex;
    if (this.changedAt !== null && now - this.changedAt > LAG_EXPIRE_MS) this.changedAt = null;
    if (!prev || prev.length !== flex.length || this.changedAt !== null) return;
    let d = 0;
    for (let i = 0; i < flex.length; i++) d += Math.abs(flex[i] - prev[i]);
    if (d > GLOVE_CHANGE_RAD) this.changedAt = now;
  }

  robot(q: Record<string, number>, now: number): void {
    const prev = this.prevQ;
    this.prevQ = q;
    if (!prev || this.changedAt === null) return;
    let moved = false;
    for (const k of Object.keys(q)) if (Math.abs(q[k] - (prev[k] ?? 0)) > ROBOT_CHANGE_RAD) moved = true;
    if (!moved) return;
    const sample = now - this.changedAt;
    this.changedAt = null;
    if (sample > LAG_EXPIRE_MS) return;
    this.value = this.value === null ? sample : 0.8 * this.value + 0.2 * sample;
  }

  reset(): void {
    this.prevGlove = null;
    this.prevQ = null;
    this.changedAt = null;
    this.value = null;
  }
}

/** Every flexion value of a glove frame in one list, for the lag meter. */
export function gloveVector(frame: GloveFrame): number[] {
  const out: number[] = [];
  for (const h of [...frame.hands].sort((a, b) => a.side.localeCompare(b.side))) {
    for (const f of ['thumb', 'index', 'middle', 'ring', 'little'] as const) out.push(...h.flexion[f]);
  }
  return out;
}

/** ws:// URL of the core's robot socket from an http(s) core address. */
export function robotSocketUrl(coreUrl: string): string {
  const u = new URL(coreUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = `${u.pathname.replace(/\/$/, '')}/ws/robot`;
  return u.toString();
}

interface SocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface RobotStoreOptions {
  coreUrl: string;
  /** True when the core must not be tried (explicit mock mode). Read on every connect. */
  mockOnly: () => boolean;
  openSocket: (url: string) => SocketLike;
  loadModels: () => Promise<RobotModels>;
  now: () => number;
}

type Listener = (msg: RobotMessage) => void;

/** The shared robot stream. Exported for tests; components use `useRobotStream`. */
export class RobotStore {
  latest: RobotMessage | null = null;
  lastAt = 0;
  private state: RobotState;
  private ws: SocketLike | null = null;
  private refs = 0;
  private retry = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private mockTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<() => void>();
  private pending = new Map<string, { resolve: (a: CoreAck) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 1;
  private lag = new LagMeter();
  private lagPublishedAt = 0;
  private retargeter: Retargeter | null = null;
  private mockInput: MockInputProvider | null = null;

  constructor(private opts: RobotStoreOptions) {
    let label = opts.coreUrl;
    try {
      label = new URL(opts.coreUrl).host;
    } catch {
      /* keep the raw text */
    }
    this.state = {
      link: 'connecting',
      coreLabel: label,
      coreDown: false,
      mockOnly: false,
      robot: null,
      described: false,
      fake: false,
      source: 'off',
      roles: {},
      lessonId: null,
      mode: null,
      lessons: [],
      lagMs: null,
      error: null,
    };
  }

  subscribe = (cb: () => void): (() => void) => {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  };

  getState = (): RobotState => this.state;

  onMessage(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  acquire(): () => void {
    this.refs += 1;
    if (this.refs === 1) this.start();
    return () => {
      this.refs -= 1;
      if (this.refs === 0) this.stop();
    };
  }

  /** What the browser retarget follows in mock mode. Pass null to stop feeding it. */
  setMockInput(provider: MockInputProvider | null): void {
    this.mockInput = provider;
  }

  /** Every glove frame the screen sees, for the lag measurement. */
  noteGloveFrame(frame: GloveFrame): void {
    this.lag.glove(gloveVector(frame), this.opts.now());
  }

  /** Sends one core command and resolves with its ack (rejects on a failed ack, a timeout or no connection). */
  send(name: string, args: Record<string, unknown> = {}): Promise<CoreAck> {
    const ws = this.ws;
    if (this.state.link !== 'core' || !ws || ws.readyState !== 1) return Promise.reject(new Error('The core is not connected.'));
    const id = `robot-${this.nextId++}`;
    const cmd: CoreCommand = { v: 1, type: 'cmd', id, name, args };
    return new Promise<CoreAck>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The core did not answer ${name}.`));
      }, ACK_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(cmd));
    });
  }

  /**
   * Chooses what the robot follows. With the core it sends `set_robot_source` and takes the core's answer; in mock mode
   * the browser retarget switches at once. 'off' always applies locally first, so a released dead-man stops the twin
   * even if the core is slow to answer.
   */
  async setSource(source: RobotSource): Promise<void> {
    if (source === 'off') this.patch({ source: 'off' });
    if (this.state.link !== 'core') {
      this.patch({ source, error: null });
      this.syncMockTimer();
      return;
    }
    try {
      const ack = await this.send('set_robot_source', { source });
      if (!ack.ok) throw new Error(ack.error?.message ?? 'The core refused the source.');
      const got = (ack.result?.source as RobotSource | undefined) ?? source;
      this.patch({ source: got, error: null });
    } catch (e) {
      this.patch({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  private patch(p: Partial<RobotState>): void {
    const next = { ...this.state, ...p };
    if ((Object.keys(p) as (keyof RobotState)[]).every((k) => next[k] === this.state[k])) return;
    this.state = next;
    this.stateListeners.forEach((l) => l());
  }

  private start(): void {
    if (this.opts.mockOnly()) {
      this.patch({ mockOnly: true });
      this.goMock();
      return;
    }
    this.connect();
  }

  private stop(): void {
    this.clearTimers();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      try {
        if (ws.readyState === 1 && this.state.source !== 'off') ws.send(JSON.stringify({ v: 1, type: 'cmd', id: 'robot-release', name: 'set_robot_source', args: { source: 'off' } }));
        ws.close();
      } catch {
        /* already closing */
      }
    }
    this.failPending('The robot stream closed.');
    this.lag.reset();
    this.latest = null;
    this.patch({ link: 'connecting', source: 'off', lagMs: null });
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.openTimer !== null) clearTimeout(this.openTimer);
    if (this.mockTimer !== null) clearInterval(this.mockTimer);
    this.retryTimer = this.openTimer = this.mockTimer = null;
  }

  private failPending(msg: string): void {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(msg));
    });
    this.pending.clear();
  }

  private connect(): void {
    let ws: SocketLike;
    try {
      ws = this.opts.openSocket(robotSocketUrl(this.opts.coreUrl));
    } catch {
      this.goMock();
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      if (ws.readyState !== 1) this.goMock();
    }, OPEN_TIMEOUT_MS);
    ws.onopen = () => {
      if (this.openTimer !== null) clearTimeout(this.openTimer);
      this.openTimer = null;
      this.retry = RETRY_MIN_MS;
      if (this.mockTimer !== null) clearInterval(this.mockTimer);
      this.mockTimer = null;
      this.lag.reset();
      this.latest = null;
      // The core's own source is unknown until its hello arrives; never carry the mock's choice over.
      this.patch({ link: 'core', coreDown: false, source: 'off', described: false, robot: null, error: null, lagMs: null });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: { type?: string } & Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'robot') this.dispatch(msg as unknown as RobotMessage);
      else if (msg.type === 'hello') this.onHello(msg as unknown as RobotHello);
      else if (msg.type === 'ack') {
        const ack = msg as unknown as CoreAck;
        const p = this.pending.get(ack.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(ack.id);
        p.resolve(ack);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.openTimer !== null) clearTimeout(this.openTimer);
      this.openTimer = null;
      this.failPending('The core closed the connection.');
      if (this.refs > 0) {
        this.goMock();
        this.scheduleRetry();
      }
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* closing anyway */
      }
    };
  }

  private onHello(h: RobotHello): void {
    this.patch({
      robot: h.robot ?? null,
      described: true,
      fake: Boolean(h.fake),
      source: h.session?.robot_source ?? 'off',
      roles: h.session?.roles ?? {},
      lessonId: h.session?.lesson_id ?? null,
      mode: h.session?.mode ?? null,
      lessons: Array.isArray(h.lessons)
        ? (h.lessons as { id?: unknown; title?: unknown }[]).filter((l) => typeof l?.id === 'string').map((l) => ({ id: l.id as string, title: typeof l.title === 'string' ? l.title : (l.id as string) }))
        : [],
    });
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || this.refs === 0) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.refs > 0 && !this.ws) this.connect();
    }, this.retry);
    this.retry = Math.min(this.retry * 1.6, RETRY_MAX_MS);
  }

  /** Switches to the browser retarget: loads the URDFs once and describes the robot as the core would. */
  private goMock(): void {
    const wasCore = this.state.link === 'core';
    this.patch({ link: 'mock', coreDown: !this.state.mockOnly, ...(wasCore ? { source: 'off' as RobotSource } : {}) });
    if (this.retargeter) {
      this.patch({ robot: this.retargeter.describe(), described: true, fake: false, roles: {} });
      this.syncMockTimer();
      return;
    }
    this.opts
      .loadModels()
      .then((models) => {
        this.retargeter = new Retargeter(models);
        if (this.state.link === 'mock') {
          this.patch({ robot: this.retargeter.describe(), described: true, fake: false, roles: {} });
          this.syncMockTimer();
        }
      })
      .catch((e: unknown) => this.patch({ described: true, robot: null, error: e instanceof Error ? e.message : String(e) }));
  }

  private syncMockTimer(): void {
    const want = this.state.link === 'mock' && this.state.source !== 'off' && this.refs > 0 && this.retargeter !== null;
    if (want && this.mockTimer === null) this.mockTimer = setInterval(() => this.mockTick(), 1000 / CORE_RATE_HZ);
    else if (!want && this.mockTimer !== null) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }
  }

  /** One tick of the browser retarget, like the core's loop: read the latest hand, retarget, emit. */
  private mockTick(): void {
    const src = this.state.source;
    if (src === 'off' || !this.retargeter || !this.mockInput) return;
    const input = this.mockInput(src);
    if (!input) return;
    const side = input.hand.side;
    const t = this.retargeter.targets(anglesFromHand(input.hand), side);
    this.dispatch(toMessage(t, src, input.from, this.opts.now() * 1000));
  }

  private dispatch(msg: RobotMessage): void {
    const now = this.opts.now();
    this.latest = msg;
    this.lastAt = now;
    this.lag.robot(msg.q, now);
    if (this.lag.value !== null && now - this.lagPublishedAt > LAG_PUBLISH_MS) {
      this.lagPublishedAt = now;
      this.patch({ lagMs: Math.round(this.lag.value) });
    }
    this.listeners.forEach((l) => l(msg));
  }
}

function defaultCoreUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_CORE_URL || 'http://localhost:8765';
}

let shared: RobotStore | null = null;

function store(): RobotStore {
  if (shared) return shared;
  shared = new RobotStore({
    coreUrl: defaultCoreUrl(),
    mockOnly: () => {
      try {
        return new URLSearchParams(window.location.search).get('mock') === '1' || window.localStorage.getItem('apprentice.mock') === '1' || (import.meta.env.VITE_MOCK === '1');
      } catch {
        return window.__apprenticeMock === true;
      }
    },
    openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    loadModels: () => import('../three/robot/model').then((m) => m.loadRobotModels()),
    now: () => performance.now(),
  });
  return shared;
}

export interface RobotStreamHandle extends RobotState {
  /** The latest robot message, updated at stream rate without re-rendering. Read it inside useFrame. */
  latest: MutableRefObject<RobotMessage | null>;
  /** performance.now() of the latest message, for "is the robot still talking". */
  lastAt: () => number;
  onMessage: (cb: Listener) => () => void;
  setSource: (source: RobotSource) => Promise<void>;
  send: (name: string, args?: Record<string, unknown>) => Promise<CoreAck>;
  setMockInput: (provider: MockInputProvider | null) => void;
  noteGloveFrame: (frame: GloveFrame) => void;
}

/** Connects to the core's /ws/robot (shared, reconnecting) while mounted, falling back to the browser retarget. */
export function useRobotStream(enabled = true): RobotStreamHandle {
  const s = store();
  useEffect(() => (enabled ? s.acquire() : undefined), [enabled, s]);
  const state = useSyncExternalStore(s.subscribe, s.getState);
  const latest = useRef<RobotMessage | null>(s.latest);
  useEffect(() => {
    latest.current = s.latest;
    return s.onMessage((m) => {
      latest.current = m;
    });
  }, [s]);
  const onMessage = useCallback((cb: Listener) => s.onMessage(cb), [s]);
  const setSource = useCallback((src: RobotSource) => s.setSource(src), [s]);
  const send = useCallback((name: string, args?: Record<string, unknown>) => s.send(name, args), [s]);
  const setMockInput = useCallback((p: MockInputProvider | null) => s.setMockInput(p), [s]);
  const noteGloveFrame = useCallback((f: GloveFrame) => s.noteGloveFrame(f), [s]);
  const lastAt = useCallback(() => s.lastAt, [s]);
  return { ...state, latest, lastAt, onMessage, setSource, send, setMockInput, noteGloveFrame };
}
