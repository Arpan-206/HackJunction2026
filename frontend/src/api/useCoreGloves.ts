import { useEffect, useRef, type RefObject } from 'react';
import type { GloveFrame } from './types';

const RETRY_MS = 1000;

/** The core's GloveFrame socket beside its robot socket: `ws://host:8765/ws/robot` gives `ws://host:8765/ws/gloves`. */
export function coreGlovesUrl(robotUrl: string): string | null {
  return /\/ws\/robot(\?.*)?$/.test(robotUrl) ? robotUrl.replace(/\/ws\/robot(\?.*)?$/, '/ws/gloves') : null;
}

/** A GloveFrame, or null for anything else. */
export function parseGloveFrame(raw: string): GloveFrame | null {
  try {
    const m = JSON.parse(raw) as Partial<GloveFrame>;
    return m && Array.isArray(m.hands) && typeof m.t === 'number' ? (m as GloveFrame) : null;
  } catch {
    return null;
  }
}

/**
 * The live hands from the same core that drives the robot, read from its `/ws/gloves` (core/compat.py, the CONTRACT
 * GloveFrame shape). The robot twin draws its human hand from here, so the hand and the robot always come from one
 * engine, with or without the backend on port 8000. Frames land in a ref; nothing re-renders. Pass null to stay closed.
 */
export function useCoreGloves(robotUrl: string | null): RefObject<GloveFrame | null> {
  const latest = useRef<GloveFrame | null>(null);
  const url = robotUrl ? coreGlovesUrl(robotUrl) : null;
  useEffect(() => {
    if (!url) return;
    let ws: WebSocket | null = null;
    let timer: number | null = null;
    let alive = true;
    const open = () => {
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        const f = parseGloveFrame(ev.data);
        if (f) latest.current = f;
      };
      ws.onerror = () => ws?.close();
      ws.onclose = () => {
        latest.current = null;
        if (alive) timer = window.setTimeout(open, RETRY_MS);
      };
    };
    open();
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      latest.current = null;
    };
  }, [url]);
  return latest;
}
