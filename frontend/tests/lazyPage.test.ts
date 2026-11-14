import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { lazyPage } from '../src/app/lazyPage';

const Hello = () => createElement('p', null, 'hello');

describe('lazyPage', () => {
  it('loads the page code once however often it is preloaded', async () => {
    const load = vi.fn(() => Promise.resolve(Hello));
    const Page = lazyPage(load);
    const [a, b] = await Promise.all([Page.preload(), Page.preload()]);
    await Page.preload();
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(Hello);
    expect(b).toBe(Hello);
  });

  it('renders a preloaded page directly, with no suspended frame', async () => {
    const Page = lazyPage(() => Promise.resolve(Hello));
    await Page.preload();
    expect(renderToString(createElement(Page))).toBe('<p>hello</p>');
  });

  it('suspends with no fallback while the code is still on its way', () => {
    const Page = lazyPage(() => new Promise(() => {}));
    expect(renderToString(createElement(Page))).not.toContain('hello');
  });

  it('tries again after a failed load', async () => {
    let fail = true;
    const load = vi.fn(() => (fail ? Promise.reject(new Error('offline')) : Promise.resolve(Hello)));
    const Page = lazyPage(load);
    await expect(Page.preload()).rejects.toThrow('offline');
    fail = false;
    await expect(Page.preload()).resolves.toBe(Hello);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
