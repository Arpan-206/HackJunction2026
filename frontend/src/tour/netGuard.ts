/**
 * The public tour's network guard. The tour runs entirely in the browser from bundled files: every request must stay
 * on the page's own origin. This module wraps fetch, XMLHttpRequest, WebSocket, EventSource and sendBeacon so that any
 * other destination throws before a byte leaves the page, and it rewrites the app's root-absolute asset paths
 * ("/models/...", "/textures/...") onto the tour's base path, because a GitHub Pages project site serves under /<repo>/.
 */

export class TourNetworkError extends Error {}

/** Whether a URL may be requested by the tour: same origin, or an in-page data: or blob: URL. */
export function allowedUrl(url: string, pageHref: string): boolean {
  let u: URL;
  try {
    u = new URL(url, pageHref);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
  return u.origin === new URL(pageHref).origin;
}

/** Puts a root-absolute path ("/models/x") under the base ("/repo/"); other URLs pass through unchanged. */
export function underBase(url: string, base: string): string {
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  const b = base.endsWith('/') ? base : `${base}/`;
  if (b === '/' || url.startsWith(b)) return url;
  return b + url.slice(1);
}

/** The base path the tour is served under, as an absolute path ("/HackJunction2026/" on Pages, "/" locally). */
export function basePath(): string {
  const raw = import.meta.env.BASE_URL || '/';
  // A relative base ("./") resolves against the page, which always sits at the base.
  return new URL(raw, window.location.href).pathname;
}

function block(kind: string, url: string): never {
  throw new TourNetworkError(`The tour makes no calls out: ${kind} to ${url} was blocked.`);
}

let installed = false;

/** Installs the guard once, before anything else runs. */
export function installNetGuard(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const base = basePath();
  const href = () => window.location.href;
  const fix = (url: string) => underBase(url, base);

  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = fix(raw);
    if (!allowedUrl(url, href())) return Promise.reject(new TourNetworkError(`The tour makes no calls out: fetch to ${raw} was blocked.`));
    return realFetch(typeof input === 'string' || input instanceof URL ? url : new Request(url, input), init);
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const fixed = fix(String(url));
    if (!allowedUrl(fixed, href())) block('a request', String(url));
    return (open as (...a: unknown[]) => void).call(this, method, fixed, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  // The tour has no sockets, no event streams and no beacons at all.
  const Socket = function (url: string | URL) {
    block('a WebSocket', String(url));
  } as unknown as typeof WebSocket;
  window.WebSocket = Socket;
  if ('EventSource' in window) {
    window.EventSource = function (url: string | URL) {
      block('an event stream', String(url));
    } as unknown as typeof EventSource;
  }
  if (navigator.sendBeacon) navigator.sendBeacon = (url: string | URL) => block('a beacon', String(url));
}
