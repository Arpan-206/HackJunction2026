import { isGloveSocketUrl, MockGloveSocket } from './glove';
import { isRobotSocketUrl, MockRobotSocket } from './robot';
import { handleMockRequest, type MockRequest } from './router';

/**
 * Transport-layer interception for mock mode. fetch, XMLHttpRequest and WebSocket are patched so requests to
 * `/api/*` and the `/ws/gloves` and `/ws/robot` sockets are answered in the browser; everything else (fonts, Vite HMR,
 * assets) passes through untouched. No feature code needs to know.
 */

const STORAGE_KEY = 'apprentice.mock';
const API_PREFIX = '/api';
const LATENCY_MS = 25;

declare global {
  interface Window {
    __apprenticeMock?: boolean;
    /** Set when mock mode was asked for (?mock=1 or VITE_MOCK=1), not just fallen back to: then nothing reaches a real engine. */
    __apprenticeMockExplicit?: boolean;
  }
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Returns the path below /api when the URL targets this origin's API, otherwise null. */
function apiPath(input: string | URL): { path: string; query: URLSearchParams } | null {
  let url: URL;
  try {
    url = new URL(String(input), window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.pathname !== API_PREFIX && !url.pathname.startsWith(`${API_PREFIX}/`)) return null;
  return { path: url.pathname.slice(API_PREFIX.length) || '/', query: url.searchParams };
}

function parseBody(body: unknown): Pick<MockRequest, 'json' | 'form'> {
  if (body === undefined || body === null) return {};
  if (body instanceof FormData) return { form: body };
  if (typeof body === 'string' && body) {
    try {
      return { json: JSON.parse(body) };
    } catch {
      return { json: body };
    }
  }
  return {};
}

function patchFetch(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input.url : input;
    const target = apiPath(raw);
    if (!target) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let body: unknown = init?.body;
    if (body === undefined && input instanceof Request) body = await input.clone().text();
    const parsed = parseBody(body);
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await wait(LATENCY_MS);
    const res = await handleMockRequest({ method, path: target.path, query: target.query, ...parsed });
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return new Response(res.status === 204 ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'X-Apprentice-Mock': '1' },
    });
  };
}

interface MockedXhr extends XMLHttpRequest {
  __mock?: { method: string; path: string; query: URLSearchParams };
}

/** The upload helper uses XMLHttpRequest for progress, so it needs the same treatment as fetch. */
function patchXhr(): void {
  const proto = XMLHttpRequest.prototype;
  const realOpen = proto.open;
  const realSend = proto.send;
  const realAbort = proto.abort;
  proto.open = function (this: MockedXhr, method: string, url: string | URL, ...rest: unknown[]) {
    const target = apiPath(url);
    this.__mock = target ? { method: method.toUpperCase(), ...target } : undefined;
    // Open a real request regardless, so every property the caller sets keeps working; send() is what we intercept.
    return (realOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;
  proto.abort = function (this: MockedXhr) {
    if (this.__mock) {
      (this as MockedXhrState).__aborted = true;
      this.onabort?.(new ProgressEvent('abort'));
      return;
    }
    realAbort.call(this);
  };
  proto.send = function (this: MockedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    if (!this.__mock) return realSend.call(this, body);
    void runMockXhr(this, this.__mock, body);
  };
}

type MockedXhrState = MockedXhr & { __aborted?: boolean };

/** Plays one intercepted XMLHttpRequest: fake upload progress, then the response, then the load events. */
async function runMockXhr(xhr: MockedXhrState, mock: NonNullable<MockedXhr['__mock']>, body: unknown): Promise<void> {
  const total = body instanceof FormData ? [...body.values()].reduce((n: number, v) => n + (v instanceof File ? v.size : String(v).length), 0) : 0;
  const steps = total ? 5 : 0;
  for (let i = 1; i <= steps; i++) {
    await wait(60);
    if (xhr.__aborted) return;
    (xhr.upload.onprogress as ((ev: ProgressEvent) => void) | null)?.(new ProgressEvent('progress', { lengthComputable: true, loaded: Math.round((total * i) / steps), total }));
  }
  const res = await handleMockRequest({ method: mock.method, path: mock.path, query: mock.query, ...parseBody(body) });
  if (xhr.__aborted) return;
  const text = JSON.stringify(res.body);
  Object.defineProperties(xhr, {
    status: { configurable: true, value: res.status },
    statusText: { configurable: true, value: '' },
    readyState: { configurable: true, value: 4 },
    responseText: { configurable: true, value: text },
    response: { configurable: true, value: text },
    responseURL: { configurable: true, value: window.location.origin + API_PREFIX + mock.path },
  });
  xhr.onreadystatechange?.(new Event('readystatechange'));
  xhr.onload?.(new ProgressEvent('load'));
  xhr.onloadend?.(new ProgressEvent('loadend'));
}

function patchWebSocket(): void {
  const RealWebSocket = window.WebSocket;
  function PatchedWebSocket(url: string | URL, protocols?: string | string[]) {
    if (isGloveSocketUrl(url)) return new MockGloveSocket(url) as unknown as WebSocket;
    // Only this origin's /ws/robot is mocked; a direct core endpoint on port 8765 still reaches a real engine.
    if (isRobotSocketUrl(url)) return new MockRobotSocket(url) as unknown as WebSocket;
    return new RealWebSocket(url, protocols);
  }
  PatchedWebSocket.prototype = RealWebSocket.prototype;
  Object.assign(PatchedWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = PatchedWebSocket as unknown as typeof WebSocket;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** `?mock=1` turns mock mode on (and remembers it), `?mock=0` turns it off again; VITE_MOCK=1 forces it on. */
export function mockRequestedExplicitly(): boolean {
  if (import.meta.env.VITE_MOCK === '1') return true;
  const flag = new URLSearchParams(window.location.search).get('mock');
  try {
    if (flag === '1') storage()?.setItem(STORAGE_KEY, '1');
    else if (flag === '0') storage()?.removeItem(STORAGE_KEY);
    else return storage()?.getItem(STORAGE_KEY) === '1';
  } catch {
    /* storage unavailable: the flag still applies to this page load */
  }
  return flag === '1';
}

/** True when `?mock=0` was passed, which beats VITE_MOCK so a static mock build can still be pointed at a real backend. */
function mockForcedOff(): boolean {
  return new URLSearchParams(window.location.search).get('mock') === '0';
}

/** Whether the real backend answers /api/health within the timeout. */
async function backendReachable(timeoutMs = 1500): Promise<boolean> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_PREFIX}/health`, { signal: ctl.signal });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') ?? '';
    // A static host that rewrites unknown paths to index.html answers 200 with HTML; that is not a backend.
    return ct.includes('json');
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

let installed = false;

/** Patches the transports. Safe to call twice. */
export function installMock(reason: string): void {
  if (installed) return;
  installed = true;
  patchFetch();
  patchXhr();
  patchWebSocket();
  window.__apprenticeMock = true;
  console.info(`[apprentice] Mock mode is on (${reason}). The Python backend is not used; data lives in this browser. Add ?mock=0 to leave it.`);
}

/**
 * Decides whether to install the mock before the app renders. Explicit requests win; otherwise the real backend is
 * probed once and the mock is installed automatically when it is unreachable.
 */
export async function maybeInstallMock(): Promise<boolean> {
  if (mockForcedOff()) {
    try {
      storage()?.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    return false;
  }
  if (mockRequestedExplicitly()) {
    window.__apprenticeMockExplicit = true;
    installMock(import.meta.env.VITE_MOCK === '1' ? 'VITE_MOCK=1' : 'requested with ?mock=1');
    return true;
  }
  if (await backendReachable()) return false;
  installMock('backend unreachable at /api/health');
  return true;
}
