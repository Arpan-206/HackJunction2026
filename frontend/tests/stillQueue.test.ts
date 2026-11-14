import { describe, expect, it } from 'vitest';
import { createStillQueue, stillDpr, stillKey, type StillKeyParts } from '../src/three/stillQueue';

const base: StillKeyParts = { id: 'skill:grip:right:chalk', preset: 'closeup', decor: true, colors: { background: '#aabbcc' }, width: 336, height: 252, dpr: 1 };

describe('stillKey', () => {
  it('is stable for the same inputs', () => {
    expect(stillKey(base)).toBe(stillKey({ ...base }));
  });
  it('changes with every input that changes the pixels', () => {
    const k = stillKey(base);
    const variants: Partial<StillKeyParts>[] = [
      { id: 'skill:grip:left:chalk' },
      { preset: 'single' },
      { decor: false },
      { colors: { background: '#000000' } },
      { width: 337 },
      { height: 253 },
      { dpr: 2 },
    ];
    for (const v of variants) expect(stillKey({ ...base, ...v })).not.toBe(k);
  });
  it('rounds the size to whole pixels', () => {
    expect(stillKey({ ...base, width: 336.2 })).toBe(stillKey(base));
  });
});

describe('stillDpr', () => {
  it('clamps to 1..2 and survives junk', () => {
    expect(stillDpr(0.5)).toBe(1);
    expect(stillDpr(3)).toBe(2);
    expect(stillDpr(1.5)).toBe(1.5);
    expect(stillDpr(Number.NaN)).toBe(1);
  });
});

describe('createStillQueue', () => {
  const instant = () => Promise.resolve();

  it('draws one picture at a time, in the order asked, and yields between jobs', async () => {
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const q = createStillQueue<string>({ yieldToPage: async () => void log.push('yield') });
    const job = (name: string) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start ${name}`);
      await Promise.resolve();
      running--;
      return name;
    };
    const out = await Promise.all(['a', 'b', 'c'].map((n) => q.request(n, job(n)).promise));
    expect(out).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
    expect(log).toEqual(['start a', 'yield', 'start b', 'yield', 'start c', 'yield']);
  });

  it('caches by key and draws a repeated key once', async () => {
    let draws = 0;
    const q = createStillQueue<string>({ yieldToPage: instant });
    const run = async () => `pic${++draws}`;
    const [a, b] = await Promise.all([q.request('k', run).promise, q.request('k', run).promise]);
    expect(a).toBe('pic1');
    expect(b).toBe('pic1');
    expect(await q.request('k', run).promise).toBe('pic1');
    expect(q.get('k')).toBe('pic1');
    expect(draws).toBe(1);
  });

  it('skips a job nobody wants any more if it has not started', async () => {
    const q = createStillQueue<string>({ yieldToPage: instant });
    let drawnB = false;
    const a = q.request('a', async () => 'a');
    const b = q.request('b', async () => {
      drawnB = true;
      return 'b';
    });
    b.cancel();
    expect(await a.promise).toBe('a');
    expect(await b.promise).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    expect(drawnB).toBe(false);
    expect(q.get('b')).toBeUndefined();
  });

  it('does not cache a failed job, so a later request tries again', async () => {
    const q = createStillQueue<string>({ yieldToPage: instant });
    expect(await q.request('k', async () => null).promise).toBeNull();
    expect(await q.request('k', async () => {
      throw new Error('context lost');
    }).promise).toBeNull();
    expect(q.get('k')).toBeUndefined();
    expect(await q.request('k', async () => 'ok').promise).toBe('ok');
  });

  it('hands every cached picture to onEvict on clear', async () => {
    const evicted: string[] = [];
    const q = createStillQueue<string>({ yieldToPage: instant, onEvict: (v) => evicted.push(v) });
    await q.request('a', async () => 'A').promise;
    await q.request('b', async () => 'B').promise;
    q.clear();
    expect(evicted.sort()).toEqual(['A', 'B']);
    expect(q.get('a')).toBeUndefined();
  });
});
