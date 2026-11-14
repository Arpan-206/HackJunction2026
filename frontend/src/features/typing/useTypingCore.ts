import { useCallback, useEffect, useRef, useState } from 'react';
import type { FingerVerdict } from './typingRun';

/**
 * Socket to the core's main `/ws` (SPEC.md) for the typing task. On hello it switches the core to the `typing` task
 * (with `simulate` when the core runs `--fake`, so the screen works without gloves), sends each keydown as the
 * `keystroke` command and hands every `keystroke` event to the listener. On unmount it puts the core back on the
 * task it had before. Endpoints tried: VITE_CORE_WS, then ws://<page host>:8765/ws.
 */

export type CoreStatus = 'connecting' | 'open' | 'closed';

export interface TypingCoreState {
  status: CoreStatus;
  /** The core accepted the typing task. */
  ready: boolean;
  /** The core runs `--fake` and simulates the presses. */
  simulated: boolean;
  error: string | null;
}

const CORE_PORT = 8765;
const RECONNECT_MS = 2000;

export function coreEndpoint(): string {
  const env = import.meta.env.VITE_CORE_WS as string | undefined;
  if (env) return env;
  const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
  return `ws://${host}:${CORE_PORT}/ws`;
}

interface Incoming {
  type?: string;
  id?: string;
  ok?: boolean;
  name?: string;
  fake?: boolean;
  session?: { task?: string };
  data?: unknown;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

export function useTypingCore(onVerdict: (v: FingerVerdict) => void) {
  const [state, setState] = useState<TypingCoreState>({ status: 'connecting', ready: false, simulated: false, error: null });
  const ws = useRef<WebSocket | null>(null);
  const seq = useRef(0);
  const acks = useRef(new Map<string, (r: Incoming) => void>());
  const prevTask = useRef<string | null>(null);
  const listener = useRef(onVerdict);
  listener.current = onVerdict;

  const send = useCallback((name: string, args?: Record<string, unknown>): Promise<Incoming> => {
    const s = ws.current;
    if (!s || s.readyState !== WebSocket.OPEN) return Promise.reject(new Error('The glove engine is not connected.'));
    const id = `t${++seq.current}`;
    return new Promise((resolve) => {
      acks.current.set(id, resolve);
      s.send(JSON.stringify({ v: 1, type: 'cmd', id, name, ...(args ? { args } : {}) }));
    });
  }, []);

  useEffect(() => {
    let closed = false;
    let timer: number | null = null;
    const connect = () => {
      let s: WebSocket;
      try {
        s = new WebSocket(coreEndpoint());
      } catch {
        setState((p) => ({ ...p, status: 'closed' }));
        return;
      }
      ws.current = s;
      setState((p) => ({ ...p, status: 'connecting' }));
      s.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let m: Incoming;
        try {
          m = JSON.parse(ev.data) as Incoming;
        } catch {
          return;
        }
        if (m.type === 'hello') {
          const fake = m.fake === true;
          if (prevTask.current === null) prevTask.current = m.session?.task ?? null;
          setState((p) => ({ ...p, status: 'open', simulated: fake }));
          void send('subscribe', { rate_hz: 15 });
          void send('set_task', { task: 'typing', config: fake ? { simulate: true } : {} }).then((r) =>
            setState((p) => ({ ...p, ready: r.ok === true, error: r.ok ? null : (r.error?.message ?? 'The glove engine has no typing task.') })),
          );
          return;
        }
        if (m.type === 'ack' && m.id) {
          const cb = acks.current.get(m.id);
          acks.current.delete(m.id);
          cb?.(m);
          return;
        }
        if (m.type === 'event' && m.name === 'keystroke' && m.data && typeof m.data === 'object') listener.current(m.data as FingerVerdict);
      };
      s.onclose = () => {
        ws.current = null;
        acks.current.clear();
        setState((p) => ({ ...p, status: 'closed', ready: false }));
        if (!closed) timer = window.setTimeout(connect, RECONNECT_MS);
      };
      s.onerror = () => s.close();
    };
    connect();
    return () => {
      closed = true;
      if (timer !== null) window.clearTimeout(timer);
      const s = ws.current;
      if (s) {
        s.onclose = null;
        const prev = prevTask.current;
        if (s.readyState === WebSocket.OPEN && prev && prev !== 'typing') {
          s.send(JSON.stringify({ v: 1, type: 'cmd', id: 'restore', name: 'set_task', args: { task: prev } }));
        }
        s.close();
      }
      ws.current = null;
    };
  }, [send]);

  /** Sends one keydown. Resolves with the core's keystroke id, or null when the core refused or is away. */
  const keystroke = useCallback(
    async (key: string): Promise<number | null> => {
      try {
        const r = await send('keystroke', { key });
        return r.ok && typeof r.result?.id === 'number' ? r.result.id : null;
      } catch {
        return null;
      }
    },
    [send],
  );

  const resetTally = useCallback(() => send('typing_reset').catch(() => null), [send]);

  return { ...state, keystroke, resetTally };
}
