/**
 * The cache and the queue behind the still hand pictures (see HandStill). Pure logic with no three.js or DOM in it,
 * so it is unit tested (tests/stillQueue.test.ts): the renderer is passed in.
 */

export interface StillKeyParts {
  /** Names the scene content: the pose, side and hand style, built by the caller. */
  id: string;
  /** Camera preset name. */
  preset: string;
  /** Bench and wall on or off. */
  decor: boolean;
  /** Stage colours of the active theme, so a theme change draws a fresh picture. */
  colors: unknown;
  /** Size in CSS pixels. */
  width: number;
  height: number;
  /** Device pixel ratio the picture is drawn at. */
  dpr: number;
}

/** Everything that changes the pixels goes into the key; two stills with the same key are the same picture. */
export function stillKey(p: StillKeyParts): string {
  return [p.id, p.preset, p.decor ? 'decor' : 'plain', JSON.stringify(p.colors), `${Math.round(p.width)}x${Math.round(p.height)}`, `@${p.dpr}`].join('|');
}

/** Device pixel ratio the stills are drawn at: the screen's, clamped to 1..2 so a picture never gets huge. */
export function stillDpr(devicePixelRatio: number): number {
  const d = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(2, Math.max(1, Math.round(d * 4) / 4));
}

export interface StillRequest<T> {
  /** Resolves with the picture, or null when it could not be drawn or the request was cancelled. */
  promise: Promise<T | null>;
  /** Drops interest. A job nobody wants any more is skipped if it has not started. */
  cancel: () => void;
}

interface Entry<T> {
  run: () => Promise<T | null>;
  wanted: number;
  started: boolean;
  waiters: ((v: T | null) => void)[];
}

export interface StillQueue<T> {
  /** Cached picture for a key, if one has been drawn. */
  get: (key: string) => T | undefined;
  /** Asks for a picture. Cached keys resolve at once; the same key requested twice is drawn once. */
  request: (key: string, run: () => Promise<T | null>) => StillRequest<T>;
  /** Number of jobs waiting or running. */
  pending: () => number;
  /** Forgets every cached picture, handing each to `onEvict` (to revoke object URLs). */
  clear: () => void;
}

/**
 * Draws one picture at a time, in the order asked, and yields to the page between jobs (`yieldToPage`, a macrotask by
 * default) so a screenful of cards never blocks scrolling. Results are cached by key; a failed job (null) is not cached.
 */
export function createStillQueue<T>(opts: { yieldToPage?: () => Promise<void>; onEvict?: (value: T) => void } = {}): StillQueue<T> {
  const yieldToPage = opts.yieldToPage ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const cache = new Map<string, T>();
  const entries = new Map<string, Entry<T>>();
  const order: string[] = [];
  let running = false;

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (order.length) {
        const key = order.shift() as string;
        const e = entries.get(key);
        if (!e) continue;
        if (e.wanted <= 0) {
          entries.delete(key);
          continue;
        }
        e.started = true;
        let value: T | null = null;
        try {
          value = await e.run();
        } catch {
          value = null;
        }
        if (value !== null) cache.set(key, value);
        entries.delete(key);
        for (const w of e.waiters) w(value);
        await yieldToPage();
      }
    } finally {
      running = false;
    }
  }

  return {
    get: (key) => cache.get(key),
    pending: () => entries.size,
    clear: () => {
      if (opts.onEvict) for (const v of cache.values()) opts.onEvict(v);
      cache.clear();
    },
    request: (key, run) => {
      const hit = cache.get(key);
      if (hit !== undefined) return { promise: Promise.resolve(hit), cancel: () => {} };
      let e = entries.get(key);
      if (!e) {
        e = { run, wanted: 0, started: false, waiters: [] };
        entries.set(key, e);
        order.push(key);
      }
      const entry = e;
      entry.wanted += 1;
      let cancelled = false;
      const promise = new Promise<T | null>((resolve) => {
        entry.waiters.push((v) => resolve(cancelled ? null : v));
      });
      void pump();
      return {
        promise,
        cancel: () => {
          if (cancelled) return;
          cancelled = true;
          entry.wanted -= 1;
          if (entry.wanted <= 0 && !entry.started) {
            entries.delete(key);
            const i = order.indexOf(key);
            if (i >= 0) order.splice(i, 1);
            for (const w of entry.waiters) w(null);
          }
        },
      };
    },
  };
}
