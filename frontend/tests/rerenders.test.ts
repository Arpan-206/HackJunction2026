import { useEffect } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GloveFrame } from '../src/api/types';
import { useGloveStream } from '../src/api/useGloveStream';
import { usePlayback } from '../src/features/shared/playback';
import { handWith } from './helpers';
import { renderHook } from './hookRenderer';

// The hooks call window.setInterval; node has the same timers on globalThis.
beforeAll(() => {
  (globalThis as { window?: unknown }).window ??= globalThis;
});
afterEach(() => {
  vi.useRealTimers();
});

/** Fake timers and a fake performance clock, which the playback reads. */
const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });

const frames: GloveFrame[] = [0, 1, 2, 3].map((t) => ({ t, source: 'replay', hands: [handWith({ index: t * 10 })] }));

describe('re-renders', () => {
  it('a playback with no frames yet does not re-render its page every 100 ms', () => {
    fakeClock();
    const h = renderHook(() => usePlayback(null));
    vi.advanceTimersByTime(2000);
    expect(h.renders()).toBe(1);
    expect(h.result().position).toBe(0);
    h.unmount();
  });

  it('a playing take still moves its scrubber at 10 Hz', () => {
    fakeClock();
    const h = renderHook(() => usePlayback(frames));
    vi.advanceTimersByTime(1000);
    expect(h.renders()).toBeGreaterThanOrEqual(10);
    expect(h.result().position).toBeGreaterThan(0.5);
    h.unmount();
  });

  it('a playback whose position nobody reads (tick: false) never re-renders, and still plays', () => {
    fakeClock();
    const h = renderHook(() => usePlayback(frames, { tick: false }));
    vi.advanceTimersByTime(1500);
    expect(h.renders()).toBe(1);
    expect(h.result().getFrame('right')).not.toBeNull();
    h.unmount();
  });

  it('the glove stream handle keeps its identity across renders, so effects on it run once', () => {
    let runs = 0;
    const h = renderHook(() => {
      const g = useGloveStream(false);
      useEffect(() => {
        runs += 1;
      }, [g]);
      return g;
    });
    const first = h.result();
    for (let i = 0; i < 10; i++) h.rerender();
    expect(h.renders()).toBe(11);
    expect(h.result()).toBe(first);
    expect(runs).toBe(1);
    expect(first.status).toBe('closed');
    h.unmount();
  });
});
