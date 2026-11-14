import { coreSessionEndpoint } from '../../../api/useCoreSession';
import { isKiosk } from '../kiosk';

/**
 * Is the glove engine (the core) playing a recording? The answer comes from a channel that already exists: the core's
 * own `/ws/gloves` stream (core/compat.py `glove_frame`) sets `source: "replay"` on every frame while the core runs
 * `python -m core --replay ...` (scripts/replay_demo.sh). No setting, kiosk flag or dev panel switch changes it.
 *
 * Note: the backend's `/ws/gloves` also says "replay" for every bridged frame, live gloves included (CONTRACT.md
 * `/ws/ingest`), so only the core's own stream is read here.
 *
 * The core socket is opened only where the core feeds the screen, so a laptop with no core logs no connection errors:
 * when the backend reports `glove_source: "external"` (route B, the core's hands bridged in), on the core screens
 * (/demo, /robot, /typing), and always in the kiosk.
 */

/** A recording is "on" for this long after the last replay frame; the core sends frames at 30 Hz. */
export const REPLAY_HOLD_MS = 2500;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 10000;
const HEALTH_POLL_MS = 5000;
const CORE_ROUTES = ['/demo', '/robot', '/typing'];

/** `ws://host:8765/ws` (or VITE_CORE_WS) becomes `ws://host:8765/ws/gloves`. */
export function coreGlovesEndpoint(sessionUrl: string = coreSessionEndpoint()): string {
  return sessionUrl.replace(/\/ws(\?.*)?$/, '/ws/gloves$1');
}

const SOURCE_RE = /"source"\s*:\s*"([a-z_]+)"/;

/** The GloveFrame `source` of one raw message, or null. Reads the field without parsing the 30 Hz frame. */
export function frameSource(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = SOURCE_RE.exec(raw);
  return m ? m[1] : null;
}

/** Whether the core is the hands' source for this page, so its socket is worth opening. */
export function coreFeedsPage(backendGloveSource: string | null, pathname: string, kiosk: boolean): boolean {
  if (kiosk) return true;
  if (backendGloveSource === 'external') return true;
  return CORE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

type Listener = () => void;

/** Process-wide watcher. `replay` is true while replay frames keep arriving; it falls back to false REPLAY_HOLD_MS after. */
class ReplayWatch {
  replay = false;
  private listeners = new Set<Listener>();
  private refs = 0;
  private ws: WebSocket | null = null;
  private retryTimer: number | null = null;
  private holdTimer: number | null = null;
  private healthTimer: number | null = null;
  private retry = RETRY_MIN_MS;
  private backendSource: string | null = null;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    this.acquire();
    return () => {
      this.listeners.delete(cb);
      this.release();
    };
  };

  getSnapshot = (): boolean => this.replay;

  /** Feed one raw core message (exported for tests). */
  onMessage(raw: unknown): void {
    const src = frameSource(raw);
    if (src === null) return;
    if (src === 'replay') {
      this.set(true);
      if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
      this.holdTimer = window.setTimeout(() => this.set(false), REPLAY_HOLD_MS);
    } else {
      this.set(false);
    }
  }

  private set(v: boolean): void {
    if (v === this.replay) return;
    this.replay = v;
    this.listeners.forEach((l) => l());
  }

  private acquire(): void {
    this.refs += 1;
    if (this.refs > 1) return;
    void this.checkHealth();
    this.healthTimer = window.setInterval(() => void this.checkHealth(), HEALTH_POLL_MS);
  }

  private release(): void {
    this.refs -= 1;
    if (this.refs > 0) return;
    if (this.healthTimer !== null) window.clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.close();
  }

  private async checkHealth(): Promise<void> {
    try {
      const res = await fetch('/api/health');
      const body = res.ok ? ((await res.json()) as { glove_source?: string }) : null;
      this.backendSource = typeof body?.glove_source === 'string' ? body.glove_source : null;
    } catch {
      this.backendSource = null;
    }
    this.reconsider();
  }

  /** Open the core socket when the core feeds this page; never close it because of a route change once replay is seen. */
  reconsider = (): void => {
    if (this.refs === 0 || typeof location === 'undefined' || typeof WebSocket === 'undefined') return;
    const want = this.replay || coreFeedsPage(this.backendSource, location.pathname, isKiosk());
    if (want && !this.ws && this.retryTimer === null) this.open();
  };

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(coreGlovesEndpoint());
    } catch {
      this.schedule();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = RETRY_MIN_MS;
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.schedule();
    };
  }

  private schedule(): void {
    if (this.refs === 0 || this.retryTimer !== null) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.reconsider();
    }, this.retry);
    this.retry = Math.min(this.retry * 2, RETRY_MAX_MS);
  }

  private close(): void {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }
}

export const replayWatch = new ReplayWatch();
