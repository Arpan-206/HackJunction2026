import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import type { GloveFrame, MotionSpec, SetMotionMessage } from './types';

export type GloveStatus = 'connecting' | 'open' | 'closed';
export type FrameListener = (frame: GloveFrame) => void;

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;

/**
 * Process-wide singleton around the /ws/gloves socket. Components share one connection (reference counted),
 * frames are stored in a plain object and pushed to listeners, so React never re-renders at 60 Hz.
 */
class GloveStore {
  latest: GloveFrame | null = null;
  status: GloveStatus = 'closed';
  private ws: WebSocket | null = null;
  private refs = 0;
  private retry = RECONNECT_MIN_MS;
  private timer: number | null = null;
  private listeners = new Set<FrameListener>();
  private statusListeners = new Set<() => void>();
  private pendingMotion: MotionSpec | null = null;

  subscribeStatus = (cb: () => void): (() => void) => {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  };

  getStatus = (): GloveStatus => this.status;

  onFrame(cb: FrameListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  acquire(): () => void {
    this.refs += 1;
    if (this.refs === 1) this.connect();
    return () => {
      this.refs -= 1;
      if (this.refs === 0) this.disconnect();
    };
  }

  sendMotion(motion: MotionSpec): void {
    const msg: SetMotionMessage = { type: 'set_motion', motion };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.pendingMotion = motion;
  }

  private setStatus(s: GloveStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((l) => l());
  }

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws/gloves`;
  }

  private connect() {
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = RECONNECT_MIN_MS;
      this.setStatus('open');
      if (this.pendingMotion) {
        this.sendMotion(this.pendingMotion);
        this.pendingMotion = null;
      }
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let frame: GloveFrame;
      try {
        frame = JSON.parse(ev.data) as GloveFrame;
      } catch {
        return;
      }
      if (!frame || !Array.isArray(frame.hands)) return;
      this.latest = frame;
      this.listeners.forEach((l) => l(frame));
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.refs > 0) {
        this.setStatus('connecting');
        this.scheduleReconnect();
      } else this.setStatus('closed');
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.refs > 0) this.connect();
    }, this.retry);
    this.retry = Math.min(this.retry * 1.6, RECONNECT_MAX_MS);
  }

  private disconnect() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('closed');
  }
}

const store = new GloveStore();

export interface GloveStreamHandle {
  status: GloveStatus;
  /** Latest frame, updated at stream rate without re-rendering. Read it inside useFrame or event handlers. */
  latest: MutableRefObject<GloveFrame | null>;
  /** Subscribe to every frame. Returns the unsubscribe function. Does not trigger React renders. */
  onFrame: (cb: FrameListener) => () => void;
  /** Ask the simulator to play a motion (ignored by real gloves). */
  setMotion: (motion: MotionSpec) => void;
}

/**
 * Connects to /ws/gloves (shared, auto-reconnecting) while the component is mounted.
 * Only `status` causes re-renders; frames are exposed through `latest` and `onFrame`.
 */
export function useGloveStream(enabled = true): GloveStreamHandle {
  useEffect(() => (enabled ? store.acquire() : undefined), [enabled]);
  const status = useSyncExternalStore(store.subscribeStatus, store.getStatus);

  const latest = useRef<GloveFrame | null>(null);
  useEffect(() => {
    latest.current = store.latest;
    return store.onFrame((f) => {
      latest.current = f;
    });
  }, []);

  const onFrame = useCallback((cb: FrameListener) => store.onFrame(cb), []);
  const setMotion = useCallback((m: MotionSpec) => store.sendMotion(m), []);
  // One handle per status: effects that depend on the handle (set_motion, onFrame subscriptions) run when the status
  // changes, not on every render of a screen that re-renders at 10 to 17 Hz.
  const shown: GloveStatus = enabled ? status : 'closed';
  return useMemo(() => ({ status: shown, latest, onFrame, setMotion }), [shown, onFrame, setMotion]);
}
