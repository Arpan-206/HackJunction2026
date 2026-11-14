import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { coreFeedsPage, coreGlovesEndpoint, frameSource, REPLAY_HOLD_MS, replayWatch } from '../src/features/shared/replay/replayWatch';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
/** Source without comments, so a comment that names the kiosk does not count as reading it. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeAll(() => {
  // The watcher uses window timers; the test environment is node.
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('replay signal from the core', () => {
  it('reads the GloveFrame source without parsing the frame', () => {
    expect(frameSource('{"t": 1.2, "source": "replay", "hands": []}')).toBe('replay');
    expect(frameSource('{"t":0,"source":"rokoko_sdk","hands":[{"side":"right"}]}')).toBe('rokoko_sdk');
    expect(frameSource('{"type":"hello"}')).toBeNull();
    expect(frameSource(new ArrayBuffer(4))).toBeNull();
  });

  it('derives the core glove socket from the core session socket', () => {
    expect(coreGlovesEndpoint('ws://localhost:8765/ws')).toBe('ws://localhost:8765/ws/gloves');
    expect(coreGlovesEndpoint('ws://10.0.0.5:9765/ws?x=1')).toBe('ws://10.0.0.5:9765/ws/gloves?x=1');
  });

  it('watches the core where the core feeds the page: bridged backend, core screens, kiosk', () => {
    expect(coreFeedsPage('external', '/apprentice', false)).toBe(true);
    expect(coreFeedsPage('simulator', '/demo', false)).toBe(true);
    expect(coreFeedsPage(null, '/robot', false)).toBe(true);
    expect(coreFeedsPage(null, '/anything', true)).toBe(true);
    expect(coreFeedsPage('simulator', '/apprentice', false)).toBe(false);
    expect(coreFeedsPage(null, '/demolition', false)).toBe(false);
  });

  it('turns on with replay frames, holds through short gaps, and turns off on a live frame or silence', () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const unsub = replayWatch.subscribe(() => seen.push(replayWatch.getSnapshot()));
    replayWatch.onMessage('{"t":0,"source":"replay","hands":[]}');
    expect(replayWatch.getSnapshot()).toBe(true);
    vi.advanceTimersByTime(REPLAY_HOLD_MS - 100);
    expect(replayWatch.getSnapshot()).toBe(true);
    replayWatch.onMessage('{"t":0,"source":"rokoko_sdk","hands":[]}');
    expect(replayWatch.getSnapshot()).toBe(false);
    replayWatch.onMessage('{"t":0,"source":"replay","hands":[]}');
    vi.advanceTimersByTime(REPLAY_HOLD_MS + 10);
    expect(replayWatch.getSnapshot()).toBe(false);
    expect(seen).toEqual([true, false, true, false]);
    unsub();
  });
});

describe('the badge cannot be hidden', () => {
  it('is mounted unconditionally beside the routes, outside the shell and the dev panel', () => {
    const main = src('src/main.tsx');
    expect(main).toMatch(/<App \/>\s*\n(\s*\{\/\*.*\*\/\}\s*\n)?\s*<ReplayBadge \/>/);
  });

  it('reads no setting, kiosk flag, dev flag or prop', () => {
    const badge = code('src/features/shared/replay/ReplayBadge.tsx');
    expect(badge).not.toMatch(/settings|sessionPrefs|kiosk|DevPanel|dev\/|localStorage|sessionStorage|props/i);
    expect(badge).toMatch(/export function ReplayBadge\(\)/);
    const css = code('src/features/shared/replay/replay.css');
    expect(css).not.toMatch(/display:\s*none|visibility:\s*hidden|opacity:\s*0[;\s]/);
    const size = /\.replay-mark__note\s*\{[^}]*font-size:\s*(\d+)px/.exec(css);
    expect(Number(size?.[1])).toBeGreaterThanOrEqual(16);
  });
});
