import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevealFile } from '../src/features/master/files/RevealFile';
import { handleMockRequest } from '../src/mock/router';

/** The dev "Open file location" link: shown only with ?dev=1, and the mock answers a mock:// path without a file. */

function stubWindow(search: string): void {
  const session = new Map<string, string>();
  vi.stubGlobal('window', {
    location: { search },
    sessionStorage: { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => session.set(k, v), removeItem: (k: string) => session.delete(k) },
  });
  vi.stubGlobal('sessionStorage', (window as unknown as { sessionStorage: Storage }).sessionStorage);
}

afterEach(() => vi.unstubAllGlobals());

const render = () => renderToStaticMarkup(createElement(RevealFile, { kind: 'recording', id: 'abc123', what: 'take 1' }));

describe('RevealFile', () => {
  it('is hidden without dev mode', () => {
    stubWindow('');
    expect(render()).toBe('');
  });

  it('is hidden when dev mode is switched off', () => {
    stubWindow('?dev=0');
    expect(render()).toBe('');
  });

  it('shows Open file location and Copy path in dev mode', () => {
    stubWindow('?dev=1');
    const html = render();
    expect(html).toContain('Open file location');
    expect(html).toContain('Copy path');
    expect(html).toContain('aria-label="Open file location of take 1"');
  });
});

describe('the mock dev file routes', () => {
  const call = (method: string, path: string, json?: unknown, query = '') => handleMockRequest({ method, path, query: new URLSearchParams(query), json });

  it('answers a mock:// path and opens nothing', async () => {
    const res = await call('POST', '/dev/reveal', { kind: 'recording', id: 'abc123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: 'recording', id: 'abc123', path: 'mock://recordings/abc123.json', opened: false });
    const loc = await call('GET', '/dev/locate', undefined, 'kind=lesson&id=l1');
    expect(loc.status).toBe(200);
    expect((loc.body as { path: string }).path).toBe('mock://lessons/l1.json');
  });

  it('refuses an unknown kind and a path that climbs out', async () => {
    expect((await call('POST', '/dev/reveal', { kind: 'env', id: 'x' })).status).toBe(422);
    expect((await call('POST', '/dev/reveal', { kind: 'recording', id: '../../.env' })).status).toBe(400);
    expect((await call('GET', '/dev/locate', undefined, 'kind=export&id=..%2F.env')).status).toBe(400);
  });
});
