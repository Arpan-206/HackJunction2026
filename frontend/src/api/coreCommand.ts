import { CORE_PORT } from './useRobotStream';

const ACK_TIMEOUT_MS = 3000;

/** VITE_CORE_WS when set, otherwise the glove core on its own port on this page's host (route B). */
export function coreEndpoint(): string {
  const env = import.meta.env.VITE_CORE_WS as string | undefined;
  if (env) return env;
  const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
  return `ws://${host}:${CORE_PORT}/ws`;
}

/** The SPEC.md control frame for one command. */
export function coreCmdFrame(id: string, name: string, args: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, type: 'cmd', id, name, args });
}

/**
 * Sends one command to the glove core's main socket (SPEC.md "Control") over a short-lived connection and resolves with
 * whether it acked ok. Never rejects: with no core (mock mode, the simulator, a table without the engine) it resolves
 * false, so a caller can fire it beside its own work.
 */
export function coreCommand(name: string, args: Record<string, unknown> = {}): Promise<boolean> {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined' || window.__apprenticeMock === true) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const id = `app-${name}-${Date.now()}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(coreEndpoint());
    } catch {
      resolve(false);
      return;
    }
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(ok);
    };
    const timer = window.setTimeout(() => done(false), ACK_TIMEOUT_MS);
    ws.onopen = () => ws.send(coreCmdFrame(id, name, args));
    ws.onerror = () => done(false);
    ws.onclose = () => done(false);
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const m = JSON.parse(ev.data) as { type?: string; id?: string; ok?: boolean };
        if (m.type === 'ack' && m.id === id) done(m.ok === true);
      } catch {
        /* not ours */
      }
    };
  });
}

/**
 * The core's `calibrate`: the wrist yaw over the next second becomes heading zero, so a hand held flat with its fingers
 * at the screen draws with its fingers into the scene. The glove's own heading starts at an arbitrary angle each
 * session (SPEC.md), so without this the live hand can point anywhere.
 */
export function calibrateCoreHeading(): Promise<boolean> {
  return coreCommand('calibrate');
}
