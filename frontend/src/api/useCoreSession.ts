import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Finger, Side } from './types';
import { CORE_PORT } from './useRobotStream';

/**
 * The core's main socket, `ws://<host>:8765/ws` (SPEC.md "Output: the viewer WebSocket"), for the demo kiosk: the
 * lesson list from `hello`, the `session`, the live `frame.score` (the one displayed score, RECONCILE.md section 0),
 * step events, and commands with one ack each. Only the fields the kiosk reads are typed; the rest is ignored, as the
 * spec asks of every viewer. Frames land in a ref at 30 Hz; nothing re-renders per frame.
 */

export type CoreStatus = 'connecting' | 'open' | 'closed';

export interface CoreLessonSummary {
  id: string;
  title: string;
  task: string;
  steps_total: number;
  source?: string;
}

export interface CoreSessionState {
  mode: string;
  task: string;
  lesson_id: string | null;
  step: number | null;
  steps_total: number;
  calibrated?: boolean;
  robot_source?: string;
}

export type CoreHint = 'too_flat' | 'too_curled' | 'too_spread' | 'too_closed';

/** `frame.score`: every value runs 0 to 1. */
export interface CoreScore {
  hand: Side;
  overall: number;
  fingers: Record<Finger, number>;
  err_deg?: Record<Finger, number>;
  worst: Finger | null;
  hint: CoreHint | null;
  step_progress?: number;
  passed?: boolean;
}

export interface CoreEvent {
  name: string;
  hand: Side | null;
  data: Record<string, unknown>;
}

export interface CoreLesson {
  id: string;
  title: string;
  steps: { name: string; key_angles: number[] | null }[];
}

export interface CoreAck {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

export interface CoreState {
  status: CoreStatus;
  /** The core runs `--fake` (synthetic gloves). */
  fake: boolean;
  lessons: CoreLessonSummary[];
  session: CoreSessionState | null;
  /** The loaded lesson from the `lesson` message: title, step names and each step's key pose (18 angles, degrees). */
  lesson: CoreLesson | null;
}

export interface CoreSessionHandle extends CoreState {
  /** Latest `frame.score` (null outside learn, mirror and duel), updated at frame rate. */
  score: MutableRefObject<CoreScore | null>;
  /** Sends one command; resolves with its ack, rejects when the socket is down or the ack never comes. */
  command: (name: string, args?: Record<string, unknown>) => Promise<CoreAck>;
  /** Subscribe to `event` messages (step_passed, lesson_complete, ...). Returns the unsubscribe function. */
  onEvent: (cb: (e: CoreEvent) => void) => () => void;
}

const RECONNECT_MS = 2000;
const ACK_TIMEOUT_MS = 3000;

/** VITE_CORE_WS when set, otherwise the core on its own port on this page's host (route B). */
export function coreSessionEndpoint(): string {
  const env = import.meta.env.VITE_CORE_WS as string | undefined;
  if (env) return env;
  const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
  return `ws://${host}:${CORE_PORT}/ws`;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Reads the lesson summaries out of a hello, skipping anything malformed. */
export function parseLessons(v: unknown): CoreLessonSummary[] {
  if (!Array.isArray(v)) return [];
  return v.filter((l): l is CoreLessonSummary => isObj(l) && typeof l.id === 'string' && typeof l.title === 'string' && !l.title.startsWith('(unreadable'));
}

/** The parts of a core `lesson` the kiosk shows. */
export function parseLesson(l: Record<string, unknown>): CoreLesson {
  const id = String(l.id);
  const steps = Array.isArray(l.steps)
    ? l.steps.map((st, i) => ({
        name: isObj(st) && typeof st.name === 'string' ? st.name : `Step ${i + 1}`,
        key_angles: isObj(st) && Array.isArray(st.key_angles) && st.key_angles.every((a) => typeof a === 'number') ? (st.key_angles as number[]) : null,
      }))
    : [];
  return { id, title: typeof l.title === 'string' ? l.title : id, steps };
}

const CLOSED: CoreState = { status: 'closed', fake: false, lessons: [], session: null, lesson: null };

/** Connects while `enabled`; reconnects every 2 s when the core is away. */
export function useCoreSession(enabled = true): CoreSessionHandle {
  const [state, setState] = useState<CoreState>({ ...CLOSED, status: enabled ? 'connecting' : 'closed' });
  const score = useRef<CoreScore | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const seq = useRef(0);
  const acks = useRef(new Map<string, { resolve: (a: CoreAck) => void; timer: number }>());
  const listeners = useRef(new Set<(e: CoreEvent) => void>());

  const command = useCallback((name: string, args?: Record<string, unknown>): Promise<CoreAck> => {
    const s = ws.current;
    if (!s || s.readyState !== WebSocket.OPEN) return Promise.reject(new Error('The glove engine is not connected.'));
    const id = `k${++seq.current}`;
    return new Promise<CoreAck>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        acks.current.delete(id);
        reject(new Error(`The glove engine did not answer ${name}.`));
      }, ACK_TIMEOUT_MS);
      acks.current.set(id, { resolve, timer });
      s.send(JSON.stringify({ v: 1, type: 'cmd', id, name, ...(args ? { args } : {}) }));
    });
  }, []);

  const onEvent = useCallback((cb: (e: CoreEvent) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: number | null = null;
    const pending = acks.current;
    const connect = () => {
      let s: WebSocket;
      try {
        s = new WebSocket(coreSessionEndpoint());
      } catch {
        setState((p) => ({ ...p, status: 'closed' }));
        return;
      }
      ws.current = s;
      s.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(ev.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (!isObj(m)) return;
        switch (m.type) {
          case 'frame':
            score.current = isObj(m.score) ? (m.score as unknown as CoreScore) : null;
            return;
          case 'hello':
            setState((p) => ({
              ...p,
              status: 'open',
              fake: m.fake === true,
              lessons: parseLessons(m.lessons),
              session: isObj(m.session) ? (m.session as unknown as CoreSessionState) : p.session,
            }));
            return;
          case 'session':
            setState((p) => ({ ...p, session: m as unknown as CoreSessionState }));
            return;
          case 'lesson': {
            const l = m.lesson;
            if (!isObj(l) || typeof l.id !== 'string') return;
            setState((p) => ({ ...p, lesson: parseLesson(l) }));
            return;
          }
          case 'event':
            if (typeof m.name === 'string') {
              const e: CoreEvent = { name: m.name, hand: (m.hand as Side | null) ?? null, data: isObj(m.data) ? m.data : {} };
              for (const cb of listeners.current) cb(e);
            }
            return;
          case 'ack': {
            const id = typeof m.id === 'string' ? m.id : '';
            const p = pending.get(id);
            if (!p) return;
            pending.delete(id);
            window.clearTimeout(p.timer);
            p.resolve({ ok: m.ok === true, result: isObj(m.result) ? m.result : undefined, error: isObj(m.error) ? (m.error as CoreAck['error']) : undefined });
            return;
          }
          default:
        }
      };
      s.onerror = () => s.close();
      s.onclose = () => {
        ws.current = null;
        score.current = null;
        setState((p) => ({ ...p, status: 'closed' }));
        if (alive) timer = window.setTimeout(connect, RECONNECT_MS);
      };
    };
    setState((p) => ({ ...p, status: 'connecting' }));
    connect();
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
      const s = ws.current;
      if (s) {
        s.onclose = null;
        s.close();
      }
      ws.current = null;
      for (const p of pending.values()) window.clearTimeout(p.timer);
      pending.clear();
    };
  }, [enabled]);

  return { ...(enabled ? state : CLOSED), score, command, onEvent };
}
